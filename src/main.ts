import StreamingAvatar, {
  AvatarQuality,
  StreamingEvents,
  TaskType
} from "@heygen/streaming-avatar";
import { AudioTranscriptionService, type TranscriptionResult } from "./audioTranscriptionService";
import { TranscriptionStrategy, SPEAKER_OPTIONS, AVATAR_DEFAULTS, KNOWLEDGEBASE_BASE } from './constants';
import type { TranscriptionStrategyType } from './constants';
import { KnowledgeBaseService } from './knowledgeBaseService';
import { ContinuousListeningService } from './continuousListeningService';

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
const startRecordingButton = document.getElementById("startRecordingButton") as HTMLButtonElement;
const stopRecordingButton = document.getElementById("stopRecordingButton") as HTMLButtonElement;
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
let continuousListeningService: ContinuousListeningService | null = null;
let sharedAudioStream: MediaStream | null = null;

// Audio sensitivity monitoring
let audioContext: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let currentSilenceThreshold: number = 0.05; // Default 5%

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
    await avatar.startVoiceChat();
    console.log('🎯 Avatar voice chat started');
    avatar.muteInputAudio(); // mute by default
    
    // Enable start button, keep stop button disabled until avatar speaks
    endButton.disabled = false;
    startButton.disabled = true;
    
    // Create shared audio stream first to ensure microphone access
    console.log('🎤 Creating shared audio stream...');
    await getSharedAudioStream();

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
    // Remove knowledgeId to use custom knowledgeBase instead
    // knowledgeId: AVATAR_DEFAULTS.KNOWLEDGE_ID,
    language: AVATAR_DEFAULTS.LANGUAGE,
    voice: {},
    // Add explicit instruction to respond in English
    knowledgeBase: KNOWLEDGEBASE_BASE
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
  console.log('🎯 Avatar started talking');
  isAvatarSpeaking = true;

  // Pause transcription to avoid picking up avatar speech
  if (transcriptionService && isAutoTranscribing) {
    transcriptionService.stopRecording();
    isAutoTranscribing = false;
  }
  
  // Update UI to show avatar is speaking
  updateTranscriptionStatus('🎯 Avatar speaking...');
  
  // Enable stop speaking button when avatar starts talking
  stopSpeakingButton.disabled = false;
  if (speakButton) speakButton.disabled = true; // Disable speak button
  if (repeatButton) repeatButton.disabled = true; // Disable repeat button
}

