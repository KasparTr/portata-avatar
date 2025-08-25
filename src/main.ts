import StreamingAvatar, {
  AvatarQuality,
  StreamingEvents,
  TaskType,
  VoiceEmotion
} from "@heygen/streaming-avatar";
import { AudioTranscriptionService, type TranscriptionResult } from "./audioTranscriptionService";
import { TranscriptionStrategy, SPEAKER_OPTIONS, KNOWLEDGEBASE, AVATAR_DEFAULTS } from './constants';
import type { TranscriptionStrategyType } from './constants';

// DOM elements
const videoElement = document.getElementById("avatarVideo") as HTMLVideoElement;
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
const unifiedRecordButton = document.getElementById("unifiedRecordButton") as HTMLButtonElement;
const saveTranscriptionButton = document.getElementById("saveTranscriptionButton") as HTMLButtonElement;
const leverHandle = document.getElementById("leverHandle") as HTMLElement;
const leverTrack = document.getElementById("leverTrack") as HTMLElement;
const avatarLabel = document.getElementById("avatarLabel") as HTMLElement;
const transcriptionLabel = document.getElementById("transcriptionLabel") as HTMLElement;
const leverControl = document.getElementById("leverControl") as HTMLElement;
const dragHandle = document.getElementById("dragHandle") as HTMLElement;

let avatar: StreamingAvatar | null = null;
let sessionData: any = null;
let transcriptionService: AudioTranscriptionService | null = null;
let currentStrategy: TranscriptionStrategyType = TranscriptionStrategy.REAL_TIME;
let currentSpeaker: string = SPEAKER_OPTIONS[0].id;
let lockedSpeaker: string = SPEAKER_OPTIONS[0].id; // Speaker locked at recording stop time
let entireTranscript: string = "";
let voiceInputTranscriptionService: AudioTranscriptionService | null = null;
let isWaitingForVoiceInput: boolean = false;
let isRecording: boolean = false;
let recordingMode: 'avatar' | 'transcription' = 'avatar';
let isAvatarSpeaking: boolean = false;

// Drag functionality variables
let isDragging = false;
let dragOffset = { x: 0, y: 0 };

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
    // Get latest transcription content from the text area
    const latestTranscript = transcriptionOutput.value || entireTranscript;
    console.log("Live transcription content:", transcriptionOutput.value);
    console.log("Entire transcript variable:", );
    console.log("Using transcript:", latestTranscript);
    let kb = KNOWLEDGEBASE
    if(entireTranscript) kb += entireTranscript
    else if (latestTranscript) kb += latestTranscript

    console.log("Knowledgebase: ", kb);
    const ac = createAvatarConfig(kb)
    sessionData = await avatar.createStartAvatar(ac);

    console.log("Session data:", sessionData);
    console.log("Avatar session initialized successfully");

    // Enable start button, keep stop button disabled until avatar speaks
    endButton.disabled = false;
    startButton.disabled = true;
  } catch (error) {
    console.error("Failed to initialize avatar session:", error);
    
    // Reset button states on error
    endButton.disabled = true;
    startButton.disabled = false;
    
    // Show error to user
    alert(`Failed to start avatar session: ${error}`);
  }
}


