#!/usr/bin/env node

import { MemoryEngine } from './src/core/MemoryEngine.js';
import { logger } from './src/utils/logger.js';

async function debugSearch() {
  try {
    const memoryEngine = new MemoryEngine();
    await memoryEngine.initialize();
    
    console.log('🔍 DEBUGGING VIDEO SEARCH');
    console.log('========================');
    
    // Check all memories
    console.log('\n1. All memories in system:');
    const allResults = await memoryEngine.searchMemories({ query: '', limit: 100 });
    console.log(`Total memories: ${allResults.length}`);
    allResults.forEach(result => {
      console.log(`  - ${result.memory.id}: ${result.memory.title} (${result.memory.contentType}) - "${result.memory.content?.substring(0,50)}..."`);
    });
    
    // Search for "video" 
    console.log('\n2. Search for "video":');
    const videoSearch = await memoryEngine.searchMemories({ query: 'video', limit: 10 });
    console.log(`Video search results: ${videoSearch.length}`);
    videoSearch.forEach(result => {
      console.log(`  - ${result.memory.title} (${result.memory.contentType}) score: ${result.similarity}`);
    });
    
    // Filter by content type
    console.log('\n3. Filter video results:');
    const videoOnly = videoSearch.filter(r => r.memory.contentType === 'video');
    console.log(`Filtered video results: ${videoOnly.length}`);
    
    // Search for specific content
    console.log('\n4. Search for "proof_video":');
    const proofSearch = await memoryEngine.searchMemories({ query: 'proof_video', limit: 10 });
    console.log(`Proof video search results: ${proofSearch.length}`);
    proofSearch.forEach(result => {
      console.log(`  - ${result.memory.title} (${result.memory.contentType}) score: ${result.similarity}`);
    });
    
    // Test content type search
    console.log('\n5. Search for "mp4":');
    const mp4Search = await memoryEngine.searchMemories({ query: 'mp4', limit: 10 });
    console.log(`MP4 search results: ${mp4Search.length}`);
    mp4Search.forEach(result => {
      console.log(`  - ${result.memory.title} (${result.memory.contentType}) score: ${result.similarity}`);
    });
    
  } catch (error) {
    console.error('Debug failed:', error);
  }
}

debugSearch();