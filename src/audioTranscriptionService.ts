import { AUDIO_TRANSCRIPTION_DEFAULTS, API_ENDPOINTS, AUDIO_FILE_EXTENSIONS, TranscriptionStrategy } from './constants';
import type { TranscriptionStrategyType } from './constants';

export interface TranscriptionResult {
  text: string;
  confidence?: number;
  timestamp?: number;
  speaker?: string;
  containsAvatarName?: boolean;
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
  audioGatingCallback?: () => boolean; // Callback to check if audio should be processed
  onAudioCaptured?: (audioBlob: Blob) => void; // Callback when audio blob is captured
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
  private nameDetectionCallback?: (result: TranscriptionResult) => void;
  private isAvatarSpeakingCallback?: () => boolean;
  private audioGatingCallback?: () => boolean;
  private onAudioCapturedCallback?: (audioBlob: Blob) => void;
  private batchHadMeaningfulAudio: boolean = false; // Track if current batch has meaningful audio

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
    this.audioGatingCallback = config.audioGatingCallback;
    this.onAudioCapturedCallback = config.onAudioCaptured;

  }

  /**
   * Initialize microphone access and prepare for recording
   * NOT IN USE!
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
    getSpeaker?: () => string,
    nameDetectionCallback?: (result: TranscriptionResult) => void,
    isAvatarSpeakingCallback?: () => boolean
  ): Promise<void> {
    if (!this.audioStream) {
      throw new Error('Audio service not initialized. Call initialize() first.');
    }

    if (this.isRecording) {
      throw new Error('Recording already in progress');
    }

    this.isAvatarSpeakingCallback = isAvatarSpeakingCallback;

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
    this.nameDetectionCallback = nameDetectionCallback;
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
   * Start silence detection to trigger transcription
   */
  private startSilenceDetection(): void {
    console.log('🎤 Starting silence detection for sentence-based processing');
    
    const checkAudioLevel = () => {
      if (!this.audioAnalyzer || !this.isRecording) return;
      
      const dataArray = new Uint8Array(this.audioAnalyzer.frequencyBinCount);
      this.audioAnalyzer.getByteFrequencyData(dataArray);
      
      // Calculate average volume
      const average = dataArray.reduce((sum, value) => sum + value, 0) / dataArray.length;
      const normalizedLevel = average / 255;
      
      const now = Date.now();
      
      // Check if sound is above threshold
      if (normalizedLevel > (this.config.silenceThreshold || 0.05)) {
        this.lastSoundTime = now;
        this.batchHadMeaningfulAudio = true; // Mark batch as having meaningful audio

        // Clear any existing silence timer
        if (this.silenceTimer) {
          clearTimeout(this.silenceTimer);
          this.silenceTimer = null;
        }
      } else {
        // Check for silence duration
        const silenceDuration = now - this.lastSoundTime;
        if (silenceDuration > (this.config.silenceDuration || AUDIO_TRANSCRIPTION_DEFAULTS.SILENCE_DURATION) && !this.silenceTimer && this.currentBuffer.length > 0) {
          this.silenceTimer = setTimeout(() => {
            if (this.isRecording && this.currentBuffer.length > 0) {
              console.log('🎤 Silence detected, processing audio batch');
              this.switchBuffer();
            }
            this.silenceTimer = null;
          }, 500);
        }
      }
      
      // Continue monitoring
      if (this.isRecording) {
        requestAnimationFrame(checkAudioLevel);
      }
    };
    
    // Start monitoring
    this.lastSoundTime = Date.now();
    this.batchHadMeaningfulAudio = false; // Reset for new batch

    checkAudioLevel();
    
    // Also start max batch timer as backup
    this.startMaxBatchTimer();
  }
  private startMaxBatchTimer(): void {
    if (this.maxBatchTimer) {
      clearTimeout(this.maxBatchTimer);
    }
    
    this.maxBatchTimer = setTimeout(() => {
      console.log('🎤 15-second max duration reached, switching buffer');
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
    
    // Capture the audio activity state for this batch
    const batchHadAudio = this.batchHadMeaningfulAudio;
    
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
          // Reset audio activity flag for new batch
          this.batchHadMeaningfulAudio = false;
        }
      }
    }
    
    this.isProcessingTranscription = false;
    
    // Process the buffer after releasing the flag, passing the audio activity state
    if (this.processingBuffer.length > 0) {
      this.processBufferAsync(batchHadAudio);
    }
  }

  /**
   * Process buffer asynchronously while recording continues
   */
  private async processBufferAsync(batchHadAudio: boolean): Promise<void> {
    if (this.isProcessingTranscription || this.processingBuffer.length === 0) {
      return;
    }
    
    // ADD THIS CHECK HERE
    if (this.isAvatarSpeakingCallback && this.isAvatarSpeakingCallback()) {
      console.log('🎯 Skipping transcription - avatar is speaking');
      this.processingBuffer = [];
      this.isProcessingTranscription = false;
      return;
    }


    // Check if batch had meaningful audio during recording
    if (!batchHadAudio) {
      console.log('🎤 Audio gating: ❌ Skipping transcription - batch had no meaningful audio during recording');
      this.processingBuffer = [];
      this.isProcessingTranscription = false;
      return;
    }

    this.isProcessingTranscription = true;
    console.log('🎤 Processing buffer asynchronously:', this.processingBuffer.length, 'chunks');

    try {
      const mimeType = this.mediaRecorder?.mimeType || 'audio/wav';
      const audioBlob = new Blob(this.processingBuffer, { type: mimeType });
      
      // Call audio captured callback if provided
      if (this.onAudioCapturedCallback) {
        this.onAudioCapturedCallback(audioBlob);
      }
      
      if (audioBlob.size > (this.config.minChunkSize || AUDIO_TRANSCRIPTION_DEFAULTS.MIN_CHUNK_SIZE)) {
        console.log('🎤 Transcribing buffer:', audioBlob.size, 'bytes');
        const transcription = await this.transcribeAudio(audioBlob);
        
        if (this.onTranscriptionCallback && transcription.text && transcription.text.trim() !== '') {
          // Check for avatar name detection
          const avatarName = "Anu";
          const containsAvatarName = transcription.text.toLowerCase().includes(avatarName.toLowerCase());
          
          // Add speaker info and name detection to transcription result
          const resultWithSpeaker = {
            ...transcription,
            speaker: this.currentSpeaker,
            containsAvatarName
          };
          
          // If avatar name is detected, call the name detection callback first
          if (containsAvatarName && this.nameDetectionCallback) {
            console.log('🎯 Avatar name detected in transcription:', transcription.text);
            this.nameDetectionCallback(resultWithSpeaker);
          }
          
          // Always call the regular transcription callback for display
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
    
    formData.append('language_code', AUDIO_TRANSCRIPTION_DEFAULTS.LANGUAGE);
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

  /**
   * Update silence threshold dynamically
   */
  public updateSilenceThreshold(threshold: number): void {
    this.config.silenceThreshold = threshold;
    console.log('🎤 Updated silence threshold to:', threshold);
  }
}
