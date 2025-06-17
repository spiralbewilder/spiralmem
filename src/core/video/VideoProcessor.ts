import path from 'path';
import { logger } from '../../utils/logger.js';
import { PerformanceMonitor } from '../platforms/PerformanceMonitor.js';
import { VideoValidator, VideoValidationResult, ValidationOptions } from './VideoValidator.js';
import { MetadataExtractor, VideoMetadata } from './MetadataExtractor.js';
import { AudioExtractor, AudioExtractionResult, AudioExtractionOptions } from './AudioExtractor.js';
import { TranscriptionEngine, TranscriptionResult, TranscriptionOptions } from './TranscriptionEngine.js';
import { FrameSampler, FrameSamplingResult, FrameSamplingOptions, ThumbnailResult, ThumbnailOptions } from './FrameSampler.js';

export interface VideoProcessingOptions extends ValidationOptions {
  extractMetadata?: boolean;
  skipValidation?: boolean;
  extractAudio?: boolean;
  transcribeAudio?: boolean;
  generateThumbnail?: boolean;
  extractFrames?: boolean;
  outputDirectory?: string;
  audioOptions?: AudioExtractionOptions;
  transcriptionOptions?: TranscriptionOptions;
  frameSamplingOptions?: FrameSamplingOptions;
  thumbnailOptions?: ThumbnailOptions;
}

export interface VideoProcessingResult {
  success: boolean;
  filePath: string;
  validation: VideoValidationResult;
  metadata?: VideoMetadata;
  audioExtraction?: AudioExtractionResult;
  transcription?: TranscriptionResult;
  frameSampling?: FrameSamplingResult;
  thumbnail?: ThumbnailResult;
  processingTime: number;
  errors: string[];
  warnings: string[];
  
  // Generated assets
  audioPath?: string;
  transcriptionPath?: string;
  thumbnailPath?: string;
  extractedFrames?: string[];
  
  // Processing stats
  stats: {
    fileSize: number;
    duration?: number;
    quality?: string;
    hasAudio?: boolean;
    audioExtracted?: boolean;
    transcribed?: boolean;
    transcriptionAccuracy?: number;
  };
}

export interface BatchProcessingResult {
  totalFiles: number;
  successfulFiles: number;
  failedFiles: number;
  results: VideoProcessingResult[];
  totalProcessingTime: number;
  errors: string[];
}

/**
 * Main video processing coordinator
 * Handles validation, metadata extraction, and asset generation
 */
export class VideoProcessor {
  private performanceMonitor: PerformanceMonitor;
  private audioExtractor: AudioExtractor;
  private transcriptionEngine: TranscriptionEngine;
  private frameSampler: FrameSampler;
  private ffmpegAvailable: boolean = false;
  private whisperAvailable: boolean = false;
  private systemChecked: boolean = false;

  constructor() {
    this.performanceMonitor = new PerformanceMonitor();
    this.audioExtractor = new AudioExtractor();
    this.transcriptionEngine = new TranscriptionEngine();
    this.frameSampler = new FrameSampler();
  }

