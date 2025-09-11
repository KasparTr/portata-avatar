import { AVATAR_AUDIO_CONFIG, API_ENDPOINTS, AUDIO_FILE_EXTENSIONS } from './constants';
import type { TranscriptionResult } from './audioTranscriptionService';
import { interruptAvatar } from './main';

export interface ContinuousListeningConfig {
  apiKey: string;
  language?: string;
  model?: string;
  sampleRate?: number;
  avatarName: string;
  onNameDetected?: (transcription: string) => void;
  onUserVoiceDetected?: (transcription: string) => void;
  onError?: (error: Error) => void;
  enableInterruptDetection?: boolean;
}

export class ContinuousListeningService {
  private mediaRecorder: MediaRecorder | null = null;
  private audioStream: MediaStream | null = null;
  private isListening = false;
  private isPaused = false;
  private config: ContinuousListeningConfig;
  private audioChunks: Blob[] = [];
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private silenceTimer: NodeJS.Timeout | null = null;
  private lastSoundTime = 0;
  private processingTimeout: NodeJS.Timeout | null = null;
  private isAvatarSpeaking = false;
  private voiceActivityThreshold = 0.15; // Higher threshold for human voice detection
  private dedicatedAudioStream: MediaStream | null = null; // Separate stream for Anu listening

  constructor(config: ContinuousListeningConfig) {
    this.config = {
      language: AVATAR_AUDIO_CONFIG.LANGUAGE,
      model: AVATAR_AUDIO_CONFIG.MODEL,
      sampleRate: AVATAR_AUDIO_CONFIG.SAMPLE_RATE,
      ...config
    };
  }

