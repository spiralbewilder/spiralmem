import { logger } from '../../utils/logger.js';
import { BatchProcessor } from './BatchProcessor.js';
import { VideoWorkflow } from '../workflow/VideoWorkflow.js';
import { VectorSearchEngine } from '../search/VectorSearchEngine.js';
import { database } from '../database/connection.js';
import { PerformanceMonitor } from '../platforms/PerformanceMonitor.js';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface ScaleTestConfig {
  videoCount: number;
  concurrentProcessing: number;
  searchQueryCount: number;
  testDuration?: number; // ms
  memoryLimitMB?: number;
  generateTestData?: boolean;
  cleanupAfterTest?: boolean;
}

export interface ScaleTestResult {
  config: ScaleTestConfig;
  videoProcessing: {
    totalVideos: number;
    successfullyProcessed: number;
    failedProcessing: number;
    averageProcessingTime: number;
    throughputPerHour: number;
    peakMemoryUsage: number;
  };
  searchPerformance: {
    totalQueries: number;
    averageSearchTime: number;
    searchThroughput: number;
    indexSize: number;
    cacheHitRate: number;
  };
  systemMetrics: {
    cpuUsage: number[];
    memoryUsage: number[];
    diskIO: number[];
    databaseConnections: number;
  };
  bottlenecks: string[];
  recommendations: string[];
}

/**
 * Comprehensive scale testing for the spiralmem video processing pipeline
 * Tests performance under various load conditions and identifies bottlenecks
 */
export class ScaleTestRunner {
  private batchProcessor: BatchProcessor<string, any>;
  private videoWorkflow: VideoWorkflow;
  private searchEngine: VectorSearchEngine;
  private performanceMonitor: PerformanceMonitor;
  private testDataDir: string;

  constructor() {
    this.batchProcessor = new BatchProcessor();
    this.videoWorkflow = new VideoWorkflow();
    this.searchEngine = new VectorSearchEngine();
    this.performanceMonitor = new PerformanceMonitor();
    this.testDataDir = path.join(process.cwd(), 'test-data', 'scale-test');
  }

  /**
   * Run comprehensive scale tests
   */
  async runScaleTest(config: ScaleTestConfig): Promise<ScaleTestResult> {
    logger.info('🚀 Starting spiralmem scale test');
    logger.info(`Config: ${config.videoCount} videos, ${config.concurrentProcessing} concurrent`);

    const testId = `scale-test-${Date.now()}`;
    this.performanceMonitor.startOperation(testId);

    try {
      // Initialize test environment
      await this.initializeTestEnvironment(config);

      const result: ScaleTestResult = {
        config,
        videoProcessing: {
          totalVideos: 0,
          successfullyProcessed: 0,
          failedProcessing: 0,
          averageProcessingTime: 0,
          throughputPerHour: 0,
          peakMemoryUsage: 0
        },
        searchPerformance: {
          totalQueries: 0,
          averageSearchTime: 0,
          searchThroughput: 0,
          indexSize: 0,
          cacheHitRate: 0
        },
        systemMetrics: {
          cpuUsage: [],
          memoryUsage: [],
          diskIO: [],
          databaseConnections: 0
        },
        bottlenecks: [],
        recommendations: []
      };

      // Phase 1: Video Processing Performance Test
      logger.info('📹 Phase 1: Video Processing Performance Test');
      const videoResults = await this.testVideoProcessingScale(config);
      result.videoProcessing = videoResults;

      // Phase 2: Search Performance Test
      logger.info('🔍 Phase 2: Search Performance Test');
      const searchResults = await this.testSearchPerformance(config);
      result.searchPerformance = searchResults;

      // Phase 3: Concurrent Load Test
      logger.info('⚡ Phase 3: Concurrent Load Test');
      const concurrentResults = await this.testConcurrentLoad(config);
      
      // Phase 4: Memory Stress Test
      logger.info('🧠 Phase 4: Memory Stress Test');
      const memoryResults = await this.testMemoryUsage(config);

      // Analyze results and generate recommendations
      result.systemMetrics = await this.collectSystemMetrics();
      result.bottlenecks = this.identifyBottlenecks(result);
      result.recommendations = this.generateRecommendations(result);

      // Cleanup if requested
      if (config.cleanupAfterTest) {
        await this.cleanup();
      }

      this.performanceMonitor.endOperation(testId, 'scale-test', true);
      logger.info('✅ Scale test completed successfully');

      return result;

    } catch (error) {
      logger.error('❌ Scale test failed:', error);
      this.performanceMonitor.endOperation(testId, 'scale-test', false);
      throw error;
    }
  }

