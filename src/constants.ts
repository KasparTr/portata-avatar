import { AvatarQuality } from "@heygen/streaming-avatar";

/**
 * Transcription Strategy Types
 */
export const TranscriptionStrategy = {
  REAL_TIME: 'real_time',
  ON_DEMAND: 'on_demand'
} as const;

export type TranscriptionStrategyType = typeof TranscriptionStrategy[keyof typeof TranscriptionStrategy];
let AVATAR_VOICE_LANGUAGE = "et" // "et", "lv", "en"
let TRANSCRIPTION_LANGUAGE = "et"; // "en"
let AVATARA_SYSTEM_NAME = "Thaddeus_Chair_Sitting_public"; // default
let AVATAR_GENDER = "female" // "male"
export let AVATAR_HUMAN_NAME = "Anu";
const AVAILABLE_VOICE_IDS = {
  EE_KERT: "adc699478776486997dcf2f7b1534a89",
  EE_ANU: "088b81175b7b4dcabc7179a94467dd06",
  EN_LEMBIT:"dcbce63bc1114c8fa9155bb6538d6edb",
  EN_IVY:"cef3bc4e0a84424cafcde6f2cf466c97",
  LV_EVERITA: "583838e570fe4e00b646082785c12260",
  LV_TOMASS: "583838e570fe4e00b646082785c12260"
}

let voiceId;
if(AVATAR_GENDER === "male"){
  AVATARA_SYSTEM_NAME = "Thaddeus_Chair_Sitting_public";
  if(AVATAR_VOICE_LANGUAGE == "et") voiceId = AVAILABLE_VOICE_IDS.EE_KERT;
  else if(AVATAR_VOICE_LANGUAGE == "lv") voiceId = AVAILABLE_VOICE_IDS.LV_TOMASS;
  else voiceId = "";
} else {
  AVATARA_SYSTEM_NAME = "Katya_Chair_Sitting_public";
  if(AVATAR_VOICE_LANGUAGE == "et") voiceId = AVAILABLE_VOICE_IDS.EE_ANU;
  else if(AVATAR_VOICE_LANGUAGE == "lv") voiceId = AVAILABLE_VOICE_IDS.LV_EVERITA;
  else voiceId = AVAILABLE_VOICE_IDS.EN_IVY;
}
  
export const AVATAR_DEFAULTS = {
  AVATAR_HUMAN_NAME: "Anu",
  AVATAR_NAME: AVATARA_SYSTEM_NAME, //Wayne_20240711, Graham_Chair_Sitting_public, SilasHR_public, Katya_Chair_Sitting_public,Thaddeus_Chair_Sitting_public
  AVATAR_QUALITY: AvatarQuality.High,
  VOICE_RATE: 1.0,
  LANGUAGE: AVATAR_VOICE_LANGUAGE,
  // KNOWLEDGE_ID: "2b705aff1a834f5c93698641bd29fe5c",
  KNOWLEDGE_ID: "b4df7e6a975d403099043769e0b86215", // 7b10a64ca5154b96aaaf3409df206ccf
  // KNOWLEDGE_ID: "7e273b0483b34438a95b11cce31d792e", ""
  // VOICE_ID:voiceId,
  VOICE_ID: voiceId,
  ACTIVITY_IDLE_TIMEOUT: 3600 // Idle timeout in seconds after last activity before closing session. Range 30–3600.
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
  CHUNK_DURATION: 1000, // 1 second chunks for faster processing
  MIN_CHUNK_SIZE: 12000, // Reduced minimum size for faster transcription
  MAX_BATCH_DURATION: 20000, // max seconds before forced processing of a batch
  
  // Silence Detection
  SILENCE_THRESHOLD: 0.5, // Audio level threshold for silence
  SILENCE_DURATION: 1000, // 1 seconds silence detection for batch processing
  
  // Audio Analysis
  FFT_SIZE: 256,
  AUDIO_CHECK_INTERVAL: 100, // Check audio levels every 100ms
  
  // Recording Management
  MEDIA_RECORDER_TIMESLICE: 1000, // Request data every 1 second
  RESTART_DELAY: 500, // Delay between stop/start to prevent audio loss
  TRANSCRIPTION_TRIGGER_DELAY: 200, // Faster transcription trigger
  
  // Audio Format Preferences (in order of preference)
  PREFERRED_MIME_TYPES: [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/wav',
    'audio/mp4'
  ]
} as const;

/**
 * Avatar Continuous Listening Configuration Constants
 * Separate from transcription to optimize avatar response times
 */
