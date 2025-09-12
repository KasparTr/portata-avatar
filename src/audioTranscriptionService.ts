import { AUDIO_TRANSCRIPTION_DEFAULTS, API_ENDPOINTS, AUDIO_FILE_EXTENSIONS, TranscriptionStrategy } from './constants';
import type { TranscriptionStrategyType } from './constants';

export interface TranscriptionResult {
  text: string;
  confidence?: number;
  timestamp?: number;
  speaker?: string;
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
  private currentBuffer: Blob[] = [];
  private processingBuffer: Blob[] = [];
  private onTranscriptionCallback?: (result: TranscriptionResult) => void;
  private onErrorCallback?: (error: Error) => void;
  private lastSoundTime: number = 0;
  private silenceTimer: NodeJS.Timeout | null = null;
  private maxBatchTimer: NodeJS.Timeout | null = null;
  private audioAnalyzer: AnalyserNode | null = null;
  private audioContext: AudioContext | null = null;
  private batchStartTime: number = 0;
  private isProcessingTranscription: boolean = false;
  private currentSpeaker: string = '';
  private getSpeakerCallback?: () => string;

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
   * Initialize with a shared audio stream (to avoid microphone conflicts)
   */
  async initializeWithStream(audioStream: MediaStream): Promise<void> {
    try {
      this.audioStream = audioStream;

      // Try different audio formats, prioritizing more compatible formats
      let mimeType: string = AUDIO_TRANSCRIPTION_DEFAULTS.PREFERRED_MIME_TYPES[0];
      for (const preferredType of AUDIO_TRANSCRIPTION_DEFAULTS.PREFERRED_MIME_TYPES) {
        if (MediaRecorder.isTypeSupported(preferredType)) {
          mimeType = preferredType;
          break;
        }
      }
      
      console.log('Using shared audio stream with format:', mimeType);
      await this.createMediaRecorder();
      
      // Set up audio analysis for silence detection
      await this.setupAudioAnalysis();
    } catch (error) {
      throw new Error(`Failed to initialize with shared audio stream: ${error}`);
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
    onError?: (error: Error) => void,
    getSpeaker?: () => string
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
    this.getSpeakerCallback = getSpeaker;
    this.currentBuffer = [];
    this.isRecording = true;

    // Start continuous recording with timeslice to get periodic data
    this.mediaRecorder.start(AUDIO_TRANSCRIPTION_DEFAULTS.MEDIA_RECORDER_TIMESLICE);
    
    // Set up continuous batch processing
    console.log('🎤 Setting up continuous batch processing...');
    await this.setupAudioAnalysis();
    this.startSilenceDetection();
  }

  /**
   * Stop audio recording and trigger transcription
   */
  async stopRecording(): Promise<void> {
    console.log('🎤 stopRecording called, isRecording:', this.isRecording);
    if (this.mediaRecorder && this.isRecording) {
      console.log('🎤 Stopping MediaRecorder...');
      this.mediaRecorder.stop();
      this.isRecording = false;
      
      // Stop all audio tracks to remove browser recording indicator
      if (this.audioStream) {
        this.audioStream.getTracks().forEach(track => {
          track.stop();
          console.log('Stopped audio track:', track.kind);
        });
      }
      
      console.log('🎤 MediaRecorder stopped, waiting for onstop event to trigger transcription');
      // processAccumulatedAudio will be called by onstop event
    } else {
      console.log('🎤 No recording to stop or MediaRecorder not available');
    }
  }

  /**
   * Force reset recording state (for error recovery)
   */
  forceResetState(): void {
    console.log('Force resetting recording state');
    this.isRecording = false;
    this.currentBuffer = [];
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
    if (this.isRecording && this.currentBuffer.length > 0) {
      await this.switchBuffer();
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
    
    // Clean up max batch timer
    if (this.maxBatchTimer) {
      clearTimeout(this.maxBatchTimer);
      this.maxBatchTimer = null;
    }
    
    // Clean up audio analysis
    if (this.audioAnalyzer) {
      this.audioAnalyzer.disconnect();
      this.audioAnalyzer = null;
    }
    
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
        this.currentBuffer.push(event.data);
        console.log(`Audio chunk received: ${event.data.size} bytes, total chunks: ${this.currentBuffer.length}`);
      }
    };

    // Remove onstop handler - we'll process batches asynchronously
    this.mediaRecorder.onstop = () => {
      console.log('🎤 MediaRecorder stopped');
      this.isRecording = false;
    };
  }

  /**
   * Get current recording duration in milliseconds
   */
  getRecordingDuration(): number {
    // Calculate total size of audio chunks as a rough estimate
    const totalSize = this.currentBuffer.reduce((sum, chunk) => sum + chunk.size, 0);
    return totalSize > 0 ? Math.max(1000, totalSize / 100) : 0; // Rough estimate based on size
  }

  /**
   * Check if enough audio has been collected for meaningful transcription
   */
  hasMinimumAudio(): boolean {
    const totalSize = this.currentBuffer.reduce((sum, chunk) => sum + chunk.size, 0);
    return this.currentBuffer.length > 0 && totalSize >= (this.config.minChunkSize || AUDIO_TRANSCRIPTION_DEFAULTS.MIN_CHUNK_SIZE);
  }

  /**
   * Set up audio analysis for silence detection
   */
  private async setupAudioAnalysis(): Promise<void> {
    if (!this.audioStream) {
      console.log('No audio stream available for analysis');
      return;
    }

    try {
      this.audioContext = new AudioContext();
      const source = this.audioContext.createMediaStreamSource(this.audioStream);
      this.audioAnalyzer = this.audioContext.createAnalyser();
      this.audioAnalyzer.fftSize = AUDIO_TRANSCRIPTION_DEFAULTS.FFT_SIZE || 256;
      source.connect(this.audioAnalyzer);
      console.log('🎤 Audio analysis setup complete for silence detection');
    } catch (error) {
      console.error('Error setting up audio analysis:', error);
    }
  }

