import * as sdk from "@d-id/client-sdk";
import { AudioTranscriptionService, } from "./audioTranscriptionService";
import { TranscriptionStrategy, SPEAKER_OPTIONS, AVATAR_DEFAULTS, AVATAR_INTRO_TEXT, DID_AGENT_CONFIG } from './constants';
import type { TranscriptionStrategyType } from './constants';
import { KnowledgeBaseService } from './knowledgeBaseService';
import { querySeekerRAG, type SeekerMessage } from './seekerService';

// Password Protection
const PASSWORD_PROTECTION_ENABLED = import.meta.env.VITE_PASSWORD_PROTECTION_ENABLED === 'true';
const APP_PASSWORD = import.meta.env.VITE_APP_PASSWORD;

function initializePasswordProtection() {
  if (!PASSWORD_PROTECTION_ENABLED) {
    return;
  }

  const passwordProtection = document.getElementById('passwordProtection') as HTMLElement;
  const mainContent = document.getElementById('mainContent') as HTMLElement;
  const passwordInput = document.getElementById('passwordInput') as HTMLInputElement;
  const passwordSubmit = document.getElementById('passwordSubmit') as HTMLButtonElement;
  const passwordError = document.getElementById('passwordError') as HTMLElement;

  // Check if already authenticated
  const isAuthenticated = sessionStorage.getItem('authenticated') === 'true';

  if (isAuthenticated) {
    mainContent.style.display = 'block';
    return;
  }

  // Show password protection
  passwordProtection.style.display = 'flex';
  mainContent.style.display = 'none';

  const checkPassword = () => {
    const enteredPassword = passwordInput.value;

    if (enteredPassword === APP_PASSWORD) {
      sessionStorage.setItem('authenticated', 'true');
      passwordProtection.style.display = 'none';
      mainContent.style.display = 'block';
      passwordError.style.display = 'none';
    } else {
      passwordError.style.display = 'block';
      passwordInput.value = '';
      passwordInput.focus();
    }
  };

  passwordSubmit.addEventListener('click', checkPassword);
  passwordInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      checkPassword();
    }
  });

  // Focus on password input
  setTimeout(() => passwordInput.focus(), 100);
}

// Initialize password protection immediately
initializePasswordProtection();

// DOM elements
const videoElement = document.getElementById("avatarVideo") as HTMLVideoElement;
const avatarPlaceholder = document.getElementById("avatarPlaceholder") as HTMLElement;
const startButton = document.getElementById(
  "startSession"
) as HTMLButtonElement;
const stopSessionButton = document.getElementById("stopSession") as HTMLButtonElement;
const skipButton = document.getElementById("skipButton") as HTMLButtonElement;
const endButton = document.getElementById("endSession") as HTMLButtonElement;
const stopSpeakingButton = document.getElementById("stopSpeaking") as HTMLButtonElement;
const speakButton = document.getElementById("speakButton") as HTMLButtonElement;
const repeatButton = document.getElementById("repeatButton") as HTMLButtonElement;
const userInput = document.getElementById("userInput") as HTMLInputElement;
const transcriptionOutput = document.getElementById("transcriptionOutput") as HTMLTextAreaElement;
const saveTranscriptionButton = document.getElementById("saveTranscriptionButton") as HTMLButtonElement;
const sensitivityMeter = document.getElementById("sensitivityLevel") as HTMLElement;
const sensitivityValue = document.getElementById("sensitivityValue") as HTMLElement;
// const silenceThreshold = document.getElementById("silenceThreshold") as HTMLInputElement;
// const thresholdValue = document.getElementById("thresholdValue") as HTMLElement;
const continuousListeningStatus = document.getElementById("continuousListeningStatus") as HTMLElement;
const avatarListeningIndicator = document.getElementById("avatarListeningIndicator") as HTMLElement;
const avatarListeningLight = document.getElementById("avatarListeningLight") as HTMLElement;
const avatarListeningText = document.getElementById("avatarListeningText") as HTMLElement;
const avatarLoadingOverlay = document.getElementById("avatarLoadingOverlay") as HTMLElement;
const seekerChatbox = document.getElementById("seekerChatbox") as HTMLElement;
// const seekerChatboxContainer = document.getElementById("seekerChatboxContainer") as HTMLElement;
const seekerInput = document.getElementById("seekerInput") as HTMLInputElement;
const seekerAskButton = document.getElementById("seekerAskButton") as HTMLButtonElement;