function createAvatarConfig(knowledgeBase: string){
  const config = {
    quality: AvatarQuality.High,
    avatarName: AVATAR_DEFAULTS.AVATAR_NAME,
    // knowledgeId: AVATAR_DEFAULTS.KNOWLEDGE_ID,
    knowledgeBase: knowledgeBase,
    language: AVATAR_DEFAULTS.LANGUAGE,
    voice: {}
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
// Handle avatar speaking events
function handleAvatarStartTalking() {
  console.log("Avatar started talking");
  isAvatarSpeaking = true;
  // Enable stop speaking button when avatar starts talking
  stopSpeakingButton.disabled = false;
  if (speakButton) speakButton.disabled = true; // Disable speak button
  if (repeatButton) repeatButton.disabled = true; // Disable repeat button
}

function handleAvatarStopTalking() {
  console.log("Avatar stopped talking");
  isAvatarSpeaking = false;
  // Disable stop speaking button and re-enable other buttons when avatar stops
  stopSpeakingButton.disabled = true;
  if (speakButton) speakButton.disabled = false;
  if (repeatButton) repeatButton.disabled = false;
}

// Handle when avatar stream is ready
function handleStreamReady(event: any) {
  if (event.detail && videoElement) {
    videoElement.srcObject = event.detail;
    videoElement.onloadedmetadata = () => {
      videoElement.play().catch(console.error);
    };
  } else {
    console.error("Stream is not available");
  }
}

// Handle stream disconnection
function handleStreamDisconnected() {
  console.log("Stream disconnected");
  if (videoElement) {
    videoElement.srcObject = null;
  }

  // Enable start button and disable end button
  startButton.disabled = false;
  endButton.disabled = true;
}

// Interrupt avatar speaking (without ending session)
async function interruptAvatar() {
  if (!avatar || !isAvatarSpeaking) return;
  
  console.log("Interrupting avatar speech");
  await avatar.interrupt();
}

// End the avatar session
async function terminateAvatarSession() {
  if (!avatar || !sessionData) return;

  await avatar.stopAvatar();
  videoElement.srcObject = null;
  avatar = null;
  
  // Reset button states
  startButton.disabled = false;
  endButton.disabled = true;
  speakButton.disabled = false;
  repeatButton.disabled = false;
}

// Handle speaking event
async function handleSpeak() {
  if (avatar && userInput.value) {
    await avatar.speak({
      text: userInput.value,
    });
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

// Initialize transcription service
async function initializeTranscriptionService() {
  const elevenlabsApiKey = import.meta.env.VITE_ELEVENLABS_API_KEY;
  
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
    await transcriptionService.initialize();
    console.log('Transcription service initialized successfully');
  } catch (error) {
    console.error('Failed to initialize transcription service:', error);
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
        const currentText = transcriptionOutput.value;
        const displaySeparator = currentText ? '\n\n' : '';
        const newText = currentText ? `${currentText}${displaySeparator}${transcriptionText}` : transcriptionText;
        transcriptionOutput.value = newText;
        
        // Auto-scroll to bottom
        transcriptionOutput.scrollTop = transcriptionOutput.scrollHeight;

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

// Handle lever toggle
function toggleLever(event?: Event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  
  console.log('Toggling lever from:', recordingMode);
  
  if (recordingMode === 'avatar') {
    recordingMode = 'transcription';
    leverHandle.classList.add('down');
    avatarLabel.classList.remove('active');
    transcriptionLabel.classList.add('active');
    console.log('Switched to transcription mode');
  } else {
    recordingMode = 'avatar';
    leverHandle.classList.remove('down');
    avatarLabel.classList.add('active');
    transcriptionLabel.classList.remove('active');
    console.log('Switched to avatar mode');
  }
}

// Handle unified recording
async function handleUnifiedRecord() {
  console.log('Record button clicked, current state:', { isRecording, recordingMode });
  
  if (!isRecording) {
    // Start recording
    isRecording = true;
    unifiedRecordButton.classList.add('recording');
    unifiedRecordButton.textContent = '⏹️ Send';
    console.log('Starting recording in mode:', recordingMode);
    
    if (recordingMode === 'avatar') {
      // Start voice input for avatar
      if (!voiceInputTranscriptionService) {
        await initializeVoiceInputTranscriptionService();
        if (!voiceInputTranscriptionService) {
          isRecording = false;
          unifiedRecordButton.classList.remove('recording');
          unifiedRecordButton.textContent = '🎤 Record';
          return;
        }
      }
      
      try {
        // Force reset state to prevent "Recording already in progress" error
        voiceInputTranscriptionService.forceResetState();
        
        await voiceInputTranscriptionService.startRecording(
          (result: TranscriptionResult) => {
            console.log('Voice input result:', result.text);
            userInput.value = result.text;
            
            if (isWaitingForVoiceInput) {
              isWaitingForVoiceInput = false;
              console.log("Voice input completed: ", userInput.value);
              
              // Reset button states
              isRecording = false;
              unifiedRecordButton.classList.remove('recording');
              unifiedRecordButton.textContent = '🎤 Record';
              
              // Trigger avatar to speak if there's text
              if (userInput.value.trim()) {
                handleSpeak();
              } else {
                console.log('No voice input detected or audio too short');
              }
            }
          },
          (error: Error) => {
            console.error('Voice input transcription error:', error);
            isWaitingForVoiceInput = false;
            isRecording = false;
            unifiedRecordButton.classList.remove('recording');
            unifiedRecordButton.textContent = '🎤 Record';
          }
        );
      } catch (error) {
        console.error('Failed to start voice recording:', error);
        isRecording = false;
        unifiedRecordButton.classList.remove('recording');
        unifiedRecordButton.textContent = '🎤 Record';
      }
    } else {
      // Start transcription recording
      if (!transcriptionService) {
        await initializeTranscriptionService();
        if (!transcriptionService) {
          isRecording = false;
          unifiedRecordButton.classList.remove('recording');
          unifiedRecordButton.textContent = '🎤 Record';
          return;
        }
      }
      
      
      try {
        await transcriptionService.startRecording(
          (result: TranscriptionResult) => {
            let transcriptionText = result.text;
            console.log('Transcription result:', transcriptionText);
            
            if (currentStrategy === TranscriptionStrategy.ON_DEMAND) {
              transcriptionText = getSpeakerPrefix() + transcriptionText;
            }
            
            // Store in entire transcript variable
            const separator = entireTranscript ? '\n\n' : '';
            entireTranscript = entireTranscript ? `${entireTranscript}${separator}${transcriptionText}` : transcriptionText;
            
            // Append new transcription to the output
            const currentText = transcriptionOutput.value;
            const displaySeparator = currentText ? '\n\n' : '';
            const newText = currentText ? `${currentText}${displaySeparator}${transcriptionText}` : transcriptionText;
            transcriptionOutput.value = newText;
            
            // Auto-scroll to bottom
            transcriptionOutput.scrollTop = transcriptionOutput.scrollHeight;
          },
          (error: Error) => {
            console.error('Transcription error:', error);
            isRecording = false;
            unifiedRecordButton.classList.remove('recording');
            unifiedRecordButton.textContent = '🎤 Record';
          }
        );
      } catch (error) {
        console.error('Failed to start transcription recording:', error);
        isRecording = false;
        unifiedRecordButton.classList.remove('recording');
        unifiedRecordButton.textContent = '🎤 Record';
      }
    }
  } else {
    // Stop recording
    console.log('Stopping recording in mode:', recordingMode);
    
    if (recordingMode === 'avatar') {
      isWaitingForVoiceInput = true;
      if (voiceInputTranscriptionService) {
        await voiceInputTranscriptionService.stopRecording();
      }
      unifiedRecordButton.textContent = '🎤 Processing...';
      
      // Add timeout to reset button state if transcription takes too long or fails
      setTimeout(() => {
        if (isWaitingForVoiceInput) {
          console.log('Transcription timeout - resetting button state');
          isWaitingForVoiceInput = false;
          isRecording = false;
          unifiedRecordButton.classList.remove('recording');
          unifiedRecordButton.textContent = '🎤 Record';
        }
      }, 10000); // 10 second timeout
    } else {
      // Lock speaker at stop time for on-demand transcription
      if (currentStrategy === TranscriptionStrategy.ON_DEMAND) {
        lockedSpeaker = currentSpeaker;
      }
      
      if (transcriptionService) {
        await transcriptionService.stopRecording();
      }
      isRecording = false;
      unifiedRecordButton.classList.remove('recording');
      unifiedRecordButton.textContent = '🎤 Record';
    }
  }
}

// Save transcription function (unimplemented)
function saveTranscription() {
  // TODO: Implement transcription saving functionality
  console.log('saveTranscription called - implementation needed');
  console.log('Current transcription:', transcriptionOutput.value);
}

// Drag functionality
function initializeDragFunctionality() {
  let startX = 0;
  let startY = 0;
  let initialX = 0;
  let initialY = 0;

  function handleDragStart(e: MouseEvent | TouchEvent) {
    if (e.target === leverTrack || e.target === leverHandle || 
        e.target === avatarLabel || e.target === transcriptionLabel ||
        e.target === unifiedRecordButton) {
      return; // Don't start drag on interactive elements
    }

    isDragging = true;
    leverControl.classList.add('dragging');

    const clientX = e instanceof MouseEvent ? e.clientX : e.touches[0].clientX;
    const clientY = e instanceof MouseEvent ? e.clientY : e.touches[0].clientY;

    const rect = leverControl.getBoundingClientRect();
    initialX = rect.left;
    initialY = rect.top;
    startX = clientX - initialX;
    startY = clientY - initialY;

    dragOffset.x = startX;
    dragOffset.y = startY;

    document.addEventListener('mousemove', handleDragMove);
    document.addEventListener('mouseup', handleDragEnd);
    document.addEventListener('touchmove', handleDragMove, { passive: false });
    document.addEventListener('touchend', handleDragEnd);

    e.preventDefault();
  }

  function handleDragMove(e: MouseEvent | TouchEvent) {
    if (!isDragging) return;

    e.preventDefault();

    const clientX = e instanceof MouseEvent ? e.clientX : e.touches[0].clientX;
    const clientY = e instanceof MouseEvent ? e.clientY : e.touches[0].clientY;

    let newX = clientX - dragOffset.x;
    let newY = clientY - dragOffset.y;

    // Keep within screen bounds
    const rect = leverControl.getBoundingClientRect();
    const maxX = window.innerWidth - rect.width;
    const maxY = window.innerHeight - rect.height;

    newX = Math.max(0, Math.min(newX, maxX));
    newY = Math.max(0, Math.min(newY, maxY));

    leverControl.style.left = `${newX}px`;
    leverControl.style.top = `${newY}px`;
    leverControl.style.right = 'auto';
    leverControl.style.transform = 'none';
  }

  function handleDragEnd() {
    if (!isDragging) return;

    isDragging = false;
    leverControl.classList.remove('dragging');

    document.removeEventListener('mousemove', handleDragMove);
    document.removeEventListener('mouseup', handleDragEnd);
    document.removeEventListener('touchmove', handleDragMove);
    document.removeEventListener('touchend', handleDragEnd);
  }

  // Add event listeners for drag start
  leverControl.addEventListener('mousedown', handleDragStart);
  leverControl.addEventListener('touchstart', handleDragStart, { passive: false });
  dragHandle.addEventListener('mousedown', handleDragStart);
  dragHandle.addEventListener('touchstart', handleDragStart, { passive: false });
}

// Initialize voice input transcription service
async function initializeVoiceInputTranscriptionService() {
  const elevenlabsApiKey = import.meta.env.VITE_ELEVENLABS_API_KEY;
  
  if (!elevenlabsApiKey) {
    console.error('ElevenLabs API key not found in environment variables');
    return;
  }

  if (!AudioTranscriptionService.isSupported()) {
    console.error('Audio transcription not supported in this browser');
    return;
  }

  voiceInputTranscriptionService = new AudioTranscriptionService({
    apiKey: elevenlabsApiKey,
    strategy: TranscriptionStrategy.ON_DEMAND, // Always use on-demand for voice input
    minChunkSize: 1000 // Lower threshold for voice input (1KB instead of 15KB)
  });

  try {
    await voiceInputTranscriptionService.initialize();
    console.log('Voice input transcription service initialized successfully');
  } catch (error) {
    console.error('Failed to initialize voice input transcription service:', error);
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
      currentSpeaker = radio.value;
      
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

// Handle keyboard shortcuts
document.addEventListener('keydown', (event) => {
  // Space key to start/stop recording (only when not typing in input fields)
  if (event.code === 'Space' && !isTypingInInput(event.target)) {
    event.preventDefault(); // Prevent page scroll
    
    if (startRecordingButton.disabled) {
      // Currently recording, so stop
      handleStopTranscription();
    } else {
      // Not recording, so start
      handleStartTranscription();
    }
  }
});

// Helper function to check if user is typing in an input field
function isTypingInInput(target: EventTarget | null): boolean {
  if (!target) return false;
  const element = target as HTMLElement;
  return element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.isContentEditable;
}

// Clean up on page unload
window.addEventListener('beforeunload', () => {
  if (transcriptionService) {
    transcriptionService.cleanup();
  }
});

// Initialize UI event listeners
document.addEventListener('DOMContentLoaded', () => {
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
  
  // Lever control event listeners
  leverTrack.addEventListener("click", toggleLever);
  leverHandle.addEventListener("click", toggleLever);
  avatarLabel.addEventListener("click", (event) => {
    event.preventDefault();
    console.log('Avatar label clicked');
    if (recordingMode !== 'avatar') toggleLever();
  });
  transcriptionLabel.addEventListener("click", (event) => {
    event.preventDefault();
    console.log('Transcription label clicked');
    if (recordingMode !== 'transcription') toggleLever();
  });
  
  // Unified record button event listener
  unifiedRecordButton.addEventListener("click", handleUnifiedRecord);
  
  // Save transcription button event listener
  saveTranscriptionButton.addEventListener("click", saveTranscription);
  
  // Initialize drag functionality
  initializeDragFunctionality();
  
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