async function handleAvatarStopTalking() {
  console.log('🎯 Avatar stopped talking');
  isAvatarSpeaking = false;
  

  // Resume transcription after avatar finishes
  if (transcriptionService && !isAutoTranscribing) {
    await startContinuousTranscription();
  }
  
  
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
    
    // Update the continuous listening service with new threshold
    if (continuousListeningService) {
      continuousListeningService.updateSilenceThreshold(currentSilenceThreshold);
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
      const isAboveThreshold = normalizedLevel > currentSilenceThreshold;
      if (continuousListeningStatus) {
        if (isAboveThreshold) {
          continuousListeningStatus.textContent = `🎧 Listening: Audio detected (${percentage}%)`;
          continuousListeningStatus.style.background = '#d4edda';
          continuousListeningStatus.style.borderColor = '#c3e6cb';
          continuousListeningStatus.style.color = '#155724';
        } else {
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

  // Stop continuous listening
  await stopContinuousListening();
  
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
  console.log('🎤 API Key present:', !!elevenlabsApiKey);
  console.log('🎤 Current strategy:', currentStrategy);
  
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
    strategy: currentStrategy
  });

  try {
    // Use shared audio stream to avoid microphone conflicts
    const audioStream = await getSharedAudioStream();
    await transcriptionService.initializeWithStream(audioStream);
    console.log('✅ Transcription service initialized with shared audio stream');
  } catch (error) {
    console.error('❌ Failed to initialize transcription service:', error);
    transcriptionService = null;
  }
}

// Get speaker prefix for transcription output using locked speaker
function getSpeakerPrefix(): string {
  if (lockedSpeaker === 'custom') {
    const customInput = document.getElementById('customSpeaker') as HTMLInputElement;
    const customName = customInput?.value.trim() || 'Speaker';
    return `[${customName}]: `;
  }
  
  const speaker = SPEAKER_OPTIONS.find(s => s.id === lockedSpeaker);
  return speaker ? speaker.prefix : '[Speaker]: ';
}

// Handle transcription start
async function handleStartTranscription() {
  if (!transcriptionService) {
    await initializeTranscriptionService();
    if (!transcriptionService) return;
  }


  try {
    await transcriptionService.startRecording(
      (result: TranscriptionResult) => {
        let transcriptionText = result.text;
        
        // Add speaker prefix for on-demand mode
        if (currentStrategy === TranscriptionStrategy.ON_DEMAND) {
          transcriptionText = getSpeakerPrefix() + transcriptionText;
        }
        
        // Store in entire transcript variable
        const separator = entireTranscript ? '\n\n' : '';
        entireTranscript = entireTranscript ? `${entireTranscript}${separator}${transcriptionText}` : transcriptionText;
        
        // Append new transcription to the output with double line break separation
        updateLiveTranscription(transcriptionText);
      },
      (error: Error) => {
        console.error('Transcription error:', error);
      }
    );
    
    startRecordingButton.disabled = true;
    stopRecordingButton.disabled = false;
    
    // Update button text based on strategy
    if (currentStrategy === TranscriptionStrategy.REAL_TIME) {
      startRecordingButton.textContent = '🎤 Recording... (Real-time)';
    } else {
      startRecordingButton.textContent = '🎤 Recording... (On-demand)';
    }
  } catch (error) {
    console.error('Failed to start recording:', error);
  }
}

// Handle transcription stop
async function handleStopTranscription() {
  // Lock in the current speaker selection at the moment stop is clicked
  if (currentStrategy === TranscriptionStrategy.ON_DEMAND) {
    lockedSpeaker = currentSpeaker;
  }
  
  if (transcriptionService) {
    await transcriptionService.stopRecording();
  }
  
  startRecordingButton.disabled = false;
  stopRecordingButton.disabled = true;
  startRecordingButton.textContent = '🎤 Start Transcription';
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
      const speakerSelect = document.getElementById('speakerSelect') as HTMLSelectElement;
      return speakerSelect ? speakerSelect.value : 'User';
    };
    
    // Handle regular transcription results (NO avatar name detection)
    const handleTranscription = (result: TranscriptionResult) => {
      if (!result.text || result.text.trim() === '') return;
      
      // Add speaker prefix and display transcription
      const speaker = result.speaker || getCurrentSpeaker();
      const transcriptionText = `[${speaker}]: ${result.text}`;
      
      updateLiveTranscription(transcriptionText);
      
      console.log('📝 Transcription added:', transcriptionText);
    };
    
    // Start transcription without name detection callback
    await transcriptionService.startRecording(
      handleTranscription,
      (error) => {
        console.error('Transcription error:', error);
        updateTranscriptionStatus('❌ Transcription error');
      },
      getCurrentSpeaker
      // NO handleNameDetection callback - completely separate from avatar
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

// Stop continuous transcription
async function stopContinuousTranscription() {
  if (transcriptionService && isAutoTranscribing) {
    console.log('🎤 Stopping continuous transcription');
    await transcriptionService.stopRecording();
    isAutoTranscribing = false;
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

// Get or create shared audio stream
async function getSharedAudioStream(): Promise<MediaStream> {
  if (!sharedAudioStream) {
    sharedAudioStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: 16000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
    console.log('🎤 Created shared audio stream for both services');
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

// Stop continuous listening
async function stopContinuousListening() {
  if (continuousListeningService) {
    await continuousListeningService.stopListening();
    continuousListeningService.cleanup();
    continuousListeningService = null;
  }
}

// Clean up on page unload
window.addEventListener('beforeunload', () => {
  if (transcriptionService) {
    transcriptionService.cleanup();
  }
  if (continuousListeningService) {
    continuousListeningService.cleanup();
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
startRecordingButton.addEventListener("click", handleStartTranscription);
stopRecordingButton.addEventListener("click", handleStopTranscription);

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