let agentManager: any = null;
let isConnected: boolean = false;
let transcriptionService: AudioTranscriptionService | null = null;
let currentStrategy: TranscriptionStrategyType = TranscriptionStrategy.ON_DEMAND;
let currentSpeaker: string = SPEAKER_OPTIONS[0].id;
let previousSpeaker: string = SPEAKER_OPTIONS[0].id;
// let lockedSpeaker: string = SPEAKER_OPTIONS[0].id; // Speaker locked at recording stop time
// let entireTranscript: string = "";
// Removed recordingMode - unified button is now avatar-only
let isAutoTranscribing: boolean = false; // Separate flag for automatic transcription
let isAvatarSpeaking: boolean = false;
let isAvatarListening: boolean = false;
let knowledgeBaseService: KnowledgeBaseService | null = null;
let seekerMessageHistory: SeekerMessage[] = [
  // {
  //   role: "assistant",
  //   content: "Oled nüüd režiimis 'Ehitamisega seotud küsimused'. Režiimi saad muuta menüüst. Seniks esita oma küsimused siia.?"
  // }
];

// Audio sensitivity and gating
let audioContext: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let currentSilenceThreshold: number = 0.15; // Increased from 0.05 to 0.15 (15%)
// let isSoundAboveThreshold: boolean = false;

// Knowledge Base
// let knowledgeBaseLatest: string = "";

// Global variable to track last speaker
// let lastSpeaker: string = '';

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


// Helper function to fetch D-ID credentials via backend proxy
// async function fetchDIDCredentials(): Promise<{ username: string; password: string }> {
//   const response = await fetch(API_ENDPOINTS.DID_AUTH, {
//     method: "POST",
//   });

//   if (!response.ok) {
//     throw new Error(`Failed to fetch D-ID credentials: ${response.status}`);
//   }

//   const data = await response.json();
//   return { username: data.username, password: data.password };
// }

