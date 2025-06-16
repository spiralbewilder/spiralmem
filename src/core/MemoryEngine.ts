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
import { database, SpaceRepository, MemoryRepository } from './database/index.js';
import { logger, logError, logPerformance } from '../utils/logger.js';
import { config } from '../utils/config.js';

export class MemoryEngine {
  private spaceRepo: SpaceRepository;
  private memoryRepo: MemoryRepository;
  private isInitialized = false;

  constructor() {
    this.spaceRepo = new SpaceRepository();
    this.memoryRepo = new MemoryRepository();
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      const startTime = Date.now();
      
      // Initialize database
      await database.initialize();
      
      // Ensure default space exists
      this.spaceRepo.ensureDefaultSpace();
      
      this.isInitialized = true;
      
      logPerformance('MemoryEngine initialization', startTime);
      logger.info('MemoryEngine initialized successfully');
    } catch (error) {
      logError(error as Error, 'MemoryEngine initialization');
      throw error;
    }
  }

  // Content Management
  async addContent(input: ContentInput): Promise<string> {
    this.ensureInitialized();
    
    try {
      const startTime = Date.now();
      
      // Validate space exists
      const spaceId = input.spaceId || 'default';
      if (!this.spaceRepo.exists(spaceId)) {
        throw new Error(`Space '${spaceId}' does not exist`);
      }

      // Create memory
      const memory = this.memoryRepo.create(input);
      
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
      const success = this.memoryRepo.update(id, updates);
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
      const success = this.memoryRepo.delete(id);
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
      return this.memoryRepo.findById(id);
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
      if (query.spaceId && !this.spaceRepo.exists(query.spaceId)) {
        throw new Error(`Space '${query.spaceId}' does not exist`);
      }

      const results = this.memoryRepo.search(query);
      
      logPerformance(`Search: "${query.query}"`, startTime);
      logger.info(`Search returned ${results.length} results for: "${query.query}"`);
      
      return results;
    } catch (error) {
      logError(error as Error, 'searchMemories');
      throw error;
    }
  }

  async semanticSearch(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    // For now, this is the same as regular search
    // Will be enhanced with vector search when embeddings are implemented
    return this.searchMemories({
      query,
      spaceId: options.searchMode === 'semantic' ? undefined : options.searchMode,
      limit: options.maxResults,
    });
  }

  async keywordSearch(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    return this.searchMemories({
      query,
      limit: options.maxResults,
    });
  }

  // Space Management
  async createSpace(name: string, settings: SpaceSettings = {}): Promise<string> {
    this.ensureInitialized();
    
    try {
      // Check if space already exists
      const existing = this.spaceRepo.findByName(name);
      if (existing) {
        throw new Error(`Space '${name}' already exists`);
      }

      const space = this.spaceRepo.create({
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
      return this.spaceRepo.findAll();
    } catch (error) {
      logError(error as Error, 'listSpaces');
      throw error;
    }
  }

  async deleteSpace(id: string): Promise<boolean> {
    this.ensureInitialized();
    
    try {
      const success = this.spaceRepo.delete(id);
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
      return this.spaceRepo.findById(id);
    } catch (error) {
      logError(error as Error, 'getSpace');
      throw error;
    }
  }

  // Utility Operations
  async getStats(spaceId?: string): Promise<MemoryStats> {
    this.ensureInitialized();
    
    try {
      const totalMemories = this.memoryRepo.count(spaceId);
      const totalSpaces = spaceId ? 1 : this.spaceRepo.findAll().length;
      const contentTypeBreakdown = this.memoryRepo.getContentTypeBreakdown(spaceId);
      
      // TODO: Implement actual storage calculation
      const storageUsed = 0;
      
      // TODO: Implement chunk counting
      const totalChunks = 0;
      
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
        memories = this.memoryRepo.findBySpace(options.spaceId);
      } else {
        // Get all memories (this could be optimized for large datasets)
        const allSpaces = await this.listSpaces();
        memories = [];
        for (const space of allSpaces) {
          memories.push(...this.memoryRepo.findBySpace(space.id));
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
      return database.healthCheck();
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
  private ensureInitialized(): void {
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