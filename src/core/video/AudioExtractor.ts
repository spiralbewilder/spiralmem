import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { logger } from '../../utils/logger.js';
import { PerformanceMonitor } from '../platforms/PerformanceMonitor.js';

export interface AudioExtractionOptions {
  outputFormat?: 'wav' | 'mp3' | 'flac' | 'm4a';
  sampleRate?: number; // Hz (e.g., 16000, 44100, 48000)
  channels?: number; // 1 for mono, 2 for stereo
  bitrate?: string; // e.g., '128k', '192k', '320k'
  normalize?: boolean; // Normalize audio levels
  removeNoise?: boolean; // Basic noise reduction
  outputDirectory?: string;
  keepOriginalDuration?: boolean;
  maxDuration?: number; // seconds, to limit processing time
}

export interface AudioExtractionResult {
  success: boolean;
  inputFile: string;
  outputFile?: string;
  duration: number; // seconds
  fileSize: number; // bytes
  sampleRate: number;
  channels: number;
  extractionTime: number; // ms
  errors: string[];
  warnings: string[];
  
  // Audio quality info
  averageVolume?: number;
  peakVolume?: number;
  silenceDetected?: boolean;
  
  // Processing stats
  compressionRatio?: number;
  processingSpeed?: number; // x realtime
}

export interface AudioValidationResult {
  hasAudio: boolean;
  audioStreams: number;
  primaryAudioInfo?: {
    codec: string;
    sampleRate: number;
    channels: number;
    bitrate: number;
    duration: number;
  };
  issues: string[];
}

/**
 * FFmpeg-based audio extraction from video files
 * Extracts audio tracks and converts to optimal formats for transcription
 */
export class AudioExtractor {
  private static readonly FFMPEG_TIMEOUT = 300000; // 5 minutes
  private performanceMonitor: PerformanceMonitor;

  constructor() {
    this.performanceMonitor = new PerformanceMonitor();
  }

  /**
   * Extract audio from video file
   */
  async extractAudio(
    videoFilePath: string, 
    options: AudioExtractionOptions = {}
  ): Promise<AudioExtractionResult> {
    const operationId = `extractAudio-${Date.now()}`;
    this.performanceMonitor.startOperation(operationId);
    const startTime = Date.now();

    const opts = this.getDefaultOptions(options);
    const result: AudioExtractionResult = {
      success: false,
      inputFile: videoFilePath,
      duration: 0,
      fileSize: 0,
      sampleRate: opts.sampleRate,
      channels: opts.channels,
      extractionTime: 0,
      errors: [],
      warnings: []
    };

    try {
      logger.info(`Starting audio extraction: ${videoFilePath}`);

      // Step 1: Validate input file has audio
      const validation = await this.validateAudioStreams(videoFilePath);
      if (!validation.hasAudio) {
        result.errors.push('No audio streams found in video file');
        this.performanceMonitor.endOperation(operationId, 'audio', false);
        return result;
      }

      // Step 2: Generate output file path
      const outputFile = await this.generateOutputPath(videoFilePath, opts);
      result.outputFile = outputFile;

      // Step 3: Build FFmpeg command
      const ffmpegArgs = this.buildFFmpegArgs(videoFilePath, outputFile, opts, validation);

      // Step 4: Execute FFmpeg
      const extractionInfo = await this.runFFmpegExtraction(ffmpegArgs, opts.maxDuration);

      // Step 5: Validate output and collect stats
      await this.validateAndAnalyzeOutput(outputFile, result);

      // Step 6: Calculate performance metrics
      result.extractionTime = Date.now() - startTime;
      result.processingSpeed = result.duration > 0 ? result.duration / (result.extractionTime / 1000) : 0;

      if (validation.primaryAudioInfo) {
        const originalSize = await this.getFileSize(videoFilePath);
        result.compressionRatio = originalSize > 0 ? result.fileSize / originalSize : 0;
      }

      result.success = true;
      logger.info(`Audio extraction completed in ${result.extractionTime}ms`);

      // Record performance metrics
      this.performanceMonitor.recordMetric({
        name: 'audio.extraction.duration',
        value: result.extractionTime,
        unit: 'ms',
        timestamp: new Date(),
        tags: {
          format: opts.outputFormat,
          channels: opts.channels.toString(),
          sampleRate: opts.sampleRate.toString(),
          success: 'true'
        }
      });

      this.performanceMonitor.endOperation(operationId, 'audio', true);

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown extraction error';
      result.errors.push(errorMsg);
      result.extractionTime = Date.now() - startTime;

      logger.error(`Audio extraction failed for ${videoFilePath}:`, error);

      this.performanceMonitor.recordMetric({
        name: 'audio.extraction.error',
        value: 1,
        unit: 'count',
        timestamp: new Date(),
        tags: { error: errorMsg.substring(0, 50) }
      });

      this.performanceMonitor.endOperation(operationId, 'audio', false);
    }

    return result;
  }

