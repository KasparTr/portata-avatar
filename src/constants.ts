import { AvatarQuality } from "@heygen/streaming-avatar";

/**
 * Transcription Strategy Types
 */
export const TranscriptionStrategy = {
  REAL_TIME: 'real_time',
  ON_DEMAND: 'on_demand'
} as const;

export type TranscriptionStrategyType = typeof TranscriptionStrategy[keyof typeof TranscriptionStrategy];

export const AVATAR_DEFAULTS = {
  AVATAR_NAME: "SilasHR_public", //Wayne_20240711
  AVATAR_QUALITY: AvatarQuality.High,
  LANGUAGE: "en",
  KNOWLEDGE_ID: "2b705aff1a834f5c93698641bd29fe5c",
}
/**
 * Audio Transcription Configuration Constants
 */
export const AUDIO_TRANSCRIPTION_DEFAULTS = {
  // API Configuration
  LANGUAGE: 'et', // est
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
 * Speaker Options for Transcription Prefixes
 */
export const SPEAKER_OPTIONS = [
  { id: 'kirsi', label: 'Kristi', prefix: '[Kristi]: ' },
  { id: 'raivo', label: 'Raivo', prefix: '[Raivo]: ' },
  { id: 'marko', label: 'Marko', prefix: '[Marko]: ' },
  { id: 'moderator', label: 'moderator', prefix: '[Moderaator, Tõnis]: ' },
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

export const KNOWLEDGEBASE = "Instructions: You are a panelist, taking part of a five member panel. The panel is part of the Telia Digital Hub conference. Panel Moderator Tõnis is leading the panel. When prompted, form a short opinion based on the transcript of the ongoing panel discussion (is available) and your own knowledge. Keep the answer strictly on topic and around the conference theme (below). Always reply in English language, regardless of prompt language. #Conference theme: []. # Transcript: "