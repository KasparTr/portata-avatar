import StreamingAvatar, {
  AvatarQuality,
  StreamingEvents,
  TaskType
} from "@heygen/streaming-avatar";
import { AudioTranscriptionService, type TranscriptionResult } from "./audioTranscriptionService";
import { TranscriptionStrategy, SPEAKER_OPTIONS, AVATAR_DEFAULTS, KNOWLEDGEBASE_BASE } from './constants';
import type { TranscriptionStrategyType } from './constants';
import { KnowledgeBaseService } from './knowledgeBaseService';

// DOM elements
const videoElement = document.getElementById("avatarVideo") as HTMLVideoElement;
const avatarPlaceholder = document.getElementById("avatarPlaceholder") as HTMLElement;
const startButton = document.getElementById(
  "startSession"
) as HTMLButtonElement;
const endButton = document.getElementById("endSession") as HTMLButtonElement;
const stopSpeakingButton = document.getElementById("stopSpeaking") as HTMLButtonElement;
const speakButton = document.getElementById("speakButton") as HTMLButtonElement;
const repeatButton = document.getElementById("repeatButton") as HTMLButtonElement;
const userInput = document.getElementById("userInput") as HTMLInputElement;
const transcriptionOutput = document.getElementById("transcriptionOutput") as HTMLTextAreaElement;
const saveTranscriptionButton = document.getElementById("saveTranscriptionButton") as HTMLButtonElement;
const sensitivityMeter = document.getElementById("sensitivityLevel") as HTMLElement;
const sensitivityValue = document.getElementById("sensitivityValue") as HTMLElement;
const silenceThreshold = document.getElementById("silenceThreshold") as HTMLInputElement;
const thresholdValue = document.getElementById("thresholdValue") as HTMLElement;
const continuousListeningStatus = document.getElementById("continuousListeningStatus") as HTMLElement;
const avatarListeningIndicator = document.getElementById("avatarListeningIndicator") as HTMLElement;
const avatarListeningLight = document.getElementById("avatarListeningLight") as HTMLElement;
const avatarListeningText = document.getElementById("avatarListeningText") as HTMLElement;
const avatarLoadingOverlay = document.getElementById("avatarLoadingOverlay") as HTMLElement;

let avatar: StreamingAvatar | null = null;
let sessionData: any = null;
let transcriptionService: AudioTranscriptionService | null = null;
let currentStrategy: TranscriptionStrategyType = TranscriptionStrategy.ON_DEMAND;
let currentSpeaker: string = SPEAKER_OPTIONS[0].id;
let previousSpeaker: string = SPEAKER_OPTIONS[0].id;
let lockedSpeaker: string = SPEAKER_OPTIONS[0].id; // Speaker locked at recording stop time
let entireTranscript: string = "";
// Removed recordingMode - unified button is now avatar-only
let isAutoTranscribing: boolean = false; // Separate flag for automatic transcription
let isAvatarSpeaking: boolean = false;
let isAvatarListening: boolean = false;
let knowledgeBaseService: KnowledgeBaseService | null = null;

// Audio sensitivity and gating
let audioContext: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let currentSilenceThreshold: number = 0.15; // Increased from 0.05 to 0.15 (15%)
let isSoundAboveThreshold: boolean = false;

// Knowledge Base
let knowledgeBaseLatest: string = "";

// Global variable to track last speaker
let lastSpeaker: string = '';

// #####################
// #### AUDIO PICKUP ###
// #####################
// pick a specific mic if you can discover it first via enumerateDevices()
const AUDIO_STREAM_CONFIG: MediaStreamConstraints = {
  audio: {
    channelCount: { ideal: 1 },
    sampleRate:   { ideal: 16000 },        // hint only; may be ignored
    echoCancellation: { ideal: true },
    noiseSuppression: { ideal: true },
    autoGainControl:  { ideal: false },    // avoid pumping room noise
    // latency:          { ideal: 0.02 },     // hint; safe to keep
    // deviceId: { exact: 'preferred-mic-id' }, // use a headset / directional mic
  }
};

let sharedAudioStream: MediaStream | null = null;


// Helper function to fetch access token
async function fetchAccessToken(): Promise<string> {
  const apiKey = import.meta.env.VITE_HEYGEN_API_KEY;
  const response = await fetch(
    "https://api.heygen.com/v1/streaming.create_token",
    {
      method: "POST",
      headers: { "x-api-key": apiKey },
    }
  );

  const { data } = await response.json();
  return data.token;
}

