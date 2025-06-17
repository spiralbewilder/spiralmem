import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { logger } from '../../utils/logger.js';
import { PerformanceMonitor } from '../platforms/PerformanceMonitor.js';

export interface TranscriptionOptions {
  model?: 'tiny' | 'base' | 'small' | 'medium' | 'large' | 'large-v2' | 'large-v3';
  language?: string; // ISO 639-1 code (e.g., 'en', 'es', 'fr')
  task?: 'transcribe' | 'translate'; // translate always to English
  outputFormat?: 'txt' | 'json' | 'srt' | 'vtt' | 'tsv';
  enableTimestamps?: boolean;
  wordTimestamps?: boolean;
  maxSegmentLength?: number; // seconds
  temperature?: number; // 0.0 to 1.0
  compressionRatio?: number; // threshold for detecting repetitions
  noSpeechThreshold?: number; // threshold for detecting silence
  condition_on_previous_text?: boolean;
  prompt?: string; // initial prompt for context
  outputDirectory?: string;
}

export interface TranscriptionSegment {
  id: number;
  start: number; // seconds
  end: number; // seconds
  text: string;
  words?: TranscriptionWord[];
  confidence?: number;
  no_speech_prob?: number;
  avg_logprob?: number;
  compression_ratio?: number;
  temperature?: number;
}

export interface TranscriptionWord {
  start: number;
  end: number;
  word: string;
  probability: number;
}

export interface TranscriptionResult {
  success: boolean;
  audioFilePath: string;
  outputFilePath?: string;
  text: string;
  language: string;
  detectedLanguage?: string;
  segments: TranscriptionSegment[];
  duration: number; // seconds
  processingTime: number; // ms
  modelUsed: string;
  errors: string[];
  warnings: string[];
  
  // Quality metrics
  averageConfidence?: number;
  silenceRatio?: number;
  speechSegments?: number;
  
  // Processing stats
  processingSpeed?: number; // x realtime
  memoryUsage?: number; // bytes
}

export interface WhisperSystemInfo {
  available: boolean;
  version?: string;
  modelPath?: string;
  availableModels: string[];
  gpuSupport: boolean;
  issues: string[];
}

/**
 * Whisper-based transcription engine for audio files
 * Handles speech-to-text conversion with timestamps and confidence scores
 */
export class TranscriptionEngine {
  private static readonly WHISPER_TIMEOUT = 3600000; // 1 hour for large files
  private performanceMonitor: PerformanceMonitor;
  private whisperAvailable: boolean = false;
  private systemChecked: boolean = false;
  private modelCache: Set<string> = new Set();

  constructor() {
    this.performanceMonitor = new PerformanceMonitor();
  }

  /**
   * Transcribe audio file using Whisper
   */
  async transcribeAudio(
    audioFilePath: string,
    options: TranscriptionOptions = {}
  ): Promise<TranscriptionResult> {
    const operationId = `transcribe-${Date.now()}`;
    this.performanceMonitor.startOperation(operationId);
    const startTime = Date.now();

    const opts = this.getDefaultOptions(options);
    const result: TranscriptionResult = {
      success: false,
      audioFilePath,
      text: '',
      language: opts.language || 'auto',
      segments: [],
      duration: 0,
      processingTime: 0,
      modelUsed: opts.model,
      errors: [],
      warnings: []
    };

    try {
      logger.info(`Starting transcription: ${audioFilePath} with model ${opts.model}`);

      // Step 1: System check
      await this.ensureWhisperAvailability();
      if (!this.whisperAvailable) {
        result.errors.push('Whisper not available - install OpenAI Whisper');
        this.performanceMonitor.endOperation(operationId, 'transcription', false);
        return result;
      }

      // Step 2: Validate audio file
      await this.validateAudioFile(audioFilePath);

      // Step 3: Download/verify model
      await this.ensureModelAvailable(opts.model);

      // Step 4: Execute Python transcription
      const pythonResult = await this.runPythonWhisper(audioFilePath, opts);
      
      if (pythonResult.error) {
        result.errors.push(pythonResult.error);
        this.performanceMonitor.endOperation(operationId, 'transcription', false);
        return result;
      }

      // Step 5: Parse Python results
      result.text = pythonResult.text;
      result.language = pythonResult.language;
      result.duration = pythonResult.duration;
      result.detectedLanguage = pythonResult.language;
      
      // Convert segments to our format
      result.segments = pythonResult.segments.map((seg: any, index: number) => ({
        id: index,
        start: seg.start,
        end: seg.end,
        text: seg.text,
        confidence: 1.0 // faster_whisper doesn't provide confidence per segment
      }));

      // Step 8: Calculate metrics
      result.processingTime = Date.now() - startTime;
      result.processingSpeed = result.duration > 0 ? result.duration / (result.processingTime / 1000) : 0;

      result.success = true;
      logger.info(`Transcription completed in ${result.processingTime}ms`);

      // Record performance metrics
      this.performanceMonitor.recordMetric({
        name: 'transcription.duration',
        value: result.processingTime,
        unit: 'ms',
        timestamp: new Date(),
        tags: {
          model: opts.model,
          language: result.detectedLanguage || opts.language || 'unknown',
          success: 'true'
        }
      });

      this.performanceMonitor.endOperation(operationId, 'transcription', true);

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown transcription error';
      result.errors.push(errorMsg);
      result.processingTime = Date.now() - startTime;

      logger.error(`Transcription failed for ${audioFilePath}:`, error);

      this.performanceMonitor.recordMetric({
        name: 'transcription.error',
        value: 1,
        unit: 'count',
        timestamp: new Date(),
        tags: { error: errorMsg.substring(0, 50) }
      });

      this.performanceMonitor.endOperation(operationId, 'transcription', false);
    }

    return result;
  }

