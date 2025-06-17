import path from 'path';
import { logger } from '../../utils/logger.js';
import { PerformanceMonitor } from '../platforms/PerformanceMonitor.js';

// Video processing components
import { VideoValidator } from '../video/VideoValidator.js';
import { MetadataExtractor } from '../video/MetadataExtractor.js';
import { AudioExtractor } from '../video/AudioExtractor.js';
import { TranscriptionEngine } from '../video/TranscriptionEngine.js';
import { FrameSampler } from '../video/FrameSampler.js';
import { ContentProcessor } from '../content/ContentProcessor.js';

// Database components
import { database } from '../database/connection.js';
import { 
  MemoryRepository, 
  VideoProcessingRepository,
  ChunkRepository 
} from '../database/repositories/index.js';

// Types
import type { 
  VideoProcessingJob, 
  ProcessedVideoContent 
} from '../database/repositories/VideoProcessingRepository.js';
import type { Memory } from '../models/types.js';

export interface VideoWorkflowOptions {
  enableFrameSampling?: boolean;
  enableTranscription?: boolean;
  enableEmbeddings?: boolean;
  chunkingOptions?: {
    chunkSize?: number;
    overlapSize?: number;
    preserveTimestamps?: boolean;
  };
  outputDirectory?: string;
  skipValidation?: boolean;
}

export interface VideoWorkflowResult {
  success: boolean;
  jobId: string;
  memoryId?: string;
  processingTime: number;
  steps: {
    validation: boolean;
    metadata: boolean;
    audioExtraction: boolean;
    transcription: boolean;
    frameSampling: boolean;
    contentProcessing: boolean;
    databaseStorage: boolean;
  };
  outputs: {
    videoPath?: string;
    audioPath?: string;
    transcriptPath?: string;
    chunksGenerated?: number;
    embeddingsGenerated?: number;
    framesExtracted?: number;
  };
  errors: string[];
  warnings: string[];
}

/**
 * Complete video processing workflow
 * Orchestrates the entire pipeline from video input to searchable database content
 */
export class VideoWorkflow {
  private performanceMonitor: PerformanceMonitor;
  private memoryRepo: MemoryRepository;
  private videoProcessingRepo: VideoProcessingRepository;
  private chunkRepo: ChunkRepository;

  // Component instances
  private validator: VideoValidator;
  private metadataExtractor: MetadataExtractor;
  private audioExtractor: AudioExtractor;
  private transcriptionEngine: TranscriptionEngine;
  private frameSampler: FrameSampler;
  private contentProcessor: ContentProcessor;

  constructor() {
    this.performanceMonitor = new PerformanceMonitor();
    
    // Initialize repositories
    this.memoryRepo = new MemoryRepository();
    this.videoProcessingRepo = new VideoProcessingRepository();
    this.chunkRepo = new ChunkRepository();

    // Initialize components
    this.validator = new VideoValidator();
    this.metadataExtractor = new MetadataExtractor();
    this.audioExtractor = new AudioExtractor();
    this.transcriptionEngine = new TranscriptionEngine();
    this.frameSampler = new FrameSampler();
    this.contentProcessor = new ContentProcessor();
  }