  /**
   * Extract audio from multiple video files
   */
  async extractAudioBatch(
    videoFilePaths: string[], 
    options: AudioExtractionOptions = {}
  ): Promise<AudioExtractionResult[]> {
    const results: AudioExtractionResult[] = [];
    
    logger.info(`Starting batch audio extraction: ${videoFilePaths.length} files`);

    for (let i = 0; i < videoFilePaths.length; i++) {
      const filePath = videoFilePaths[i];
      logger.info(`Processing ${i + 1}/${videoFilePaths.length}: ${path.basename(filePath)}`);

      try {
        const result = await this.extractAudio(filePath, options);
        results.push(result);
      } catch (error) {
        const errorResult: AudioExtractionResult = {
          success: false,
          inputFile: filePath,
          duration: 0,
          fileSize: 0,
          sampleRate: options.sampleRate || 16000,
          channels: options.channels || 1,
          extractionTime: 0,
          errors: [error instanceof Error ? error.message : 'Unknown error'],
          warnings: []
        };
        results.push(errorResult);
      }
    }

    const successCount = results.filter(r => r.success).length;
    logger.info(`Batch extraction completed: ${successCount}/${videoFilePaths.length} successful`);

    return results;
  }

  /**
   * Get optimal audio extraction settings for transcription
   */
  static getOptimalTranscriptionSettings(): AudioExtractionOptions {
    return {
      outputFormat: 'wav',
      sampleRate: 16000, // Optimal for most speech recognition models
      channels: 1, // Mono for transcription
      normalize: true,
      removeNoise: true,
      keepOriginalDuration: true
    };
  }

  /**
   * Get fast audio extraction settings optimized for speed over quality
   * Use for audio-first processing where transcription speed is critical
   */
  static getFastTranscriptionSettings(): AudioExtractionOptions {
    return {
      outputFormat: 'wav',
      sampleRate: 16000, // Same as optimal for compatibility
      channels: 1, // Mono for transcription
      normalize: false, // Skip normalization for speed
      removeNoise: false, // Skip noise reduction for speed
      keepOriginalDuration: true
    };
  }