// INFO: https://www.npmjs.com/package/@d-id/client-sdk
// Initialize streaming avatar session with D-ID
async function initializeAvatarSession() {
  try {
    // Show loading overlay
    if (avatarLoadingOverlay) {
      avatarLoadingOverlay.style.display = 'flex';
    }
    console.log("Starting D-ID avatar session initialization...");

    // Fetch D-ID credentials from backend
    // const credentials = await fetchDIDCredentials();

    // Create Basic Auth token
    // const authToken = btoa(`${credentials.username}:${credentials.password}`);

    // Set up D-ID callbacks
    const callbacks = {
      onSrcObjectReady: (value: MediaStream) => {
        console.log('🎯 D-ID stream ready');
        if (videoElement) {
          videoElement.srcObject = value;
          videoElement.onloadedmetadata = () => {
            videoElement.play().catch(console.error);
            // Show video and hide placeholder
            videoElement.style.display = 'flex';
            if (avatarPlaceholder) {
              avatarPlaceholder.style.display = 'none';
            }
            console.log('🎯 D-ID video stream is now playing');
          };
        }
        return value;
      },
      onConnectionStateChange: (state: string) => {
        console.log('🎯 D-ID connection state:', state);
        if (state === 'connected') {
          isConnected = true;
          console.log('🎯 D-ID agent connected successfully');
        } else if (state === 'disconnected' || state === 'closed' || state === 'fail') {
          handleStreamDisconnected();
        }
      },
      onVideoStateChange: (state: string) => {
        console.log('🎯 D-ID video state:', state);
        if (state === 'STOP') {
          handleAvatarStopTalking();
          // if(agentManager) agentManager.reconnect()
        } else {
          handleAvatarStartTalking();
        }
      },
      onError: (error: any, errorData: any) => {
        console.error('🎯 D-ID error:', error, errorData);
      }
    };

    // // Create D-ID agent manager
    // const auth = {
    //   type: 'bearer' as const,
    //   token: authToken
    // };

    const streamOptions = {
      compatibilityMode: 'auto' as const,
      streamWarmup: true,
      // sessionTimeout: 300 // Maximum session timeout in seconds (5 minutes)
    };

    // 3. Paste the 'data-client-key' in the 'auth.clientKey' variable
    const auth = { type: 'key' as const, clientKey: 'Z29vZ2xlLW9hdXRoMnwxMTEyOTI4MjA1MzkxMjYyODMzNzA6UWtqRFM5eUFIOGl0N2xLMElVN0No' };

    agentManager = await sdk.createAgentManager(DID_AGENT_CONFIG.AGENT_ID, {
      auth,
      callbacks,
      streamOptions,
      mode: 'Functional' as any
    });

    console.log('🎯 D-ID agent manager created');

    // Connect to the agent
    await agentManager.connect();
    console.log('🎯 D-ID agent connection initiated');

    // Toggle session buttons
    startButton.style.display = 'none';
    if (stopSessionButton) stopSessionButton.style.display = 'flex';
    if (skipButton) skipButton.disabled = false;
    if (endButton) endButton.disabled = false;

    // Enable seeker chatbox
    if (seekerInput) seekerInput.disabled = false;
    if (seekerAskButton) seekerAskButton.disabled = false;

    // Create shared audio stream first to ensure microphone access
    console.log('🎤 Creating shared audio stream...');
    await getCleanSharedAudioStream();

    // Start audio level monitoring with shared stream
    if (sharedAudioStream) {
      startAudioLevelMonitoring(sharedAudioStream);
    }

    if (avatarLoadingOverlay) {
      avatarLoadingOverlay.style.display = 'none';
    }

    // Start the avatar intro
    startAvatarIntro()
  } catch (error) {
    console.error("Failed to initialize D-ID avatar session:", error);

    // Reset button states on error
    if (endButton) endButton.disabled = true;
    startButton.style.display = 'flex';
    if (stopSessionButton) stopSessionButton.style.display = 'none';
    if (skipButton) skipButton.disabled = true;

    // Keep seeker chatbox disabled on error
    if (seekerInput) seekerInput.disabled = true;
    if (seekerAskButton) seekerAskButton.disabled = true;

    // Hide loading overlay
    if (avatarLoadingOverlay) {
      avatarLoadingOverlay.style.display = 'none';
    }

    // Show error to user
    alert(`Failed to start D-ID avatar session: ${error}`);
  }
}

function startAvatarIntro() {
  handleRepeatThis(AVATAR_INTRO_TEXT)
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

  // Fade input box to background
  if (seekerChatbox) {
    seekerChatbox.style.opacity = '0.3';
    seekerChatbox.style.pointerEvents = 'none';
  }

  // Enable stop speaking button when avatar starts talking
  if (stopSpeakingButton) stopSpeakingButton.disabled = false;
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

  // Restore input box focus
  if (seekerChatbox) {
    seekerChatbox.style.opacity = '1';
    seekerChatbox.style.pointerEvents = 'auto';
  }

  // Disable stop speaking button and re-enable other buttons when avatar stops
  if (stopSpeakingButton) stopSpeakingButton.disabled = true;
  if (speakButton) speakButton.disabled = false;
  if (repeatButton) repeatButton.disabled = false;
}

// Initialize audio sensitivity monitoring
// function initializeAudioSensitivityMonitor() {
//   // Set up threshold slider
//   silenceThreshold.addEventListener('input', (e) => {
//     const target = e.target as HTMLInputElement;
//     currentSilenceThreshold = parseFloat(target.value);
//     thresholdValue.textContent = `${Math.round(currentSilenceThreshold * 100)}%`;

//     // Update transcription service threshold if it exists
//     if (transcriptionService) {
//       transcriptionService.updateSilenceThreshold(currentSilenceThreshold);
//     }
//   });
  
//   // Initialize threshold display
//   thresholdValue.textContent = `${Math.round(currentSilenceThreshold * 100)}%`;
//   silenceThreshold.value = currentSilenceThreshold.toString();
// }

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
      // isSoundAboveThreshold = isAboveThreshold;
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
  if(startButton) startButton.disabled = false;
  if(endButton) endButton.disabled = true;
}