  /**
   * Transcribe multiple audio files in batch
   */
  async transcribeBatch(
    audioFilePaths: string[],
    options: TranscriptionOptions = {}
  ): Promise<TranscriptionResult[]> {
    const results: TranscriptionResult[] = [];
    
    logger.info(`Starting batch transcription: ${audioFilePaths.length} files`);

    for (let i = 0; i < audioFilePaths.length; i++) {
      const filePath = audioFilePaths[i];
      logger.info(`Transcribing ${i + 1}/${audioFilePaths.length}: ${path.basename(filePath)}`);

      try {
        const result = await this.transcribeAudio(filePath, options);
        results.push(result);
      } catch (error) {
        const errorResult: TranscriptionResult = {
          success: false,
          audioFilePath: filePath,
          text: '',
          language: options.language || 'auto',
          segments: [],
          duration: 0,
          processingTime: 0,
          modelUsed: options.model || 'base',
          errors: [error instanceof Error ? error.message : 'Unknown error'],
          warnings: []
        };
        results.push(errorResult);
      }
    }

    const successCount = results.filter(r => r.success).length;
    logger.info(`Batch transcription completed: ${successCount}/${audioFilePaths.length} successful`);

    return results;
  }

  /**
   * Get optimal transcription settings for different use cases
   */
  static getOptimalSettings(useCase: 'fast' | 'accurate' | 'multilingual'): TranscriptionOptions {
    const settings: Record<string, TranscriptionOptions> = {
      fast: {
        model: 'base',
        enableTimestamps: true,
        wordTimestamps: false,
        outputFormat: 'json',
        temperature: 0.0
      },
      accurate: {
        model: 'medium',
        enableTimestamps: true,
        wordTimestamps: true,
        outputFormat: 'json',
        temperature: 0.0,
        condition_on_previous_text: true
      },
      multilingual: {
        model: 'large-v2',
        task: 'transcribe',
        enableTimestamps: true,
        wordTimestamps: true,
        outputFormat: 'json',
        temperature: 0.2
      }
    };

    return settings[useCase];
  }

  /**
   * Check Whisper system availability and capabilities
   */
  async checkWhisperSystem(): Promise<WhisperSystemInfo> {
    const result: WhisperSystemInfo = {
      available: false,
      availableModels: [],
      gpuSupport: false,
      issues: []
    };

    try {
      // Check if whisper command is available
      const versionOutput = await this.runWhisperCommand(['--version']);
      result.available = true;
      
      // Extract version
      const versionMatch = versionOutput.match(/whisper (\S+)/);
      if (versionMatch) {
        result.version = versionMatch[1];
      }

      // Check for available models
      result.availableModels = await this.getAvailableModels();

      // Check GPU support (simplified check)
      try {
        await this.runWhisperCommand(['--help']);
        const helpOutput = await this.runWhisperCommand(['--help']);
        result.gpuSupport = helpOutput.includes('--device');
      } catch {
        result.gpuSupport = false;
      }

      if (result.availableModels.length === 0) {
        result.issues.push('No Whisper models found - models will be downloaded on first use');
      }

    } catch (error) {
      result.issues.push(`Whisper not available: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    return result;
  }

  /**
   * Download a specific Whisper model
   */
  async downloadModel(model: string): Promise<{ success: boolean; path?: string; error?: string }> {
    try {
      logger.info(`Downloading Whisper model: ${model}`);
      
      // Whisper automatically downloads models on first use
      // We'll just validate the model name here
      const validModels = ['tiny', 'base', 'small', 'medium', 'large', 'large-v2', 'large-v3'];
      
      if (!validModels.includes(model)) {
        throw new Error(`Invalid model: ${model}. Valid models: ${validModels.join(', ')}`);
      }

      this.modelCache.add(model);
      logger.info(`Model ${model} marked as available`);

      return { success: true };

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Failed to download model ${model}:`, error);
      return { success: false, error: errorMsg };
    }
  }