// Initialize streaming avatar session
async function initializeAvatarSession() {
  try {
    // Show loading overlay
    if (avatarLoadingOverlay) {
      avatarLoadingOverlay.style.display = 'flex';
    }
    console.log("Starting avatar session initialization...");
    const token = await fetchAccessToken();
    avatar = new StreamingAvatar({ token });

    avatar.on(StreamingEvents.STREAM_READY, handleStreamReady);
    avatar.on(StreamingEvents.STREAM_DISCONNECTED, handleStreamDisconnected);
    avatar.on(StreamingEvents.AVATAR_START_TALKING, handleAvatarStartTalking);
    avatar.on(StreamingEvents.AVATAR_STOP_TALKING, handleAvatarStopTalking);
    
    sessionData = await avatar.createStartAvatar(createAvatarConfig());
    console.log('🎯 Avatar session created:', !!sessionData);
    
    // Start avatar voice chat session
    avatar?.muteInputAudio(); // mute by default
    await avatar.startVoiceChat();
    setTimeout(() => {
      console.log('🎯 Avatar voice chat started');
      // Hide loading overlay
      if (avatarLoadingOverlay) {
        avatarLoadingOverlay.style.display = 'none';
      }
    }, 1000);
    
    // Enable start button, keep stop button disabled until avatar speaks
    endButton.disabled = false;
    startButton.disabled = true;
    
    // Create shared audio stream first to ensure microphone access
    console.log('🎤 Creating shared audio stream...');
    await getCleanSharedAudioStream();

    // Initialize transcription service (separate from avatar)
    console.log('🎤 Initializing transcription service...');
    await initializeTranscriptionService();

    // Start continuous transcription (completely separate from avatar)
    console.log('🎤 Starting continuous transcription...');
    await startContinuousTranscription();
    
    // Initialize audio sensitivity monitoring
    initializeAudioSensitivityMonitor();
    
    // Start audio level monitoring with shared stream
    if (sharedAudioStream) {
      startAudioLevelMonitoring(sharedAudioStream);
    }
    
    // Add toggle instructions
    updateTranscriptionStatus('🎤 Transcription active. Press SPACE to toggle avatar listening.');
    
  } catch (error) {
    console.error("Failed to initialize avatar session:", error);
    
    // Reset button states on error
    endButton.disabled = true;
    startButton.disabled = false;
    
    // Show error to user
    alert(`Failed to start avatar session: ${error}`);
  }
}


function createAvatarConfig(){
  const config = {
    quality: AvatarQuality.High,
    avatarName: AVATAR_DEFAULTS.AVATAR_NAME,
    knowledgeId: AVATAR_DEFAULTS.KNOWLEDGE_ID,
    language: AVATAR_DEFAULTS.LANGUAGE,
    voice: {},
    activityIdleTimeout: AVATAR_DEFAULTS.ACTIVITY_IDLE_TIMEOUT,
    // knowledgeBase: knowledgeBaseLatest
  }
  if(AVATAR_DEFAULTS.VOICE_ID){
    config.voice = {
      voiceId:AVATAR_DEFAULTS.VOICE_ID,
      rate: AVATAR_DEFAULTS.VOICE_RATE,
      // emotion: VoiceEmotion.FRIENDLY,
    }
  }
  return config
}

// Update transcription status display
function updateTranscriptionStatus(status: string) {
  const statusElement = document.getElementById('transcriptionStatus');
  if (statusElement) {
    statusElement.textContent = status;
  }
}

// Handle avatar speaking events
function handleAvatarStartTalking() {
  isAvatarSpeaking = true;
  // stopContinuousTranscription();
  
  // Update UI to show avatar is speaking
  updateTranscriptionStatus('🎯 Avatar speaking...');
  
  // Enable stop speaking button when avatar starts talking
  stopSpeakingButton.disabled = false;
  if (speakButton) speakButton.disabled = true; // Disable speak button
  if (repeatButton) repeatButton.disabled = true; // Disable repeat button
}

async function handleAvatarStopTalking() {
  isAvatarSpeaking = false;

  // // Resume transcription after avatar finishes
  // if (transcriptionService && !isAutoTranscribing) {
  //   console.log('🎤 Resuming continuous transcription...');
  //   await startContinuousTranscription();
  // }
  
  // Disable stop speaking button and re-enable other buttons when avatar stops
  stopSpeakingButton.disabled = true;
  if (speakButton) speakButton.disabled = false;
  if (repeatButton) repeatButton.disabled = false;
}

// Initialize audio sensitivity monitoring
function initializeAudioSensitivityMonitor() {
  // Set up threshold slider
  silenceThreshold.addEventListener('input', (e) => {
    const target = e.target as HTMLInputElement;
    currentSilenceThreshold = parseFloat(target.value);
    thresholdValue.textContent = `${Math.round(currentSilenceThreshold * 100)}%`;

    // Update transcription service threshold if it exists
    if (transcriptionService) {
      transcriptionService.updateSilenceThreshold(currentSilenceThreshold);
    }
  });
  
  // Initialize threshold display
  thresholdValue.textContent = `${Math.round(currentSilenceThreshold * 100)}%`;
  silenceThreshold.value = currentSilenceThreshold.toString();
}