  /**
   * Start silence detection and 20-second timer for buffer switching
   * DISABLED: Silence detection causes too many API requests
   */
  private startSilenceDetection(): void {
    // SILENCE DETECTION DISABLED - causes excessive API requests
    // Only rely on max batch timer now
    console.log('🎤 Silence detection disabled, using only max batch timer');
    
    // Start 20-second max timer
    this.startMaxBatchTimer();
  }
  private startMaxBatchTimer(): void {
    if (this.maxBatchTimer) {
      clearTimeout(this.maxBatchTimer);
    }
    
    this.maxBatchTimer = setTimeout(() => {
      console.log('🎤 10-second max duration reached, switching buffer');
      if (this.isRecording && this.currentBuffer.length > 0) {
        this.switchBuffer();
      }
      // Restart timer for next batch
      this.startMaxBatchTimer();
    }, AUDIO_TRANSCRIPTION_DEFAULTS.MAX_BATCH_DURATION);
  }

  /**
   * Trigger buffer switch manually (e.g., on speaker change)
   */
  public triggerBufferSwitch(previousSpeaker?: string): void {
    if (this.isRecording && this.currentBuffer.length > 0) {
      this.switchBuffer(previousSpeaker);
    }
  }

  /**
   * Switch buffer for processing while continuing to record
   */
  private async switchBuffer(overrideSpeaker?: string): Promise<void> {
    if (this.isProcessingTranscription || this.currentBuffer.length === 0 || !this.mediaRecorder) {
      return;
    }

    console.log('🎤 Switching buffer - stopping MediaRecorder to finalize audio file');
    
    this.isProcessingTranscription = true;
    
    // Stop MediaRecorder to finalize the current audio file
    if (this.mediaRecorder.state === 'recording') {
      this.mediaRecorder.stop();
      
      // Capture current speaker at the moment of buffer switch
      this.currentSpeaker = overrideSpeaker || (this.getSpeakerCallback ? this.getSpeakerCallback() : '');
      
      // Wait for stop event and process the finalized audio
      await new Promise<void>((resolve) => {
        const originalOnStop = this.mediaRecorder!.onstop;
        this.mediaRecorder!.onstop = async () => {
          console.log('🎤 MediaRecorder stopped, processing finalized audio');
          
          if (this.currentBuffer.length > 0) {
            // Move to processing buffer
            this.processingBuffer = [...this.currentBuffer];
            this.currentBuffer = [];
          }
          
          // Restore original handler
          if (originalOnStop) {
            this.mediaRecorder!.onstop = originalOnStop;
          }
          
          resolve();
        };
      });
      
      // Immediately restart recording to minimize gap
      if (this.isRecording) {
        await this.createMediaRecorder();
        if (this.mediaRecorder) {
          this.mediaRecorder.start(AUDIO_TRANSCRIPTION_DEFAULTS.MEDIA_RECORDER_TIMESLICE);
          console.log('🎤 MediaRecorder restarted for continuous recording');
        }
      }
    }
    
    this.isProcessingTranscription = false;
    
    // Process the buffer after releasing the flag
    if (this.processingBuffer.length > 0) {
      this.processBufferAsync();
    }
  }

  /**
   * Process buffer asynchronously while recording continues
   */
  private async processBufferAsync(): Promise<void> {
    if (this.isProcessingTranscription || this.processingBuffer.length === 0) {
      return;
    }

    this.isProcessingTranscription = true;
    console.log('🎤 Processing buffer asynchronously:', this.processingBuffer.length, 'chunks');

    try {
      const mimeType = this.mediaRecorder?.mimeType || 'audio/wav';
      const audioBlob = new Blob(this.processingBuffer, { type: mimeType });
      
      if (audioBlob.size > (this.config.minChunkSize || AUDIO_TRANSCRIPTION_DEFAULTS.MIN_CHUNK_SIZE)) {
        console.log('🎤 Transcribing buffer:', audioBlob.size, 'bytes');
        const transcription = await this.transcribeAudio(audioBlob);
        
        if (this.onTranscriptionCallback && transcription.text && transcription.text.trim() !== '') {
          // Add speaker info to transcription result
          const resultWithSpeaker = {
            ...transcription,
            speaker: this.currentSpeaker
          };
          this.onTranscriptionCallback(resultWithSpeaker);
        }
      } else {
        console.log('🎤 Buffer too small for transcription');
      }
      
      // Clear processing buffer
      this.processingBuffer = [];
    } catch (error) {
      console.error('Error processing buffer:', error);
      if (this.onErrorCallback) {
        this.onErrorCallback(error as Error);
      }
    } finally {
      this.isProcessingTranscription = false;
    }
  }

  private async transcribeAudio(audioBlob: Blob): Promise<TranscriptionResult> {
    console.log('Starting transcription for blob of size:', audioBlob.size, 'type:', audioBlob.type);
    
    const formData = new FormData();
    
    // Determine file extension based on MIME type
    let filename = AUDIO_FILE_EXTENSIONS[audioBlob.type as keyof typeof AUDIO_FILE_EXTENSIONS] || 'audio.webm';
    
    formData.append('file', audioBlob, filename);
    formData.append('model_id', AUDIO_TRANSCRIPTION_DEFAULTS.MODEL);
    
    // Only add diarize if it's true (boolean, not JSON string)
    if (AUDIO_TRANSCRIPTION_DEFAULTS.DIARIZE) {
      formData.append('diarize', 'true');
    }

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