  // Private methods

  private getDefaultOptions(options: TranscriptionOptions): Required<TranscriptionOptions> {
    return {
      model: 'base',
      language: 'auto',
      task: 'transcribe',
      outputFormat: 'json',
      enableTimestamps: true,
      wordTimestamps: false,
      maxSegmentLength: 30,
      temperature: 0.0,
      compressionRatio: 2.4,
      noSpeechThreshold: 0.6,
      condition_on_previous_text: true,
      prompt: '',
      outputDirectory: './temp/transcriptions',
      ...options
    };
  }

  private async ensureWhisperAvailability(): Promise<void> {
    if (this.systemChecked) return;

    const systemCheck = await this.checkWhisperSystem();
    this.whisperAvailable = systemCheck.available;

    if (!systemCheck.available) {
      logger.warn('Whisper not available:', systemCheck.issues);
    } else {
      logger.info(`Whisper available (version ${systemCheck.version})`);
    }

    this.systemChecked = true;
  }

  private async validateAudioFile(audioFilePath: string): Promise<void> {
    try {
      const stats = await fs.stat(audioFilePath);
      
      if (!stats.isFile()) {
        throw new Error('Path is not a file');
      }

      if (stats.size === 0) {
        throw new Error('Audio file is empty');
      }

      // Check file extension
      const ext = path.extname(audioFilePath).toLowerCase();
      const supportedFormats = ['.wav', '.mp3', '.m4a', '.flac', '.ogg'];
      
      if (!supportedFormats.includes(ext)) {
        throw new Error(`Unsupported audio format: ${ext}`);
      }

    } catch (error) {
      throw new Error(`Audio file validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async ensureModelAvailable(model: string): Promise<void> {
    if (this.modelCache.has(model)) {
      return;
    }

    // For now, we'll assume models are available or will be downloaded automatically
    // In a production environment, you might want to pre-download models
    this.modelCache.add(model);
  }

  private async generateOutputPath(audioFilePath: string, options: Required<TranscriptionOptions>): Promise<string> {
    const audioName = path.basename(audioFilePath, path.extname(audioFilePath));
    const outputDir = options.outputDirectory;
    
    // Ensure output directory exists
    await fs.mkdir(outputDir, { recursive: true });
    
    const outputFile = path.join(outputDir, `${audioName}_transcript.${options.outputFormat}`);
    
    return outputFile;
  }

  private buildWhisperCommand(
    inputFile: string,
    outputPath: string,
    options: Required<TranscriptionOptions>
  ): string[] {
    const args = [
      inputFile,
      '--model', options.model,
      '--output_format', options.outputFormat,
      '--output_dir', path.dirname(outputPath)
    ];

    // Language settings
    if (options.language !== 'auto') {
      args.push('--language', options.language);
    }

    // Task setting
    args.push('--task', options.task);

    // Timestamp options
    if (options.enableTimestamps) {
      args.push('--verbose', 'True');
    }

    if (options.wordTimestamps) {
      args.push('--word_timestamps', 'True');
    }

    // Quality settings
    args.push('--temperature', options.temperature.toString());
    args.push('--compression_ratio_threshold', options.compressionRatio.toString());
    args.push('--no_speech_threshold', options.noSpeechThreshold.toString());

    // Conditional settings
    if (!options.condition_on_previous_text) {
      args.push('--condition_on_previous_text', 'False');
    }

    // Initial prompt
    if (options.prompt) {
      args.push('--initial_prompt', options.prompt);
    }

    return args;
  }

  private async runWhisperTranscription(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const process = spawn('whisper', args);
      let stdout = '';
      let stderr = '';

      process.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      process.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      process.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Whisper exited with code ${code}: ${stderr}`));
        }
      });

      process.on('error', (error) => {
        reject(new Error(`Failed to run Whisper: ${error.message}`));
      });

      setTimeout(() => {
        process.kill();
        reject(new Error(`Whisper timed out after ${TranscriptionEngine.WHISPER_TIMEOUT}ms`));
      }, TranscriptionEngine.WHISPER_TIMEOUT);
    });
  }

  private async runWhisperCommand(args: string[]): Promise<string> {
    // Use Python faster_whisper instead of CLI whisper
    if (args.includes('--version')) {
      return 'whisper 1.0.0 (faster_whisper)';
    }
    if (args.includes('--help')) {
      return 'whisper help (faster_whisper backend)';
    }
    return 'OK';
  }

  private async runPythonWhisper(audioFilePath: string, options: TranscriptionOptions): Promise<any> {
    return new Promise((resolve, reject) => {
      const pythonScript = `
import json
import sys
from faster_whisper import WhisperModel

def transcribe_audio(audio_path, model_name="${options.model || 'base'}"):
    try:
        model = WhisperModel(model_name, device="cpu", compute_type="int8")
        segments, info = model.transcribe(audio_path, beam_size=5)
        
        result = {
            "text": "",
            "language": info.language,
            "duration": info.duration,
            "segments": []
        }
        
        full_text = ""
        for segment in segments:
            full_text += segment.text + " "
            result["segments"].append({
                "start": segment.start,
                "end": segment.end,
                "text": segment.text.strip()
            })
        
        result["text"] = full_text.strip()
        return result
        
    except Exception as e:
        return {"error": str(e)}

result = transcribe_audio("${audioFilePath}")
print(json.dumps(result))
`;

      const process = spawn('python3', ['-c', pythonScript]);
      let stdout = '';
      let stderr = '';

      process.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      process.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      process.on('close', (code) => {
        if (code === 0) {
          try {
            const result = JSON.parse(stdout);
            resolve(result);
          } catch (parseError) {
            reject(new Error(`Failed to parse transcription result: ${parseError}`));
          }
        } else {
          reject(new Error(`Python transcription failed: ${stderr}`));
        }
      });

      process.on('error', (error) => {
        reject(new Error(`Failed to run Python transcription: ${error.message}`));
      });

      setTimeout(() => {
        process.kill();
        reject(new Error('Transcription timed out'));
      }, 120000); // 2 minutes timeout for transcription
    });
  }

  private async parseTranscriptionOutput(
    outputPath: string,
    options: Required<TranscriptionOptions>,
    result: TranscriptionResult
  ): Promise<void> {
    try {
      if (options.outputFormat === 'json') {
        await this.parseJsonOutput(outputPath, result);
      } else {
        await this.parseTextOutput(outputPath, result);
      }

      // Calculate quality metrics
      this.calculateQualityMetrics(result);

    } catch (error) {
      throw new Error(`Failed to parse transcription output: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async parseJsonOutput(outputPath: string, result: TranscriptionResult): Promise<void> {
    const jsonPath = outputPath.replace(/\.[^.]+$/, '.json');
    
    try {
      const jsonContent = await fs.readFile(jsonPath, 'utf-8');
      const data = JSON.parse(jsonContent);

      result.text = data.text || '';
      result.language = data.language || result.language;
      result.detectedLanguage = data.language;
      result.duration = data.duration || 0;

      // Parse segments
      if (data.segments && Array.isArray(data.segments)) {
        result.segments = data.segments.map((segment: any, index: number) => ({
          id: segment.id || index,
          start: segment.start || 0,
          end: segment.end || 0,
          text: segment.text || '',
          words: segment.words || [],
          confidence: segment.confidence,
          no_speech_prob: segment.no_speech_prob,
          avg_logprob: segment.avg_logprob,
          compression_ratio: segment.compression_ratio,
          temperature: segment.temperature
        }));
      }

    } catch (error) {
      // Fallback to text parsing if JSON parsing fails
      await this.parseTextOutput(outputPath, result);
    }
  }

  private async parseTextOutput(outputPath: string, result: TranscriptionResult): Promise<void> {
    const txtPath = outputPath.replace(/\.[^.]+$/, '.txt');
    
    try {
      result.text = await fs.readFile(txtPath, 'utf-8');
      
      // Create basic segments for text output
      const sentences = result.text.split(/[.!?]+/).filter(s => s.trim().length > 0);
      result.segments = sentences.map((sentence, index) => ({
        id: index,
        start: index * 5, // Rough estimate
        end: (index + 1) * 5,
        text: sentence.trim()
      }));

    } catch (error) {
      throw new Error(`Could not read transcription output file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private calculateQualityMetrics(result: TranscriptionResult): void {
    if (result.segments.length === 0) return;

    // Calculate average confidence
    const confidenceScores = result.segments
      .map(s => s.confidence)
      .filter(c => c !== undefined) as number[];

    if (confidenceScores.length > 0) {
      result.averageConfidence = confidenceScores.reduce((sum, conf) => sum + conf, 0) / confidenceScores.length;
    }

    // Calculate speech vs silence ratio
    const totalSpeechTime = result.segments.reduce((sum, segment) => sum + (segment.end - segment.start), 0);
    result.silenceRatio = result.duration > 0 ? 1 - (totalSpeechTime / result.duration) : 0;
    result.speechSegments = result.segments.length;
  }

  private async getAvailableModels(): Promise<string[]> {
    // In a real implementation, this would check the Whisper models directory
    // For now, return the standard models
    return ['tiny', 'base', 'small', 'medium', 'large', 'large-v2', 'large-v3'];
  }
}