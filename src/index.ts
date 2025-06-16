#!/usr/bin/env node

import 'dotenv/config';
import { MemoryEngine } from './core/MemoryEngine.js';
import { logger } from './utils/logger.js';

async function main() {
  try {
    logger.info('Starting Spiralmem...');
    
    const memoryEngine = new MemoryEngine();
    await memoryEngine.initialize();
    
    // Basic functionality test
    logger.info('Testing basic functionality...');
    
    // Add some test content
    const memoryId = await memoryEngine.addContent({
      content: 'This is a test memory for spiralmem initialization.',
      title: 'Test Memory',
      source: 'manual',
      metadata: {
        category: 'test',
        priority: 'low'
      }
    });
    
    logger.info(`Created test memory: ${memoryId}`);
    
    // Test search
    const searchResults = await memoryEngine.searchMemories({
      query: 'test memory',
      limit: 10
    });
    
    logger.info(`Search found ${searchResults.length} results`);
    
    // Test stats
    const stats = await memoryEngine.getStats();
    logger.info('System stats:', stats);
    
    // Test health check
    const isHealthy = await memoryEngine.healthCheck();
    logger.info(`System health: ${isHealthy ? 'Healthy' : 'Unhealthy'}`);
    
    logger.info('Spiralmem initialization complete and functional!');
    
  } catch (error) {
    logger.error('Failed to start Spiralmem:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  logger.info('Received SIGINT, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('Received SIGTERM, shutting down gracefully...');
  process.exit(0);
});

// Run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    logger.error('Unhandled error:', error);
    process.exit(1);
  });
}