  /**
   * Process a video file through the complete pipeline
   */
  async processVideo(
    videoPath: string,
    spaceId: string = 'default',
    options: VideoWorkflowOptions = {}
  ): Promise<VideoWorkflowResult> {
    const operationId = `processVideo-${Date.now()}`;
    this.performanceMonitor.startOperation(operationId);
    const startTime = Date.now();

    const opts = this.getDefaultOptions(options);
    const result: VideoWorkflowResult = {
      success: false,
      jobId: '',
      processingTime: 0,
      steps: {
        validation: false,
        metadata: false,
        audioExtraction: false,
        transcription: false,
        frameSampling: false,
        contentProcessing: false,
        databaseStorage: false
      },
      outputs: {},
      errors: [],
      warnings: []
    };

    try {
      // Initialize database
      await database.initialize();

      logger.info(`Starting video workflow: ${path.basename(videoPath)}`);

      // Step 1: Create processing job
      const job = await this.createProcessingJob(videoPath, opts);
      result.jobId = job.id;

      // Step 2: Validate video
      if (!opts.skipValidation) {
        await this.updateJobStep(job.id, 'validation', 'running');
        const validationResult = await VideoValidator.validateVideoFile(videoPath);
        
        if (!validationResult.isValid) {
          result.errors.push(...validationResult.errors);
          await this.updateJobStep(job.id, 'validation', 'failed', null, validationResult.errors.join('; '));
          await this.videoProcessingRepo.updateJobStatus(job.id, 'failed', 10);
          return result;
        }
        
        result.steps.validation = true;
        await this.updateJobStep(job.id, 'validation', 'completed');
        await this.videoProcessingRepo.updateJobStatus(job.id, 'processing', 10);
      }

      // Step 3: Extract metadata
      await this.updateJobStep(job.id, 'metadata', 'running');
      let metadata: any;
      try {
        metadata = await MetadataExtractor.extractMetadata(videoPath);
        result.steps.metadata = true;
        result.outputs.videoPath = videoPath;
        await this.updateJobStep(job.id, 'metadata', 'completed', metadata);
        await this.videoProcessingRepo.updateJobStatus(job.id, 'processing', 20);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Metadata extraction failed';
        result.errors.push(errorMsg);
        await this.updateJobStep(job.id, 'metadata', 'failed', null, errorMsg);
        await this.videoProcessingRepo.updateJobStatus(job.id, 'failed', 20);
        return result;
      }

      // Step 4: Extract audio
      await this.updateJobStep(job.id, 'audio-extraction', 'running');
      const audioResult = await this.audioExtractor.extractAudio(videoPath, {
        outputDirectory: `${opts.outputDirectory}/audio`,
        ...AudioExtractor.getOptimalTranscriptionSettings()
      });

      if (!audioResult.success) {
        result.errors.push(...audioResult.errors);
        await this.updateJobStep(job.id, 'audio-extraction', 'failed', null, audioResult.errors.join('; '));
        await this.videoProcessingRepo.updateJobStatus(job.id, 'failed', 30);
        return result;
      }

      result.steps.audioExtraction = true;
      result.outputs.audioPath = audioResult.outputFile;
      await this.updateJobStep(job.id, 'audio-extraction', 'completed');
      await this.videoProcessingRepo.updateJobPaths(job.id, { 
        videoPath, 
        audioPath: audioResult.outputFile 
      });
      await this.videoProcessingRepo.updateJobStatus(job.id, 'processing', 40);

      // Step 5: Transcription (if enabled)
      let transcriptData: any = null;
      if (opts.enableTranscription && audioResult.outputFile) {
        await this.updateJobStep(job.id, 'transcription', 'running');
        const transcriptionResult = await this.transcriptionEngine.transcribeAudio(
          audioResult.outputFile,
          { outputDirectory: `${opts.outputDirectory}/transcripts` }
        );

        if (!transcriptionResult.success) {
          result.warnings.push(...transcriptionResult.errors);
          await this.updateJobStep(job.id, 'transcription', 'failed', null, transcriptionResult.errors.join('; '));
        } else {
          result.steps.transcription = true;
          result.outputs.transcriptPath = transcriptionResult.outputFilePath;
          transcriptData = {
            segments: transcriptionResult.segments,
            full_text: transcriptionResult.text,
            language: transcriptionResult.language,
            duration: transcriptionResult.duration
          };
          await this.updateJobStep(job.id, 'transcription', 'completed');
          await this.videoProcessingRepo.updateJobPaths(job.id, { 
            transcriptPath: transcriptionResult.outputFilePath 
          });
        }
        
        await this.videoProcessingRepo.updateJobStatus(job.id, 'processing', 60);
      }

      // Step 6: Frame sampling (if enabled)
      if (opts.enableFrameSampling) {
        await this.updateJobStep(job.id, 'frame-sampling', 'running');
        const frameResult = await this.frameSampler.extractFrames(videoPath, {
          outputDirectory: `${opts.outputDirectory}/frames`,
          frameCount: 10,
          method: 'uniform'
        });

        if (!frameResult.success) {
          result.warnings.push(...frameResult.errors);
          await this.updateJobStep(job.id, 'frame-sampling', 'failed', null, frameResult.errors.join('; '));
        } else {
          result.steps.frameSampling = true;
          result.outputs.framesExtracted = frameResult.totalFramesExtracted;
          await this.updateJobStep(job.id, 'frame-sampling', 'completed');
        }
      }

      await this.videoProcessingRepo.updateJobStatus(job.id, 'processing', 70);

      // Step 7: Content processing (chunking and embeddings)
      let processedContent: any = null;
      if (transcriptData) {
        await this.updateJobStep(job.id, 'content-processing', 'running');
        const contentResult = await this.contentProcessor.processTranscript(
          transcriptData,
          job.id,
          {
            enableEmbeddings: opts.enableEmbeddings,
            chunking: opts.chunkingOptions,
            storeResults: false // We'll store in database instead
          }
        );

        if (!contentResult.success) {
          result.warnings.push(...contentResult.errors);
          await this.updateJobStep(job.id, 'content-processing', 'failed', null, contentResult.errors.join('; '));
        } else {
          result.steps.contentProcessing = true;
          result.outputs.chunksGenerated = contentResult.chunkingResult.totalChunks;
          result.outputs.embeddingsGenerated = contentResult.embeddingResult?.embeddings.length || 0;
          processedContent = contentResult.processedContent;
          await this.updateJobStep(job.id, 'content-processing', 'completed');
        }
      }

      await this.videoProcessingRepo.updateJobStatus(job.id, 'processing', 80);

      // Step 8: Store in database
      await this.updateJobStep(job.id, 'database-storage', 'running');
      const memoryId = await this.storeInDatabase(
        job.id,
        videoPath,
        spaceId,
        metadata,
        transcriptData,
        processedContent
      );

      if (memoryId) {
        result.steps.databaseStorage = true;
        result.memoryId = memoryId;
        await this.updateJobStep(job.id, 'database-storage', 'completed');
        await this.videoProcessingRepo.updateJobStatus(job.id, 'completed', 100);
      } else {
        result.errors.push('Failed to store content in database');
        await this.updateJobStep(job.id, 'database-storage', 'failed', null, 'Database storage failed');
        await this.videoProcessingRepo.updateJobStatus(job.id, 'failed', 90);
        return result;
      }

      // Success!
      result.processingTime = Date.now() - startTime;
      result.success = true;

      logger.info(`Video workflow completed successfully: ${result.jobId} in ${result.processingTime}ms`);

      this.performanceMonitor.recordMetric({
        name: 'video.workflow.duration',
        value: result.processingTime,
        unit: 'ms',
        timestamp: new Date(),
        tags: {
          jobId: result.jobId,
          success: 'true',
          chunksGenerated: (result.outputs.chunksGenerated || 0).toString()
        }
      });

      this.performanceMonitor.endOperation(operationId, 'video-workflow', true);

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown workflow error';
      result.errors.push(errorMsg);
      result.processingTime = Date.now() - startTime;

      logger.error(`Video workflow failed for ${videoPath}:`, error);

      // Update job status
      if (result.jobId) {
        await this.videoProcessingRepo.updateJobStatus(result.jobId, 'failed', undefined, errorMsg);
      }

      this.performanceMonitor.recordMetric({
        name: 'video.workflow.error',
        value: 1,
        unit: 'count',
        timestamp: new Date(),
        tags: { error: errorMsg.substring(0, 50) }
      });

      this.performanceMonitor.endOperation(operationId, 'video-workflow', false);
    }

    return result;
  }

