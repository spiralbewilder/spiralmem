import { MemoryEngine } from '../../src/core/MemoryEngine.js';
import { database } from '../../src/core/database/index.js';
import fs from 'fs';
import path from 'path';

describe('MemoryEngine', () => {
  let memoryEngine: MemoryEngine;
  const testDbPath = './data/test-spiralmem.db';

  beforeAll(async () => {
    // Set test database path
    process.env.SPIRALMEM_DB_PATH = testDbPath;
    
    // Remove test database if it exists
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }

    memoryEngine = new MemoryEngine();
    await memoryEngine.initialize();
  });

  afterAll(async () => {
    // Close database connection
    database.close();
    
    // Clean up test database
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    
    // Clean up test data directory if empty
    const dataDir = path.dirname(testDbPath);
    try {
      if (fs.existsSync(dataDir) && fs.readdirSync(dataDir).length === 0) {
        fs.rmdirSync(dataDir);
      }
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('initialization', () => {
    it('should initialize successfully', async () => {
      expect(memoryEngine).toBeDefined();
      
      const isHealthy = await memoryEngine.healthCheck();
      expect(isHealthy).toBe(true);
    });

    it('should have default space', async () => {
      const spaces = await memoryEngine.listSpaces();
      expect(spaces).toHaveLength(1);
      expect(spaces[0].name).toBe('Default');
      expect(spaces[0].id).toBe('default');
    });
  });

  describe('content management', () => {
    it('should add content successfully', async () => {
      const memoryId = await memoryEngine.addContent({
        content: 'This is a test memory.',
        title: 'Test Memory',
        source: 'test',
        metadata: { category: 'test' }
      });

      expect(memoryId).toBeDefined();
      expect(typeof memoryId).toBe('string');
    });

    it('should retrieve content by ID', async () => {
      const memoryId = await memoryEngine.addContent({
        content: 'Another test memory.',
        title: 'Another Test',
        source: 'test'
      });

      const memory = await memoryEngine.getContent(memoryId);
      expect(memory).toBeDefined();
      expect(memory?.id).toBe(memoryId);
      expect(memory?.content).toBe('Another test memory.');
      expect(memory?.title).toBe('Another Test');
    });

    it('should update content', async () => {
      const memoryId = await memoryEngine.addContent({
        content: 'Original content',
        source: 'test'
      });

      await memoryEngine.updateContent(memoryId, {
        content: 'Updated content',
        title: 'Updated Title'
      });

      const memory = await memoryEngine.getContent(memoryId);
      expect(memory?.content).toBe('Updated content');
      expect(memory?.title).toBe('Updated Title');
    });

    it('should delete content', async () => {
      const memoryId = await memoryEngine.addContent({
        content: 'Content to delete',
        source: 'test'
      });

      const deleted = await memoryEngine.deleteContent(memoryId);
      expect(deleted).toBe(true);

      const memory = await memoryEngine.getContent(memoryId);
      expect(memory).toBeNull();
    });
  });

  describe('search functionality', () => {
    beforeEach(async () => {
      // Add test content for search
      await memoryEngine.addContent({
        content: 'Machine learning is a subset of artificial intelligence.',
        title: 'ML Introduction',
        source: 'test'
      });

      await memoryEngine.addContent({
        content: 'Neural networks are inspired by biological neurons.',
        title: 'Neural Networks',
        source: 'test'
      });

      await memoryEngine.addContent({
        content: 'Deep learning uses multiple layers in neural networks.',
        title: 'Deep Learning',
        source: 'test'
      });
    });

    it('should search content by keyword', async () => {
      const results = await memoryEngine.searchMemories({
        query: 'neural networks',
        limit: 10
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].memory.content).toContain('neural');
    });

    it('should search content by title', async () => {
      const results = await memoryEngine.searchMemories({
        query: 'Deep Learning',
        limit: 10
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].memory.title).toContain('Deep Learning');
    });

    it('should return highlights in search results', async () => {
      const results = await memoryEngine.searchMemories({
        query: 'learning',
        limit: 10
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].highlights).toBeDefined();
      expect(results[0].highlights!.length).toBeGreaterThan(0);
    });
  });

  describe('space management', () => {
    it('should create new space', async () => {
      const spaceId = await memoryEngine.createSpace('Test Space', {
        autoTagging: true
      });

      expect(spaceId).toBeDefined();

      const space = await memoryEngine.getSpace(spaceId);
      expect(space?.name).toBe('Test Space');
      expect(space?.settings.autoTagging).toBe(true);
    });

    it('should list all spaces', async () => {
      const spaceId = await memoryEngine.createSpace('Another Space');
      const spaces = await memoryEngine.listSpaces();

      expect(spaces.length).toBeGreaterThanOrEqual(2); // default + created
      expect(spaces.some(s => s.id === spaceId)).toBe(true);
    });

    it('should not allow duplicate space names', async () => {
      await memoryEngine.createSpace('Unique Space');
      
      await expect(
        memoryEngine.createSpace('Unique Space')
      ).rejects.toThrow("Space 'Unique Space' already exists");
    });
  });

  describe('statistics and health', () => {
    it('should provide system statistics', async () => {
      const stats = await memoryEngine.getStats();

      expect(stats).toBeDefined();
      expect(typeof stats.totalMemories).toBe('number');
      expect(typeof stats.totalSpaces).toBe('number');
      expect(stats.contentTypeBreakdown).toBeDefined();
    });

    it('should perform health check', async () => {
      const isHealthy = await memoryEngine.healthCheck();
      expect(isHealthy).toBe(true);
    });

    it('should export data', async () => {
      const exportData = await memoryEngine.exportData({
        format: 'json'
      });

      expect(exportData).toBeDefined();
      expect(exportData.memories).toBeDefined();
      expect(exportData.spaces).toBeDefined();
      expect(exportData.metadata).toBeDefined();
      expect(exportData.metadata.format).toBe('json');
    });
  });
});