export const AVATAR_AUDIO_CONFIG = {
  // API Configuration
  LANGUAGE: AVATAR_VOICE_LANGUAGE,
  MODEL: 'scribe_v1',
  
  // Audio Settings
  SAMPLE_RATE: 16000,
  CHANNEL_COUNT: 1,
  ECHO_CANCELLATION: true,
  NOISE_SUPPRESSION: true,
  AUTO_GAIN_CONTROL: true,
  DIARIZE: false, // Don't need speaker separation for avatar listening
  
  // Transcription Timing (optimized for fast avatar response)
  CHUNK_DURATION: 15000, // Process chunks every 15 seconds (faster than transcription)
  MIN_CHUNK_SIZE: 2000, // Minimum 2KB of audio data (smaller for faster processing)
  
  // Silence Detection (optimized for conversational response)
  SILENCE_THRESHOLD: 0.01, // Audio level threshold for silence
  SILENCE_DURATION: 800, // 0.8 seconds of silence triggers processing (faster response)
  
  // Audio Analysis
  FFT_SIZE: 256,
  AUDIO_CHECK_INTERVAL: 100, // Check audio levels every 100ms
  
  // Recording Management (optimized for avatar responsiveness)
  MEDIA_RECORDER_TIMESLICE: 500, // Request data every 0.5 seconds (faster)
  RESTART_DELAY: 200, // Delay between stop/start to prevent audio loss (reduced)
  TRANSCRIPTION_TRIGGER_DELAY: 50, // Delay before triggering transcription (reduced)
  
  // Audio Format Preferences (in order of preference)
  PREFERRED_MIME_TYPES: [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/wav',
    'audio/mp4'
  ]
} as const;

/**
 * Speaker Names - easily changeable in one place
 */
export const SPEAKER_NAMES = {
  KRISTI: 'Kristi',
  RAIVO: 'Raivo', 
  MARKO: 'Marko', 
  RAINA: 'Raina',
  MODERATOR: 'Lembit',
  MODE_NAME: 'Kaspar',
  MODERATOR_FULL: 'Moderaator, Kaspar'
} as const;

/**
 * Speaker Options for Transcription Prefixes
 */
export const SPEAKER_OPTIONS = [
  // { id: 'kirsi', label: SPEAKER_NAMES.KRISTI, prefix: `[${SPEAKER_NAMES.KRISTI}]: ` },
  { id: 'raivo', label: SPEAKER_NAMES.RAIVO, prefix: `[${SPEAKER_NAMES.RAIVO}]: ` },
  { id: 'marko', label: SPEAKER_NAMES.MARKO, prefix: `[${SPEAKER_NAMES.MARKO}]: ` },
  { id: 'raina', label: SPEAKER_NAMES.RAINA, prefix: `[${SPEAKER_NAMES.RAINA}]: ` },
  { id: 'moderator', label: SPEAKER_NAMES.MODERATOR, prefix: `[${SPEAKER_NAMES.MODERATOR_FULL}]: ` },
] as const;

/**
 * API Endpoints
 * Using backend proxy to keep API keys secure
 */
export const API_ENDPOINTS = {
  HEYGEN_TOKEN: '/api/heygen-token',
  ELEVENLABS_SPEECH_TO_TEXT: '/api/transcribe',
  SEEKER_QUERY: '/api/seeker-query'
} as const;

/**
 * Seeker RAG System Configuration
 */
export const SEEKER_CONFIG = {
  NAMESPACE: 'ehr', // Update this with your actual namespace
  ROLE: 'Customer support'
} as const;

/**
 * File Extensions for Audio Types
 */
export const AUDIO_FILE_EXTENSIONS = {
  'audio/wav': 'audio.wav',
  'audio/mp4': 'audio.mp4',
  'audio/mp4;codecs=opus': 'audio.webm',
  'audio/webm': 'audio.webm',
  'audio/webm;codecs=opus': 'audio.webm',
  'audio/ogg': 'audio.ogg'
} as const;

export const KNOWLEDGEBASE_BASE = `
#Instructions: 
* Your name is ${AVATAR_HUMAN_NAME}, you are a representative of MARU - Estonian Land and Spacial Agency. 
* Avoid chancellery language. 
* If you cannot pronounce something in ${AVATAR_VOICE_LANGUAGE} language, avoid it in your answer.
* Keep the answer strictly on Topic (below). 
* Avoid adressing anybody by name.
* Always reply in ${AVATAR_VOICE_LANGUAGE} language, regardless of prompt language. 
* Behave like you would be in an official meeting and avoid "feel free to ask more", etc quirks.
---
# Topic
* You are taking part of a meeting between high level officials who are presented MARUs AI capabilities. 
* The meeting is about MARU and use of AI.  
`