// Start audio level monitoring
function startAudioLevelMonitoring(stream: MediaStream) {
  try {
    audioContext = new AudioContext();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);
    
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    function updateAudioLevel() {
      if (!analyser) return;
      
      analyser.getByteFrequencyData(dataArray);
      const average = dataArray.reduce((sum, value) => sum + value, 0) / bufferLength;
      const normalizedLevel = average / 255;
      
      // Update UI
      const percentage = Math.round(normalizedLevel * 100);
      sensitivityMeter.style.width = `${percentage}%`;
      sensitivityValue.textContent = `${percentage}%`;
      
      // Update status based on threshold
      let isAboveThreshold = normalizedLevel > currentSilenceThreshold;
      isSoundAboveThreshold = isAboveThreshold;
      if (continuousListeningStatus) {
        if (isAboveThreshold) {
          // startContinuousTranscription();
          continuousListeningStatus.textContent = `🎧 Listening: Audio detected (${percentage}%)`;
          continuousListeningStatus.style.background = '#d4edda';
          continuousListeningStatus.style.borderColor = '#c3e6cb';
          continuousListeningStatus.style.color = '#155724';
        } else {
          // stopContinuousTranscription();
          continuousListeningStatus.textContent = `🎧 Listening: Silence detected (${percentage}%)`;
          continuousListeningStatus.style.background = '#f8f9fa';
          continuousListeningStatus.style.borderColor = '#dee2e6';
          continuousListeningStatus.style.color = '#495057';
        }
      }
      
      requestAnimationFrame(updateAudioLevel);
    }
    
    updateAudioLevel();
  } catch (error) {
    console.error('Failed to initialize audio level monitoring:', error);
  }
}

// Handle when avatar stream is ready
function handleStreamReady(event: any) {
  console.log('🎯 Avatar stream ready event fired');
  
  if (event.detail && videoElement) {
    videoElement.srcObject = event.detail;
    videoElement.onloadedmetadata = () => {
      videoElement.play().catch(console.error);
      // Show video and hide placeholder
      videoElement.style.display = 'flex';
      if (avatarPlaceholder) {
        avatarPlaceholder.style.display = 'none';
      }
      console.log('🎯 Avatar video stream is now playing and ready for speech');
      
    };
  } else {
    console.log('🎯 No avatar stream available in event');
    console.log('🎯 Session data exists:', !!sessionData);
  }
}

// Handle stream disconnection
function handleStreamDisconnected() {
  console.log("Stream disconnected");
  if (videoElement) {
    videoElement.srcObject = null;
    videoElement.style.display = 'none';
  }
  
  // Show placeholder
  if (avatarPlaceholder) {
    avatarPlaceholder.style.display = 'flex';
  }

  // Enable start button and disable end button
  startButton.disabled = false;
  endButton.disabled = true;
}

// Interrupt avatar speaking (without ending session)
export async function interruptAvatar() {
  if (!avatar || !isAvatarSpeaking) return;
  await avatar.interrupt();
}

// End the avatar session
async function terminateAvatarSession() {
  if (!avatar || !sessionData) return;

  // Stop continuous transcription
  await stopContinuousTranscription();
  
  await avatar.stopAvatar();
  videoElement.srcObject = null;
  videoElement.style.display = 'none';
  avatar = null;
  
  // Show placeholder
  if (avatarPlaceholder) {
    avatarPlaceholder.style.display = 'flex';
  }
  
  // Reset button states
  startButton.disabled = false;
  endButton.disabled = true;
  speakButton.disabled = false;
  repeatButton.disabled = false;
}

// Handle speaking event
async function handleSpeak() {
  if (avatar && userInput.value) {
    const avatarText = userInput.value;
    await avatar.speak({
      text: avatarText,
    });
    
    // Inject avatar response into transcription if transcription is active
    if (transcriptionOutput.value) {
      const avatarTranscription = `[${AVATAR_DEFAULTS.AVATAR_HUMAN_NAME}]: ${avatarText}`;
      const currentText = transcriptionOutput.value;
      const separator = currentText ? '\n\n' : '';
      updateLiveTranscription(`${separator}${avatarTranscription}`);
    }
    
    // Keep the text in input field for user to see and potentially edit
    // userInput.value = ""; // Don't clear input after speaking
  }
}

// Handle talking event
async function handleRepeat() {
  if (avatar && userInput.value) {
    await avatar.speak({
      text: userInput.value,
      taskType: TaskType.REPEAT
    });
    userInput.value = ""; // Clear input after talking
  }
}

