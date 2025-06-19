import { 
  Memory, 
  Space, 
  ContentInput, 
  SearchQuery, 
  SearchResult, 
  SearchOptions,
  MemoryStats,
  ExportOptions,
  ExportData,
  SpaceSettings
} from './models/types.js';
import { database, SpaceRepository, MemoryRepository, ChunkRepository } from './database/index.js';
import { logger, logError, logPerformance } from '../utils/logger.js';
import { config } from '../utils/config.js';
import { 
  withErrorHandling, 
  validateRequired, 
  DatabaseError,
  SystemError 
} from '../utils/errorHandler.js';
import { healthMonitor } from '../utils/healthMonitor.js';
import { resourceMonitor } from '../utils/resourceMonitor.js';

export class MemoryEngine {
  private spaceRepo: SpaceRepository;
  private memoryRepo: MemoryRepository;
  private chunkRepo: ChunkRepository;
  private isInitialized = false;

  constructor() {
    this.spaceRepo = new SpaceRepository();
    this.memoryRepo = new MemoryRepository();
    this.chunkRepo = new ChunkRepository();
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      const startTime = Date.now();
      logger.info('Initializing MemoryEngine...');
      
      // Initialize database
      await database.initialize();
      
      // Ensure default space exists
      await this.spaceRepo.ensureDefaultSpace();
      
      // Run health checks
      const healthStatus = await healthMonitor.runHealthChecks();
      if (healthStatus.database === 'down') {
        throw new DatabaseError('Database health check failed during initialization');
      }
      
      // Start resource monitoring
      resourceMonitor.startMonitoring();
      
      // Start periodic health checks (every 5 minutes)
      healthMonitor.startPeriodicHealthChecks(300000);
      
      this.isInitialized = true;
      
      logPerformance('MemoryEngine initialization', startTime);
      logger.info('MemoryEngine initialized successfully', {
        database: healthStatus.database,
        processing: healthStatus.processing
      });
      
    } catch (error) {
      const wrappedError = error instanceof Error ? 
        new SystemError('MemoryEngine initialization failed', { originalError: error.message }) :
        new SystemError('MemoryEngine initialization failed with unknown error');
      
      logError(wrappedError, 'MemoryEngine initialization');
      throw wrappedError;
    }
  }

  async systemHealthCheck(): Promise<boolean> {
    try {
      this.ensureInitialized();
      
      const health = await healthMonitor.runHealthChecks();
      return health.database === 'healthy' && health.processing !== 'down';
    } catch (error) {
      logger.error('Health check failed:', error);
      return false;
    }
  }

  async getSystemStatus() {
    const health = await healthMonitor.runHealthChecks();
    const resources = await resourceMonitor.getCurrentUsage();
    
    return {
      health,
      resources,
      initialized: this.isInitialized,
      canAcceptJobs: resourceMonitor.canAcceptNewJob()
    };
  }

  // Content Management
  async addContent(input: ContentInput): Promise<string> {
    this.ensureInitialized();
    
    try {
      const startTime = Date.now();
      
      // Validate space exists
      const spaceId = input.spaceId || 'default';
      if (!(await this.spaceRepo.exists(spaceId))) {
        throw new Error(`Space '${spaceId}' does not exist`);
      }

      // Create memory
      const memory = await this.memoryRepo.create(input);
      
      // TODO: Generate embeddings for semantic search
      // This will be implemented when we add vector search
      
      logPerformance('Add content', startTime);
      logger.info(`Added memory: ${memory.id} to space: ${spaceId}`);
      
      return memory.id;
    } catch (error) {
      logError(error as Error, 'addContent');
      throw error;
    }
  }

  async updateContent(id: string, updates: Partial<Pick<Memory, 'title' | 'content' | 'metadata'>>): Promise<void> {
    this.ensureInitialized();
    
    try {
      const success = await this.memoryRepo.update(id, updates);
      if (!success) {
        throw new Error(`Memory '${id}' not found`);
      }
      
      // TODO: Update embeddings if content changed
      
      logger.info(`Updated memory: ${id}`);
    } catch (error) {
      logError(error as Error, 'updateContent');
      throw error;
    }
  }

  async deleteContent(id: string): Promise<boolean> {
    this.ensureInitialized();
    
    try {
      const success = await this.memoryRepo.delete(id);
      if (success) {
        logger.info(`Deleted memory: ${id}`);
      }
      return success;
    } catch (error) {
      logError(error as Error, 'deleteContent');
      throw error;
    }
  }

  async getContent(id: string): Promise<Memory | null> {
    this.ensureInitialized();
    
    try {
      return await this.memoryRepo.findById(id);
    } catch (error) {
      logError(error as Error, 'getContent');
      throw error;
    }
  }

  // Search Operations
  async searchMemories(query: SearchQuery): Promise<SearchResult[]> {
    this.ensureInitialized();
    
    try {
      const startTime = Date.now();
      
      // Validate space if specified
      if (query.spaceId && !(await this.spaceRepo.exists(query.spaceId))) {
        throw new Error(`Space '${query.spaceId}' does not exist`);
      }

      const results = await this.memoryRepo.search(query);
      
      logPerformance(`Search: "${query.query}"`, startTime);
      logger.info(`Search returned ${results.length} results for: "${query.query}"`);
      
      return results;
    } catch (error) {
      logError(error as Error, 'searchMemories');
      throw error;
    }
  }

  async semanticSearch(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    this.ensureInitialized();
    try {
      const { VectorSearchEngine } = await import('./search/VectorSearchEngine.js');
      const vectorEngine = new VectorSearchEngine();
      
      const vectorResults = await vectorEngine.search(query, {
        model: 'all-MiniLM-L6-v2',
        similarityThreshold: options.similarityThreshold || 0.6,
        maxResults: options.maxResults || 10,
        includeMetadata: true
      });

      // Convert vector results to SearchResult format
      return vectorResults.results.map(vr => ({
        memory: {
          id: vr.metadata?.memoryId || vr.contentId,
          spaceId: 'default', // Will be properly resolved from metadata
          contentType: 'video' as const,
          title: 'Semantic Match',
          content: vr.content,
          source: vr.metadata?.sourceId || '',
          metadata: vr.metadata || {},
          createdAt: new Date(),
          updatedAt: new Date()
        },
        chunk: vr.contentType === 'chunk' ? {
          id: vr.contentId,
          memoryId: vr.metadata?.memoryId || '',
          chunkText: vr.content,
          chunkOrder: vr.metadata?.chunkIndex || 0,
          startOffset: vr.metadata?.timestamp ? Math.floor(vr.metadata.timestamp * 1000) : undefined,
          metadata: vr.metadata || {},
          createdAt: new Date()
        } : undefined,
        similarity: vr.similarity,
        highlights: [vr.content.substring(0, 100) + '...']
      }));
    } catch (error) {
      logger.warn('Semantic search failed, falling back to keyword search:', error);
      // Fallback to keyword search
      return this.searchMemories({
        query,
        limit: options.maxResults,
      });
    }
  }

  async keywordSearch(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    return this.searchMemories({
      query,
      limit: options.maxResults,
    });
  }

  /**
   * Enhanced search with precise timestamps for spoken word matches
   */
  async searchWithTimestamps(query: string, options: {
    spaceId?: string;
    limit?: number;
    contentTypes?: string[];
  } = {}): Promise<SearchResult[]> {
    this.ensureInitialized();
    try {
      const startTime = Date.now();
      
      // Validate space if specified
      if (options.spaceId && !(await this.spaceRepo.exists(options.spaceId))) {
        throw new Error(`Space '${options.spaceId}' does not exist`);
      }

      const searchQuery = {
        query,
        spaceId: options.spaceId,
        limit: options.limit || 10,
        contentTypes: options.contentTypes
      };

      const results = await this.memoryRepo.searchWithTimestamps(searchQuery);
      
      logPerformance(`Timestamp search: "${query}"`, startTime);
      logger.info(`Timestamp search returned ${results.length} results with precise timing for: "${query}"`);
      
      return results;
    } catch (error) {
      logError(error as Error, 'searchWithTimestamps');
      throw error;
    }
  }

  /**
   * Generate embeddings for existing content to enable semantic search
   */
  async generateEmbeddings(options: {
    memoryIds?: string[];
    forceRegenerate?: boolean;
    batchSize?: number;
  } = {}): Promise<{
    success: boolean;
    indexed: number;
    failed: number;
    errors: string[];
  }> {
    this.ensureInitialized();
    try {
      const { VectorSearchEngine } = await import('./search/VectorSearchEngine.js');
      const vectorEngine = new VectorSearchEngine();
      
      // Get chunks to index
      let chunks;
      if (options.memoryIds) {
        chunks = await this.chunkRepo.findByMemoryIds(options.memoryIds);
      } else {
        // Get all chunks by getting all spaces first
        const spaces = await this.spaceRepo.findAll();
        const allMemoryIds: string[] = [];
        for (const space of spaces) {
          const spaceMemories = await this.memoryRepo.findBySpace(space.id);
          allMemoryIds.push(...spaceMemories.map((m: Memory) => m.id));
        }
        chunks = await this.chunkRepo.findByMemoryIds(allMemoryIds);
      }

      logger.info(`Starting embedding generation for ${chunks.length} chunks`);

      // Filter out already indexed chunks if not forcing regeneration
      let chunksToIndex = chunks;
      if (!options.forceRegenerate) {
        // This would require checking existing embeddings
        // For now, index all chunks
      }

      // Prepare content for batch indexing
      const indexItems = chunksToIndex.map(chunk => ({
        content: chunk.chunkText,
        contentId: chunk.id,
        contentType: 'chunk' as const
      }));

      const result = await vectorEngine.indexContentBatch(indexItems, {
        model: 'all-MiniLM-L6-v2',
        batchSize: options.batchSize || 32
      });

      logger.info(`Embedding generation completed: ${result.successful} successful, ${result.failed} failed`);

      return {
        success: result.successful > 0,
        indexed: result.successful,
        failed: result.failed,
        errors: result.failed > 0 ? [`${result.failed} embeddings failed to generate`] : []
      };

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Embedding generation failed:', error);
      return {
        success: false,
        indexed: 0,
        failed: 0,
        errors: [errorMsg]
      };
    }
  }

  /**
   * Get vector search statistics
   */
  async getVectorStats(): Promise<{
    totalEmbeddings: number;
    embeddingsByType: Record<string, number>;
    embeddingsByModel: Record<string, number>;
    averageDimensions: number;
  }> {
    this.ensureInitialized();
    try {
      const { VectorSearchEngine } = await import('./search/VectorSearchEngine.js');
      const vectorEngine = new VectorSearchEngine();
      return await vectorEngine.getIndexStats();
    } catch (error) {
      logger.error('Failed to get vector stats:', error);
      return {
        totalEmbeddings: 0,
        embeddingsByType: {},
        embeddingsByModel: {},
        averageDimensions: 0
      };
    }
  }

  // Space Management
  async createSpace(name: string, settings: SpaceSettings = {}): Promise<string> {
    this.ensureInitialized();
    
    try {
      // Check if space already exists
      const existing = await this.spaceRepo.findByName(name);
      if (existing) {
        throw new Error(`Space '${name}' already exists`);
      }

      const space = await this.spaceRepo.create({
        id: this.generateId(),
        name,
        settings,
      });
      
      logger.info(`Created space: ${space.id} (${name})`);
      return space.id;
    } catch (error) {
      logError(error as Error, 'createSpace');
      throw error;
    }
  }

  async listSpaces(): Promise<Space[]> {
    this.ensureInitialized();
    
    try {
      return await this.spaceRepo.findAll();
    } catch (error) {
      logError(error as Error, 'listSpaces');
      throw error;
    }
  }

  async deleteSpace(id: string): Promise<boolean> {
    this.ensureInitialized();
    
    try {
      const success = await this.spaceRepo.delete(id);
      if (success) {
        logger.info(`Deleted space: ${id}`);
      }
      return success;
    } catch (error) {
      logError(error as Error, 'deleteSpace');
      throw error;
    }
  }

  async getSpace(id: string): Promise<Space | null> {
    this.ensureInitialized();
    
    try {
      return await this.spaceRepo.findById(id);
    } catch (error) {
      logError(error as Error, 'getSpace');
      throw error;
    }
  }

  // Utility Operations
  async getStats(spaceId?: string): Promise<MemoryStats> {
    this.ensureInitialized();
    
    try {
      const totalMemories = await this.memoryRepo.count(spaceId);
      const allSpaces = spaceId ? [] : await this.spaceRepo.findAll();
      const totalSpaces = spaceId ? 1 : allSpaces.length;
      const contentTypeBreakdown = await this.memoryRepo.getContentTypeBreakdown(spaceId);
      
      // TODO: Implement actual storage calculation
      const storageUsed = 0;
      
      // Get actual chunk count
      const totalChunks = await this.chunkRepo.count();
      
      // TODO: Implement recent activity tracking
      const recentActivity = {
        memoriesAdded: 0,
        videosProcessed: 0,
        searchesPerformed: 0,
      };

      return {
        totalMemories,
        totalChunks,
        totalSpaces,
        storageUsed,
        contentTypeBreakdown,
        recentActivity,
      };
    } catch (error) {
      logError(error as Error, 'getStats');
      throw error;
    }
  }

  async exportData(options: ExportOptions): Promise<ExportData> {
    this.ensureInitialized();
    
    try {
      // Get memories based on options
      let memories: Memory[];
      if (options.spaceId) {
        memories = await this.memoryRepo.findBySpace(options.spaceId);
      } else {
        // Get all memories (this could be optimized for large datasets)
        const allSpaces = await this.listSpaces();
        memories = [];
        for (const space of allSpaces) {
          const spaceMemories = await this.memoryRepo.findBySpace(space.id);
          memories.push(...spaceMemories);
        }
      }

      // Filter by date range if specified
      if (options.dateRange) {
        memories = memories.filter(memory => 
          memory.createdAt >= options.dateRange!.start &&
          memory.createdAt <= options.dateRange!.end
        );
      }

      const spaces = await this.listSpaces();
      const tags: any[] = []; // TODO: Implement tag repository
      
      const exportData: ExportData = {
        memories,
        spaces,
        tags,
        metadata: {
          exportedAt: new Date(),
          version: '1.0.0',
          format: options.format,
        },
      };

      logger.info(`Exported ${memories.length} memories in ${options.format} format`);
      return exportData;
    } catch (error) {
      logError(error as Error, 'exportData');
      throw error;
    }
  }

  // Health and diagnostics
  async healthCheck(): Promise<boolean> {
    try {
      return await database.healthCheck();
    } catch (error) {
      logError(error as Error, 'healthCheck');
      return false;
    }
  }

  async backup(backupPath?: string): Promise<string> {
    this.ensureInitialized();
    
    try {
      const path = await database.backup(backupPath);
      logger.info(`Database backed up to: ${path}`);
      return path;
    } catch (error) {
      logError(error as Error, 'backup');
      throw error;
    }
  }

  // Helper methods
  protected ensureInitialized(): void {
    if (!this.isInitialized) {
      throw new Error('MemoryEngine not initialized. Call initialize() first.');
    }
  }

  private generateId(): string {
    return crypto.randomUUID();
  }

  // Development helpers
  async reset(): Promise<void> {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Reset not allowed in production');
    }
    
    logger.warn('Resetting MemoryEngine - all data will be lost');
    // TODO: Implement reset functionality for development
  }
}