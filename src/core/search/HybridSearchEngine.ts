import { logger } from '../../utils/logger.js';
import { PerformanceMonitor } from '../platforms/PerformanceMonitor.js';
import { VectorSearchEngine, VectorSearchResult } from './VectorSearchEngine.js';
import { ChunkRepository } from '../database/repositories/index.js';

export interface HybridSearchOptions {
  vectorWeight?: number; // 0.0 to 1.0, weight for vector search
  keywordWeight?: number; // 0.0 to 1.0, weight for keyword search
  vectorThreshold?: number; // Minimum similarity for vector results
  maxResults?: number;
  model?: string;
  includeMetadata?: boolean;
}

export interface HybridSearchResult {
  id: string;
  contentId: string;
  contentType: 'chunk' | 'memory' | 'frame';
  content: string;
  combinedScore: number;
  vectorScore?: number;
  keywordScore?: number;
  matchType: 'vector' | 'keyword' | 'hybrid';
  highlights?: string[];
  metadata?: any;
}

export interface HybridSearchMetrics {
  totalTime: number; // ms
  vectorSearchTime: number;
  keywordSearchTime: number;
  combinationTime: number;
  vectorResults: number;
  keywordResults: number;
  combinedResults: number;
  deduplicationSavings: number;
}

/**
 * Hybrid search engine combining vector similarity and keyword matching
 * Provides the best of both semantic and exact matching approaches
 */
export class HybridSearchEngine {
  private vectorEngine: VectorSearchEngine;
  private chunkRepository: ChunkRepository;
  private performanceMonitor: PerformanceMonitor;

  constructor() {
    this.vectorEngine = new VectorSearchEngine();
    this.chunkRepository = new ChunkRepository();
    this.performanceMonitor = new PerformanceMonitor();
  }

  /**
   * Perform hybrid search combining vector similarity and keyword matching
   */
  async search(
    query: string,
    options: HybridSearchOptions = {}
  ): Promise<{
    results: HybridSearchResult[];
    metrics: HybridSearchMetrics;
  }> {
    const operationId = `hybridSearch-${Date.now()}`;
    this.performanceMonitor.startOperation(operationId);
    const searchStartTime = Date.now();

    const opts = this.getDefaultOptions(options);
    const metrics: HybridSearchMetrics = {
      totalTime: 0,
      vectorSearchTime: 0,
      keywordSearchTime: 0,
      combinationTime: 0,
      vectorResults: 0,
      keywordResults: 0,
      combinedResults: 0,
      deduplicationSavings: 0
    };

    try {
      logger.info(`Starting hybrid search: "${query}"`);

      // Step 1: Vector search (if weight > 0)
      let vectorResults: VectorSearchResult[] = [];
      if (opts.vectorWeight > 0) {
        const vectorStartTime = Date.now();
        try {
          const vectorSearchResult = await this.vectorEngine.search(query, {
            model: opts.model as 'all-MiniLM-L6-v2' | 'openai' | 'sentence-transformers',
            similarityThreshold: opts.vectorThreshold,
            maxResults: opts.maxResults * 2, // Get more to allow for combination
            includeMetadata: opts.includeMetadata
          });
          
          vectorResults = vectorSearchResult.results;
          metrics.vectorSearchTime = Date.now() - vectorStartTime;
          metrics.vectorResults = vectorResults.length;
        } catch (error) {
          logger.warn('Vector search failed, continuing with keyword-only search:', error);
          metrics.vectorSearchTime = Date.now() - vectorStartTime;
        }
      }

      // Step 2: Keyword search (if weight > 0)
      let keywordResults: Array<{
        id: string;
        contentId: string;
        content: string;
        score: number;
        highlights: string[];
        metadata?: any;
      }> = [];
      
      if (opts.keywordWeight > 0) {
        const keywordStartTime = Date.now();
        keywordResults = await this.performKeywordSearch(query, opts);
        metrics.keywordSearchTime = Date.now() - keywordStartTime;
        metrics.keywordResults = keywordResults.length;
      }

      // Step 3: Combine and rank results
      const combinationStartTime = Date.now();
      const combinedResults = this.combineResults(vectorResults, keywordResults, opts);
      metrics.combinationTime = Date.now() - combinationStartTime;
      metrics.combinedResults = combinedResults.length;
      metrics.deduplicationSavings = (metrics.vectorResults + metrics.keywordResults) - metrics.combinedResults;

      // Step 4: Sort by combined score and limit results
      const finalResults = combinedResults
        .sort((a, b) => b.combinedScore - a.combinedScore)
        .slice(0, opts.maxResults);

      metrics.totalTime = Date.now() - searchStartTime;

      logger.info(`Hybrid search completed: ${finalResults.length} results in ${metrics.totalTime}ms`);

      this.performanceMonitor.endOperation(operationId, 'hybrid-search', true);

      return {
        results: finalResults,
        metrics
      };

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown hybrid search error';
      logger.error('Hybrid search failed:', error);

      metrics.totalTime = Date.now() - searchStartTime;
      this.performanceMonitor.endOperation(operationId, 'hybrid-search', false);

      return {
        results: [],
        metrics
      };
    }
  }