  /**
   * Process a single video file
   */
  async processVideo(
    filePath: string, 
    options: VideoProcessingOptions = {}
  ): Promise<VideoProcessingResult> {
    const operationId = `processVideo-${Date.now()}`;
    this.performanceMonitor.startOperation(operationId);
    
    const startTime = Date.now();
    const result: VideoProcessingResult = {
      success: false,
      filePath,
      validation: {
        isValid: false,
        fileInfo: {
          filePath,
          fileName: path.basename(filePath),
          fileSize: 0,
          fileExtension: '',
          isValid: false,
          errors: [],
          warnings: []
        },
        errors: [],
        warnings: []
      },
      processingTime: 0,
      errors: [],
      warnings: [],
      stats: {
        fileSize: 0
      }
    };

    try {
      logger.info(`Starting video processing: ${filePath}`);

      // Step 1: System check
      await this.ensureSystemRequirements();

      // Step 2: Validation (unless skipped)
      if (!options.skipValidation) {
        logger.info('Running video validation...');
        result.validation = await VideoValidator.validateVideoFile(filePath, options);
        
        if (!result.validation.isValid) {
          result.errors.push(...result.validation.errors);
          result.warnings.push(...result.validation.warnings);
          this.performanceMonitor.endOperation(operationId, 'video', false);
          return result;
        }
      }

      // Step 3: Metadata extraction
      if (options.extractMetadata !== false && this.ffmpegAvailable) {
        logger.info('Extracting video metadata...');
        try {
          result.metadata = await MetadataExtractor.extractMetadata(filePath);
          
          // Update validation result with metadata
          result.validation = await MetadataExtractor.extractAndValidateMetadata(result.validation);
          
        } catch (error) {
          const errorMsg = `Metadata extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
          result.warnings.push(errorMsg);
          logger.warn(errorMsg);
        }
      }

      // Step 4: Update stats
      this.updateProcessingStats(result);

      // Step 4: Audio extraction
      if (options.extractAudio && this.ffmpegAvailable && result.metadata?.hasAudio) {
        logger.info('Extracting audio track...');
        try {
          const audioOptions = options.audioOptions || AudioExtractor.getOptimalTranscriptionSettings();
          result.audioExtraction = await this.audioExtractor.extractAudio(filePath, audioOptions);
          
          if (result.audioExtraction.success) {
            result.audioPath = result.audioExtraction.outputFile;
            logger.info(`Audio extracted to: ${result.audioPath}`);
          } else {
            result.warnings.push(`Audio extraction failed: ${result.audioExtraction.errors.join(', ')}`);
          }
        } catch (error) {
          const errorMsg = `Audio extraction error: ${error instanceof Error ? error.message : 'Unknown error'}`;
          result.warnings.push(errorMsg);
          logger.warn(errorMsg);
        }
      }

      // Step 5: Transcription
      if (options.transcribeAudio && this.whisperAvailable && result.audioPath) {
        logger.info('Transcribing audio...');
        try {
          const transcriptionOptions = options.transcriptionOptions || TranscriptionEngine.getOptimalSettings('accurate');
          result.transcription = await this.transcriptionEngine.transcribeAudio(result.audioPath, transcriptionOptions);
          
          if (result.transcription.success) {
            result.transcriptionPath = result.transcription.outputFilePath;
            logger.info(`Transcription completed: ${result.transcription.text.length} characters`);
          } else {
            result.warnings.push(`Transcription failed: ${result.transcription.errors.join(', ')}`);
          }
        } catch (error) {
          const errorMsg = `Transcription error: ${error instanceof Error ? error.message : 'Unknown error'}`;
          result.warnings.push(errorMsg);
          logger.warn(errorMsg);
        }
      }

      // Step 6: Thumbnail generation
      if (options.generateThumbnail && this.ffmpegAvailable) {
        logger.info('Generating thumbnail...');
        try {
          const thumbnailOptions = options.thumbnailOptions || {
            position: 'middle',
            width: 320,
            height: 240,
            format: 'jpg' as const
          };
          result.thumbnail = await this.frameSampler.generateThumbnail(filePath, thumbnailOptions);
          
          if (result.thumbnail.success) {
            result.thumbnailPath = result.thumbnail.thumbnailPath;
            logger.info(`Thumbnail generated: ${result.thumbnailPath}`);
          } else {
            result.warnings.push(`Thumbnail generation failed: ${result.thumbnail.errors.join(', ')}`);
          }
        } catch (error) {
          const errorMsg = `Thumbnail generation error: ${error instanceof Error ? error.message : 'Unknown error'}`;
          result.warnings.push(errorMsg);
          logger.warn(errorMsg);
        }
      }
      
      // Step 7: Frame extraction
      if (options.extractFrames && this.ffmpegAvailable) {
        logger.info('Extracting frames...');
        try {
          const frameSamplingOptions = options.frameSamplingOptions || {
            method: 'uniform' as const,
            frameCount: 10,
            outputFormat: 'jpg' as const
          };
          result.frameSampling = await this.frameSampler.extractFrames(filePath, frameSamplingOptions);
          
          if (result.frameSampling.success) {
            result.extractedFrames = result.frameSampling.frames.map(f => f.filepath);
            logger.info(`Frame extraction completed: ${result.frameSampling.totalFramesExtracted} frames`);
          } else {
            result.warnings.push(`Frame extraction failed: ${result.frameSampling.errors.join(', ')}`);
          }
        } catch (error) {
          const errorMsg = `Frame extraction error: ${error instanceof Error ? error.message : 'Unknown error'}`;
          result.warnings.push(errorMsg);
          logger.warn(errorMsg);
        }
      }

      result.success = true;
      result.processingTime = Date.now() - startTime;

      logger.info(`Video processing completed successfully in ${result.processingTime}ms`);
      
      // Record performance metrics
      this.performanceMonitor.recordMetric({
        name: 'video.processing.duration',
        value: result.processingTime,
        unit: 'ms',
        timestamp: new Date(),
        tags: { 
          success: 'true',
          hasMetadata: (!!result.metadata).toString(),
          quality: result.metadata?.estimatedQuality || 'unknown'
        }
      });

      this.performanceMonitor.endOperation(operationId, 'video', true);

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown processing error';
      result.errors.push(errorMsg);
      result.processingTime = Date.now() - startTime;
      
      logger.error(`Video processing failed for ${filePath}:`, error);
      
      this.performanceMonitor.recordMetric({
        name: 'video.processing.error',
        value: 1,
        unit: 'count',
        timestamp: new Date(),
        tags: { error: errorMsg.substring(0, 50) }
      });

      this.performanceMonitor.endOperation(operationId, 'video', false);
    }

    return result;
  }

  /**
   * Process multiple video files in batch
   */
  async processVideos(
    filePaths: string[], 
    options: VideoProcessingOptions = {}
  ): Promise<BatchProcessingResult> {
    const batchStartTime = Date.now();
    const batchResult: BatchProcessingResult = {
      totalFiles: filePaths.length,
      successfulFiles: 0,
      failedFiles: 0,
      results: [],
      totalProcessingTime: 0,
      errors: []
    };

    logger.info(`Starting batch video processing: ${filePaths.length} files`);

    try {
      // Process files sequentially to avoid overwhelming the system
      for (let i = 0; i < filePaths.length; i++) {
        const filePath = filePaths[i];
        logger.info(`Processing file ${i + 1}/${filePaths.length}: ${path.basename(filePath)}`);

        try {
          const result = await this.processVideo(filePath, options);
          batchResult.results.push(result);

          if (result.success) {
            batchResult.successfulFiles++;
          } else {
            batchResult.failedFiles++;
          }

        } catch (error) {
          batchResult.failedFiles++;
          const errorMsg = `Failed to process ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`;
          batchResult.errors.push(errorMsg);
          logger.error(errorMsg);
        }
      }

      batchResult.totalProcessingTime = Date.now() - batchStartTime;

      logger.info(`Batch processing completed: ${batchResult.successfulFiles}/${batchResult.totalFiles} successful in ${batchResult.totalProcessingTime}ms`);

      // Record batch metrics
      this.performanceMonitor.recordMetric({
        name: 'video.batch.processing',
        value: batchResult.totalFiles,
        unit: 'count',
        timestamp: new Date(),
        tags: {
          successful: batchResult.successfulFiles.toString(),
          failed: batchResult.failedFiles.toString()
        }
      });

    } catch (error) {
      const errorMsg = `Batch processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
      batchResult.errors.push(errorMsg);
      logger.error(errorMsg);
    }

    return batchResult;
  }

  /**
   * Get processing statistics and performance metrics
   */
  getProcessingMetrics() {
    return this.performanceMonitor.getAnalytics();
  }

  /**
   * Check if video processing is ready (FFmpeg available, etc.)
   */
  async checkSystemReadiness(): Promise<{
    ready: boolean;
    ffmpeg: boolean;
    ffprobe: boolean;
    whisper: boolean;
    versions: {
      ffmpeg?: string;
      whisper?: string;
    };
    issues: string[];
  }> {
    const result = {
      ready: false,
      ffmpeg: false,
      ffprobe: false,
      whisper: false,
      versions: {} as { ffmpeg?: string; whisper?: string },
      issues: [] as string[]
    };

    try {
      // Check FFmpeg
      const ffmpegCheck = await MetadataExtractor.checkFFmpegAvailability();
      result.ffmpeg = ffmpegCheck.ffmpeg;
      result.ffprobe = ffmpegCheck.ffprobe;
      result.versions.ffmpeg = ffmpegCheck.version;

      if (!ffmpegCheck.ffprobe) {
        result.issues.push('ffprobe not available - metadata extraction will be limited');
      }

      if (!ffmpegCheck.ffmpeg) {
        result.issues.push('ffmpeg not available - video processing will be limited');
      }

      // Check Whisper
      const whisperCheck = await this.transcriptionEngine.checkWhisperSystem();
      result.whisper = whisperCheck.available;
      result.versions.whisper = whisperCheck.version;

      if (!whisperCheck.available) {
        result.issues.push('Whisper not available - transcription will be limited');
      }

      result.ready = ffmpegCheck.ffprobe; // At minimum, we need ffprobe

    } catch (error) {
      result.issues.push(`System check failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    return result;
  }

  // Private methods

  private async ensureSystemRequirements(): Promise<void> {
    if (this.systemChecked) return;

    const systemCheck = await this.checkSystemReadiness();
    this.ffmpegAvailable = systemCheck.ffprobe;
    this.whisperAvailable = systemCheck.whisper;

    if (!systemCheck.ready) {
      logger.warn('Video processing system not fully ready:', systemCheck.issues);
    } else {
      logger.info(`Video processing system ready (FFmpeg ${systemCheck.versions.ffmpeg}, Whisper ${systemCheck.versions.whisper || 'N/A'})`);
    }

    this.systemChecked = true;
  }

  private updateProcessingStats(result: VideoProcessingResult): void {
    result.stats.fileSize = result.validation.fileInfo.fileSize;
    
    if (result.metadata) {
      result.stats.duration = result.metadata.duration;
      result.stats.quality = result.metadata.estimatedQuality;
      result.stats.hasAudio = result.metadata.hasAudio;
    }

    if (result.audioExtraction) {
      result.stats.audioExtracted = result.audioExtraction.success;
    }

    if (result.transcription) {
      result.stats.transcribed = result.transcription.success;
      result.stats.transcriptionAccuracy = result.transcription.averageConfidence;
    }
  }

  /**
   * Create a processing summary for reporting
   */
  static createProcessingSummary(results: VideoProcessingResult[]): {
    totalFiles: number;
    successfulFiles: number;
    totalSize: number;
    totalDuration: number;
    qualityDistribution: Record<string, number>;
    formatDistribution: Record<string, number>;
    errors: string[];
  } {
    const summary = {
      totalFiles: results.length,
      successfulFiles: results.filter(r => r.success).length,
      totalSize: 0,
      totalDuration: 0,
      qualityDistribution: {} as Record<string, number>,
      formatDistribution: {} as Record<string, number>,
      errors: [] as string[]
    };

    for (const result of results) {
      summary.totalSize += result.stats.fileSize;
      
      if (result.metadata) {
        summary.totalDuration += result.metadata.duration;
        
        const quality = result.metadata.estimatedQuality;
        summary.qualityDistribution[quality] = (summary.qualityDistribution[quality] || 0) + 1;
        
        const format = result.metadata.containerFormat;
        summary.formatDistribution[format] = (summary.formatDistribution[format] || 0) + 1;
      }
      
      summary.errors.push(...result.errors);
    }

    return summary;
  }
}