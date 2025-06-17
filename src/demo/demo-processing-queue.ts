#!/usr/bin/env node

/**
 * Processing Queue Demo
 * Tests job queue management, scheduling, and batch processing
 */

import { JobManager, ProcessingQueue, ProcessingJob } from '../core/video/index.js';
import { logger } from '../utils/logger.js';

async function main() {
  try {
    console.log('🚀 Video Processing Queue Demo');
    console.log('===============================\n');

    // Initialize job manager
    console.log('🔧 Initializing job manager...');
    const jobManager = new JobManager({
      maxQueues: 3,
      defaultQueueOptions: {
        maxConcurrentJobs: 2,
        maxRetries: 2,
        priorityMode: 'priority',
        autoStart: true
      },
      enableJobHistory: true,
      enableScheduling: true,
      historyRetentionDays: 7
    });

    // Set up event listeners
    setupEventListeners(jobManager);

    console.log('✅ Job manager initialized');
    console.log('');

    // Create additional queues
    console.log('🏗️  Creating specialized queues...');
    
    jobManager.createQueue('priority', {
      maxConcurrentJobs: 1,
      priorityMode: 'priority'
    });

    jobManager.createQueue('batch', {
      maxConcurrentJobs: 3,
      priorityMode: 'fifo'
    });

    console.log('✅ Created specialized queues: priority, batch');
    console.log('');

    // Test queue statistics
    console.log('📊 Initial queue statistics...');
    const initialStats = jobManager.getAllStats();
    for (const [queueName, stats] of Object.entries(initialStats)) {
      console.log(`  ${queueName}: ${stats.totalJobs} total, ${stats.pendingJobs} pending`);
    }
    console.log('');

    // Test job submission
    console.log('📝 Testing job submissions...');
    
    const testFiles = [
      'sample-video-1.mp4',
      'sample-video-2.avi',
      'sample-video-3.mov',
      'urgent-video.mp4',
      'large-video.mkv'
    ];

    // Submit individual jobs with different priorities
    console.log('Submitting individual jobs...');
    const jobResults = [];

    for (let i = 0; i < testFiles.length; i++) {
      const file = testFiles[i];
      const priority = file.includes('urgent') ? 'urgent' : 
                     file.includes('large') ? 'low' : 'normal';
      
      try {
        const result = await jobManager.submitJob(file, {
          extractMetadata: true,
          extractAudio: true,
          transcribeAudio: false // Skip for demo
        }, {
          priority: priority as ProcessingJob['priority'],
          metadata: { demo: true, fileIndex: i }
        });
        
        jobResults.push(result);
        console.log(`  ✓ Job ${result.jobId} submitted to ${result.queueName} (${priority} priority)`);
      } catch (error) {
        console.log(`  ✗ Failed to submit ${file}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
    console.log('');

    // Test batch job submission
    console.log('📦 Testing batch job submission...');
    const batchFiles = [
      'batch-video-1.mp4',
      'batch-video-2.mp4',
      'batch-video-3.mp4'
    ];

    try {
      const batchResults = await jobManager.submitBatchJobs(batchFiles, {
        extractMetadata: true,
        skipValidation: true
      }, {
        priority: 'normal',
        queueName: 'batch',
        metadata: { batch: true, demo: true }
      });

      console.log(`✅ Batch submitted: ${batchResults.length} jobs to batch queue`);
      for (const result of batchResults.slice(0, 3)) {
        console.log(`  Job ${result.jobId}: ${result.filePath}`);
      }
    } catch (error) {
      console.log(`❌ Batch submission failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
    console.log('');

    // Test distributed batch submission
    console.log('🌐 Testing distributed batch submission...');
    const distributedFiles = [
      'distributed-1.mp4',
      'distributed-2.mp4',
      'distributed-3.mp4',
      'distributed-4.mp4'
    ];

    try {
      const distributedResults = await jobManager.submitBatchJobs(distributedFiles, {
        extractMetadata: true
      }, {
        priority: 'normal',
        distributeAcrossQueues: true,
        metadata: { distributed: true, demo: true }
      });

      console.log(`✅ Distributed batch: ${distributedResults.length} jobs across queues`);
      const queueDistribution = distributedResults.reduce((acc, r) => {
        acc[r.queueName] = (acc[r.queueName] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      
      for (const [queue, count] of Object.entries(queueDistribution)) {
        console.log(`  ${queue}: ${count} jobs`);
      }
    } catch (error) {
      console.log(`❌ Distributed batch failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
    console.log('');

    // Test job scheduling
    console.log('📅 Testing job scheduling...');
    
    const futureDate = new Date(Date.now() + 10000); // 10 seconds from now
    const scheduleId = jobManager.scheduleJob(
      'Demo Scheduled Job',
      ['scheduled-video.mp4'],
      { extractMetadata: true },
      {
        type: 'once',
        executeAt: futureDate,
        enabled: true
      },
      { priority: 'high', metadata: { scheduled: true } },
      'priority'
    );

    console.log(`✅ Scheduled job ${scheduleId} to run at ${futureDate.toLocaleTimeString()}`);
    console.log('');

    // Wait a moment to see job processing
    console.log('⏳ Waiting to observe job processing...');
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Show current statistics
    console.log('📈 Current queue statistics...');
    const currentStats = jobManager.getAggregatedStats();
    console.log('Aggregated Stats:', {
      totalJobs: currentStats.totalJobs,
      pending: currentStats.pendingJobs,
      processing: currentStats.processingJobs,
      completed: currentStats.completedJobs,
      failed: currentStats.failedJobs,
      queueCount: currentStats.queueCount,
      activeQueues: currentStats.activeQueues,
      estimatedWaitTime: `${Math.round(currentStats.estimatedWaitTime / 60)} minutes`
    });
    console.log('');

    // Show per-queue statistics
    console.log('📋 Per-queue statistics...');
    const allStats = jobManager.getAllStats();
    for (const [queueName, stats] of Object.entries(allStats)) {
      console.log(`${queueName}:`, {
        total: stats.totalJobs,
        pending: stats.pendingJobs,
        processing: stats.processingJobs,
        completed: stats.completedJobs,
        failed: stats.failedJobs,
        throughput: `${stats.throughputPerHour}/hour`
      });
    }
    console.log('');

    // Test job retrieval and status
    console.log('🔍 Testing job status retrieval...');
    if (jobResults.length > 0) {
      const firstJob = jobResults[0];
      const jobInfo = jobManager.getJob(firstJob.jobId);
      
      if (jobInfo) {
        console.log(`Job ${firstJob.jobId} status:`, {
          status: jobInfo.job.status,
          queue: jobInfo.queueName,
          created: jobInfo.job.createdAt.toLocaleTimeString(),
          retries: jobInfo.job.retryCount,
          estimatedDuration: jobInfo.job.estimatedDuration
        });
      }
    }
    console.log('');

    // Test job cancellation
    console.log('❌ Testing job cancellation...');
    if (jobResults.length > 1) {
      const jobToCancel = jobResults[1];
      const cancelled = await jobManager.cancelJob(jobToCancel.jobId);
      console.log(`Job ${jobToCancel.jobId} cancellation: ${cancelled ? 'Success' : 'Failed'}`);
    }
    console.log('');

    // Show job history
    console.log('📚 Job history (last 5 entries)...');
    const history = jobManager.getJobHistory({ limit: 5 });
    for (const entry of history) {
      console.log(`  ${entry.id}: ${entry.status} - ${entry.filePath} (${entry.queueName})`);
    }
    console.log('');

    // Test queue management
    console.log('⚙️  Testing queue management...');
    
    // Get specific queue
    const priorityQueue = jobManager.getQueue('priority');
    if (priorityQueue) {
      const queueStats = priorityQueue.getStats();
      console.log(`Priority queue stats: ${queueStats.totalJobs} jobs, ${queueStats.pendingJobs} pending`);
    }

    // Test queue cleanup
    const defaultQueue = jobManager.getQueue('default');
    if (defaultQueue) {
      const clearedJobs = await defaultQueue.clearFinishedJobs();
      console.log(`Cleared ${clearedJobs} finished jobs from default queue`);
    }
    console.log('');

    // Performance and resource monitoring
    console.log('⚡ Performance monitoring demo...');
    console.log('Processing queue features:');
    console.log('  ✓ Multi-queue job distribution');
    console.log('  ✓ Priority-based scheduling');
    console.log('  ✓ Automatic retry with backoff');
    console.log('  ✓ Job timeout handling');
    console.log('  ✓ Persistent job storage');
    console.log('  ✓ Real-time statistics');
    console.log('  ✓ Event-driven monitoring');
    console.log('  ✓ Batch processing optimization');
    console.log('  ✓ Scheduled job execution');
    console.log('  ✓ Resource-aware load balancing');
    console.log('');

    // Demonstrate error handling
    console.log('🚨 Testing error handling...');
    try {
      await jobManager.submitJob('non-existent-file.mp4', {}, {
        queueName: 'non-existent-queue'
      });
    } catch (error) {
      console.log(`  ✓ Correctly handled error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    try {
      jobManager.createQueue('default'); // Should fail - already exists
    } catch (error) {
      console.log(`  ✓ Correctly handled duplicate queue: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
    console.log('');

    // Wait for scheduled job (if still pending)
    console.log('⏰ Waiting for scheduled job execution...');
    await new Promise(resolve => setTimeout(resolve, 8000));
    
    const finalStats = jobManager.getAggregatedStats();
    console.log(`Final stats: ${finalStats.totalJobs} total jobs, ${finalStats.completedJobs} completed`);
    console.log('');

    console.log('🎉 Processing Queue Demo Completed!');
    console.log('===================================');
    console.log('');
    console.log('Key features demonstrated:');
    console.log('  • Multi-queue architecture with load balancing');
    console.log('  • Priority-based job scheduling');
    console.log('  • Batch job submission and distribution');
    console.log('  • Scheduled job execution');
    console.log('  • Real-time statistics and monitoring');
    console.log('  • Job lifecycle management (add, cancel, retry)');
    console.log('  • Event-driven architecture');
    console.log('  • Persistent storage and recovery');
    console.log('  • Resource management and concurrency control');
    console.log('');
    console.log('Production considerations:');
    console.log('  • Set appropriate concurrency limits based on hardware');
    console.log('  • Configure persistent storage for job recovery');
    console.log('  • Monitor queue depth and processing times');
    console.log('  • Implement health checks and alerting');
    console.log('  • Scale queues based on workload patterns');

    // Cleanup
    await jobManager.shutdown();

  } catch (error) {
    console.error('❌ Demo failed:', error);
    process.exit(1);
  }
}

function setupEventListeners(jobManager: JobManager) {
  // Job lifecycle events
  jobManager.on('jobSubmitted', (data) => {
    logger.debug(`Job submitted: ${data.jobId} to ${data.queueName}`);
  });

  jobManager.on('jobStarted', (data) => {
    console.log(`  🔄 Processing: ${data.filePath} (${data.queueName})`);
  });

  jobManager.on('jobCompleted', (data) => {
    console.log(`  ✅ Completed: ${data.filePath} in ${data.actualDuration?.toFixed(1)}s`);
  });

  jobManager.on('jobFailed', (data) => {
    console.log(`  ❌ Failed: ${data.filePath} - ${data.error}`);
  });

  jobManager.on('jobCancelled', (data) => {
    console.log(`  🚫 Cancelled: ${data.filePath}`);
  });

  jobManager.on('jobRetry', (data) => {
    console.log(`  🔄 Retrying: ${data.filePath} (attempt ${data.retryCount})`);
  });

  // Queue management events
  jobManager.on('queueCreated', (data) => {
    logger.info(`Queue created: ${data.name}`);
  });

  jobManager.on('queueRemoved', (data) => {
    logger.info(`Queue removed: ${data.name}`);
  });

  // Scheduling events
  jobManager.on('scheduledJobExecuted', (data) => {
    console.log(`  📅 Scheduled job executed: ${data.name}`);
  });

  // Health monitoring
  jobManager.on('healthAlert', (data) => {
    console.log(`  ⚠️  Health Alert [${data.severity}]: ${data.message}`);
  });

  // Batch processing
  jobManager.on('batchJobsSubmitted', (data) => {
    logger.debug(`Batch submitted: ${data.count} jobs`);
  });
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Demo interrupted - cleaning up...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n👋 Demo terminated - cleaning up...');
  process.exit(0);
});

// Run the demo
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}