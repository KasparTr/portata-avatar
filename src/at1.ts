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
  }
  
  export class AudioTranscriptionService {
    private mediaRecorder: MediaRecorder | null = null;
    private audioStream: MediaStream | null = null;
    private isRecording = false;
    private config: AudioTranscriptionConfig;
    private audioChunks: Blob[] = [];
    private onTranscriptionCallback?: (result: TranscriptionResult) => void;
    private onErrorCallback?: (error: Error) => void;
  
    constructor(config: AudioTranscriptionConfig) {
      this.config = {
        language: 'en',
        model: 'scribe_v1',
        sampleRate: 16000,
        chunkDuration: 5000, // Process chunks every 5 seconds
        minChunkSize: 5000, // Minimum 5KB of audio data
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
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        });
  
        this.mediaRecorder = new MediaRecorder(this.audioStream, {
          mimeType: 'audio/webm;codecs=opus'
        });
  
        this.setupMediaRecorderEvents();
      } catch (error) {
        throw new Error(`Failed to initialize audio: ${error}`);
      }
    }
  
    /**
     * Start audio recording with real-time transcription
     */
    async startRecording(
      onTranscription: (result: TranscriptionResult) => void,
      onError?: (error: Error) => void
    ): Promise<void> {
      if (!this.mediaRecorder || !this.audioStream) {
        throw new Error('Audio service not initialized. Call initialize() first.');
      }
  
      if (this.isRecording) {
        throw new Error('Recording already in progress');
      }
  
      this.onTranscriptionCallback = onTranscription;
      this.onErrorCallback = onError;
      this.audioChunks = [];
      this.isRecording = true;
  
      // Start continuous recording
      this.mediaRecorder.start();
      
      // Schedule periodic chunk processing for real-time transcription
      this.scheduleChunkProcessing();
    }
  
    /**
     * Stop audio recording and trigger transcription
     */
    async stopRecording(): Promise<void> {
      if (this.mediaRecorder && this.isRecording) {
        this.mediaRecorder.stop();
        this.isRecording = false;
        // processAudioChunk will be called by onstop event
      }
    }
  
    /**
     * Manually trigger transcription of current audio buffer
     */
    async transcribeCurrentBuffer(): Promise<void> {
      if (this.isRecording && this.audioChunks.length > 0) {
        await this.processAudioChunk();
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
        }
      };
  
      this.mediaRecorder.onstop = () => {
        if (this.audioChunks.length > 0) {
          this.processAudioChunk();
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
      return this.audioChunks.length > 0 && totalSize >= (this.config.minChunkSize || 5000);
    }
  
    /**
     * Schedule periodic chunk processing for real-time transcription
     */
    private scheduleChunkProcessing(): void {
      if (!this.isRecording) return;
  
      setTimeout(() => {
        if (this.isRecording && this.hasMinimumAudio()) {
          this.processCurrentChunks();
        }
        
        // Continue scheduling if still recording
        if (this.isRecording) {
          this.scheduleChunkProcessing();
        }
      }, this.config.chunkDuration || 5000);
    }
  
    /**
     * Process current audio chunks without stopping recording
     */
    private async processCurrentChunks(): Promise<void> {
      if (this.audioChunks.length === 0) return;
  
      try {
        // Create a copy of current chunks and clear the buffer for new audio
        const chunksToProcess = [...this.audioChunks];
        this.audioChunks = [];
  
        const audioBlob = new Blob(chunksToProcess, { type: 'audio/webm' });
        
        console.log(`Processing ${chunksToProcess.length} audio chunks in real-time, size: ${audioBlob.size} bytes`);
        
        const transcription = await this.transcribeAudio(audioBlob);
        
        if (transcription.text && transcription.text.trim() && this.onTranscriptionCallback) {
          this.onTranscriptionCallback(transcription);
        }
      } catch (error) {
        console.error('Error processing real-time audio chunks:', error);
        if (this.onErrorCallback) {
          this.onErrorCallback(error as Error);
        }
      }
    }
  
    private async processAudioChunk(): Promise<void> {
      // This is called when recording stops - process any remaining chunks
      if (this.audioChunks.length === 0) {
        console.log('No remaining audio chunks to process');
        return;
      }
  
      try {
        const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
        
        console.log(`Processing final ${this.audioChunks.length} audio chunks, total size: ${audioBlob.size} bytes`);
        
        // Process remaining audio even if it's smaller than usual chunks
        if (audioBlob.size > 1000) {
          const transcription = await this.transcribeAudio(audioBlob);
          
          if (transcription.text && transcription.text.trim() && this.onTranscriptionCallback) {
            this.onTranscriptionCallback(transcription);
          }
        }
      } catch (error) {
        console.error('Error processing final audio chunk:', error);
        if (this.onErrorCallback) {
          this.onErrorCallback(error as Error);
        }
      }
    }
  
    private async transcribeAudio(audioBlob: Blob): Promise<TranscriptionResult> {
      console.log('Starting transcription for blob of size:', audioBlob.size);
      
      const formData = new FormData();
      formData.append('file', audioBlob, 'audio.webm');
      formData.append('model_id', 'scribe_v1');
      
      // Use the configured language or default to auto-detect
      if (this.config.language && this.config.language !== 'en') {
        formData.append('language_code', this.config.language);
      }
      
      try {
        const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
          method: 'POST',
          headers: {
            'xi-api-key': this.config.apiKey
          },
          body: formData
        });
  
        if (!response.ok) {
          const errorText = await response.text();
          console.error('API Error Response:', errorText);
          throw new Error(`ElevenLabs API error: ${response.status} - ${errorText}`);
        }
  
        const result = await response.json();
        console.log('API Response:', result);
  
        return {
          text: result.text || '',
          confidence: result.confidence || 0,
          timestamp: Date.now()
        };
      } catch (error) {
        console.error('Transcription error:', error);
        throw new Error(`Transcription failed: ${error}`);
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
  