  /**
   * Index content for both vector and keyword search
   */
  async indexContent(
    content: string,
    contentId: string,
    contentType: 'chunk' | 'memory' | 'frame',
    options: { model?: string } = {}
  ): Promise<boolean> {
    try {
      // Index for vector search
      const vectorIndexed = await this.vectorEngine.indexContent(content, contentId, contentType, options);
      
      // Keyword indexing happens automatically through database storage
      // (chunks are already stored in the chunks table for keyword search)
      
      return vectorIndexed;

    } catch (error) {
      logger.error(`Failed to index content for hybrid search ${contentId}:`, error);
      return false;
    }
  }

  /**
   * Get search engine statistics
   */
  async getSearchStats(): Promise<{
    vectorStats: any;
    keywordStats: {
      totalChunks: number;
      averageChunkLength: number;
    };
  }> {
    const vectorStats = await this.vectorEngine.getIndexStats();
    
    const keywordStats = {
      totalChunks: await this.chunkRepository.count(),
      averageChunkLength: 0
    };

    return {
      vectorStats,
      keywordStats
    };
  }

  // Private methods

  private getDefaultOptions(options: HybridSearchOptions): Required<HybridSearchOptions> {
    return {
      vectorWeight: 0.0,  // Disabled by default due to dependencies
      keywordWeight: 1.0, // Keyword-only search by default
      vectorThreshold: 0.7,
      maxResults: 20,
      model: 'all-MiniLM-L6-v2',
      includeMetadata: true,
      ...options
    };
  }

  private async performKeywordSearch(
    query: string,
    options: Required<HybridSearchOptions>
  ): Promise<Array<{
    id: string;
    contentId: string;
    content: string;
    score: number;
    highlights: string[];
    metadata?: any;
  }>> {
    try {
      // Prepare search terms
      const searchTerms = this.prepareSearchTerms(query);
      const results: Array<{
        id: string;
        contentId: string;
        content: string;
        score: number;
        highlights: string[];
        metadata?: any;
      }> = [];

      // Search for each term and combine results
      for (const term of searchTerms) {
        const chunks = await this.chunkRepository.search(term, undefined, options.maxResults * 2);
        
        for (const chunk of chunks) {
          const score = this.calculateKeywordScore(chunk.chunkText, term, query);
          const highlights = this.extractHighlights(chunk.chunkText, term);
          
          results.push({
            id: chunk.id,
            contentId: chunk.id,
            content: chunk.chunkText,
            score,
            highlights,
            metadata: options.includeMetadata ? {
              sourceId: chunk.memoryId,
              sourceType: 'chunk',
              timestamp: chunk.startOffset ? chunk.startOffset / 1000 : undefined,
              chunkIndex: chunk.chunkOrder,
              memoryId: chunk.memoryId
            } : undefined
          });
        }
      }

      // Deduplicate and merge scores for same content
      return this.deduplicateKeywordResults(results);

    } catch (error) {
      logger.error('Keyword search failed:', error);
      return [];
    }
  }