// Initialize continuous transcription service
async function initializeTranscriptionService() {
  const elevenlabsApiKey = import.meta.env.VITE_ELEVENLABS_API_KEY;
  
  console.log('🎤 Initializing transcription service...');
  
  if (!elevenlabsApiKey) {
    console.error('ElevenLabs API key not found in environment variables');
    return;
  }

  if (!AudioTranscriptionService.isSupported()) {
    console.error('Audio transcription not supported in this browser');
    return;
  }

  transcriptionService = new AudioTranscriptionService({
    apiKey: elevenlabsApiKey,
    strategy: currentStrategy,
    silenceThreshold: currentSilenceThreshold
  });

  try {
    // Use shared audio stream to avoid microphone conflicts
    const audioStream = await getCleanSharedAudioStream();
    await transcriptionService.initializeWithStream(audioStream);
    console.log('✅ Transcription service initialized');
  } catch (error) {
    console.error('❌ Failed to initialize transcription service:', error);
    transcriptionService = null;
  }
}


// Stop continuous transcription
async function stopContinuousTranscription() {
  if (transcriptionService && isAutoTranscribing) {
    console.log('🎤 Stopping continuous transcription');
    await transcriptionService.stopRecording();
    isAutoTranscribing = false;
  }
}


// Initialize knowledge base service
async function initializeKnowledgeBaseService(): Promise<KnowledgeBaseService | null> {
  const heygenApiKey = import.meta.env.VITE_HEYGEN_API_KEY;
  
  if (!heygenApiKey) {
    console.error('HeyGen API key not found in environment variables');
    return null;
  }

  const service = new KnowledgeBaseService({
    apiKey: heygenApiKey,
    knowledgeId: AVATAR_DEFAULTS.KNOWLEDGE_ID
  });

  return service;
}

