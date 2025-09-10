import { AvatarQuality } from "@heygen/streaming-avatar";

/**
 * Transcription Strategy Types
 */
export const TranscriptionStrategy = {
  REAL_TIME: 'real_time',
  ON_DEMAND: 'on_demand'
} as const;

export type TranscriptionStrategyType = typeof TranscriptionStrategy[keyof typeof TranscriptionStrategy];
let AVATAR_VOICE_LANGUAGE = "en" // "et"
let TRANSCRIPTION_LANGUAGE = "et"; // "en"
let avatarName = "Thaddeus_Chair_Sitting_public";
let AVATAR_GENDER = "female" // "male"
const AVAILABLE_VOICE_IDS = {
  EE_KERT: "adc699478776486997dcf2f7b1534a89",
  EE_ANU: "088b81175b7b4dcabc7179a94467dd06",
  EN_LEMBIT:"dcbce63bc1114c8fa9155bb6538d6edb",
  EN_IVY:"cef3bc4e0a84424cafcde6f2cf466c97"
}

let voiceId = AVAILABLE_VOICE_IDS.EE_ANU;
if(AVATAR_GENDER === "male"){
  avatarName = "Thaddeus_Chair_Sitting_public";
  if(AVATAR_VOICE_LANGUAGE == "et") voiceId = AVAILABLE_VOICE_IDS.EE_KERT;
  else voiceId = AVAILABLE_VOICE_IDS.EN_LEMBIT;
} else {
  avatarName = "Katya_Chair_Sitting_public";
  if(AVATAR_VOICE_LANGUAGE == "et") voiceId = AVAILABLE_VOICE_IDS.EE_ANU;
  else voiceId = AVAILABLE_VOICE_IDS.EN_IVY;
}
  
export const AVATAR_DEFAULTS = {
  AVATAR_NAME: avatarName, //Wayne_20240711, Graham_Chair_Sitting_public, SilasHR_public, Katya_Chair_Sitting_public,Thaddeus_Chair_Sitting_public
  AVATAR_QUALITY: AvatarQuality.High,
  VOICE_RATE: 1.0,
  LANGUAGE: AVATAR_VOICE_LANGUAGE,
  KNOWLEDGE_ID: "2b705aff1a834f5c93698641bd29fe5c",
  VOICE_ID:voiceId
}
/**
 * Audio Transcription Configuration Constants
 */
export const AUDIO_TRANSCRIPTION_DEFAULTS = {
  // API Configuration
  LANGUAGE: TRANSCRIPTION_LANGUAGE,
  MODEL: 'scribe_v1',
  
  // Audio Settings
  SAMPLE_RATE: 16000,
  CHANNEL_COUNT: 1,
  ECHO_CANCELLATION: true,
  NOISE_SUPPRESSION: true,
  AUTO_GAIN_CONTROL: true,
  DIARIZE: true,
  
  // Transcription Timing
  CHUNK_DURATION: 30000, // Process chunks every 30 seconds (max)
  MIN_CHUNK_SIZE: 5000, // Minimum 5KB of audio data
  
  // Silence Detection
  SILENCE_THRESHOLD: 0.01, // Audio level threshold for silence
  SILENCE_DURATION: 2000, // 1 second of silence triggers transcription
  
  // Audio Analysis
  FFT_SIZE: 256,
  AUDIO_CHECK_INTERVAL: 100, // Check audio levels every 100ms
  
  // Recording Management
  MEDIA_RECORDER_TIMESLICE: 1000, // Request data every 1 second
  RESTART_DELAY: 500, // Delay between stop/start to prevent audio loss
  TRANSCRIPTION_TRIGGER_DELAY: 100, // Delay before triggering transcription
  
  // Audio Format Preferences (in order of preference)
  PREFERRED_MIME_TYPES: [
    'audio/wav',
    'audio/mp4',
    'audio/webm',
    'audio/webm;codecs=opus'
  ]
} as const;

/**
 * Speaker Names - easily changeable in one place
 */
export const SPEAKER_NAMES = {
  // KRISTI: 'Kristi',
  // RAIVO: 'Raivo', 
  RAINA: 'Raina',
  MODERATOR: 'moderator',
  MODE_NAME: 'Kaspar',
  MODERATOR_FULL: 'Moderaator, Kaspar'
} as const;

/**
 * Speaker Options for Transcription Prefixes
 */
export const SPEAKER_OPTIONS = [
  // { id: 'kirsi', label: SPEAKER_NAMES.KRISTI, prefix: `[${SPEAKER_NAMES.KRISTI}]: ` },
  // { id: 'raivo', label: SPEAKER_NAMES.RAIVO, prefix: `[${SPEAKER_NAMES.RAIVO}]: ` },
  // { id: 'marko', label: SPEAKER_NAMES.MARKO, prefix: `[${SPEAKER_NAMES.MARKO}]: ` },
  { id: 'raina', label: SPEAKER_NAMES.RAINA, prefix: `[${SPEAKER_NAMES.RAINA}]: ` },
  { id: 'moderator', label: SPEAKER_NAMES.MODERATOR, prefix: `[${SPEAKER_NAMES.MODERATOR_FULL}]: ` },
] as const;

/**
 * API Endpoints
 */
export const API_ENDPOINTS = {
  ELEVENLABS_SPEECH_TO_TEXT: 'https://api.elevenlabs.io/v1/speech-to-text'
} as const;

/**
 * File Extensions for Audio Types
 */
export const AUDIO_FILE_EXTENSIONS = {
  'audio/wav': 'audio.wav',
  'audio/mp4': 'audio.mp4',
  'audio/webm': 'audio.webm',
  'audio/ogg': 'audio.ogg'
} as const;

export const KNOWLEDGEBASE_BASE = `#Instructions: Your name is Anu, you are a panelist taking part of panel discussion on the topic of digital transformation and AI. You are the newest member of Portata - We help enterprises, institutions, and nations turn intelligence into infrastructure with PAGIS, our AGI execution OS.  The panel is part of the Telia Digital Hub conference. Panel moderator ${SPEAKER_NAMES.MODE_NAME} will ask you questions, adress him when he asks you a questions (all prompts are from him). When prompted, form a short opinion based on the transcript of the ongoing panel discussion (if available) and your own knowledge. Keep the answer strictly on topic and around the conference theme (if available). Always reply in Estonian language, regardless of prompt language. #Conference theme: Digital Transformation. # Panel Discussion Transcript:"`