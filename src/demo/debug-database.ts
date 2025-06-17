#!/usr/bin/env node

import { database } from '../core/database/connection.js';
import { VideoProcessingRepository } from '../core/database/repositories/VideoProcessingRepository.js';

async function main() {
  try {
    console.log('🔧 Testing database connection...');
    
    // Initialize database
    await database.initialize();
    console.log('✅ Database initialized');
    
    // Test basic query
    const db = database.getDb();
    const testResult = await db.get('SELECT 1 as test');
    console.log('✅ Basic query works:', testResult);
    
    // Test VideoProcessingRepository
    const repo = new VideoProcessingRepository();
    console.log('✅ Repository created');
    
    // Test job creation
    const job = await repo.createJob({
      id: `test-job-${Date.now()}`,
      sourceId: 'test-source',
      sourceType: 'local',
      status: 'pending',
      progress: 0,
      processingSteps: [],
      metadata: {}
    });
    
    console.log('✅ Job created:', job.id);
    
    // Test job update
    const updateResult = await repo.updateJobStatus(job.id, 'processing', 50);
    console.log('✅ Job update result:', updateResult);
    
    console.log('🎉 All database tests passed!');
    
  } catch (error) {
    console.error('❌ Database test failed:', error);
    console.error('Stack:', error instanceof Error ? error.stack : 'No stack');
  }
}

main().catch(console.error);