  /**
   * Check if FFmpeg supports audio processing
   */
  async checkAudioProcessingSupport(): Promise<{
    supported: boolean;
    codecs: string[];
    formats: string[];
    filters: string[];
    issues: string[];
  }> {
    const result = {
      supported: false,
      codecs: [] as string[],
      formats: [] as string[],
      filters: [] as string[],
      issues: [] as string[]
    };

    try {
      // Check FFmpeg codecs
      const codecOutput = await this.runFFmpegCommand(['-codecs']);
      result.codecs = this.parseCodecList(codecOutput);

      // Check formats
      const formatOutput = await this.runFFmpegCommand(['-formats']);
      result.formats = this.parseFormatList(formatOutput);

      // Check filters
      const filterOutput = await this.runFFmpegCommand(['-filters']);
      result.filters = this.parseFilterList(filterOutput);

      result.supported = result.codecs.length > 0 && result.formats.includes('wav');

      if (!result.supported) {
        result.issues.push('FFmpeg audio processing not fully supported');
      }

    } catch (error) {
      result.issues.push(`FFmpeg check failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    return result;
  }

  // Private methods

  private getDefaultOptions(options: AudioExtractionOptions): Required<AudioExtractionOptions> {
    return {
      outputFormat: 'wav',
      sampleRate: 16000,
      channels: 1,
      bitrate: '128k',
      normalize: false,
      removeNoise: false,
      outputDirectory: './temp/audio',
      keepOriginalDuration: true,
      maxDuration: 8 * 60 * 60, // 8 hours
      ...options
    };
  }

  private async validateAudioStreams(videoFilePath: string): Promise<AudioValidationResult> {
    const result: AudioValidationResult = {
      hasAudio: false,
      audioStreams: 0,
      issues: []
    };

    try {
      const probeOutput = await this.runFFprobeCommand([
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_streams',
        '-select_streams', 'a',
        videoFilePath
      ]);

      const probeData = JSON.parse(probeOutput);
      const audioStreams = probeData.streams || [];

      result.audioStreams = audioStreams.length;
      result.hasAudio = audioStreams.length > 0;

      if (audioStreams.length > 0) {
        const primaryStream = audioStreams[0];
        result.primaryAudioInfo = {
          codec: primaryStream.codec_name,
          sampleRate: parseInt(primaryStream.sample_rate) || 0,
          channels: primaryStream.channels || 0,
          bitrate: parseInt(primaryStream.bit_rate) || 0,
          duration: parseFloat(primaryStream.duration) || 0
        };

        if (audioStreams.length > 1) {
          result.issues.push(`Multiple audio streams found (${audioStreams.length}), using first stream`);
        }
      }

    } catch (error) {
      result.issues.push(`Audio stream validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    return result;
  }

  private async generateOutputPath(videoFilePath: string, options: Required<AudioExtractionOptions>): Promise<string> {
    const videoName = path.basename(videoFilePath, path.extname(videoFilePath));
    const outputDir = options.outputDirectory;
    
    // Ensure output directory exists
    await fs.mkdir(outputDir, { recursive: true });
    
    const outputFile = path.join(outputDir, `${videoName}_audio.${options.outputFormat}`);
    
    // Handle file conflicts by adding timestamp
    try {
      await fs.access(outputFile);
      const timestamp = Date.now();
      const outputFileWithTimestamp = path.join(outputDir, `${videoName}_audio_${timestamp}.${options.outputFormat}`);
      return outputFileWithTimestamp;
    } catch {
      return outputFile;
    }
  }

  private buildFFmpegArgs(
    inputFile: string, 
    outputFile: string, 
    options: Required<AudioExtractionOptions>,
    validation: AudioValidationResult
  ): string[] {
    const args = [
      '-i', inputFile,
      '-vn', // No video
      '-acodec', this.getOutputCodec(options.outputFormat),
      '-ar', options.sampleRate.toString(),
      '-ac', options.channels.toString()
    ];

    // Add bitrate for compressed formats
    if (options.outputFormat !== 'wav' && options.outputFormat !== 'flac') {
      args.push('-ab', options.bitrate);
    }

    // Add audio filters
    const filters: string[] = [];
    
    if (options.normalize) {
      filters.push('loudnorm');
    }
    
    if (options.removeNoise) {
      filters.push('afftdn');
    }

    if (filters.length > 0) {
      args.push('-af', filters.join(','));
    }

    // Duration limiting
    if (!options.keepOriginalDuration && options.maxDuration) {
      args.push('-t', options.maxDuration.toString());
    }

    // Overwrite output file
    args.push('-y');
    args.push(outputFile);

    return args;
  }

  private getOutputCodec(format: string): string {
    const codecMap: Record<string, string> = {
      'wav': 'pcm_s16le',
      'mp3': 'libmp3lame',
      'flac': 'flac',
      'm4a': 'aac'
    };
    return codecMap[format] || 'pcm_s16le';
  }

  private async runFFmpegExtraction(args: string[], maxDuration?: number): Promise<void> {
    const timeout = maxDuration ? Math.min(maxDuration * 1000 * 2, AudioExtractor.FFMPEG_TIMEOUT) : AudioExtractor.FFMPEG_TIMEOUT;
    
    return new Promise((resolve, reject) => {
      const process = spawn('ffmpeg', args);
      let stderr = '';

      process.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      process.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`FFmpeg exited with code ${code}: ${stderr}`));
        }
      });

