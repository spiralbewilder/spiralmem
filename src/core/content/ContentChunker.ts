import { logger } from '../../utils/logger.js';
import { PerformanceMonitor } from '../platforms/PerformanceMonitor.js';

export interface ChunkingOptions {
  chunkSize?: number; // Target characters per chunk
  overlapSize?: number; // Characters to overlap between chunks
  sentenceBreak?: boolean; // Break on sentence boundaries
  preserveTimestamps?: boolean; // Keep timestamp references
  minChunkSize?: number; // Minimum chunk size
  maxChunkSize?: number; // Maximum chunk size
}

export interface ContentChunk {
  id: string;
  content: string;
  startTime?: number; // seconds
  endTime?: number; // seconds
  chunkIndex: number;
  wordCount: number;
  characterCount: number;
  embedding?: number[]; // Vector embedding
  metadata: {
    sourceId: string;
    sourceType: 'video' | 'audio' | 'text';
    language?: string;
    confidence?: number;
    hasTimestamps: boolean;
  };
}

export interface ChunkingResult {
  success: boolean;
  sourceId: string;
  chunks: ContentChunk[];
  totalChunks: number;
  totalTokens: number;
  processingTime: number; // ms
  errors: string[];
  warnings: string[];
  
  // Analytics
  averageChunkSize: number;
  overlapEfficiency: number;
  timestampCoverage: number; // percentage of chunks with timestamps
}

export interface TranscriptSegment {
  text: string;
  start: number;
  end: number;
  confidence?: number;
}

/**
 * Content chunking system for breaking down transcripts into searchable segments
 * Optimized for semantic search with proper overlap and timestamp preservation
 */
export class ContentChunker {
  private performanceMonitor: PerformanceMonitor;

  constructor() {
    this.performanceMonitor = new PerformanceMonitor();
  }

  /**
   * Chunk transcript data into searchable segments
   */
  async chunkTranscript(
    transcriptData: {
      segments: TranscriptSegment[];
      full_text: string;
      language?: string;
      duration?: number;
    },
    sourceId: string,
    options: ChunkingOptions = {}
  ): Promise<ChunkingResult> {
    const operationId = `chunkTranscript-${Date.now()}`;
    this.performanceMonitor.startOperation(operationId);
    const startTime = Date.now();

    const opts = this.getDefaultOptions(options);
    const result: ChunkingResult = {
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
    };

    try {
      logger.info(`Starting content chunking for source: ${sourceId}`);

      // Step 1: Validate input
      if (!transcriptData.segments || transcriptData.segments.length === 0) {
        result.errors.push('No transcript segments provided');
        return result;
      }

      // Step 2: Choose chunking strategy
      const chunks = opts.preserveTimestamps ? 
        await this.chunkByTimestamps(transcriptData, sourceId, opts) :
        await this.chunkByText(transcriptData.full_text, sourceId, opts);

      // Step 3: Post-process chunks
      result.chunks = await this.postProcessChunks(chunks, transcriptData, opts);
      result.totalChunks = result.chunks.length;

      // Step 4: Calculate analytics
      await this.calculateAnalytics(result);

      result.processingTime = Date.now() - startTime;
      result.success = true;

      logger.info(`Content chunking completed: ${result.totalChunks} chunks in ${result.processingTime}ms`);

      // Record performance metrics
      this.performanceMonitor.recordMetric({
        name: 'content.chunking.duration',
        value: result.processingTime,
        unit: 'ms',
        timestamp: new Date(),
        tags: {
          sourceId,
          chunkCount: result.totalChunks.toString(),
          strategy: opts.preserveTimestamps ? 'timestamp' : 'text',
          success: 'true'
        }
      });

      this.performanceMonitor.endOperation(operationId, 'content-chunking', true);

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown chunking error';
      result.errors.push(errorMsg);
      result.processingTime = Date.now() - startTime;

      logger.error(`Content chunking failed for ${sourceId}:`, error);

      this.performanceMonitor.recordMetric({
        name: 'content.chunking.error',
        value: 1,
        unit: 'count',
        timestamp: new Date(),
        tags: { error: errorMsg.substring(0, 50) }
      });

      this.performanceMonitor.endOperation(operationId, 'content-chunking', false);
    }

    return result;
  }

  /**
   * Chunk text content without timestamps
   */
  async chunkText(
    text: string,
    sourceId: string,
    options: ChunkingOptions = {}
  ): Promise<ChunkingResult> {
    return this.chunkTranscript(
      {
        segments: [],
        full_text: text
      },
      sourceId,
      { ...options, preserveTimestamps: false }
    );
  }

  // Private methods

  private getDefaultOptions(options: ChunkingOptions): Required<ChunkingOptions> {
    return {
      chunkSize: 500, // ~100-150 words
      overlapSize: 100, // 20% overlap
      sentenceBreak: true,
      preserveTimestamps: true,
      minChunkSize: 200,
      maxChunkSize: 1000,
      ...options
    };
  }