  /**
   * Test video processing performance with various batch sizes
   */
  private async testVideoProcessingScale(config: ScaleTestConfig) {
    logger.info(`Testing video processing with ${config.videoCount} videos`);

    const testVideos = await this.prepareTestVideos(config.videoCount);
    const startTime = Date.now();

    const batchResult = await this.batchProcessor.processVideosBatch(
      testVideos,
      async (videoPath: string) => {
        return await this.videoWorkflow.processVideo(videoPath, 'scale-test', {
          enableFrameSampling: false, // Disable to focus on core processing
          chunkingOptions: {
            chunkSize: 1000, // Smaller chunks for faster processing
            overlapSize: 100
          }
        });
      },
      {
        batchSize: Math.min(5, config.concurrentProcessing),
        concurrentBatches: config.concurrentProcessing,
        memoryLimitMB: config.memoryLimitMB,
        progressCallback: (progress) => {
          if (progress.processedItems % 10 === 0) {
            logger.info(`Video processing progress: ${progress.percentage.toFixed(1)}% (${progress.processedItems}/${progress.totalItems})`);
          }
        }
      }
    );

    const totalTime = Date.now() - startTime;

    return {
      totalVideos: testVideos.length,
      successfullyProcessed: batchResult.successful.length,
      failedProcessing: batchResult.failed.length,
      averageProcessingTime: batchResult.metrics.averageItemTime,
      throughputPerHour: (batchResult.successful.length / totalTime) * 3600000,
      peakMemoryUsage: batchResult.metrics.memoryUsage.peak
    };
  }

  /**
   * Test search performance with various query loads
   */
  private async testSearchPerformance(config: ScaleTestConfig) {
    logger.info(`Testing search performance with ${config.searchQueryCount} queries`);

    const testQueries = this.generateTestQueries(config.searchQueryCount);
    const searchTimes: number[] = [];

    const startTime = Date.now();

    for (const query of testQueries) {
      const queryStart = Date.now();
      
      try {
        await this.searchEngine.search(query, {
          maxResults: 20,
          similarityThreshold: 0.7
        });
        
        const queryTime = Date.now() - queryStart;
        searchTimes.push(queryTime);

      } catch (error) {
        logger.warn(`Search query failed: ${query}`, error);
      }
    }

    const totalSearchTime = Date.now() - startTime;
    const indexStats = await this.searchEngine.getIndexStats();

    return {
      totalQueries: testQueries.length,
      averageSearchTime: searchTimes.reduce((a, b) => a + b, 0) / searchTimes.length,
      searchThroughput: (testQueries.length / totalSearchTime) * 1000,
      indexSize: indexStats.totalEmbeddings,
      cacheHitRate: 0 // Would need cache implementation to measure
    };
  }

  /**
   * Test concurrent processing under load
   */
  private async testConcurrentLoad(config: ScaleTestConfig) {
    logger.info('Testing concurrent load handling');

    const concurrentTasks = [];
    const taskCount = Math.min(config.concurrentProcessing * 2, 20);

    // Simulate concurrent video processing and search operations
    for (let i = 0; i < taskCount; i++) {
      if (i % 2 === 0) {
        // Video processing task
        concurrentTasks.push(this.simulateVideoProcessing());
      } else {
        // Search task
        concurrentTasks.push(this.simulateSearchLoad());
      }
    }

    const startTime = Date.now();
    const results = await Promise.allSettled(concurrentTasks);
    const endTime = Date.now();

    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    logger.info(`Concurrent load test: ${successful}/${taskCount} tasks completed in ${endTime - startTime}ms`);

    return {
      totalTasks: taskCount,
      successfulTasks: successful,
      failedTasks: failed,
      totalTime: endTime - startTime
    };
  }

  /**
   * Test memory usage patterns
   */
  private async testMemoryUsage(config: ScaleTestConfig) {
    logger.info('Testing memory usage patterns');

    const memorySnapshots: number[] = [];
    const interval = setInterval(() => {
      memorySnapshots.push(this.getCurrentMemoryUsage());
    }, 1000);

    try {
      // Process a batch of videos while monitoring memory
      const testVideos = await this.prepareTestVideos(Math.min(10, config.videoCount));
      
      await this.batchProcessor.processVideosBatch(
        testVideos,
        async (videoPath: string) => {
          return await this.videoWorkflow.processVideo(videoPath, 'memory-test');
        },
        {
          batchSize: 2,
          concurrentBatches: 1, // Single batch to isolate memory usage
          memoryLimitMB: config.memoryLimitMB
        }
      );

    } finally {
      clearInterval(interval);
    }

    return {
      peakMemory: Math.max(...memorySnapshots),
      averageMemory: memorySnapshots.reduce((a, b) => a + b, 0) / memorySnapshots.length,
      memoryGrowth: memorySnapshots[memorySnapshots.length - 1] - memorySnapshots[0],
      snapshots: memorySnapshots
    };
  }

