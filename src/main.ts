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
const unifiedRecordButton = document.getElementById("unifiedRecordButton") as HTMLButtonElement;
const saveTranscriptionButton = document.getElementById("saveTranscriptionButton") as HTMLButtonElement;
const leverHandle = document.getElementById("leverHandle") as HTMLElement;
const leverTrack = document.getElementById("leverTrack") as HTMLElement;
const avatarLabel = document.getElementById("avatarLabel") as HTMLElement;
const transcriptionLabel = document.getElementById("transcriptionLabel") as HTMLElement;
const leverControl = document.getElementById("leverControl") as HTMLElement;
const dragHandle = document.getElementById("dragHandle") as HTMLElement;
const sensitivityMeter = document.getElementById("sensitivityLevel") as HTMLElement;
const sensitivityValue = document.getElementById("sensitivityValue") as HTMLElement;
const silenceThreshold = document.getElementById("silenceThreshold") as HTMLInputElement;
const thresholdValue = document.getElementById("thresholdValue") as HTMLElement;
const continuousListeningStatus = document.getElementById("continuousListeningStatus") as HTMLElement;

let avatar: StreamingAvatar | null = null;
let sessionData: any = null;
let transcriptionService: AudioTranscriptionService | null = null;
let currentStrategy: TranscriptionStrategyType = TranscriptionStrategy.ON_DEMAND;
let currentSpeaker: string = SPEAKER_OPTIONS[0].id;
let previousSpeaker: string = SPEAKER_OPTIONS[0].id;
let lockedSpeaker: string = SPEAKER_OPTIONS[0].id; // Speaker locked at recording stop time
let entireTranscript: string = "";
let voiceInputTranscriptionService: AudioTranscriptionService | null = null;
let isWaitingForVoiceInput: boolean = false;
let isRecording: boolean = false;
// Removed recordingMode - unified button is now avatar-only
let isAutoTranscribing: boolean = false; // Separate flag for automatic transcription
let isAvatarSpeaking: boolean = false;
let knowledgeBaseService: KnowledgeBaseService | null = null;
let continuousListeningService: ContinuousListeningService | null = null;
let isContinuousListeningActive: boolean = false;
let pendingAvatarResponse: string | null = null;
let sharedAudioStream: MediaStream | null = null;
let isAvatarStreamReady: boolean = false; // Track if avatar stream is ready

// Audio sensitivity monitoring
let audioContext: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let currentSilenceThreshold: number = 0.05; // Default 5%

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
    avatar.on(StreamingEvents.AVATAR_STOP_TALKING, handleAvatarStopTalking);
    
    sessionData = await avatar.newSession(createAvatarConfig());
    console.log('🎯 Avatar session created:', !!sessionData);
    console.log('🎯 Avatar instance state:', avatar ? 'exists' : 'null');
    
    // Try to start session, but ignore 400 error if already started
    try {
      console.log('🎯 Attempting to start avatar session...');
      const startResult = await avatar.startSession();
      console.log('🎯 Avatar session started successfully:', startResult);
    } catch (error) {
      console.log('🎯 StartSession failed (likely already started):');
      // This is expected if session is already started by createStartAvatar
    }
    
    // Enable start button, keep stop button disabled until avatar speaks
    endButton.disabled = false;
    startButton.disabled = true;
    
    // Create shared audio stream first to ensure microphone access
    console.log('🎤 Creating shared audio stream...');
    await getSharedAudioStream();

    // Start continuous transcription when session starts (this will handle everything)
    console.log('🎤 Attempting to start continuous transcription...');
    await startContinuousTranscription();
    
    // Initialize continuous listening but don't start it yet (transcription takes priority)
    await initializeContinuousListening();
    
    // Initialize audio sensitivity monitoring
    initializeAudioSensitivityMonitor();
    
    // Start audio level monitoring with shared stream
    if (sharedAudioStream) {
      startAudioLevelMonitoring(sharedAudioStream);
    }
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

