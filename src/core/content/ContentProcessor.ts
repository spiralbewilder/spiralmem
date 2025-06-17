import { logger } from '../../utils/logger.js';
import { PerformanceMonitor } from '../platforms/PerformanceMonitor.js';
import { ContentChunker, ContentChunk, ChunkingOptions, ChunkingResult } from './ContentChunker.js';
import { EmbeddingGenerator, EmbeddingOptions, EmbeddingResult, ChunkEmbedding } from './EmbeddingGenerator.js';

export interface ContentProcessingOptions {
  chunking?: ChunkingOptions;
  embedding?: EmbeddingOptions;
  enableEmbeddings?: boolean;
  storeResults?: boolean;
  outputDirectory?: string;
}

export interface ProcessedContent {
  sourceId: string;
  sourceType: 'video' | 'audio' | 'text';
  chunks: ContentChunk[];
  embeddings?: ChunkEmbedding[];
  metadata: {
    originalLength: number;
    processingTime: number;
    chunkCount: number;
    embeddingCount: number;
    language?: string;
    hasTimestamps: boolean;
  };
}

export interface ContentProcessingResult {
  success: boolean;
  sourceId: string;
  processedContent?: ProcessedContent;
  chunkingResult: ChunkingResult;
  embeddingResult?: EmbeddingResult;
  totalProcessingTime: number;
  errors: string[];
  warnings: string[];
  
  // Performance metrics
  chunksPerSecond: number;
  embeddingsPerSecond: number;
  totalTokensProcessed: number;
}

/**
 * Complete content processing pipeline
 * Handles chunking, embedding generation, and storage of processed content
 */
export class ContentProcessor {
  private chunker: ContentChunker;
  private embeddingGenerator: EmbeddingGenerator;
  private performanceMonitor: PerformanceMonitor;

  constructor() {
    this.chunker = new ContentChunker();
    this.embeddingGenerator = new EmbeddingGenerator();
    this.performanceMonitor = new PerformanceMonitor();
  }

  /**
   * Process transcript data into searchable chunks with embeddings
   */
  async processTranscript(
    transcriptData: {
      segments: any[];
      full_text: string;
      language?: string;
      duration?: number;
    },
    sourceId: string,
    options: ContentProcessingOptions = {}
  ): Promise<ContentProcessingResult> {
    const operationId = `processTranscript-${Date.now()}`;
    this.performanceMonitor.startOperation(operationId);
    const startTime = Date.now();

    const opts = this.getDefaultOptions(options);
    const result: ContentProcessingResult = {
      success: false,
      sourceId,
      chunkingResult: {
        success: false,
        sourceId,
        chunks: [],
        totalChunks: 0,
        totalTokens: 0,
        processingTime: 0,
        errors: [],
        warnings: [],
        averageChunkSize: 0,
        overlapEfficiency: 0,
        timestampCoverage: 0
      },
      totalProcessingTime: 0,
      errors: [],
      warnings: [],
      chunksPerSecond: 0,
      embeddingsPerSecond: 0,
      totalTokensProcessed: 0
    };

    try {
      logger.info(`Starting content processing for source: ${sourceId}`);

      // Step 1: Chunk the transcript
      logger.info('Step 1: Chunking transcript content');
      result.chunkingResult = await this.chunker.chunkTranscript(
        transcriptData,
        sourceId,
        opts.chunking
      );

      if (!result.chunkingResult.success) {
        result.errors.push('Chunking failed');
        result.errors.push(...result.chunkingResult.errors);
        return result;
      }

      logger.info(`Chunking completed: ${result.chunkingResult.totalChunks} chunks created`);

      // Step 2: Generate embeddings if enabled
      if (opts.enableEmbeddings && result.chunkingResult.chunks.length > 0) {
        logger.info('Step 2: Generating embeddings for chunks');
        
        result.embeddingResult = await this.embeddingGenerator.generateEmbeddings(
          result.chunkingResult.chunks,
          opts.embedding
        );

        if (!result.embeddingResult.success) {
          result.warnings.push('Embedding generation failed');
          result.warnings.push(...result.embeddingResult.errors);
        } else {
          logger.info(`Embedding generation completed: ${result.embeddingResult.embeddings.length} embeddings created`);
        }
      }

      // Step 3: Create processed content object
      result.processedContent = await this.createProcessedContent(
        sourceId,
        transcriptData,
        result.chunkingResult,
        result.embeddingResult
      );

      // Step 4: Store results if requested
      if (opts.storeResults) {
        await this.storeProcessedContent(result.processedContent, opts.outputDirectory);
      }

      // Step 5: Calculate final metrics
      result.totalProcessingTime = Date.now() - startTime;
      this.calculateFinalMetrics(result);

      result.success = true;

      logger.info(`Content processing completed in ${result.totalProcessingTime}ms`);

      // Record performance metrics
      this.performanceMonitor.recordMetric({
        name: 'content.processing.duration',
        value: result.totalProcessingTime,
        unit: 'ms',
        timestamp: new Date(),
        tags: {
          sourceId,
          chunkCount: result.chunkingResult.totalChunks.toString(),
          embeddingCount: (result.embeddingResult?.embeddings.length || 0).toString(),
          success: 'true'
        }
      });

      this.performanceMonitor.endOperation(operationId, 'content-processing', true);

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown processing error';
      result.errors.push(errorMsg);
      result.totalProcessingTime = Date.now() - startTime;

      logger.error(`Content processing failed for ${sourceId}:`, error);

      this.performanceMonitor.recordMetric({
        name: 'content.processing.error',
        value: 1,
        unit: 'count',
        timestamp: new Date(),
        tags: { error: errorMsg.substring(0, 50) }
      });

      this.performanceMonitor.endOperation(operationId, 'content-processing', false);
    }

    return result;
  }

