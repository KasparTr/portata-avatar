import { AUDIO_TRANSCRIPTION_DEFAULTS, API_ENDPOINTS, AUDIO_FILE_EXTENSIONS, TranscriptionStrategy } from './constants';
import type { TranscriptionStrategyType } from './constants';

export interface TranscriptionResult {
  text: string;
  confidence?: number;
  timestamp?: number;
}

export interface AudioTranscriptionConfig {
  apiKey: string;
  language?: string;
  model?: string;
  sampleRate?: number;
  chunkDuration?: number; // Duration between transcriptions
  minChunkSize?: number; // Minimum audio data size for transcription
  silenceThreshold?: number; // Audio level threshold for silence detection
  silenceDuration?: number; // Duration of silence before triggering transcription
  strategy?: TranscriptionStrategyType; // Transcription strategy
}

export class AudioTranscriptionService {
  private mediaRecorder: MediaRecorder | null = null;
  private audioStream: MediaStream | null = null;
  private isRecording = false;
  private config: AudioTranscriptionConfig;
  private audioChunks: Blob[] = [];
  private onTranscriptionCallback?: (result: TranscriptionResult) => void;
  private onErrorCallback?: (error: Error) => void;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private silenceTimer: NodeJS.Timeout | null = null;
  private lastSoundTime = 0;

  constructor(config: AudioTranscriptionConfig) {
    this.config = {
      language: AUDIO_TRANSCRIPTION_DEFAULTS.LANGUAGE,
      model: AUDIO_TRANSCRIPTION_DEFAULTS.MODEL,
      sampleRate: AUDIO_TRANSCRIPTION_DEFAULTS.SAMPLE_RATE,
      chunkDuration: AUDIO_TRANSCRIPTION_DEFAULTS.CHUNK_DURATION,
      minChunkSize: AUDIO_TRANSCRIPTION_DEFAULTS.MIN_CHUNK_SIZE,
      silenceThreshold: AUDIO_TRANSCRIPTION_DEFAULTS.SILENCE_THRESHOLD,
      silenceDuration: AUDIO_TRANSCRIPTION_DEFAULTS.SILENCE_DURATION,
      strategy: TranscriptionStrategy.REAL_TIME,
      ...config
    };
  }