// Save transcription function with knowledge base integration
async function saveTranscriptionToKnowledge() {
  try {
    const transcriptionText = transcriptionOutput.value.trim();
    knowledgeBaseLatest = KNOWLEDGEBASE_BASE + transcriptionText // not in use.
    
    if (!transcriptionText) return;

    // Initialize knowledge base service if not already done
    if (!knowledgeBaseService) {
      knowledgeBaseService = await initializeKnowledgeBaseService();
      if (!knowledgeBaseService) {
        alert('Failed to initialize knowledge base service. Please check your HeyGen API key.');
        return;
      } else {
        knowledgeBaseService.setKnowledgeId(AVATAR_DEFAULTS.KNOWLEDGE_ID);
      }
    }

    // Show loading state
    const originalButtonText = saveTranscriptionButton.textContent;
    saveTranscriptionButton.textContent = '💾 Saving...';
    saveTranscriptionButton.disabled = true;

    // Update knowledge base with transcription content
    await knowledgeBaseService.updateKnowledgeBase(transcriptionText);
    // todo:store to local storage
    localStorage.setItem('transcription', transcriptionText);

    // Show success feedback
    saveTranscriptionButton.textContent = '✅ Saved!';
    setTimeout(() => {
      saveTranscriptionButton.textContent = originalButtonText;
      saveTranscriptionButton.disabled = false;
    }, 2000);

  } catch (error) {
    console.error('Failed to save transcription to knowledge base:', error);
    
    // Reset button state
    saveTranscriptionButton.textContent = '💾 Save Transcription';
    saveTranscriptionButton.disabled = false;
    
    // Show error to user
    alert(`Failed to save transcription: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// Start continuous transcription (separate from avatar)
async function startContinuousTranscription() {
  if (!transcriptionService) {
    console.error('Transcription service not initialized');
    return;
  }

  try {
    console.log('🎤 Starting continuous transcription...');

    // Get current speaker for transcription attribution
    const getCurrentSpeaker = () => {
      // Check for selected speaker option (radio button or similar)
      const selectedSpeaker = document.querySelector('input[name="speaker"]:checked') as HTMLInputElement;
      if (selectedSpeaker) {
        return selectedSpeaker.value;
      }
      
      // Fallback to a default speaker
      return 'Panelist';
    };
    
    // Handle regular transcription results
    const updateTranscription = (result: TranscriptionResult) => {
      if (!result.text || result.text.trim() === '') return;
      
      // // Add speaker prefix and display transcription
      // const speaker = result.speaker || getCurrentSpeaker();
      // const transcriptionText = `[${speaker}]: ${result.text}`;
      
      const speaker = result.speaker || getCurrentSpeaker();
      let transcriptionText: string;
      
      // Check if speaker changed
      if (speaker !== lastSpeaker) {
        // Speaker changed - add line break and speaker name
        transcriptionText = `[${speaker}]: ${result.text}`;
        lastSpeaker = speaker;
      } else {
        // Same speaker - just add continuation with dots
        transcriptionText = `... ${result.text}`;
      }
      
      updateLiveTranscription(transcriptionText);
      
    };
    
    // Start transcription
    await transcriptionService.startRecording(
      updateTranscription,
      (error) => {
        console.error('Transcription error:', error);
        updateTranscriptionStatus('❌ Transcription error');
      },
      getCurrentSpeaker,
      undefined, // nameDetectionCallback
      () => isAvatarSpeaking // isAvatarSpeakingCallback
    );
    
    isAutoTranscribing = true;
    updateTranscriptionStatus('🎤 Transcription active');
    
    // Update pause/resume button
    const pauseResumeBtn = document.getElementById('pauseResumeTranscription') as HTMLButtonElement;
    if (pauseResumeBtn) {
      pauseResumeBtn.textContent = '⏸️ Pause Transcription';
      pauseResumeBtn.disabled = false;
    }
    
    console.log('✅ Continuous transcription started successfully');
  } catch (error) {
    console.error('Failed to start continuous transcription:', error);
    updateTranscriptionStatus('❌ Failed to start transcription');
  }
}

// Handle transcription strategy change
function handleStrategyChange() {
  const strategyRadios = document.querySelectorAll('input[name="transcriptionStrategy"]') as NodeListOf<HTMLInputElement>;
  const speakerSection = document.getElementById('speakerSelection') as HTMLElement;
  
  strategyRadios.forEach(radio => {
    if (radio.checked) {
      currentStrategy = radio.value as TranscriptionStrategyType;
      
      // Show/hide speaker selection based on strategy
      if (currentStrategy === TranscriptionStrategy.ON_DEMAND) {
        speakerSection.style.display = 'block';
      } else {
        speakerSection.style.display = 'none';
      }
      
      // Reinitialize transcription service with new strategy
      if (transcriptionService) {
        transcriptionService.cleanup();
        transcriptionService = null;
      }
    }
  });
}

// Handle speaker selection change
function handleSpeakerChange() {
  const speakerRadios = document.querySelectorAll('input[name="speaker"]') as NodeListOf<HTMLInputElement>;
  const customSpeakerInput = document.getElementById('customSpeaker') as HTMLInputElement;
  
  speakerRadios.forEach(radio => {
    if (radio.checked) {
      // Store previous speaker before changing
      previousSpeaker = currentSpeaker;
      currentSpeaker = radio.value;
      
      // Trigger buffer switch if transcription is active and speaker changed
      if (isAutoTranscribing && transcriptionService && previousSpeaker !== currentSpeaker) {
        console.log(`🎤 Speaker changed from ${previousSpeaker} to ${currentSpeaker}, triggering buffer switch`);
        transcriptionService.triggerBufferSwitch(previousSpeaker);
      }
      
      // Show/hide custom speaker input (only if element exists)
      if (customSpeakerInput) {
        if (currentSpeaker === 'custom') {
          customSpeakerInput.style.display = 'inline-block';
        } else {
          customSpeakerInput.style.display = 'none';
        }
      }
    }
  });
}

// Handle keyboard shortcuts - Toggle avatar listening
document.addEventListener('keydown', (event) => {
  // Space key for toggle avatar listening (only when not typing in input fields)
  if (event.code === 'Space' && !isTypingInInput(event.target)) {
    event.preventDefault(); // Prevent page scroll
    
    // Toggle avatar listening on space press
    if (avatar) {
      if (isAvatarListening) {
        interruptAvatar(); // needs to be interrupted first, otherwise stop will throw 400 API error.
        stopAvatarListening();
      } else {
        startAvatarListening();
      }
    }
  }
});

// Helper function to check if user is typing in an input field
function isTypingInInput(target: EventTarget | null): boolean {
  if (!target) return false;
  const element = target as HTMLElement;
  return element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.isContentEditable;
}

// wrapper in case we want to clean up the stream in the future.
async function getCleanSharedAudioStream(): Promise<MediaStream> {
  return await getSharedAudioStream()
}

// Get or create shared audio stream
async function getSharedAudioStream(): Promise<MediaStream> {
  if (!sharedAudioStream) {
    sharedAudioStream = await navigator.mediaDevices.getUserMedia(AUDIO_STREAM_CONFIG);
    // tell the encoder/transcriber this is voice, not music
    const [track] = sharedAudioStream.getAudioTracks();
    try { track.contentHint = 'speech'; } catch {}
    console.log('Created shared audio stream for both services');
  }
  return sharedAudioStream;
}

// Avatar toggle listening functions
async function startAvatarListening() {
  if (!avatar || isAvatarListening) return;
  
  try {
    console.log("Starting avatar listening (toggle)");
    // await avatar.startListening();
    avatar.unmuteInputAudio()
    isAvatarListening = true;
    updateTranscriptionStatus('🎯 Avatar listening... (press SPACE to stop)');
    updateAvatarListeningIndicator(true);
  } catch (error) {
    console.error('Failed to start avatar listening:', error);
  }
}

async function stopAvatarListening() {
  if (!avatar || !isAvatarListening) return;
  
  try {
    console.log("🎯 Stopping avatar listening (toggle)");
    // await avatar.stopListening();
    avatar.muteInputAudio()
    isAvatarListening = false;
    updateTranscriptionStatus('🎤 Transcription active. Press SPACE to toggle avatar listening.');
    updateAvatarListeningIndicator(false);
  } catch (error) {
    console.error('Failed to stop avatar listening:', error);
  }
}

// Update avatar listening visual indicator
function updateAvatarListeningIndicator(isListening: boolean) {
  if (!avatarListeningLight || !avatarListeningText || !avatarListeningIndicator) return;
  
  if (isListening) {
    // Red light when listening
    avatarListeningLight.style.background = '#dc3545';
    avatarListeningLight.style.boxShadow = '0 0 10px rgba(220, 53, 69, 0.6)';
    avatarListeningText.textContent = 'Avatar: Listening';
    avatarListeningIndicator.style.background = '#f8d7da';
    avatarListeningIndicator.style.borderColor = '#f5c6cb';
    avatarListeningIndicator.style.color = '#721c24';
    
    // Add pulsing animation
    avatarListeningLight.style.animation = 'pulse 1.5s infinite';
  } else {
    // Gray light when idle
    avatarListeningLight.style.background = '#6c757d';
    avatarListeningLight.style.boxShadow = 'none';
    avatarListeningText.textContent = 'Avatar: Idle';
    avatarListeningIndicator.style.background = '#f8f9fa';
    avatarListeningIndicator.style.borderColor = '#dee2e6';
    avatarListeningIndicator.style.color = '#495057';
    
    // Remove animation
    avatarListeningLight.style.animation = 'none';
  }
}



// Clean up on page unload
window.addEventListener('beforeunload', () => {
  if (transcriptionService) {
    transcriptionService.cleanup();
  }
});

// Generate speaker options dynamically
function generateSpeakerOptions() {
  const speakerOptionsContainer = document.getElementById('speakerOptions');
  if (!speakerOptionsContainer) return;

  speakerOptionsContainer.innerHTML = SPEAKER_OPTIONS.map((speaker, index) => `
    <label class="speaker-card">
      <input type="radio" name="speaker" value="${speaker.id}" ${index === 0 ? 'checked' : ''}>
      <span class="speaker-label">${speaker.label}</span>
    </label>
  `).join('');
}

// Initialize UI event listeners
document.addEventListener('DOMContentLoaded', () => {
  // Generate speaker options from constants
  generateSpeakerOptions();
  // Strategy selection event listeners
  const strategyRadios = document.querySelectorAll('input[name="transcriptionStrategy"]') as NodeListOf<HTMLInputElement>;
  strategyRadios.forEach(radio => {
    radio.addEventListener('change', handleStrategyChange);
  });
  
  // Speaker selection event listeners
  const speakerRadios = document.querySelectorAll('input[name="speaker"]') as NodeListOf<HTMLInputElement>;
  speakerRadios.forEach(radio => {
    radio.addEventListener('change', handleSpeakerChange);
  });
  
  // Lever controls removed - unified button is now avatar-only
  // TODO: Hide or remove lever UI elements from HTML

  
  // Save transcription button event listener
  saveTranscriptionButton.addEventListener("click", saveTranscriptionToKnowledge);
  
  // Initialize drag functionality
  
  // Initialize UI state
  handleStrategyChange();
  handleSpeakerChange();
});

// Event listeners for buttons
startButton.addEventListener("click", initializeAvatarSession);
endButton.addEventListener("click", terminateAvatarSession);
stopSpeakingButton.addEventListener("click", interruptAvatar);
speakButton.addEventListener("click", handleSpeak);
repeatButton.addEventListener("click", handleRepeat);

// Update live transcription with automatic saving
function updateLiveTranscription(text: string) {
  try {
    const currentText = transcriptionOutput.value;
    const separator = currentText ? '\n\n' : '';
    transcriptionOutput.value = currentText + separator + text;
    transcriptionOutput.scrollTop = transcriptionOutput.scrollHeight;
    
    // Auto-save transcription after each update
    saveTranscriptionToKnowledge();
  } catch (error) {
    
  }

}

// // Pop-out controls functionality
// function popOutControls() {
//   if (isControlsPoppedOut) {
//     popInControls();
//     return;
//   }

//   if (popOutWindow && !popOutWindow.closed) {
//     popOutWindow.focus();
//     return;
//   }

//   // Create pop-out window for controls
//   popOutWindow = window.open('', 'ControlsWindow', 
//     'width=800,height=600,resizable=yes,scrollbars=yes,toolbar=no,menubar=no,location=no,status=no'
//   );

//   if (!popOutWindow) return;

//   // Set up the controls window
//   popOutWindow.document.write(`
//     <!DOCTYPE html>
//     <html>
//     <head>
//       <title>Avatar Controls</title>
//       <style>
//         body { 
//           margin: 20px; 
//           font-family: system-ui, -apple-system, sans-serif;
//           background: #f5f5f5;
//         }
//         section {
//           background: white;
//           padding: 20px;
//           margin: 15px 0;
//           border-radius: 8px;
//           box-shadow: 0 2px 8px rgba(0,0,0,0.1);
//         }
//         button {
//           margin: 5px;
//           padding: 10px 15px;
//           border: none;
//           border-radius: 6px;
//           cursor: pointer;
//           font-size: 14px;
//         }
//         input, textarea {
//           width: 100%;
//           padding: 10px;
//           border: 1px solid #ddd;
//           border-radius: 6px;
//           margin: 5px 0;
//         }
//         textarea {
//           height: 200px;
//           resize: vertical;
//         }
//       </style>
//     </head>
//     <body>
//       <h2>Avatar Controls</h2>
//       <div id="controlsContainer"></div>
//     </body>
//     </html>
//   `);

//   // Clone controls to pop-out window
//   const controlsSection = document.getElementById('controlsSection');
//   const popOutContainer = popOutWindow.document.getElementById('controlsContainer');
  
//   if (controlsSection && popOutContainer) {
//     // Clone the controls (not move, to avoid breaking functionality)
//     const clonedControls = controlsSection.cloneNode(true) as HTMLElement;
//     popOutContainer.appendChild(clonedControls);
    
//     // Hide original controls
//     controlsSection.style.display = 'none';
//   }

//   // Update button text
//   popOutButton.textContent = '📥 Pop In Controls';
//   isControlsPoppedOut = true;

//   // Handle window close
//   popOutWindow.addEventListener('beforeunload', () => {
//     popInControls();
//   });
// }


// function popInControls() {
//   if (popOutWindow && !popOutWindow.closed) {
//     popOutWindow.close();
//   }
  
//   // Move elements back to main window
//   const mainContainer = document.getElementById('avatarContainer');
//   const avatarVideo = popOutWindow?.document.getElementById('avatarVideo') || document.getElementById('avatarVideo');
//   const avatarPlaceholder = popOutWindow?.document.getElementById('avatarPlaceholder') || document.getElementById('avatarPlaceholder');
  
//   if (mainContainer) {
//     if (avatarVideo) {
//       mainContainer.appendChild(avatarVideo);
//     }
    
//     if (avatarPlaceholder) {
//       mainContainer.appendChild(avatarPlaceholder);
//     }
//   }

//   // Update button text
//   popOutButton.textContent = '↗️';
//   isControlsPoppedOut = false;
//   popOutWindow = null;
// }

// document.addEventListener('DOMContentLoaded', () => {
//   const popOutBtn = document.getElementById('popOutButton');
//   const controls = document.getElementById('controlsSection');
//   if (!popOutBtn || !controls) return;

//   // @ts-ignore
//   let popup = null;
//   // placeholder to remember where controls were
//   const placeholder = document.createComment('controls-section-placeholder');

//   popOutBtn.addEventListener('click', () => {
//     // already popped out? focus it
//     // @ts-ignore
//     if (popup && !popup.closed) {
//       popup.focus();
//       return;
//     }

//     // open a bare popup
//     popup = window.open('', 'ControlsPopup', 'width=700,height=900,resizable=yes,scrollbars=yes');
//     if (!popup) {
//       alert('Please allow pop-ups for this site to pop out controls.');
//       return;
//     }

//     // minimal HTML + PicoCSS so styling remains
//     popup.document.write(`
//       <!DOCTYPE html>
//       <html lang="en">
//       <head>
//         <meta charset="UTF-8" />
//         <title>Controls</title>
//         <meta name="viewport" content="width=device-width, initial-scale=1.0" />
//         <link rel="stylesheet"
//           href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css" />
//         <style>
//           body { margin: 16px;width:100%; }
//           header { display:flex; justify-content: space-between; align-items:center; margin-bottom:12px; }
//         </style>
//       </head>
//       <body>
//         <header>
//           <strong>Controls</strong>
//           <button id="returnBtn">Return to main</button>
//         </header>
//       </body>
//       </html>
//     `);
//     popup.document.close();

//     // move the real node (no clone) so all event listeners keep working
//     controls.replaceWith(placeholder); // remember original spot
//     const moved = popup.document.adoptNode(controls);
//     popup.document.body.appendChild(moved);

//     // hide the pop-out button while in popup (optional)
//     const btnInPopup = popup.document.getElementById('popOutButton');
//     if (btnInPopup) btnInPopup.style.display = 'none';

//     // handle "return to main"
//     const returnBtn = popup.document.getElementById('returnBtn');
//     const returnControls = () => {
//       //@ts-ignore
//       if (!popup || popup.closed) return; // already handled
//       const back = document.adoptNode(moved);
//       placeholder.replaceWith(back);
//       popup.close();
//     };
//     returnBtn?.addEventListener('click', returnControls);

//     // if user closes the popup window, return controls automatically
//     popup.addEventListener('beforeunload', () => {
//       try {
//         if (moved && placeholder.isConnected) {
//           const back = document.adoptNode(moved);
//           placeholder.replaceWith(back);
//         }
//       } catch (_) { /* noop */ }
//     });
//   });
// });

// --- pop out controls (TypeScript-safe, simple) ---
document.addEventListener('DOMContentLoaded', () => {
  const popOutBtn = document.getElementById('popOutButton') as HTMLButtonElement | null;
  const controls = document.getElementById('controlsSection') as HTMLElement | null;
  if (!popOutBtn || !controls) return;

  popOutBtn.addEventListener('click', () => {
    const popup = window.open('', 'ControlsPopup', 'width=700,height=900,resizable=yes,scrollbars=yes');
    if (!popup) {
      alert('please allow pop-ups to pop out controls.');
      return;
    }

    // write minimal scaffold
    popup.document.write(`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Controls</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css" />
<style> body{ margin:16px } </style>
</head><body>
  <div id="popupControls"></div>
</body></html>`);
    popup.document.close();

    const mount = popup.document.getElementById('popupControls') as HTMLElement | null;
    if (!mount) return;

    // make a visual clone (no logic attached)
    const clone = controls.cloneNode(true) as HTMLElement;

    // remove pop-out button inside the clone (avoid recursion)
    const cloneBtn = clone.querySelector('#popOutButton') as HTMLElement | null;
    if (cloneBtn) cloneBtn.remove();

    mount.appendChild(clone);

    // hide original controls so you can share only the video section
    const prevDisplay = controls.style.display;
    controls.style.display = 'none';

    // helper: find original element by id (in main window)
    const findOriginal = (id?: string | null): HTMLElement | null =>
      id ? (document.getElementById(id) as HTMLElement | null) : null;

    // forward clicks in popup → trigger original handlers
    mount.addEventListener('click', (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const clickable = target.closest('[id]') as HTMLElement | null;
      if (!clickable?.id) return;

      const orig = findOriginal(clickable.id);
      if (!orig) return;

      if (orig.tagName === 'BUTTON') {
        e.preventDefault();
        (orig as HTMLButtonElement).click();
      }
    });

    // forward input/value changes (text, range, checkbox, radio, select)
    function forwardValue(src: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement) {
      const orig = findOriginal(src.id);
      if (!orig) return;

      // text, range, select
      if ('value' in orig) {
        (orig as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value = src.value;
      }
      // checkbox / radio
      if ((src as HTMLInputElement).type === 'checkbox' || (src as HTMLInputElement).type === 'radio') {
        (orig as HTMLInputElement).checked = (src as HTMLInputElement).checked;
      }

      // fire events so existing listeners react
      orig.dispatchEvent(new Event('input', { bubbles: true }));
      orig.dispatchEvent(new Event('change', { bubbles: true }));
    }

    mount.addEventListener('input', (e: Event) => {
      const el = e.target as Element | null;
      if (!el) return;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
        forwardValue(el as any);
      }
    });

    mount.addEventListener('change', (e: Event) => {
      const el = e.target as Element | null;
      if (!el) return;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
        forwardValue(el as any);
      }
    });

    // one-time initial sync so clone shows current values
    const inputs = clone.querySelectorAll('input[id], textarea[id], select[id]');
    inputs.forEach((src) => {
      const orig = findOriginal((src as HTMLElement).id);
      if (!orig) return;

      if (src instanceof HTMLInputElement || src instanceof HTMLTextAreaElement || src instanceof HTMLSelectElement) {
        if ('value' in orig && 'value' in src) {
          (src as any).value = (orig as any).value;
        }
        if (src.type === 'checkbox' || src.type === 'radio') {
          //@ts-ignore
          src.checked = (orig as HTMLInputElement).checked;
        }
      }
    });

    // restore original controls when popup closes
    const restore = () => {
      controls.style.display = prevDisplay || '';
    };
    popup.addEventListener('beforeunload', restore);
  });
});