// Handle avatar speaking events
function handleAvatarStartTalking() {
  console.log("🎯 Avatar started talking - event fired");
  isAvatarSpeaking = true;
  
  // Stop continuous transcription when avatar starts speaking
  if (isAutoTranscribing) {
    console.log('🎤 Stopping transcription - avatar started speaking');
    stopContinuousTranscription();
  }
  
  // Inject pending avatar response into transcription
  if (pendingAvatarResponse && transcriptionOutput.value) {
    const avatarTranscription = `[${AVATAR_DEFAULTS.AVATAR_HUMAN_NAME}]: ${pendingAvatarResponse}`;
    const currentText = transcriptionOutput.value;
    const separator = currentText ? '\n\n' : '';
    transcriptionOutput.value = currentText + separator + avatarTranscription;
    transcriptionOutput.scrollTop = transcriptionOutput.scrollHeight;
    pendingAvatarResponse = null; // Clear after injection
  }
  
  // Enable stop speaking button when avatar starts talking
  stopSpeakingButton.disabled = false;
  if (speakButton) speakButton.disabled = true; // Disable speak button
  if (repeatButton) repeatButton.disabled = true; // Disable repeat button
}

function handleAvatarStopTalking() {
  console.log("🎯 Avatar stopped talking - event fired");
  isAvatarSpeaking = false;
  
  // Restart continuous transcription when avatar stops speaking
  setTimeout(async () => {
    if (!isAutoTranscribing) {
      console.log('🎤 Restarting transcription - avatar stopped speaking');
      await startContinuousTranscription();
    }
  }, 500); // Small delay to ensure avatar has fully stopped
  
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
  isAvatarStreamReady = true;
  
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
      
      // If there's a pending avatar response, speak it now
      if (pendingAvatarResponse && avatar) {
        console.log('🎯 Speaking pending response now that stream is ready:', pendingAvatarResponse);
        avatar.speak({ text: pendingAvatarResponse, task_type: TaskType.TALK })
          .then(() => {
            console.log('🎯 Pending response spoken successfully');
            pendingAvatarResponse = null;
          })
          .catch((error) => {
            console.error('🎯 Error speaking pending response:', error);
          });
      }
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
  
  console.log("Interrupting avatar speech");
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
      transcriptionOutput.value = currentText + separator + avatarTranscription;
      transcriptionOutput.scrollTop = transcriptionOutput.scrollHeight;
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

// Get speaker name by ID for display purposes
function getSpeakerName(speakerId: string): string {
  if (speakerId === 'custom') {
    const customInput = document.getElementById('customSpeaker') as HTMLInputElement;
    return customInput?.value.trim() || 'Speaker';
  }
  
  const speaker = SPEAKER_OPTIONS.find(s => s.id === speakerId);
  return speaker ? speaker.label : 'Speaker';
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

// Remove lever toggle - unified button is now avatar-only
// Lever UI elements can be hidden or removed from HTML

// Handle unified recording - now avatar-only
async function handleUnifiedRecord() {
  if (!isRecording) {
    // Start avatar voice input recording
    isRecording = true;
    unifiedRecordButton.classList.add('recording');
    unifiedRecordButton.textContent = '⏹️ Send';
    
    // Start voice input for avatar
    if (!voiceInputTranscriptionService) {
      await initializeVoiceInputTranscriptionService();
      if (!voiceInputTranscriptionService) {
        isRecording = false;
        unifiedRecordButton.classList.remove('recording');
        unifiedRecordButton.textContent = '🎤 Talk to Avatar';
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
            unifiedRecordButton.textContent = '🎤 Talk to Avatar';
            
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
          unifiedRecordButton.textContent = '🎤 Talk to Avatar';
        }
      );
    } catch (error) {
      console.error('Failed to start voice recording:', error);
      isRecording = false;
      unifiedRecordButton.classList.remove('recording');
      unifiedRecordButton.textContent = '🎤 Record';
    }
  } else {
    // Stop avatar voice input recording
    console.log('Stopping avatar voice input recording');
    
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
        unifiedRecordButton.textContent = '🎤 Talk to Avatar';
      }
    }, 10000); // 10 second timeout
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
async function saveTranscription() {
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

// Auto-start continuous transcription when avatar session begins
async function startContinuousTranscription() {
  console.log('🎤 startContinuousTranscription called');
  console.log('🎤 transcriptionService exists:', !!transcriptionService);
  console.log('🎤 isAutoTranscribing:', isAutoTranscribing);
  console.log('🎤 currentStrategy:', currentStrategy);
  
  if (!transcriptionService) {
    console.log('🎤 No transcription service, initializing...');
    await initializeTranscriptionService();
    if (!transcriptionService) {
      console.error('❌ Failed to initialize transcription service for continuous mode');
      return;
    }
  }

  // Only start if not already auto-transcribing
  if (!isAutoTranscribing) {
    try {
      console.log('🎤 Starting continuous transcription with strategy:', currentStrategy);
      
      // Set flag before starting to ensure callbacks work
      isAutoTranscribing = true;
      
      await transcriptionService.startRecording(
        (result: TranscriptionResult) => {
          // Only process if we're still in auto-transcription mode and not during avatar speech
          if (isAutoTranscribing && !isAvatarSpeaking) {
            console.log('🎤 Transcription result received:', result.text);
            let transcriptionText = result.text;
            
            // Skip empty results
            if (!transcriptionText || transcriptionText.trim() === '') {
              console.log('🎤 Skipping empty transcription result');
              return;
            }
            
            // Add speaker prefix - use speaker from result if available, otherwise use current selection
            if (currentStrategy === TranscriptionStrategy.ON_DEMAND) {
              if (result.speaker) {
                // Use the speaker that was captured when this batch started processing
                const speakerName = getSpeakerName(result.speaker);
                transcriptionText = `[${speakerName}]: ${transcriptionText}`;
              } else {
                transcriptionText = getSpeakerPrefix() + transcriptionText;
              }
            } else {
              // For real-time mode, add simple prefix
              transcriptionText = `[User]: ${transcriptionText}`;
            }
            
            console.log('🎤 Adding to Live Transcription:', transcriptionText);
            
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
          }
        },
        (error: Error) => {
          console.error('Continuous transcription error:', error);
          // Auto-restart on error if we should still be transcribing
          if (isAutoTranscribing) {
            setTimeout(() => startContinuousTranscription(), 2000);
          }
        },
        () => currentSpeaker // Pass function to get current speaker selection
      );
      
      console.log('🎤 Continuous transcription started successfully');
    } catch (error) {
      console.error('Failed to start continuous transcription:', error);
      isAutoTranscribing = false; // Reset flag on error
    }
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

// Initialize continuous listening service
async function initializeContinuousListening() {
  const elevenlabsApiKey = import.meta.env.VITE_ELEVENLABS_API_KEY;
  
  if (!elevenlabsApiKey) {
    console.error('ElevenLabs API key not found for continuous listening');
    return;
  }

  if (!ContinuousListeningService.isSupported()) {
    console.error('Continuous listening not supported in this browser');
    return;
  }

  continuousListeningService = new ContinuousListeningService({
    apiKey: elevenlabsApiKey,
    language: AVATAR_DEFAULTS.LANGUAGE, // Use avatar's language instead of transcription language
    avatarName: AVATAR_DEFAULTS.AVATAR_HUMAN_NAME,
    enableInterruptDetection: true,
    onNameDetected: handleAvatarNameDetected,
    onUserVoiceDetected: handleUserInterrupt,
    onError: (error: Error) => {
      console.error('Continuous listening error:', error);
    }
  });

  try {
    // Use shared audio stream to avoid microphone conflicts
    const audioStream = await getSharedAudioStream();
    await continuousListeningService.initializeWithStream(audioStream);
    // Start listening for avatar name detection
    await continuousListeningService.startListening();
    isContinuousListeningActive = true;
    console.log('🎧 Continuous listening initialized with shared stream and started - listening for avatar name');
    updateContinuousListeningUI();
  } catch (error) {
    console.error('Failed to initialize continuous listening:', error);
  }
}

// Stop continuous listening
async function stopContinuousListening() {
  if (continuousListeningService) {
    await continuousListeningService.stopListening();
    continuousListeningService.cleanup();
    continuousListeningService = null;
    isContinuousListeningActive = false;
  }
}

// Handle avatar name detection from continuous listening
async function handleAvatarNameDetected(transcription: string) {
  console.log('🎯 Avatar name detected:', transcription);
  
  // Stop continuous transcription temporarily to avoid transcribing avatar response
  let wasAutoTranscribing = false;
  if (transcriptionService && isAutoTranscribing) {
    console.log('🎯 Temporarily stopping continuous transcription due to Anu activation');
    wasAutoTranscribing = true;
    await stopContinuousTranscription();
    
    // Add user input to transcription output
    const userTranscription = `[User]: ${transcription}`;
    const currentText = transcriptionOutput.value;
    const separator = currentText ? '\n\n' : '';
    transcriptionOutput.value = currentText + separator + userTranscription;
    transcriptionOutput.scrollTop = transcriptionOutput.scrollHeight;
  }
  
  // Update UI to show detection
  if (continuousListeningStatus) {
    continuousListeningStatus.textContent = `🎯 Name detected: "${transcription}"`;
  }
  
  // Store the transcription for later injection into transcription output
  pendingAvatarResponse = transcription;
  
  // Trigger avatar to respond
  if (avatar) {
    try {
      console.log('🎯 Avatar exists, attempting to make it speak...');
      console.log('🎯 Avatar session data:', !!sessionData);
      console.log('🎯 Avatar session ID:', sessionData?.session_id);
      console.log('🎯 Avatar stream ready:', isAvatarStreamReady);
      
      if (!isAvatarStreamReady) {
        console.log('🎯 ⚠️ Avatar stream not ready yet - waiting for STREAM_READY event');
        // Store the transcription to speak once stream is ready
        pendingAvatarResponse = transcription;
        return;
      }
      
      console.log('🎯 Calling avatar.speak() with text:', transcription);
      console.log('🎯 Avatar config being used:', createAvatarConfig());
      
      
      // Try with TALK task type
      console.log('🎯 Testing with TALK task type...');
      try {
        const talkResult = await avatar.speak({ 
          text: transcription, 
          task_type: TaskType.TALK 
        });
        console.log('🎯 TALK test result:', talkResult);
        console.log('🎯 TALK test result type:', typeof talkResult);
      } catch (error) {
        console.error('🎯 Error with TALK:', error);
      }

      // Check if avatar is actually ready to speak
      console.log('🎯 Checking avatar state after speak call...');
      
      // Restart transcription after avatar finishes speaking
      if (wasAutoTranscribing) {
        setTimeout(() => {
          console.log('🎤 Restarting continuous transcription after Anu response');
          startContinuousTranscription();
        }, 1000);
      }
    } catch (error) {
      console.log('🎯 Error making avatar speak:', error);
      console.log('🎯 Error details:', JSON.stringify(error, null, 2));
      
      // Still restart transcription even if speak failed
      if (wasAutoTranscribing) {
        setTimeout(() => {
          console.log('🎤 Restarting continuous transcription after Anu response (error case)');
          startContinuousTranscription();
        }, 1000);
      }
    }
  } else {
    console.log('🎯 No avatar instance available - avatar is null');
    console.log('🎯 Session data exists:', !!sessionData);
  }
}

// Handle user voice interrupt detection
async function handleUserInterrupt(transcription: string) {
  console.log('🛑 User interrupt detected:', transcription);
  
  // Update UI to show interrupt
  if (continuousListeningStatus) {
    continuousListeningStatus.textContent = `🛑 Interrupt: "${transcription}"`;
  }
  
  // Always interrupt the avatar when user voice is detected
  if (avatar) {
    try {
      console.log('🛑 Interrupting avatar speech due to user voice');
      await avatar.interrupt();
    } catch (error) {
      console.error('Error interrupting avatar:', error);
    }
  }
}

// Update UI to show continuous listening status
function updateContinuousListeningUI() {
  // We'll add a status indicator in the UI
  let statusElement = document.getElementById('continuousListeningStatus');
  if (!statusElement) {
    // Create status element if it doesn't exist
    statusElement = document.createElement('div');
    statusElement.id = 'continuousListeningStatus';
    statusElement.style.cssText = `
      position: fixed;
      top: 20px;
      left: 20px;
      padding: 8px 12px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      z-index: 1000;
      transition: all 0.3s ease;
    `;
    document.body.appendChild(statusElement);
  }
  
  if (isContinuousListeningActive) {
    statusElement.textContent = '🎧 Listening for "Anu"...';
    statusElement.style.backgroundColor = '#28a745';
    statusElement.style.color = 'white';
    statusElement.style.boxShadow = '0 2px 8px rgba(40, 167, 69, 0.3)';
  } else {
    statusElement.textContent = '🔇 Not listening';
    statusElement.style.backgroundColor = '#6c757d';
    statusElement.style.color = 'white';
    statusElement.style.boxShadow = '0 2px 8px rgba(108, 117, 125, 0.3)';
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