  /**
   * Initialize microphone access and prepare for recording
   */
  async initialize(): Promise<void> {
    try {
      this.audioStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: this.config.sampleRate,
          channelCount: AUDIO_TRANSCRIPTION_DEFAULTS.CHANNEL_COUNT,
          echoCancellation: AUDIO_TRANSCRIPTION_DEFAULTS.ECHO_CANCELLATION,
          noiseSuppression: AUDIO_TRANSCRIPTION_DEFAULTS.NOISE_SUPPRESSION,
          autoGainControl: AUDIO_TRANSCRIPTION_DEFAULTS.AUTO_GAIN_CONTROL
        }
      });

      // Try different audio formats, prioritizing more compatible formats
      let mimeType: string = AUDIO_TRANSCRIPTION_DEFAULTS.PREFERRED_MIME_TYPES[0];
      for (const preferredType of AUDIO_TRANSCRIPTION_DEFAULTS.PREFERRED_MIME_TYPES) {
        if (MediaRecorder.isTypeSupported(preferredType)) {
          mimeType = preferredType;
          break;
        }
      }
      
      console.log('Using audio format:', mimeType);
      await this.createMediaRecorder();
      
      // Set up audio analysis for silence detection
      await this.setupAudioAnalysis();
    } catch (error) {
      throw new Error(`Failed to initialize audio: ${error}`);
    }
  }

  /**
   * Create or recreate MediaRecorder instance
   */
  private async createMediaRecorder(): Promise<void> {
    // Check if audio stream is still active, reinitialize if needed
    if (!this.audioStream || this.audioStream.getTracks().every(track => track.readyState === 'ended')) {
      console.log('Audio stream ended, reinitializing...');
      await this.reinitializeAudioStream();
    }

    if (!this.audioStream) {
      throw new Error('Audio stream not available');
    }

    // Try different audio formats, prioritizing more compatible formats
    let mimeType: string = AUDIO_TRANSCRIPTION_DEFAULTS.PREFERRED_MIME_TYPES[0];
    for (const preferredType of AUDIO_TRANSCRIPTION_DEFAULTS.PREFERRED_MIME_TYPES) {
      if (MediaRecorder.isTypeSupported(preferredType)) {
        mimeType = preferredType;
        break;
      }
    }
    
    console.log('Creating MediaRecorder with format:', mimeType);
    this.mediaRecorder = new MediaRecorder(this.audioStream, { mimeType });
    this.setupMediaRecorderEvents();
  }

  /**
   * Reinitialize audio stream after tracks have been stopped
   */
  private async reinitializeAudioStream(): Promise<void> {
    try {
      this.audioStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: this.config.sampleRate,
          channelCount: AUDIO_TRANSCRIPTION_DEFAULTS.CHANNEL_COUNT,
          echoCancellation: AUDIO_TRANSCRIPTION_DEFAULTS.ECHO_CANCELLATION,
          noiseSuppression: AUDIO_TRANSCRIPTION_DEFAULTS.NOISE_SUPPRESSION,
          autoGainControl: AUDIO_TRANSCRIPTION_DEFAULTS.AUTO_GAIN_CONTROL
        }
      });
      
      // Reinitialize audio analysis
      await this.setupAudioAnalysis();
    } catch (error) {
      throw new Error(`Failed to reinitialize audio stream: ${error}`);
    }
  }

  /**
   * Start continuous audio recording with real-time transcription
   */
  async startRecording(
    onTranscription: (result: TranscriptionResult) => void,
    onError?: (error: Error) => void
  ): Promise<void> {
    if (!this.audioStream) {
      throw new Error('Audio service not initialized. Call initialize() first.');
    }

    if (this.isRecording) {
      throw new Error('Recording already in progress');
    }

    // Recreate MediaRecorder if it's null or in an unusable state
    if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
      console.log('Recreating MediaRecorder for new recording session');
      await this.createMediaRecorder();
    }

    if (!this.mediaRecorder) {
      throw new Error('Failed to create MediaRecorder');
    }

    this.onTranscriptionCallback = onTranscription;
    this.onErrorCallback = onError;
    this.audioChunks = [];
    this.isRecording = true;

    // Start continuous recording with timeslice to get periodic data
    this.mediaRecorder.start(AUDIO_TRANSCRIPTION_DEFAULTS.MEDIA_RECORDER_TIMESLICE);
    
    // Schedule periodic chunk processing only for real-time strategy
    if (this.config.strategy === TranscriptionStrategy.REAL_TIME) {
      this.scheduleChunkProcessing();
    }
  }

  /**
   * Stop audio recording and trigger transcription
   */
  async stopRecording(): Promise<void> {
    if (this.mediaRecorder && this.isRecording) {
      this.mediaRecorder.stop();
      this.isRecording = false;
      
      // Stop all audio tracks to remove browser recording indicator
      if (this.audioStream) {
        this.audioStream.getTracks().forEach(track => {
          track.stop();
          console.log('Stopped audio track:', track.kind);
        });
      }
      
      // processAccumulatedAudio will be called by onstop event
    }
  }

  /**
   * Force reset recording state (for error recovery)
   */
  forceResetState(): void {
    console.log('Force resetting recording state');
    this.isRecording = false;
    this.audioChunks = [];
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      this.mediaRecorder.stop();
    }
    // Reset MediaRecorder to null so it gets recreated on next recording
    this.mediaRecorder = null;
  }

  /**
   * Manually trigger transcription of current audio buffer
   */
  async transcribeCurrentBuffer(): Promise<void> {
    if (this.isRecording && this.audioChunks.length > 0) {
      await this.processCompleteAudioFile();
      this.audioChunks = []; // Clear buffer after transcription
    }
  }

  /**
   * Clean up resources
   */
  cleanup(): void {
    if (this.isRecording) {
      this.stopRecording();
    }
    
    // Clean up silence detection
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    
    // Clean up audio analysis
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    
    this.analyser = null;
    
    if (this.audioStream) {
      this.audioStream.getTracks().forEach(track => track.stop());
      this.audioStream = null;
    }
    
    this.mediaRecorder = null;
  }

  private setupMediaRecorderEvents(): void {
    if (!this.mediaRecorder) return;

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        this.audioChunks.push(event.data);
        console.log(`Audio chunk received: ${event.data.size} bytes, total chunks: ${this.audioChunks.length}`);
      }
    };

    this.mediaRecorder.onstop = () => {
      console.log('Recording stopped, processing complete audio file');
      this.isRecording = false; // Ensure state is reset
      if (this.audioChunks.length > 0) {
        this.processCompleteAudioFile();
      }
    };
  }

  /**
   * Get current recording duration in milliseconds
   */
  getRecordingDuration(): number {
    // Calculate total size of audio chunks as a rough estimate
    const totalSize = this.audioChunks.reduce((sum, chunk) => sum + chunk.size, 0);
    return totalSize > 0 ? Math.max(1000, totalSize / 100) : 0; // Rough estimate based on size
  }

  /**
   * Check if enough audio has been collected for meaningful transcription
   */
  hasMinimumAudio(): boolean {
    const totalSize = this.audioChunks.reduce((sum, chunk) => sum + chunk.size, 0);
    return this.audioChunks.length > 0 && totalSize >= (this.config.minChunkSize || AUDIO_TRANSCRIPTION_DEFAULTS.MIN_CHUNK_SIZE);
  }

  /**
   * Schedule periodic recording restart for clean audio segments (real-time only)
   */
  private scheduleChunkProcessing(): void {
    if (!this.isRecording || this.config.strategy !== TranscriptionStrategy.REAL_TIME) return;

    // Start silence detection
    this.startSilenceDetection();

    // Fallback timer for maximum chunk duration
    setTimeout(() => {
      if (this.isRecording && this.config.strategy === TranscriptionStrategy.REAL_TIME) {
        console.log('「⩇⩇:⩇⩇」 Max duration reached, forcing transcription');
        this.restartRecordingForTranscription();
      }
      
      // Continue scheduling if still recording
      if (this.isRecording && this.config.strategy === TranscriptionStrategy.REAL_TIME) {
        this.scheduleChunkProcessing();
      }
    }, this.config.chunkDuration || AUDIO_TRANSCRIPTION_DEFAULTS.CHUNK_DURATION);
  }

  /**
   * Restart recording to create a complete audio file for transcription
   */
  private async restartRecordingForTranscription(): Promise<void> {
    if (!this.mediaRecorder || !this.audioStream || !this.isRecording) return;

    try {
      // Stop current recording to get a complete audio file
      this.mediaRecorder.stop();
      
      // Wait a bit for the stop event to process
      setTimeout(() => {
        if (this.isRecording && this.audioStream) {
          // Start a new recording session
          const mimeType = this.mediaRecorder?.mimeType || 'audio/wav';
          this.mediaRecorder = new MediaRecorder(this.audioStream, { mimeType });
          this.setupMediaRecorderEvents();
          this.audioChunks = []; // Clear for new recording
          this.mediaRecorder.start(AUDIO_TRANSCRIPTION_DEFAULTS.MEDIA_RECORDER_TIMESLICE);
          console.log('Recording restarted for continuous transcription');
          
          // Restart silence detection
          this.startSilenceDetection();
        }
      }, AUDIO_TRANSCRIPTION_DEFAULTS.RESTART_DELAY);
    } catch (error) {
      console.error('Error restarting recording:', error);
      if (this.onErrorCallback) {
        this.onErrorCallback(error as Error);
      }
    }
  }

  /**
   * Set up audio analysis for silence detection
   */
  private async setupAudioAnalysis(): Promise<void> {
    try {
      this.audioContext = new AudioContext();
      this.analyser = this.audioContext.createAnalyser();
      
      if (this.audioStream) {
        const source = this.audioContext.createMediaStreamSource(this.audioStream);
        source.connect(this.analyser);
        
        this.analyser.fftSize = AUDIO_TRANSCRIPTION_DEFAULTS.FFT_SIZE;
        console.log('Audio analysis setup complete for silence detection');
      }
    } catch (error) {
      console.warn('Could not set up audio analysis for silence detection:', error);
    }
  }

  /**
   * Start monitoring audio levels for silence detection (real-time only)
   */
  private startSilenceDetection(): void {
    if (!this.analyser || !this.isRecording || this.config.strategy !== TranscriptionStrategy.REAL_TIME) return;

    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    const checkAudioLevel = () => {
      if (!this.isRecording || !this.analyser) return;
      
      this.analyser.getByteFrequencyData(dataArray);
      
      // Calculate average audio level
      const average = dataArray.reduce((sum, value) => sum + value, 0) / bufferLength;
      const normalizedLevel = average / 255;
      
      const now = Date.now();
      
      if (normalizedLevel > (this.config.silenceThreshold || AUDIO_TRANSCRIPTION_DEFAULTS.SILENCE_THRESHOLD)) {
        // Sound detected
        this.lastSoundTime = now;
        
        // Clear any existing silence timer
        if (this.silenceTimer) {
          clearTimeout(this.silenceTimer);
          this.silenceTimer = null;
        }
      } else {
        // Silence detected
        const silenceDuration = now - this.lastSoundTime;
        
        if (silenceDuration > (this.config.silenceDuration || AUDIO_TRANSCRIPTION_DEFAULTS.SILENCE_DURATION) && !this.silenceTimer && this.config.strategy === TranscriptionStrategy.REAL_TIME) {
          console.log(`༄ Silence detected for ${silenceDuration}ms, triggering transcription`);
          this.silenceTimer = setTimeout(() => {
            if (this.isRecording && this.audioChunks.length > 0 && this.config.strategy === TranscriptionStrategy.REAL_TIME) {
              console.log('༄ Silence-triggered transcription');
              this.restartRecordingForTranscription();
            }
            this.silenceTimer = null;
          }, AUDIO_TRANSCRIPTION_DEFAULTS.TRANSCRIPTION_TRIGGER_DELAY);
        }
      }
      
      // Continue monitoring
      if (this.isRecording) {
        setTimeout(checkAudioLevel, AUDIO_TRANSCRIPTION_DEFAULTS.AUDIO_CHECK_INTERVAL);
      }
    };
    
    // Initialize last sound time
    this.lastSoundTime = Date.now();
    checkAudioLevel();
  }

  private async processCompleteAudioFile(): Promise<void> {
    console.log('Processing complete audio file...');
    console.log('Audio chunks available:', this.audioChunks.length);
    console.log('Callback available:', !!this.onTranscriptionCallback);
    
    if (!this.audioChunks.length) {
      console.log('No audio chunks to process');
      return;
    }

    try {
      // Clear silence timer when processing
      if (this.silenceTimer) {
        clearTimeout(this.silenceTimer);
        this.silenceTimer = null;
      }
      
      // Create a complete audio file from all chunks (this should be a valid file now)
      const mimeType = this.mediaRecorder?.mimeType || 'audio/wav';
      const completeAudioBlob = new Blob(this.audioChunks, { type: mimeType });
      
      console.log(`Processing complete audio file: ${completeAudioBlob.size} bytes from ${this.audioChunks.length} chunks, type: ${mimeType}`);
      console.log(`Min chunk size threshold: ${this.config.minChunkSize || AUDIO_TRANSCRIPTION_DEFAULTS.MIN_CHUNK_SIZE} bytes`);
      
      if (completeAudioBlob.size > (this.config.minChunkSize || AUDIO_TRANSCRIPTION_DEFAULTS.MIN_CHUNK_SIZE)) {
        console.log('Audio size sufficient, starting transcription...');
        const transcription = await this.transcribeAudio(completeAudioBlob);
        console.log('Transcription result:', transcription);
        
        if (this.onTranscriptionCallback) {
          console.log('Calling transcription callback with result:', transcription.text);
          this.onTranscriptionCallback(transcription);
        } else {
          console.log('No transcription callback available');
        }
      } else {
        console.log('Complete audio file too small for transcription');
        // Still call the callback with empty result to reset UI state
        if (this.onTranscriptionCallback) {
          this.onTranscriptionCallback({ text: '', confidence: 0 });
        }
      }
    } catch (error) {
      console.error('Error processing complete audio file:', error);
      this.isRecording = false; // Reset state on error
      if (this.onErrorCallback) {
        this.onErrorCallback(error as Error);
      }
    }
  }

  private async transcribeAudio(audioBlob: Blob): Promise<TranscriptionResult> {
    console.log('Starting transcription for blob of size:', audioBlob.size, 'type:', audioBlob.type);
    
    const formData = new FormData();
    
    // Determine file extension based on MIME type
    let filename = AUDIO_FILE_EXTENSIONS[audioBlob.type as keyof typeof AUDIO_FILE_EXTENSIONS] || 'audio.webm';
    
    formData.append('file', audioBlob, filename);
    formData.append('model_id', AUDIO_TRANSCRIPTION_DEFAULTS.MODEL);
    formData.append("diarize", JSON.stringify(AUDIO_TRANSCRIPTION_DEFAULTS.DIARIZE));

    console.log('Sending transcription request to ElevenLabs API with filename:', filename);
    
    try {
      const response = await fetch(API_ENDPOINTS.ELEVENLABS_SPEECH_TO_TEXT, {
        method: 'POST',
        headers: {
          'xi-api-key': this.config.apiKey
        },
        body: formData
      });
      
      console.log('API Response:', response);
    
      if (!response.ok) {
        const errorText = await response.text();
        console.error('API Error response:', errorText);
        throw new Error(`Transcription failed: Error: ElevenLabs API error: ${response.status} - ${errorText}`);
      }
      
      const result = await response.json();
      console.log('Transcription API result:', result);
      
      return {
        text: result.text || '',
        confidence: result.confidence,
        timestamp: Date.now()
      };
    } catch (error) {
      console.error('Transcription API call failed:', error);
      throw error;
    }
  }

  /**
   * Check if browser supports required features
   */
  static isSupported(): boolean {
    try {
      return !!(
        navigator.mediaDevices &&
        navigator.mediaDevices.getUserMedia
      ) && typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('audio/webm');
    } catch {
      return false;
    }
  }

  /**
   * Get current recording status
   */
  get recording(): boolean {
    return this.isRecording;
  }
}