  private prepareSearchTerms(query: string): string[] {
    // Basic term extraction
    let terms = query.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(term => term.length > 2); // Filter short terms

    // Remove duplicates
    terms = [...new Set(terms)];

    // Add original query for phrase matching
    if (query.length > 5) {
      terms.push(query.toLowerCase());
    }

    return terms;
  }

  private calculateKeywordScore(content: string, term: string, originalQuery: string): number {
    const lowerContent = content.toLowerCase();
    const lowerTerm = term.toLowerCase();
    const lowerQuery = originalQuery.toLowerCase();

    let score = 0;

    // Exact phrase match gets highest score
    if (lowerContent.includes(lowerQuery)) {
      score += 1.0;
    }

    // Individual term matches
    const termMatches = (lowerContent.match(new RegExp(lowerTerm, 'g')) || []).length;
    score += termMatches * 0.3;

    // Position bonus (earlier matches score higher)
    const firstIndex = lowerContent.indexOf(lowerTerm);
    if (firstIndex !== -1) {
      const positionScore = 1 - (firstIndex / lowerContent.length);
      score += positionScore * 0.2;
    }

    return Math.min(score, 1.0);
  }

  private extractHighlights(content: string, term: string): string[] {
    const highlights: string[] = [];
    const lowerContent = content.toLowerCase();
    const lowerTerm = term.toLowerCase();
    
    let index = 0;
    while ((index = lowerContent.indexOf(lowerTerm, index)) !== -1) {
      const start = Math.max(0, index - 50);
      const end = Math.min(content.length, index + term.length + 50);
      const highlight = content.substring(start, end);
      highlights.push(highlight);
      index += term.length;
    }

    return highlights.slice(0, 3); // Limit to 3 highlights
  }

  private deduplicateKeywordResults(
    results: Array<{
      id: string;
      contentId: string;
      content: string;
      score: number;
      highlights: string[];
      metadata?: any;
    }>
  ): Array<{
    id: string;
    contentId: string;
    content: string;
    score: number;
    highlights: string[];
    metadata?: any;
  }> {
    const deduped = new Map<string, typeof results[0]>();

    for (const result of results) {
      const existing = deduped.get(result.contentId);
      if (!existing || result.score > existing.score) {
        deduped.set(result.contentId, {
          ...result,
          highlights: existing ? 
            [...new Set([...existing.highlights, ...result.highlights])] : 
            result.highlights
        });
      }
    }

    return Array.from(deduped.values());
  }

  private combineResults(
    vectorResults: VectorSearchResult[],
    keywordResults: Array<{
      id: string;
      contentId: string;
      content: string;
      score: number;
      highlights: string[];
      metadata?: any;
    }>,
    options: Required<HybridSearchOptions>
  ): HybridSearchResult[] {
    const combined = new Map<string, HybridSearchResult>();

    // Add vector results
    for (const result of vectorResults) {
      combined.set(result.contentId, {
        id: result.id,
        contentId: result.contentId,
        contentType: result.contentType,
        content: result.content,
        combinedScore: result.similarity * options.vectorWeight,
        vectorScore: result.similarity,
        matchType: 'vector',
        metadata: result.metadata
      });
    }

    // Add keyword results or combine with existing
    for (const result of keywordResults) {
      const existing = combined.get(result.contentId);
      
      if (existing) {
        // Combine scores
        existing.combinedScore = 
          (existing.vectorScore || 0) * options.vectorWeight +
          result.score * options.keywordWeight;
        existing.keywordScore = result.score;
        existing.matchType = 'hybrid';
        existing.highlights = result.highlights;
      } else {
        // Add as keyword-only result
        combined.set(result.contentId, {
          id: result.id,
          contentId: result.contentId,
          contentType: 'chunk', // Keyword results are always chunks for now
          content: result.content,
          combinedScore: result.score * options.keywordWeight,
          keywordScore: result.score,
          matchType: 'keyword',
          highlights: result.highlights,
          metadata: result.metadata
        });
      }
    }

    return Array.from(combined.values());
  }
}