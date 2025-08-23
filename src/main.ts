import StreamingAvatar, {
  AvatarQuality,
  StreamingEvents,
  TaskType
} from "@heygen/streaming-avatar";
import { AudioTranscriptionService, type TranscriptionResult } from "./audioTranscriptionService";
import { TranscriptionStrategy, SPEAKER_OPTIONS } from './constants';
import type { TranscriptionStrategyType } from './constants';

// DOM elements
const videoElement = document.getElementById("avatarVideo") as HTMLVideoElement;
const startButton = document.getElementById(
  "startSession"
) as HTMLButtonElement;
const endButton = document.getElementById("endSession") as HTMLButtonElement;
const speakButton = document.getElementById("speakButton") as HTMLButtonElement;
const repeatButton = document.getElementById("repeatButton") as HTMLButtonElement;
const userInput = document.getElementById("userInput") as HTMLInputElement;
const startRecordingButton = document.getElementById("startRecordingButton") as HTMLButtonElement;
const stopRecordingButton = document.getElementById("stopRecordingButton") as HTMLButtonElement;
const transcriptionOutput = document.getElementById("transcriptionOutput") as HTMLTextAreaElement;

const KNOWLEDGE_ID = "2b705aff1a834f5c93698641bd29fe5c";

let avatar: StreamingAvatar | null = null;
let sessionData: any = null;
let transcriptionService: AudioTranscriptionService | null = null;
let currentStrategy: TranscriptionStrategyType = TranscriptionStrategy.REAL_TIME;
let currentSpeaker: string = SPEAKER_OPTIONS[0].id;
let lockedSpeaker: string = SPEAKER_OPTIONS[0].id; // Speaker locked at recording stop time
let entireTranscript: string = "";

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
  const token = await fetchAccessToken();
  avatar = new StreamingAvatar({ token });

  avatar.on(StreamingEvents.STREAM_READY, handleStreamReady);
  avatar.on(StreamingEvents.STREAM_DISCONNECTED, handleStreamDisconnected);
  console.log("entireTranscript: ", entireTranscript)
  sessionData = await avatar.createStartAvatar({
    quality: AvatarQuality.High,
    avatarName: "Wayne_20240711",
    knowledgeId: KNOWLEDGE_ID,
    knowledgeBase: entireTranscript
    // language: "et",
    // voice: {
    //   elevenlabsSettings: {
    //     model_id: "eleven_multilingual_v2"
    //   }
    // }
  });

  console.log("Session data:", sessionData);

  // Enable end button and disable start button
  endButton.disabled = false;
  startButton.disabled = true;
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

// End the avatar session
async function terminateAvatarSession() {
  if (!avatar || !sessionData) return;

  await avatar.stopAvatar();
  videoElement.srcObject = null;
  avatar = null;
}

// Handle speaking event
async function handleSpeak() {
  if (avatar && userInput.value) {
    await avatar.speak({
      text: userInput.value,
    });
    userInput.value = ""; // Clear input after speaking
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
async function handleStartRecording() {
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
        
        // Update the user input field with the latest transcription (without prefix)
        userInput.value = result.text;
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
async function handleStopRecording() {
  // Lock in the current speaker selection at the moment stop is clicked
  if (currentStrategy === TranscriptionStrategy.ON_DEMAND) {
    lockedSpeaker = currentSpeaker;
  }
  
  if (transcriptionService) {
    await transcriptionService.stopRecording();
  }
  
  startRecordingButton.disabled = false;
  stopRecordingButton.disabled = true;
  startRecordingButton.textContent = '🎤 Start Recording';
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
      handleStopRecording();
    } else {
      // Not recording, so start
      handleStartRecording();
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
  
  // Initialize UI state
  handleStrategyChange();
  handleSpeakerChange();
});

// Event listeners for buttons
startButton.addEventListener("click", initializeAvatarSession);
endButton.addEventListener("click", terminateAvatarSession);
speakButton.addEventListener("click", handleSpeak);
repeatButton.addEventListener("click", handleRepeat);
startRecordingButton.addEventListener("click", handleStartRecording);
stopRecordingButton.addEventListener("click", handleStopRecording);