      process.on('error', (error) => {
        reject(new Error(`Failed to run FFmpeg: ${error.message}`));
      });

      setTimeout(() => {
        process.kill();
        reject(new Error(`FFmpeg timed out after ${timeout}ms`));
      }, timeout);
    });
  }

  private async runFFmpegCommand(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const process = spawn('ffmpeg', args);
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
          resolve(stdout);
        } else {
          reject(new Error(`FFmpeg command failed: ${stderr}`));
        }
      });

      process.on('error', (error) => {
        reject(new Error(`Failed to run FFmpeg: ${error.message}`));
      });

      setTimeout(() => {
        process.kill();
        reject(new Error('FFmpeg command timed out'));
      }, 30000);
    });
  }

  private async validateAndAnalyzeOutput(outputFile: string, result: AudioExtractionResult): Promise<void> {
    try {
      const stats = await fs.stat(outputFile);
      result.fileSize = stats.size;

      if (result.fileSize === 0) {
        result.errors.push('Output file is empty');
        return;
      }

      // Get duration from file using ffprobe
      try {
        const probeOutput = await this.runFFprobeCommand([
          '-v', 'quiet',
          '-print_format', 'json',
          '-show_format',
          outputFile
        ]);

        const probeData = JSON.parse(probeOutput);
        result.duration = parseFloat(probeData.format.duration) || 0;

      } catch (error) {
        result.warnings.push('Could not determine output file duration');
      }

    } catch (error) {
      result.errors.push(`Output validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async getFileSize(filePath: string): Promise<number> {
    try {
      const stats = await fs.stat(filePath);
      return stats.size;
    } catch {
      return 0;
    }
  }

  private parseCodecList(output: string): string[] {
    const lines = output.split('\n');
    const codecs: string[] = [];
    
    for (const line of lines) {
      if (line.includes('A')) { // Audio codec
        const match = line.match(/\s+(\w+)\s+/);
        if (match) {
          codecs.push(match[1]);
        }
      }
    }
    
    return codecs;
  }

  private parseFormatList(output: string): string[] {
    const lines = output.split('\n');
    const formats: string[] = [];
    
    for (const line of lines) {
      const match = line.match(/\s*[DE]+\s+(\w+)/);
      if (match) {
        formats.push(match[1]);
      }
    }
    
    return formats;
  }

  private parseFilterList(output: string): string[] {
    const lines = output.split('\n');
    const filters: string[] = [];
    
    for (const line of lines) {
      if (line.includes('A->A') || line.includes('A->N')) { // Audio filters
        const match = line.match(/\s+(\w+)\s+/);
        if (match) {
          filters.push(match[1]);
        }
      }
    }
    
    return filters;
  }

  private async runFFprobeCommand(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const process = spawn('ffprobe', args);
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
          resolve(stdout);
        } else {
          reject(new Error(`FFprobe command failed: ${stderr}`));
        }
      });

      process.on('error', (error) => {
        reject(new Error(`Failed to run FFprobe: ${error.message}`));
      });

      setTimeout(() => {
        process.kill();
        reject(new Error('FFprobe command timed out'));
      }, 30000);
    });
  }
}