// Interrupt avatar speaking (D-ID doesn't have direct interrupt, so we'll handle it differently)
export async function interruptAvatar() {
  if (!agentManager || !isAvatarSpeaking) return;
  // D-ID doesn't have a direct interrupt method, but stopping speaking will be handled by state changes
  console.log('🎯 Interrupt requested (D-ID)');
}

// End the avatar session
async function terminateAvatarSession() {
  // Stop D-ID agent if it exists
  if (agentManager && isConnected) {
    // Stop continuous transcription
    await stopContinuousTranscription();

    await agentManager.disconnect();
    agentManager = null;
    isConnected = false;
  }

  // Always reset UI regardless of avatar state
  videoElement.srcObject = null;
  videoElement.style.display = 'none';

  // Show placeholder
  if (avatarPlaceholder) {
    avatarPlaceholder.style.display = 'flex';
  }

  // Reset button states
  startButton.style.display = 'flex';
  if (stopSessionButton) stopSessionButton.style.display = 'none';
  if (skipButton) skipButton.disabled = true;
  if (endButton) endButton.disabled = true;
  if (speakButton) speakButton.disabled = false;
  if (repeatButton) repeatButton.disabled = false;

  // Disable seeker chatbox and restore opacity
  if (seekerInput) seekerInput.disabled = true;
  if (seekerAskButton) seekerAskButton.disabled = true;
  if (seekerChatbox) {
    seekerChatbox.style.opacity = '1';
    seekerChatbox.style.pointerEvents = 'auto';
  }
}

async function handleSeekerReply(reply?: string) {
  if (agentManager && reply) {
    await agentManager.speak({
      type: 'text',
      input: reply
    });
  }
}

// Handle speaking event
async function handleSpeak() {
  if (agentManager && userInput && userInput.value) {
    const avatarText = userInput.value;
    await agentManager.speak({
      type: 'text',
      input: avatarText
    });

    // Inject avatar response into transcription if transcription is active
    if (transcriptionOutput && transcriptionOutput.value) {
      const avatarTranscription = `[${AVATAR_DEFAULTS.AVATAR_HUMAN_NAME}]: ${avatarText}`;
      const currentText = transcriptionOutput.value;
      const separator = currentText ? '\n\n' : '';
      updateLiveTranscription(`${separator}${avatarTranscription}`);
    }
  }
}

// Handle talking event
async function handleRepeatThis(repeateThis?: string) {
  if (agentManager && repeateThis) {
    await agentManager.speak({
      type: 'text',
      input: repeateThis
    });
  }
}

// Handle talking event
async function handleRepeat() {
  if (userInput) {
    handleRepeatThis(userInput.value)
    userInput.value = ""; // Clear input after talking
  }
}



// Initialize continuous transcription service
// async function initializeTranscriptionService() {
//   console.log('🎤 Initializing transcription service...');

//   if (!AudioTranscriptionService.isSupported()) {
//     console.error('Audio transcription not supported in this browser');
//     return;
//   }

//   // API key is no longer needed on the client side - backend proxy handles it
//   transcriptionService = new AudioTranscriptionService({
//     apiKey: '', // Empty - backend proxy will use server-side key
//     strategy: currentStrategy,
//     silenceThreshold: currentSilenceThreshold
//   });

//   try {
//     // Use shared audio stream to avoid microphone conflicts
//     const audioStream = await getCleanSharedAudioStream();
//     await transcriptionService.initializeWithStream(audioStream);
//     console.log('✅ Transcription service initialized');
//   } catch (error) {
//     console.error('❌ Failed to initialize transcription service:', error);
//     transcriptionService = null;
//   }
// }


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
  // Note: If KnowledgeBaseService makes direct API calls, it also needs to be proxied
  // For now, we'll return null or update the service to use proxied endpoints
  console.warn('KnowledgeBaseService needs backend proxy implementation');
  return null;
}