  /**
   * Get processing job by ID
   */
  async getProcessingJob(jobId: string): Promise<VideoProcessingJob | null> {
    return this.videoProcessingRepo.findJobById(jobId);
  }

  /**
   * Get processing statistics
   */
  async getProcessingStats() {
    return {
      jobStats: await this.videoProcessingRepo.getJobStats(),
      processingMetrics: await this.videoProcessingRepo.getProcessingMetrics()
    };
  }

  // Private methods

  private getDefaultOptions(options: VideoWorkflowOptions): Required<VideoWorkflowOptions> {
    return {
      enableFrameSampling: false,
      enableTranscription: true,
      enableEmbeddings: false, // Disabled by default due to dependencies
      chunkingOptions: {
        chunkSize: 400,
        overlapSize: 80,
        preserveTimestamps: true
      },
      outputDirectory: './temp/workflow-output',
      skipValidation: false,
      ...options
    };
  }

  private async createProcessingJob(
    videoPath: string,
    options: Required<VideoWorkflowOptions>
  ): Promise<VideoProcessingJob> {
    const sourceId = path.basename(videoPath, path.extname(videoPath));
    
    return this.videoProcessingRepo.createJob({
      id: `job-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      sourceId,
      sourceType: 'local',
      status: 'pending',
      progress: 0,
      processingSteps: [],
      metadata: {
        originalUrl: videoPath
      }
    });
  }

  private async updateJobStep(
    jobId: string,
    stepName: string,
    status: 'pending' | 'running' | 'completed' | 'failed',
    metadata?: any,
    error?: string
  ): Promise<void> {
    await this.videoProcessingRepo.updateJobStep(jobId, stepName, status, metadata, error);
  }

  private async storeInDatabase(
    jobId: string,
    videoPath: string,
    spaceId: string,
    metadata: any,
    transcriptData: any,
    processedContent: any
  ): Promise<string | null> {
    try {
      // Create memory record
      const memory: Omit<Memory, 'createdAt' | 'updatedAt'> = {
        id: `memory-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        spaceId,
        contentType: 'video',
        title: path.basename(videoPath),
        content: transcriptData?.full_text || 'Video content',
        source: videoPath,
        filePath: videoPath,
        metadata: {
          duration: metadata?.duration || 0,
          format: metadata?.format || 'unknown',
          resolution: metadata?.resolution || { width: 0, height: 0 },
          processingJobId: jobId
        }
      };

      const createdMemory = await this.memoryRepo.create(memory);

      // Store processed content if available
      if (processedContent && transcriptData) {
        const videoContent: Omit<ProcessedVideoContent, 'createdAt'> = {
          id: `content-${jobId}`,
          jobId,
          memoryId: createdMemory.id,
          chunks: processedContent.chunks.map((chunk: any) => ({
            id: chunk.id,
            chunkIndex: chunk.chunkIndex,
            content: chunk.content,
            startTime: chunk.startTime,
            endTime: chunk.endTime,
            wordCount: chunk.wordCount,
            characterCount: chunk.characterCount,
            embedding: chunk.embedding
          })),
          embeddings: processedContent.embeddings,
          transcript: {
            language: transcriptData.language || 'en',
            duration: transcriptData.duration || 0,
            segmentCount: transcriptData.segments?.length || 0,
            fullText: transcriptData.full_text || '',
            segments: transcriptData.segments || []
          },
          metadata: processedContent.metadata
        };

        await this.videoProcessingRepo.storeProcessedContent(videoContent);

        // Store individual chunks in chunks table
        if (processedContent.chunks) {
          for (const chunk of processedContent.chunks) {
            await this.chunkRepo.create({
              id: chunk.id,
              memoryId: createdMemory.id,
              chunkText: chunk.content,
              chunkOrder: chunk.chunkIndex,
              startOffset: chunk.startTime ? Math.floor(chunk.startTime * 1000) : undefined,
              endOffset: chunk.endTime ? Math.floor(chunk.endTime * 1000) : undefined,
              metadata: {
                wordCount: chunk.wordCount,
                characterCount: chunk.characterCount,
                hasTimestamps: chunk.startTime !== undefined,
                processingJobId: jobId
              }
            });
          }
        }
      }

      return createdMemory.id;

    } catch (error) {
      logger.error('Failed to store video content in database:', error);
      return null;
    }
  }
}