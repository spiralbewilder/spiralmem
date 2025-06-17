import { logger } from '../../utils/logger.js';
import { PerformanceMonitor } from '../platforms/PerformanceMonitor.js';
import { EmbeddingGenerator } from '../content/EmbeddingGenerator.js';
import { database } from '../database/connection.js';

export interface VectorSearchOptions {
  model?: 'openai' | 'sentence-transformers' | 'all-MiniLM-L6-v2';
  similarityThreshold?: number; // 0.0 to 1.0
  maxResults?: number;
  includeMetadata?: boolean;
  hybridSearch?: boolean; // Combine with keyword search
  weightVector?: number; // 0.0 to 1.0, weight for vector vs keyword
}

export interface VectorSearchResult {
  id: string;
  contentId: string;
  contentType: 'chunk' | 'memory' | 'frame';
  content: string;
  similarity: number;
  embedding?: number[];
  metadata?: {
    sourceId?: string;
    sourceType?: string;
    timestamp?: number;
    chunkIndex?: number;
    memoryId?: string;
  };
}

export interface SearchPerformanceMetrics {
  searchTime: number; // ms
  embeddingTime: number; // ms
  similarityTime: number; // ms
  totalResults: number;
  filteredResults: number;
  queryVector?: number[];
}

export interface VectorIndex {
  id: string;
  contentId: string;
  contentType: string;
  embedding: number[];
  dimensions: number;
  model: string;
  createdAt: Date;
}

/**
 * Vector search engine for semantic similarity search
 * Handles embedding generation, storage, and similarity computation
 */
export class VectorSearchEngine {
  private embeddingGenerator: EmbeddingGenerator;
  private performanceMonitor: PerformanceMonitor;

  constructor() {
    this.embeddingGenerator = new EmbeddingGenerator();
    this.performanceMonitor = new PerformanceMonitor();
  }