  /**
   * Initialize microphone access and prepare for continuous listening
   */
  async initialize(): Promise<void> {
    try {
      // Create dedicated audio stream for Anu listening (separate from transcription service)
      this.dedicatedAudioStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: this.config.sampleRate,
          channelCount: AVATAR_AUDIO_CONFIG.CHANNEL_COUNT,
          echoCancellation: AVATAR_AUDIO_CONFIG.ECHO_CANCELLATION,
          noiseSuppression: AVATAR_AUDIO_CONFIG.NOISE_SUPPRESSION,
          autoGainControl: AVATAR_AUDIO_CONFIG.AUTO_GAIN_CONTROL
        }
      });
      
      // Use the dedicated stream for Anu listening
      this.audioStream = this.dedicatedAudioStream;

      // Try different audio formats, prioritizing more compatible formats
      let mimeType: string = AVATAR_AUDIO_CONFIG.PREFERRED_MIME_TYPES[0];
      for (const preferredType of AVATAR_AUDIO_CONFIG.PREFERRED_MIME_TYPES) {
        if (MediaRecorder.isTypeSupported(preferredType)) {
          mimeType = preferredType;
          break;
        }
      }
      
      console.log('🎧 Anu continuous listening using dedicated audio stream with format:', mimeType);
      await this.createMediaRecorder();
      
      // Set up audio analysis for silence detection
      await this.setupAudioAnalysis();
    } catch (error) {
      throw new Error(`Failed to initialize continuous listening: ${error}`);
    }
  }

  /**
   * Create or recreate MediaRecorder instance
   */
  private async createMediaRecorder(): Promise<void> {
    // Check if audio stream is still active, reinitialize if needed
    if (!this.audioStream || this.audioStream.getTracks().every(track => track.readyState === 'ended')) {
      console.log('Audio stream ended, reinitializing for continuous listening...');
      await this.reinitializeAudioStream();
    }

    if (!this.audioStream) {
      throw new Error('Audio stream not available for continuous listening');
    }

    // Try different audio formats, prioritizing more compatible formats
    let mimeType: string = AVATAR_AUDIO_CONFIG.PREFERRED_MIME_TYPES[0];
    for (const preferredType of AVATAR_AUDIO_CONFIG.PREFERRED_MIME_TYPES) {
      if (MediaRecorder.isTypeSupported(preferredType)) {
        mimeType = preferredType;
        break;
      }
    }
    
    console.log('Creating MediaRecorder for continuous listening with format:', mimeType);
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
          channelCount: AVATAR_AUDIO_CONFIG.CHANNEL_COUNT,
          echoCancellation: AVATAR_AUDIO_CONFIG.ECHO_CANCELLATION,
          noiseSuppression: AVATAR_AUDIO_CONFIG.NOISE_SUPPRESSION,
          autoGainControl: AVATAR_AUDIO_CONFIG.AUTO_GAIN_CONTROL
        }
      });
      
      // Reinitialize audio analysis
      await this.setupAudioAnalysis();
    } catch (error) {
      throw new Error(`Failed to reinitialize audio stream for continuous listening: ${error}`);
    }
  }

  /**
   * Start continuous listening for avatar name
   */
  async startListening(): Promise<void> {
    if (!this.audioStream) {
      throw new Error('Continuous listening service not initialized. Call initialize() first.');
    }
    if (this.isListening) {
      console.log('🎧 Already listening continuously');
      return;
    }

    await this.createMediaRecorder();

    if (!this.mediaRecorder) {
      throw new Error('Failed to create MediaRecorder for continuous listening');
    }

    this.audioChunks = [];
    this.isListening = true;

    // Start continuous recording with timeslice to get periodic data
    this.mediaRecorder.start(AVATAR_AUDIO_CONFIG.MEDIA_RECORDER_TIMESLICE);
    
    // Start silence detection for processing audio chunks
    this.startSilenceDetection();
    
    console.log('🎧 Continuous listening started - waiting for avatar name...');
  }

  /**
   * Set avatar speaking state
   */
  setAvatarSpeaking(speaking: boolean): void {
    this.isAvatarSpeaking = speaking;
    console.log(`🎧 Avatar speaking state: ${speaking}`);
  }

  /**
   * Pause continuous listening (e.g., when avatar is speaking)
   */
  pauseListening(): void {
    if (!this.isListening) {
      console.log('🎧 Not currently listening, cannot pause');
      return;
    }

    console.log('🎧 Switching to interrupt detection mode...');
    this.isAvatarSpeaking = true;
    
    // Don't stop recording if interrupt detection is enabled - keep recording for interrupts
    if (!this.config.enableInterruptDetection) {
      if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
        this.mediaRecorder.stop();
      }
    } else {
      console.log('🎤 Keeping recording active for interrupt detection');
      // Clear existing audio chunks to start fresh for interrupt detection
      this.audioChunks = [];
    }
    
    // Clear silence timer
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    
    // Mark as paused but keep isListening true so we can resume
    this.isPaused = true;
    console.log('🎧 Now in interrupt detection mode');
  }

  /**
   * Resume continuous listening (e.g., after avatar stops speaking)
   */
  async resumeListening(): Promise<void> {
    if (!this.isListening || !this.isPaused) {
      console.log('🎧 Cannot resume - not in paused state');
      return;
    }

    console.log('🎧 Resuming continuous listening...');
    this.isAvatarSpeaking = false;
    
    try {
      // Clear any existing audio chunks from before pause
      this.audioChunks = [];
      
      // Create new MediaRecorder
      await this.createMediaRecorder();
      
      if (this.mediaRecorder) {
        // Start recording again
        this.mediaRecorder.start(AVATAR_AUDIO_CONFIG.MEDIA_RECORDER_TIMESLICE);
        
        // Restart silence detection with interrupt detection enabled
        this.startSilenceDetection();
        
        this.isPaused = false;
        console.log('🎧 Continuous listening resumed with interrupt detection');
      }
    } catch (error) {
      console.error('Error resuming continuous listening:', error);
      if (this.config.onError) {
        this.config.onError(error as Error);
      }
    }
  }

  /**
   * Stop continuous listening
   */
  async stopListening(): Promise<void> {
    if (this.mediaRecorder && this.isListening) {
      this.mediaRecorder.stop();
      this.isListening = false;
      console.log('🔇 Continuous listening stopped');
    }
  }

  /**
   * Clean up resources
   */
  cleanup(): void {
    if (this.isListening) {
      this.stopListening();
    }
    
    // Clean up silence detection
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    
    // Clean up processing timeout
    if (this.processingTimeout) {
      clearTimeout(this.processingTimeout);
      this.processingTimeout = null;
    }
    
    // Clean up audio analysis
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    
    this.analyser = null;
    
    // Clean up dedicated audio stream
    if (this.dedicatedAudioStream) {
      this.dedicatedAudioStream.getTracks().forEach(track => track.stop());
      this.dedicatedAudioStream = null;
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
        console.log(`🎧 Audio chunk received: ${event.data.size} bytes, total chunks: ${this.audioChunks.length}`);
      }
    };

    this.mediaRecorder.onstop = () => {
      console.log('🎧 Recording stopped, processing audio');
      // Don't set isListening = false here - we want to continue listening
      if (this.audioChunks.length > 0) {
        this.processAudioForNameDetection();
      } else {
        console.log('🎧 No audio chunks to process, restarting recording');
        // Restart recording immediately if no chunks
        this.restartContinuousListening();
      }
    };
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
        
        this.analyser.fftSize = AVATAR_AUDIO_CONFIG.FFT_SIZE;
        console.log('🎧 Audio analysis setup complete for continuous listening');
      }
    } catch (error) {
      console.warn('Could not set up audio analysis for continuous listening:', error);
    }
  }

  /**
   * Start monitoring audio levels for silence detection
   */
  private startSilenceDetection(): void {
    if (!this.analyser || !this.isListening) return;

    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    const checkAudioLevel = () => {
      if (!this.isListening || !this.analyser) return;
      
      this.analyser.getByteFrequencyData(dataArray);
      
      // Calculate average audio level
      const average = dataArray.reduce((sum, value) => sum + value, 0) / bufferLength;
      const normalizedLevel = average / 255;
      
      const now = Date.now();
      
      if (normalizedLevel > AVATAR_AUDIO_CONFIG.SILENCE_THRESHOLD) {
        // Sound detected
        this.lastSoundTime = now;
        
        // Check for interrupt detection when avatar is speaking
        if (this.isAvatarSpeaking && this.config.enableInterruptDetection && normalizedLevel > this.voiceActivityThreshold) {
          console.log(`🎤 Strong voice activity detected while avatar speaking (${normalizedLevel.toFixed(3)}) - potential interrupt`);
          // Trigger immediate processing to check for user voice
          if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
            console.log('🎤 Stopping recording to process potential interrupt');
            this.mediaRecorder.stop();
            // Clear silence timer to avoid conflicts
            if (this.silenceTimer) {
              clearTimeout(this.silenceTimer);
              this.silenceTimer = null;
            }
            interruptAvatar();
          }
        }
        
        // Clear any existing silence timer
        if (this.silenceTimer) {
          clearTimeout(this.silenceTimer);
          this.silenceTimer = null;
        }
      } else {
        // Silence detected
        const silenceDuration = now - this.lastSoundTime;
        
        if (silenceDuration > AVATAR_AUDIO_CONFIG.SILENCE_DURATION && !this.silenceTimer && !this.isPaused && !this.isAvatarSpeaking) {
          console.log(`🎧 Silence detected for ${silenceDuration}ms, processing for name detection`);
          this.silenceTimer = setTimeout(() => {
            if (this.isListening && this.audioChunks.length > 0 && !this.isPaused && !this.isAvatarSpeaking && this.mediaRecorder && this.mediaRecorder.state === 'recording') {
              console.log('🎧 Silence-triggered name detection processing');
              // Stop current recording to process
              this.mediaRecorder.stop();
            }
            this.silenceTimer = null;
          }, AVATAR_AUDIO_CONFIG.TRANSCRIPTION_TRIGGER_DELAY);
        }
      }
      
      // Continue monitoring
      if (this.isListening) {
        setTimeout(checkAudioLevel, AVATAR_AUDIO_CONFIG.AUDIO_CHECK_INTERVAL);
      }
    };
    
    // Initialize last sound time
    this.lastSoundTime = Date.now();
    checkAudioLevel();
  }


  /**
   * Restart continuous listening after processing
   */
  private async restartContinuousListening(): Promise<void> {
    if (!this.isListening || !this.audioStream) {
      console.log('🎧 Cannot restart - not in listening state or no audio stream');
      return;
    }

    // If paused but interrupt detection enabled, still restart for interrupt monitoring
    if (this.isPaused && !this.config.enableInterruptDetection) {
      console.log('🎧 Skipping restart - service is paused and no interrupt detection');
      return;
    }
    
    if (this.isPaused && this.config.enableInterruptDetection) {
      console.log('🎤 Restarting for interrupt detection while avatar speaks');
    }

    try {
      console.log('🎧 Restarting continuous listening after processing...');
      
      // Create new MediaRecorder for continued listening
      const mimeType = this.mediaRecorder?.mimeType || 'audio/wav';
      this.mediaRecorder = new MediaRecorder(this.audioStream, { mimeType });
      this.setupMediaRecorderEvents();
      
      // Clear audio chunks for new recording session
      this.audioChunks = [];
      
      // Start recording again
      this.mediaRecorder.start(AVATAR_AUDIO_CONFIG.MEDIA_RECORDER_TIMESLICE);
      
      // Restart silence detection (this will reset the chunk timer)
      this.startSilenceDetection();
      
      console.log('🎧 Continuous listening restarted successfully');
    } catch (error) {
      console.error('Error restarting continuous listening:', error);
      if (this.config.onError) {
        this.config.onError(error as Error);
      }
    }
  }

  /**
   * Process audio chunks for name detection
   */
  private async processAudioForNameDetection(): Promise<void> {
    console.log('🎧 Processing audio for name detection...');
    console.log('🎧 Audio chunks available:', this.audioChunks.length);
    
    if (!this.audioChunks.length) {
      console.log('🎧 No audio chunks to process');
      // Restart listening even if no chunks
      this.restartContinuousListening();
      return;
    }

    try {
      // Clear silence timer when processing
      if (this.silenceTimer) {
        clearTimeout(this.silenceTimer);
        this.silenceTimer = null;
      }
      
      // Create a complete audio file from all chunks
      const mimeType = this.mediaRecorder?.mimeType || 'audio/wav';
      const completeAudioBlob = new Blob(this.audioChunks, { type: mimeType });
      
      console.log(`🎧 Processing complete audio file: ${completeAudioBlob.size} bytes from ${this.audioChunks.length} chunks, type: ${mimeType}`);
      
      // Check for minimum size and validate audio blob
      if (completeAudioBlob.size > AVATAR_AUDIO_CONFIG.MIN_CHUNK_SIZE && this.isValidAudioBlob(completeAudioBlob)) {
        console.log('🎧 Audio size sufficient, starting transcription for name detection...');
        const transcription = await this.transcribeAudio(completeAudioBlob);
        console.log('🎧 Transcription result:', transcription);
        
        // Check if this is during avatar speaking (potential interrupt)
        if (this.isAvatarSpeaking && this.config.enableInterruptDetection) {
          console.log(`🎤 Processing potential interrupt: "${transcription.text}"`);
          if (this.isUserVoiceDetected(transcription.text)) {
            console.log(`🛑 User interrupt detected: "${transcription.text}"`);
            if (this.config.onUserVoiceDetected) {
              this.config.onUserVoiceDetected(transcription.text);
            }
          } else {
            console.log(`🎧 No user interrupt detected in: "${transcription.text}"`);
          }
        } else {
          // Normal name detection when avatar is not speaking
          console.log(`🔍 Checking for avatar name "${this.config.avatarName}" in transcription: "${transcription.text}"`);
          if (this.isAvatarNameMentioned(transcription.text)) {
            console.log(`🎯 Avatar name "${this.config.avatarName}" detected in: "${transcription.text}"`);
            if (this.config.onNameDetected) {
              console.log(`📞 Calling onNameDetected callback with: "${transcription.text}"`);
              this.config.onNameDetected(transcription.text);
            } else {
              console.log(`❌ No onNameDetected callback available`);
            }
          } else {
            console.log(`🎧 Avatar name "${this.config.avatarName}" not detected in: "${transcription.text}"`);
          }
        }
      } else {
        console.log('🎧 Audio file too small or invalid for name detection processing');
      }
      
      // Only restart continuous listening if avatar is not speaking
      if (!this.isAvatarSpeaking) {
        this.restartContinuousListening();
      }
      
    } catch (error) {
      console.error('Error processing audio for name detection:', error);
      // Don't call onError to prevent infinite loops
      // Still restart listening even on error, but only if not avatar speaking
      if (!this.isAvatarSpeaking) {
        this.restartContinuousListening();
      }
    }
  }

  /**
   * Detect if user voice is present (for interrupt detection)
   */
  private isUserVoiceDetected(text: string): boolean {
    if (!text || text.trim().length === 0) {
      return false;
    }

    const normalizedText = text.toLowerCase().trim();
    
    // Filter out common avatar speech patterns and background noise
    const avatarPatterns = [
      '(techno music)',
      '(tram hajt de tramvajzúg)',
      '(music)',
      '(background noise)',
      '(silence)',
      '(ambient)',
      '(echo)',
      '',
      ' '
    ];
    
    // However, allow "people talking" as it might be the user
    const allowedBackgroundPatterns = [
      '(people talking',
      'people talking',
      'talking in the background'
    ];
    
    // Check if it's allowed background pattern (might be user)
    const isAllowedBackground = allowedBackgroundPatterns.some(pattern => 
      normalizedText.includes(pattern.toLowerCase())
    );
    
    // Check if it's just avatar echo/noise (but allow background talking)
    if (!isAllowedBackground && avatarPatterns.some(pattern => normalizedText.includes(pattern.toLowerCase()) || normalizedText === pattern.toLowerCase())) {
      console.log(`🎧 Filtered out avatar echo/noise: "${text}"`);
      return false;
    }
    
    // Look for actual human speech patterns
    const humanSpeechIndicators = [
      // Common interrupt words
      'stop', 'wait', 'pause', 'excuse me', 'sorry', 'hey', 'hello', 'hi',
      // Questions
      'what', 'how', 'why', 'when', 'where', 'who',
      // Commands
      'can you', 'could you', 'please', 'tell me', 'explain',
      // Avatar name for interruption
      this.config.avatarName.toLowerCase()
    ];
    
    const hasHumanSpeech = humanSpeechIndicators.some(indicator => 
      normalizedText.includes(indicator)
    );
    
    // Also check for reasonable length (human speech is usually more than 2 characters)
    const hasReasonableLength = normalizedText.length > 2;
    
    // For background talking, be more permissive - any talking detected while avatar speaks could be interrupt
    const isBackgroundTalking = isAllowedBackground && hasReasonableLength;
    
    const isUserVoice = hasHumanSpeech || isBackgroundTalking;
    
    console.log(`🎤 User voice detection: "${text}" -> ${isUserVoice} (human patterns: ${hasHumanSpeech}, length: ${hasReasonableLength})`);
    
    return isUserVoice;
  }

  /**
   * Check if avatar name is mentioned in the transcription
   */
  private isAvatarNameMentioned(text: string): boolean {
    if (!text || !this.config.avatarName) {
      console.log(`🔍 Name detection failed: text="${text}", avatarName="${this.config.avatarName}"`);
      return false;
    }
    
    const normalizedText = text.toLowerCase().trim();
    const normalizedName = this.config.avatarName.toLowerCase().trim();
    
    console.log(`🔍 Normalized text: "${normalizedText}"`);
    console.log(`🔍 Normalized name: "${normalizedName}"`);
    
    // Check for exact name match (case insensitive)
    const nameVariations = [
      normalizedName,
      normalizedName + ',',
      normalizedName + '.',
      normalizedName + '!',
      normalizedName + '?',
      'hey ' + normalizedName,
      'hi ' + normalizedName,
      'hello ' + normalizedName,
    ];
    
    console.log(`🔍 Checking name variations:`, nameVariations);
    
    const found = nameVariations.some(variation => {
      const matches = normalizedText.includes(variation) || 
                     normalizedText.startsWith(variation) ||
                     normalizedText.endsWith(variation);
      if (matches) {
        console.log(`✅ Found match with variation: "${variation}"`);
      }
      return matches;
    });
    
    console.log(`🔍 Name detection result: ${found}`);
    return found;
  }

  /**
   * Transcribe audio using ElevenLabs API
   */
  private async transcribeAudio(audioBlob: Blob): Promise<TranscriptionResult> {
    console.log('🎧 Starting transcription for name detection, blob size:', audioBlob.size, 'type:', audioBlob.type);
    
    const formData = new FormData();
    
    // Determine file extension based on MIME type
    let filename = AUDIO_FILE_EXTENSIONS[audioBlob.type as keyof typeof AUDIO_FILE_EXTENSIONS] || 'audio.mp4';
    
    formData.append('file', audioBlob, filename);
    formData.append('model_id', AVATAR_AUDIO_CONFIG.MODEL);
    formData.append("diarize", JSON.stringify(AVATAR_AUDIO_CONFIG.DIARIZE));

    console.log('🎧 Sending transcription request for name detection with filename:', filename);
    
    try {
      const response = await fetch(API_ENDPOINTS.ELEVENLABS_SPEECH_TO_TEXT, {
        method: 'POST',
        headers: {
          'xi-api-key': this.config.apiKey
        },
        body: formData
      });
      
      console.log('🎧 API Response:', response);
    
      if (!response.ok) {
        const errorText = await response.text();
        console.error('🎧 API Error response:', errorText);
        throw new Error(`Name detection transcription failed: Error: ElevenLabs API error: ${response.status} - ${errorText}`);
      }
      
      const result = await response.json();
      console.log('🎧 Name detection transcription API result:', result);
      
      return {
        text: result.text || '',
        confidence: result.confidence,
        timestamp: Date.now()
      };
    } catch (error) {
      console.error('🎧 Name detection transcription API call failed:', error);
      // Return empty result instead of throwing to prevent infinite loops
      return {
        text: '',
        confidence: 0,
        timestamp: Date.now()
      };
    }
  }

  /**
   * Validate audio blob to prevent sending corrupt files to API
   */
  private isValidAudioBlob(blob: Blob): boolean {
    // Check minimum size (at least 5KB for valid audio)
    if (blob.size < 5000) {
      console.log(`🎧 Audio blob too small: ${blob.size} bytes`);
      return false;
    }
    
    // Check maximum reasonable size (prevent sending huge files)
    if (blob.size > 10 * 1024 * 1024) { // 10MB max
      console.log(`🎧 Audio blob too large: ${blob.size} bytes`);
      return false;
    }
    
    // Check if blob has valid MIME type
    if (!blob.type || !blob.type.startsWith('audio/')) {
      console.log(`🎧 Invalid audio MIME type: ${blob.type}`);
      return false;
    }
    
    return true;
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
   * Get current listening status
   */
  get listening(): boolean {
    return this.isListening;
  }
}