  private async chunkByTimestamps(
    transcriptData: { segments: TranscriptSegment[]; language?: string },
    sourceId: string,
    options: Required<ChunkingOptions>
  ): Promise<ContentChunk[]> {
    const chunks: ContentChunk[] = [];
    let currentChunk = '';
    let currentStartTime = 0;
    let currentEndTime = 0;
    let chunkIndex = 0;

    for (let i = 0; i < transcriptData.segments.length; i++) {
      const segment = transcriptData.segments[i];
      const segmentText = segment.text.trim();

      // Start new chunk if empty
      if (currentChunk === '') {
        currentChunk = segmentText;
        currentStartTime = segment.start;
        currentEndTime = segment.end;
        continue;
      }

      // Check if adding this segment would exceed chunk size
      const potentialChunk = currentChunk + ' ' + segmentText;
      
      if (potentialChunk.length > options.chunkSize && currentChunk.length >= options.minChunkSize) {
        // Create chunk from current content
        chunks.push(this.createChunk(
          currentChunk,
          sourceId,
          chunkIndex++,
          currentStartTime,
          currentEndTime,
          transcriptData.language
        ));

        // Start new chunk with overlap
        const overlapText = this.extractOverlap(currentChunk, options.overlapSize);
        currentChunk = overlapText + ' ' + segmentText;
        currentStartTime = segment.start;
        currentEndTime = segment.end;
      } else {
        // Add to current chunk
        currentChunk = potentialChunk;
        currentEndTime = segment.end;
      }
    }

    // Add final chunk if any content remains
    if (currentChunk.trim() && currentChunk.length >= options.minChunkSize) {
      chunks.push(this.createChunk(
        currentChunk,
        sourceId,
        chunkIndex,
        currentStartTime,
        currentEndTime,
        transcriptData.language
      ));
    }

    return chunks;
  }

  private async chunkByText(
    text: string,
    sourceId: string,
    options: Required<ChunkingOptions>
  ): Promise<ContentChunk[]> {
    const chunks: ContentChunk[] = [];
    let chunkIndex = 0;

    // Split by sentences if requested
    const segments = options.sentenceBreak ? 
      this.splitBySentences(text) : 
      [text];

    let currentChunk = '';
    
    for (const segment of segments) {
      if (currentChunk === '') {
        currentChunk = segment;
        continue;
      }

      const potentialChunk = currentChunk + ' ' + segment;
      
      if (potentialChunk.length > options.chunkSize && currentChunk.length >= options.minChunkSize) {
        // Create chunk
        chunks.push(this.createChunk(
          currentChunk,
          sourceId,
          chunkIndex++
        ));

        // Start new chunk with overlap
        const overlapText = this.extractOverlap(currentChunk, options.overlapSize);
        currentChunk = overlapText + ' ' + segment;
      } else {
        currentChunk = potentialChunk;
      }
    }

    // Add final chunk
    if (currentChunk.trim() && currentChunk.length >= options.minChunkSize) {
      chunks.push(this.createChunk(
        currentChunk,
        sourceId,
        chunkIndex
      ));
    }

    return chunks;
  }

  private createChunk(
    content: string,
    sourceId: string,
    chunkIndex: number,
    startTime?: number,
    endTime?: number,
    language?: string
  ): ContentChunk {
    return {
      id: `${sourceId}-chunk-${chunkIndex}`,
      content: content.trim(),
      startTime,
      endTime,
      chunkIndex,
      wordCount: content.split(/\s+/).length,
      characterCount: content.length,
      metadata: {
        sourceId,
        sourceType: 'video',
        language,
        hasTimestamps: startTime !== undefined && endTime !== undefined
      }
    };
  }

  private extractOverlap(text: string, overlapSize: number): string {
    if (text.length <= overlapSize) {
      return text;
    }

    // Try to break at word boundary
    const substring = text.slice(-overlapSize);
    const firstSpaceIndex = substring.indexOf(' ');
    
    return firstSpaceIndex !== -1 ? 
      substring.slice(firstSpaceIndex + 1) : 
      substring;
  }

  private splitBySentences(text: string): string[] {
    // Simple sentence splitting - can be enhanced with NLP library
    return text
      .split(/[.!?]+/)
      .map(s => s.trim())
      .filter(s => s.length > 0);
  }

  private async postProcessChunks(
    chunks: ContentChunk[],
    transcriptData: any,
    options: Required<ChunkingOptions>
  ): Promise<ContentChunk[]> {
    // Filter out chunks that are too small or too large
    const filteredChunks = chunks.filter(chunk => 
      chunk.characterCount >= options.minChunkSize && 
      chunk.characterCount <= options.maxChunkSize
    );

    // Clean up content
    return filteredChunks.map(chunk => ({
      ...chunk,
      content: this.cleanContent(chunk.content)
    }));
  }

  private cleanContent(content: string): string {
    return content
      .replace(/\s+/g, ' ') // Normalize whitespace
      .replace(/^\s+|\s+$/g, '') // Trim
      .replace(/[^\w\s.,!?;:()\-"']/g, ''); // Remove unusual characters
  }

  private async calculateAnalytics(result: ChunkingResult): Promise<void> {
    if (result.chunks.length === 0) return;

    // Average chunk size
    result.averageChunkSize = result.chunks.reduce((sum, chunk) => 
      sum + chunk.characterCount, 0) / result.chunks.length;

    // Timestamp coverage
    const chunksWithTimestamps = result.chunks.filter(chunk => 
      chunk.metadata.hasTimestamps).length;
    result.timestampCoverage = (chunksWithTimestamps / result.chunks.length) * 100;

    // Total tokens (rough estimate: 1 token ≈ 4 characters)
    result.totalTokens = Math.ceil(
      result.chunks.reduce((sum, chunk) => sum + chunk.characterCount, 0) / 4
    );

    // Overlap efficiency (placeholder - can be enhanced)
    result.overlapEfficiency = 85; // Assuming good overlap strategy
  }
}