// Save transcription function with knowledge base integration
async function saveTranscriptionToKnowledge() {
  try {
    const transcriptionText = transcriptionOutput.value.trim();
    // knowledgeBaseLatest = KNOWLEDGEBASE_BASE + transcriptionText // not in use.
    
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

// // Start continuous transcription (separate from avatar)
// async function startContinuousTranscription() {
//   if (!transcriptionService) {
//     console.error('Transcription service not initialized');
//     return;
//   }

//   try {
//     console.log('🎤 Starting continuous transcription...');

//     // Get current speaker for transcription attribution
//     const getCurrentSpeaker = () => {
//       // Check for selected speaker option (radio button or similar)
//       const selectedSpeaker = document.querySelector('input[name="speaker"]:checked') as HTMLInputElement;
//       if (selectedSpeaker) {
//         return selectedSpeaker.value;
//       }
      
//       // Fallback to a default speaker
//       return 'Panelist';
//     };
    
//     // Handle regular transcription results
//     const updateTranscription = (result: TranscriptionResult) => {
//       if (!result.text || result.text.trim() === '') return;
      
//       // // Add speaker prefix and display transcription
//       // const speaker = result.speaker || getCurrentSpeaker();
//       // const transcriptionText = `[${speaker}]: ${result.text}`;
      
//       const speaker = result.speaker || getCurrentSpeaker();
//       let transcriptionText: string;
      
//       // Check if speaker changed
//       if (speaker !== lastSpeaker) {
//         // Speaker changed - add line break and speaker name
//         transcriptionText = `[${speaker}]: ${result.text}`;
//         lastSpeaker = speaker;
//       } else {
//         // Same speaker - just add continuation with dots
//         transcriptionText = `... ${result.text}`;
//       }
      
//       updateLiveTranscription(transcriptionText);
      
//     };
    
//     // Start transcription
//     await transcriptionService.startRecording(
//       updateTranscription,
//       (error) => {
//         console.error('Transcription error:', error);
//         updateTranscriptionStatus('❌ Transcription error');
//       },
//       getCurrentSpeaker,
//       undefined, // nameDetectionCallback
//       () => isAvatarSpeaking // isAvatarSpeakingCallback
//     );
    
//     isAutoTranscribing = true;
//     updateTranscriptionStatus('🎤 Transcription active');
    
//     // Update pause/resume button
//     const pauseResumeBtn = document.getElementById('pauseResumeTranscription') as HTMLButtonElement;
//     if (pauseResumeBtn) {
//       pauseResumeBtn.textContent = '⏸️ Pause Transcription';
//       pauseResumeBtn.disabled = false;
//     }
    
//     console.log('✅ Continuous transcription started successfully');
//   } catch (error) {
//     console.error('Failed to start continuous transcription:', error);
//     updateTranscriptionStatus('❌ Failed to start transcription');
//   }
// }

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
    if (agentManager) {
      if (isAvatarListening) {
        interruptAvatar();
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

// Avatar toggle listening functions (D-ID handles audio differently)
async function startAvatarListening() {
  if (!agentManager || isAvatarListening) return;

  try {
    console.log("Starting avatar listening (toggle) - D-ID");
    // D-ID doesn't have explicit mute/unmute methods in the docs
    // Audio handling is done through WebRTC connection
    isAvatarListening = true;
    updateTranscriptionStatus('🎯 Avatar listening... (press SPACE to stop)');
    updateAvatarListeningIndicator(true);
  } catch (error) {
    console.error('Failed to start avatar listening:', error);
  }
}

async function stopAvatarListening() {
  if (!agentManager || !isAvatarListening) return;

  try {
    console.log("🎯 Stopping avatar listening (toggle) - D-ID");
    // D-ID doesn't have explicit mute/unmute methods in the docs
    // Audio handling is done through WebRTC connection
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
    avatarListeningText.textContent = 'Listening';
    avatarListeningIndicator.style.background = '#f8d7da';
    avatarListeningIndicator.style.borderColor = '#f5c6cb';
    avatarListeningIndicator.style.color = '#721c24';
    
    // Add pulsing animation
    avatarListeningLight.style.animation = 'pulse 1.5s infinite';
  } else {
    // Gray light when idle
    avatarListeningLight.style.background = '#6c757d';
    avatarListeningLight.style.boxShadow = 'none';
    avatarListeningText.textContent = 'Idle';
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
  if (saveTranscriptionButton) {
    saveTranscriptionButton.addEventListener("click", saveTranscriptionToKnowledge);
  }

  // Seeker chatbox event listeners
  if (seekerAskButton) {
    seekerAskButton.addEventListener("click", handleSeekerAsk);
  }
  if (seekerInput) {
    seekerInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        handleSeekerAsk();
      }
    });
  }
  
  // Initialize drag functionality
  
  // Initialize UI state
  handleStrategyChange();
  handleSpeakerChange();
});

// Event listeners for buttons
startButton.addEventListener("click", initializeAvatarSession);
if (stopSessionButton) {
  stopSessionButton.addEventListener("click", terminateAvatarSession);
}
if (skipButton) {
  skipButton.addEventListener("click", interruptAvatar);
}
if (endButton) {
  endButton.addEventListener("click", terminateAvatarSession);
}
if (stopSpeakingButton) {
  stopSpeakingButton.addEventListener("click", interruptAvatar);
}
if (speakButton) {
  speakButton.addEventListener("click", handleSpeak);
}
if (repeatButton) {
  repeatButton.addEventListener("click", handleRepeat);
}

// Update live transcription with automatic saving
function updateLiveTranscription(text: string) {
  try {
    if (!transcriptionOutput) return;

    const currentText = transcriptionOutput.value;
    const separator = currentText ? '\n\n' : '';
    transcriptionOutput.value = currentText + separator + text;
    transcriptionOutput.scrollTop = transcriptionOutput.scrollHeight;

    // Auto-save transcription after each update
    // saveTranscriptionToKnowledge();
  } catch (error) {

  }

}

// Handle Seeker RAG query
async function handleSeekerAsk() {
  const question = seekerInput.value.trim();
  
  if (!question) {
    console.warn('⚠️ Seeker: No question provided');
    return;
  }
  
  console.log('🔍 System: History:', seekerMessageHistory);
  console.log('🔍 User: Asking question:', question);
  
  // Disable button while processing
  seekerAskButton.disabled = true;
  seekerAskButton.textContent = 'Küsin...';

  // Fade input box to background while loading
  if (seekerChatbox) {
    seekerChatbox.style.opacity = '0.3';
    seekerChatbox.style.pointerEvents = 'none';
  }

  let shouldRestoreOpacity = false;

  try {

    // Query Seeker RAG
    const response = await querySeekerRAG(question, seekerMessageHistory);

    if (response.error) {
      console.error('❌ Seeker error:', response.error);
      alert(`Seeker error: ${response.error}`);
      shouldRestoreOpacity = true;
    } else {
      // Log the response to console
      console.log('✅ Seeker response:', response.reply);

      if (response.reply) {
        handleSeekerReply(response.reply);
        // Don't restore opacity - avatar will speak and handleAvatarStopTalking will restore it
        shouldRestoreOpacity = false;
      } else {
        // No reply to speak, restore opacity
        shouldRestoreOpacity = true;
      }

      // Update history
      if (response.reply) {
        // Add user message to history
        seekerMessageHistory.push({
          role: 'user',
          content: question
        });

        // Add assistant response to history
        seekerMessageHistory.push({
          role: 'assistant',
          content: response.reply
        });
      }

      // Clear input
      seekerInput.value = '';
    }
  } catch (error) {
    console.error('❌ Seeker request failed:', error);
    alert('Failed to query Seeker. Check console for details.');
    shouldRestoreOpacity = true;
  } finally {
    // Re-enable button
    seekerAskButton.disabled = false;
    seekerAskButton.textContent = 'Küsi';

    // Only restore input box visibility if there was an error or no reply
    // Otherwise, let handleAvatarStopTalking restore it when avatar finishes speaking
    if (shouldRestoreOpacity && seekerChatbox) {
      seekerChatbox.style.opacity = '1';
      seekerChatbox.style.pointerEvents = 'auto';
    }
  }
}