  /**
   * Process plain text content
   */
  async processText(
    text: string,
    sourceId: string,
    options: ContentProcessingOptions = {}
  ): Promise<ContentProcessingResult> {
    return this.processTranscript(
      {
        segments: [],
        full_text: text
      },
      sourceId,
      { ...options, chunking: { ...options.chunking, preserveTimestamps: false } }
    );
  }

  /**
   * Get processing statistics for a completed result
   */
  getProcessingStats(result: ContentProcessingResult): {
    chunkStats: {
      totalChunks: number;
      averageChunkSize: number;
      timestampCoverage: number;
    };
    embeddingStats?: {
      totalEmbeddings: number;
      dimensions: number;
      processingSpeed: number;
    };
    performance: {
      totalTime: number;
      chunkingTime: number;
      embeddingTime: number;
      chunksPerSecond: number;
    };
  } {
    const stats = {
      chunkStats: {
        totalChunks: result.chunkingResult.totalChunks,
        averageChunkSize: result.chunkingResult.averageChunkSize,
        timestampCoverage: result.chunkingResult.timestampCoverage
      },
      performance: {
        totalTime: result.totalProcessingTime,
        chunkingTime: result.chunkingResult.processingTime,
        embeddingTime: result.embeddingResult?.processingTime || 0,
        chunksPerSecond: result.chunksPerSecond
      }
    } as any;

    if (result.embeddingResult) {
      stats.embeddingStats = {
        totalEmbeddings: result.embeddingResult.embeddings.length,
        dimensions: result.embeddingResult.embeddings[0]?.dimensions || 0,
        processingSpeed: result.embeddingResult.embeddingsPerSecond
      };
    }

    return stats;
  }

  // Private methods

  private getDefaultOptions(options: ContentProcessingOptions): Required<ContentProcessingOptions> {
    return {
      chunking: {},
      embedding: {},
      enableEmbeddings: true,
      storeResults: false,
      outputDirectory: './temp/processed-content',
      ...options
    };
  }

  private async createProcessedContent(
    sourceId: string,
    transcriptData: any,
    chunkingResult: ChunkingResult,
    embeddingResult?: EmbeddingResult
  ): Promise<ProcessedContent> {
    // Merge chunks with their embeddings
    const chunksWithEmbeddings: ContentChunk[] = chunkingResult.chunks.map(chunk => {
      const embedding = embeddingResult?.embeddings.find(emb => emb.chunkId === chunk.id);
      return {
        ...chunk,
        embedding: embedding?.embedding
      };
    });

    return {
      sourceId,
      sourceType: 'video',
      chunks: chunksWithEmbeddings,
      embeddings: embeddingResult?.embeddings,
      metadata: {
        originalLength: transcriptData.full_text?.length || 0,
        processingTime: chunkingResult.processingTime + (embeddingResult?.processingTime || 0),
        chunkCount: chunkingResult.totalChunks,
        embeddingCount: embeddingResult?.embeddings.length || 0,
        language: transcriptData.language,
        hasTimestamps: chunkingResult.chunks.some(chunk => chunk.metadata.hasTimestamps)
      }
    };
  }

  private async storeProcessedContent(
    processedContent: ProcessedContent,
    outputDirectory: string = './temp/processed-content'
  ): Promise<void> {
    try {
      // Ensure output directory exists
      await import('fs').then(fs => fs.promises.mkdir(outputDirectory, { recursive: true }));

      // Save processed content as JSON
      const contentPath = `${outputDirectory}/${processedContent.sourceId}-processed.json`;
      await import('fs').then(fs => 
        fs.promises.writeFile(contentPath, JSON.stringify(processedContent, null, 2))
      );

      // Save chunks separately for easier access
      const chunksPath = `${outputDirectory}/${processedContent.sourceId}-chunks.json`;
      await import('fs').then(fs => 
        fs.promises.writeFile(chunksPath, JSON.stringify(processedContent.chunks, null, 2))
      );

      // Save embeddings separately if they exist
      if (processedContent.embeddings) {
        const embeddingsPath = `${outputDirectory}/${processedContent.sourceId}-embeddings.json`;
        await import('fs').then(fs => 
          fs.promises.writeFile(embeddingsPath, JSON.stringify(processedContent.embeddings, null, 2))
        );
      }

      logger.info(`Processed content stored to: ${outputDirectory}`);
    } catch (error) {
      logger.error('Failed to store processed content:', error);
      throw error;
    }
  }

  private calculateFinalMetrics(result: ContentProcessingResult): void {
    // Chunks per second
    if (result.chunkingResult.processingTime > 0) {
      result.chunksPerSecond = (result.chunkingResult.totalChunks / result.chunkingResult.processingTime) * 1000;
    }

    // Embeddings per second
    if (result.embeddingResult && result.embeddingResult.processingTime > 0) {
      result.embeddingsPerSecond = (result.embeddingResult.embeddings.length / result.embeddingResult.processingTime) * 1000;
    }

    // Total tokens processed
    result.totalTokensProcessed = result.chunkingResult.totalTokens + (result.embeddingResult?.totalTokensProcessed || 0);
  }
}