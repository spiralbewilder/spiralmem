#!/usr/bin/env node

/**
 * Test Video Ingestion to Memory System
 * Tests complete video-to-memory workflow
 */

import { MemoryEngine } from './src/core/MemoryEngine.js';
import { VideoWorkflow } from './src/core/workflow/VideoWorkflow.js';
import { logger } from './src/utils/logger.js';
import fs from 'fs';
import path from 'path';

async function main() {
  try {
    console.log('🎬 TESTING VIDEO INGESTION TO MEMORY SYSTEM');
    console.log('==========================================');
    
    // Initialize systems
    const memoryEngine = new MemoryEngine();
    await memoryEngine.initialize();
    console.log('✅ Memory engine initialized');
    
    const videoWorkflow = new VideoWorkflow();
    console.log('✅ Video workflow initialized');
    
    // Check for test video
    const videoPath = './temp/proof-test/video/proof_video.mp4';
    if (!fs.existsSync(videoPath)) {
      console.log('❌ Test video not found at:', videoPath);
      console.log('Run demo:proof first to download test video');
      return;
    }
    
    const fileStats = fs.statSync(videoPath);
    console.log(`✅ Test video found: ${(fileStats.size / 1024 / 1024).toFixed(2)} MB`);
    
    // Step 1: Process video through workflow
    console.log('\n📹 STEP 1: Processing video through workflow');
    console.log('===========================================');
    
    const result = await videoWorkflow.processVideo(videoPath, 'default', {
      enableTranscription: true,
      enableFrameExtraction: false,
      enableThumbnails: true,
      chunkingOptions: {
        chunkSize: 500,
        overlapSize: 50,
        preserveTimestamps: true
      }
    });
    
    console.log('Video processing result:', {
      success: result.success,
      memoryId: result.memoryId,
      processingTime: result.processingTimeMs,
      videoDetails: result.videoMetadata
    });
    
    if (!result.success) {
      console.log('❌ Video processing failed:', result.errors);
      return;
    }
    
    // Step 2: Test retrieval from memory system
    console.log('\n🔍 STEP 2: Testing memory retrieval');
    console.log('==================================');
    
    const memory = await memoryEngine.getContent(result.memoryId!);
    if (memory) {
      console.log('✅ Memory retrieved successfully:');
      console.log('  ID:', memory.id);
      console.log('  Title:', memory.title);
      console.log('  Content Type:', memory.contentType);
      console.log('  Source:', memory.source);
      console.log('  Metadata Keys:', Object.keys(memory.metadata));
    } else {
      console.log('❌ Memory not found');
      return;
    }
    
    // Step 3: Test search functionality
    console.log('\n🔎 STEP 3: Testing video content search');
    console.log('=====================================');
    
    const searchResults = await memoryEngine.searchMemories({
      query: 'video',
      limit: 10
    });
    
    console.log(`✅ Search found ${searchResults.length} results`);
    const videoResults = searchResults.filter(r => r.memory.contentType === 'video');
    console.log(`📹 Video results: ${videoResults.length}`);
    
    if (videoResults.length > 0) {
      console.log('First video result:', {
        id: videoResults[0].memory.id,
        title: videoResults[0].memory.title,
        score: videoResults[0].similarity,
        content: videoResults[0].memory.content?.substring(0, 100) + '...'
      });
    }
    
    // Step 4: Check system stats
    console.log('\n📊 STEP 4: System statistics');
    console.log('===========================');
    
    const systemStats = await memoryEngine.getStats();
    console.log('System stats:', {
      totalMemories: systemStats.totalMemories,
      totalChunks: systemStats.totalChunks,
      contentBreakdown: systemStats.contentTypeBreakdown
    });
    
    console.log('\n🎉 VIDEO INGESTION TEST COMPLETED SUCCESSFULLY!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    logger.error('Video ingestion test failed:', error);
  }
}

main().catch(console.error);