  /**
   * Perform semantic search using vector similarity
   */
  async search(
    query: string,
    options: VectorSearchOptions = {}
  ): Promise<{
    results: VectorSearchResult[];
    metrics: SearchPerformanceMetrics;
  }> {
    const operationId = `vectorSearch-${Date.now()}`;
    this.performanceMonitor.startOperation(operationId);
    const searchStartTime = Date.now();

    const opts = this.getDefaultOptions(options);
    const metrics: SearchPerformanceMetrics = {
      searchTime: 0,
      embeddingTime: 0,
      similarityTime: 0,
      totalResults: 0,
      filteredResults: 0
    };

    try {
      logger.info(`Starting vector search: "${query}" with model ${opts.model}`);

      // Step 1: Generate embedding for query
      const embeddingStartTime = Date.now();
      const queryEmbedding = await this.embeddingGenerator.generateSingleEmbedding(query, {
        model: opts.model
      });

      if (!queryEmbedding) {
        throw new Error('Failed to generate query embedding');
      }

      metrics.embeddingTime = Date.now() - embeddingStartTime;
      metrics.queryVector = queryEmbedding;

      // Step 2: Retrieve stored embeddings from database
      const similarityStartTime = Date.now();
      const storedEmbeddings = await this.getStoredEmbeddings(opts);

      // Step 3: Calculate similarities
      const similarities = this.calculateSimilarities(queryEmbedding, storedEmbeddings);
      metrics.totalResults = similarities.length;

      // Step 4: Filter and sort results
      const filteredResults = similarities
        .filter(result => result.similarity >= opts.similarityThreshold)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, opts.maxResults);

      metrics.filteredResults = filteredResults.length;
      metrics.similarityTime = Date.now() - similarityStartTime;

      // Step 5: Enrich results with content and metadata
      const enrichedResults = await this.enrichResults(filteredResults, opts);

      metrics.searchTime = Date.now() - searchStartTime;

      logger.info(`Vector search completed: ${metrics.filteredResults}/${metrics.totalResults} results in ${metrics.searchTime}ms`);

      // Record performance metrics
      this.performanceMonitor.recordMetric({
        name: 'vector.search.duration',
        value: metrics.searchTime,
        unit: 'ms',
        timestamp: new Date(),
        tags: {
          model: opts.model,
          resultsFound: metrics.filteredResults.toString(),
          totalEmbeddings: metrics.totalResults.toString()
        }
      });

      this.performanceMonitor.endOperation(operationId, 'vector-search', true);

      return {
        results: enrichedResults,
        metrics
      };

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown vector search error';
      logger.error('Vector search failed:', error);

      metrics.searchTime = Date.now() - searchStartTime;

      this.performanceMonitor.recordMetric({
        name: 'vector.search.error',
        value: 1,
        unit: 'count',
        timestamp: new Date(),
        tags: { error: errorMsg.substring(0, 50) }
      });

      this.performanceMonitor.endOperation(operationId, 'vector-search', false);

      return {
        results: [],
        metrics
      };
    }
  }

  /**
   * Store embedding in vector index
   */
  async storeEmbedding(
    contentId: string,
    contentType: 'chunk' | 'memory' | 'frame',
    embedding: number[],
    model: string
  ): Promise<boolean> {
    try {
      const db = database.getDb();
      
      await db.run(`
        INSERT OR REPLACE INTO vector_embeddings (
          id, content_id, content_type, embedding_model, 
          embedding_dimensions, embedding_vector, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `, 
        `${contentId}-${contentType}-${model}`,
        contentId,
        contentType,
        model,
        embedding.length,
        JSON.stringify(embedding),
        new Date().toISOString()
      );

      logger.info(`Stored embedding for ${contentType}:${contentId} (${embedding.length}D, ${model})`);
      return true;

    } catch (error) {
      logger.error(`Failed to store embedding for ${contentId}:`, error);
      return false;
    }
  }

  /**
   * Index content by generating and storing embeddings
   */
  async indexContent(
    content: string,
    contentId: string,
    contentType: 'chunk' | 'memory' | 'frame',
    options: { model?: string } = {}
  ): Promise<boolean> {
    try {
      const model = options.model || 'all-MiniLM-L6-v2';
      
      // Generate embedding
      const embedding = await this.embeddingGenerator.generateSingleEmbedding(content, { model: model as 'all-MiniLM-L6-v2' | 'openai' | 'sentence-transformers' });
      
      if (!embedding) {
        logger.warn(`Failed to generate embedding for ${contentType}:${contentId}`);
        return false;
      }

      // Store in vector index
      return await this.storeEmbedding(contentId, contentType, embedding, model);

    } catch (error) {
      logger.error(`Failed to index content ${contentId}:`, error);
      return false;
    }
  }

  /**
   * Batch index multiple content items
   */
  async indexContentBatch(
    items: Array<{
      content: string;
      contentId: string;
      contentType: 'chunk' | 'memory' | 'frame';
    }>,
    options: { model?: string; batchSize?: number } = {}
  ): Promise<{ successful: number; failed: number }> {
    const model = options.model || 'all-MiniLM-L6-v2';
    const batchSize = options.batchSize || 32;
    
    let successful = 0;
    let failed = 0;

    logger.info(`Starting batch indexing: ${items.length} items with model ${model}`);

    // Process in batches
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      
      try {
        // Generate embeddings for batch
        const contents = batch.map(item => item.content);
        const embeddingResult = await this.embeddingGenerator.generateEmbeddings(
          contents.map((content, idx) => ({
            id: batch[idx].contentId,
            content,
            chunkIndex: idx,
            wordCount: content.split(' ').length,
            characterCount: content.length,
            metadata: {
              sourceId: batch[idx].contentId,
              sourceType: batch[idx].contentType === 'chunk' ? 'text' as const : 
                         batch[idx].contentType === 'memory' ? 'text' as const : 'video' as const,
              hasTimestamps: false
            }
          })),
          { model: model as 'all-MiniLM-L6-v2' | 'openai' | 'sentence-transformers', batchSize }
        );

        if (embeddingResult.success) {
          // Store each embedding
          for (let j = 0; j < batch.length; j++) {
            const item = batch[j];
            const embedding = embeddingResult.embeddings[j];
            
            if (embedding) {
              const stored = await this.storeEmbedding(
                item.contentId,
                item.contentType,
                embedding.embedding,
                model
              );
              
              if (stored) {
                successful++;
              } else {
                failed++;
              }
            } else {
              failed++;
            }
          }
        } else {
          failed += batch.length;
          logger.warn(`Batch embedding generation failed for batch starting at index ${i}`);
        }

      } catch (error) {
        failed += batch.length;
        logger.error(`Batch indexing failed for batch starting at index ${i}:`, error);
      }
    }

    logger.info(`Batch indexing completed: ${successful} successful, ${failed} failed`);
    return { successful, failed };
  }

  /**
   * Get vector index statistics
   */
  async getIndexStats(): Promise<{
    totalEmbeddings: number;
    embeddingsByType: Record<string, number>;
    embeddingsByModel: Record<string, number>;
    averageDimensions: number;
  }> {
    try {
      const db = database.getDb();
      
      // Total embeddings
      const totalResult = await db.get('SELECT COUNT(*) as count FROM vector_embeddings') as { count: number };
      
      // By content type
      const typeResults = await db.all(`
        SELECT content_type, COUNT(*) as count 
        FROM vector_embeddings 
        GROUP BY content_type
      `) as Array<{ content_type: string; count: number }>;
      
      // By model
      const modelResults = await db.all(`
        SELECT embedding_model, COUNT(*) as count 
        FROM vector_embeddings 
        GROUP BY embedding_model
      `) as Array<{ embedding_model: string; count: number }>;
      
      // Average dimensions
      const dimensionsResult = await db.get(`
        SELECT AVG(embedding_dimensions) as avg_dimensions 
        FROM vector_embeddings
      `) as { avg_dimensions: number };

      return {
        totalEmbeddings: totalResult.count,
        embeddingsByType: Object.fromEntries(typeResults.map(r => [r.content_type, r.count])),
        embeddingsByModel: Object.fromEntries(modelResults.map(r => [r.embedding_model, r.count])),
        averageDimensions: Math.round(dimensionsResult.avg_dimensions || 0)
      };

    } catch (error) {
      logger.error('Failed to get index stats:', error);
      return {
        totalEmbeddings: 0,
        embeddingsByType: {},
        embeddingsByModel: {},
        averageDimensions: 0
      };
    }
  }

  // Private methods

  private getDefaultOptions(options: VectorSearchOptions): Required<VectorSearchOptions> {
    return {
      model: 'all-MiniLM-L6-v2',
      similarityThreshold: 0.7,
      maxResults: 20,
      includeMetadata: true,
      hybridSearch: false,
      weightVector: 1.0,
      ...options
    };
  }

  private async getStoredEmbeddings(options: Required<VectorSearchOptions>): Promise<VectorIndex[]> {
    const db = database.getDb();
    
    const rows = await db.all(`
      SELECT * FROM vector_embeddings 
      WHERE embedding_model = ?
      ORDER BY created_at DESC
    `, options.model) as Array<{
      id: string;
      content_id: string;
      content_type: string;
      embedding_model: string;
      embedding_dimensions: number;
      embedding_vector: string;
      created_at: string;
    }>;

    return rows.map(row => ({
      id: row.id,
      contentId: row.content_id,
      contentType: row.content_type,
      embedding: JSON.parse(row.embedding_vector),
      dimensions: row.embedding_dimensions,
      model: row.embedding_model,
      createdAt: new Date(row.created_at)
    }));
  }

  private calculateSimilarities(
    queryEmbedding: number[],
    storedEmbeddings: VectorIndex[]
  ): Array<{ contentId: string; contentType: string; similarity: number; embedding: number[] }> {
    return storedEmbeddings.map(stored => ({
      contentId: stored.contentId,
      contentType: stored.contentType,
      similarity: this.cosineSimilarity(queryEmbedding, stored.embedding),
      embedding: stored.embedding
    }));
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('Vectors must have the same length');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    return magnitude === 0 ? 0 : dotProduct / magnitude;
  }

  private async enrichResults(
    similarities: Array<{ contentId: string; contentType: string; similarity: number; embedding: number[] }>,
    options: Required<VectorSearchOptions>
  ): Promise<VectorSearchResult[]> {
    const db = database.getDb();
    const results: VectorSearchResult[] = [];

    for (const sim of similarities) {
      try {
        let content = '';
        let metadata: any = {};

        // Get content based on type
        switch (sim.contentType) {
          case 'chunk':
            const chunk = await db.get('SELECT * FROM chunks WHERE id = ?', sim.contentId);
            if (chunk) {
              content = chunk.chunk_text;
              metadata = {
                sourceId: chunk.memory_id,
                sourceType: 'chunk',
                timestamp: chunk.start_offset ? chunk.start_offset / 1000 : undefined,
                chunkIndex: chunk.chunk_order,
                memoryId: chunk.memory_id
              };
            }
            break;
            
          case 'memory':
            const memory = await db.get('SELECT * FROM memories WHERE id = ?', sim.contentId);
            if (memory) {
              content = memory.content;
              metadata = {
                sourceId: memory.id,
                sourceType: memory.content_type,
                memoryId: memory.id
              };
            }
            break;
            
          case 'frame':
            // Frame content would be OCR text or description
            content = `Frame content for ${sim.contentId}`;
            metadata = {
              sourceId: sim.contentId,
              sourceType: 'frame'
            };
            break;
        }

        if (content) {
          results.push({
            id: `${sim.contentId}-${sim.contentType}`,
            contentId: sim.contentId,
            contentType: sim.contentType as 'chunk' | 'memory' | 'frame',
            content,
            similarity: sim.similarity,
            embedding: options.includeMetadata ? sim.embedding : undefined,
            metadata: options.includeMetadata ? metadata : undefined
          });
        }

      } catch (error) {
        logger.warn(`Failed to enrich result for ${sim.contentType}:${sim.contentId}:`, error);
      }
    }

    return results;
  }
}