  // Helper methods

  private async initializeTestEnvironment(config: ScaleTestConfig): Promise<void> {
    await database.initialize();
    
    if (config.generateTestData) {
      await this.generateTestData(config);
    }
  }

  private async prepareTestVideos(count: number): Promise<string[]> {
    // For scale testing, we'll create dummy video file paths
    // In a real environment, these would be actual video files
    const videos: string[] = [];
    
    for (let i = 0; i < count; i++) {
      videos.push(`/test-data/video-${i.toString().padStart(3, '0')}.mp4`);
    }

    return videos;
  }

  private generateTestQueries(count: number): string[] {
    const baseQueries = [
      'tutorial programming',
      'javascript typescript',
      'video processing',
      'machine learning',
      'database design',
      'web development',
      'API REST GraphQL',
      'performance optimization',
      'user interface',
      'data structures'
    ];

    const queries: string[] = [];
    for (let i = 0; i < count; i++) {
      const baseQuery = baseQueries[i % baseQueries.length];
      queries.push(`${baseQuery} ${i}`);
    }

    return queries;
  }

  private async simulateVideoProcessing(): Promise<void> {
    // Simulate video processing load
    await new Promise(resolve => setTimeout(resolve, Math.random() * 2000 + 1000));
  }

  private async simulateSearchLoad(): Promise<void> {
    const query = `test query ${Math.random()}`;
    await this.searchEngine.search(query, { maxResults: 10 });
  }

  private getCurrentMemoryUsage(): number {
    if (typeof process !== 'undefined' && process.memoryUsage) {
      return process.memoryUsage().heapUsed;
    }
    return 0;
  }

  private async collectSystemMetrics() {
    const memoryUsage = this.getCurrentMemoryUsage();
    
    return {
      cpuUsage: [0], // Would need OS-level monitoring
      memoryUsage: [memoryUsage],
      diskIO: [0], // Would need OS-level monitoring  
      databaseConnections: 1 // SQLite uses single connection
    };
  }

  private identifyBottlenecks(result: ScaleTestResult): string[] {
    const bottlenecks: string[] = [];

    // Check processing throughput
    if (result.videoProcessing.throughputPerHour < 10) {
      bottlenecks.push('Low video processing throughput - consider increasing batch size or concurrency');
    }

    // Check memory usage
    if (result.videoProcessing.peakMemoryUsage > 1024 * 1024 * 1024) { // 1GB
      bottlenecks.push('High memory usage detected - implement memory optimization');
    }

    // Check search performance
    if (result.searchPerformance.averageSearchTime > 1000) { // 1 second
      bottlenecks.push('Slow search performance - consider search index optimization');
    }

    // Check failure rates
    const failureRate = result.videoProcessing.failedProcessing / result.videoProcessing.totalVideos;
    if (failureRate > 0.1) { // 10%
      bottlenecks.push('High failure rate - improve error handling and retry logic');
    }

    return bottlenecks;
  }

  private generateRecommendations(result: ScaleTestResult): string[] {
    const recommendations: string[] = [];

    // Performance recommendations
    if (result.videoProcessing.averageProcessingTime > 30000) { // 30 seconds
      recommendations.push('Consider implementing video preprocessing pipeline for faster processing');
    }

    if (result.searchPerformance.indexSize > 10000) {
      recommendations.push('Implement search result caching for frequently accessed queries');
    }

    // Resource recommendations
    if (result.videoProcessing.peakMemoryUsage > 512 * 1024 * 1024) { // 512MB
      recommendations.push('Implement streaming processing for large video files');
    }

    // Scaling recommendations
    if (result.videoProcessing.throughputPerHour < 50) {
      recommendations.push('Consider horizontal scaling with worker processes');
    }

    return recommendations;
  }

  private async generateTestData(config: ScaleTestConfig): Promise<void> {
    // Create test data directory
    await fs.mkdir(this.testDataDir, { recursive: true });
    
    logger.info(`Generated test environment in ${this.testDataDir}`);
  }

  private async cleanup(): Promise<void> {
    try {
      await fs.rm(this.testDataDir, { recursive: true, force: true });
      logger.info('Test environment cleaned up');
    } catch (error) {
      logger.warn('Cleanup failed:', error);
    }
  }
}