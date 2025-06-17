import { logger } from '../../utils/logger.js';
import { PerformanceMonitor } from '../platforms/PerformanceMonitor.js';

export interface BatchProcessingOptions {
  batchSize?: number;
  concurrentBatches?: number;
  retryAttempts?: number;
  retryDelayMs?: number;
  progressCallback?: (progress: BatchProgress) => void;
  memoryLimitMB?: number;
  timeoutMs?: number;
}

export interface BatchProgress {
  totalItems: number;
  processedItems: number;
  successfulItems: number;
  failedItems: number;
  currentBatch: number;
  totalBatches: number;
  percentage: number;
  averageTimePerItem: number;
  estimatedTimeRemaining: number;
}

export interface BatchResult<T> {
  successful: T[];
  failed: Array<{
    item: any;
    error: string;
    attempts: number;
  }>;
  metrics: BatchMetrics;
}

export interface BatchMetrics {
  totalProcessingTime: number;
  averageItemTime: number;
  throughputPerSecond: number;
  memoryUsage: {
    peak: number;
    average: number;
    final: number;
  };
  batchBreakdown: Array<{
    batchIndex: number;
    itemCount: number;
    processingTime: number;
    successRate: number;
  }>;
}

/**
 * High-performance batch processor for handling large volumes of video content
 * Implements memory management, concurrency control, and retry logic
 */
export class BatchProcessor<TInput, TOutput> {
  private performanceMonitor: PerformanceMonitor;
  private memoryTracking: number[] = [];

  constructor() {
    this.performanceMonitor = new PerformanceMonitor();
  }

  /**
   * Process items in optimized batches with performance monitoring
   */
  async processBatch(
    items: TInput[],
    processor: (item: TInput) => Promise<TOutput>,
    options: BatchProcessingOptions = {}
  ): Promise<BatchResult<TOutput>> {
    const opts = this.getDefaultOptions(options);
    const operationId = `batch-process-${Date.now()}`;
    
    logger.info(`Starting batch processing: ${items.length} items in batches of ${opts.batchSize}`);
    
    this.performanceMonitor.startOperation(operationId);
    const startTime = Date.now();

    const result: BatchResult<TOutput> = {
      successful: [],
      failed: [],
      metrics: {
        totalProcessingTime: 0,
        averageItemTime: 0,
        throughputPerSecond: 0,
        memoryUsage: { peak: 0, average: 0, final: 0 },
        batchBreakdown: []
      }
    };

    try {
      // Split into batches
      const batches = this.createBatches(items, opts.batchSize);
      
      const progress: BatchProgress = {
        totalItems: items.length,
        processedItems: 0,
        successfulItems: 0,
        failedItems: 0,
        currentBatch: 0,
        totalBatches: batches.length,
        percentage: 0,
        averageTimePerItem: 0,
        estimatedTimeRemaining: 0
      };

      // Process batches with concurrency control
      const semaphore = new Semaphore(opts.concurrentBatches);
      const batchPromises = batches.map(async (batch, batchIndex) => {
        await semaphore.acquire();
        
        try {
          return await this.processSingleBatch(
            batch,
            batchIndex,
            processor,
            opts,
            progress,
            result
          );
        } finally {
          semaphore.release();
        }
      });

      // Wait for all batches to complete
      const batchResults = await Promise.allSettled(batchPromises);
      
      // Process batch results
      for (let i = 0; i < batchResults.length; i++) {
        const batchResult = batchResults[i];
        
        if (batchResult.status === 'fulfilled') {
          result.successful.push(...batchResult.value.successful);
          result.failed.push(...batchResult.value.failed);
        } else {
          logger.error(`Batch ${i} failed completely:`, batchResult.reason);
          // Add all items from failed batch to failed results
          batches[i].forEach(item => {
            result.failed.push({
              item,
              error: batchResult.reason.message || 'Batch processing failed',
              attempts: 1
            });
          });
        }
      }

      // Calculate final metrics
      result.metrics = this.calculateMetrics(startTime, items.length, result);

      logger.info(`Batch processing completed: ${result.successful.length}/${items.length} successful`);
      
      this.performanceMonitor.endOperation(operationId, 'batch-process', true);

      return result;

    } catch (error) {
      logger.error('Batch processing failed:', error);
      this.performanceMonitor.endOperation(operationId, 'batch-process', false);
      throw error;
    }
  }

  /**
   * Process multiple video files with optimized resource management
   */
  async processVideosBatch(
    videoPaths: string[],
    processor: (videoPath: string) => Promise<any>,
    options: BatchProcessingOptions & {
      cleanupTempFiles?: boolean;
      maxConcurrentFFmpeg?: number;
    } = {}
  ): Promise<BatchResult<any>> {
    const opts = {
      batchSize: 3, // Smaller batches for video processing
      concurrentBatches: 2, // Limited concurrency for FFmpeg
      memoryLimitMB: 2048, // 2GB memory limit
      cleanupTempFiles: true,
      maxConcurrentFFmpeg: 2,
      ...options
    };

    logger.info(`Starting video batch processing: ${videoPaths.length} videos`);

    // Enhanced processor with resource management
    const videoProcessor = async (videoPath: string) => {
      const itemStartTime = Date.now();
      
      try {
        // Monitor memory before processing
        this.trackMemoryUsage();
        
        // Check memory limit
        if (this.getCurrentMemoryUsage() > opts.memoryLimitMB * 1024 * 1024) {
          logger.warn('Memory limit approaching, forcing garbage collection');
          if (global.gc) {
            global.gc();
          }
          await this.waitForMemoryToStabilize();
        }

        const result = await processor(videoPath);
        
        // Track processing time
        const processingTime = Date.now() - itemStartTime;
        this.performanceMonitor.recordMetric({
          name: 'video.processing.duration',
          value: processingTime,
          unit: 'ms',
          timestamp: new Date(),
          tags: { videoPath: videoPath.split('/').pop() || 'unknown' }
        });

        return result;

      } catch (error) {
        logger.error(`Video processing failed for ${videoPath}:`, error);
        throw error;
      }
    };

    return await this.processBatch(videoPaths, videoProcessor, opts);
  }

  /**
   * Process search indexing in batches for large content volumes
   */
  async processSearchIndexingBatch(
    contentItems: Array<{
      id: string;
      content: string;
      contentType: 'chunk' | 'memory' | 'frame';
    }>,
    indexer: (item: any) => Promise<boolean>,
    options: BatchProcessingOptions = {}
  ): Promise<BatchResult<boolean>> {
    const opts = {
      batchSize: 50, // Larger batches for indexing
      concurrentBatches: 4, // Higher concurrency for I/O operations
      ...options
    };

    logger.info(`Starting search indexing batch: ${contentItems.length} items`);

    const indexProcessor = async (item: any) => {
      try {
        return await indexer(item);
      } catch (error) {
        logger.warn(`Indexing failed for ${item.id}:`, error);
        return false;
      }
    };

    return await this.processBatch(contentItems, indexProcessor, opts) as BatchResult<boolean>;
  }

  // Private helper methods

  private async processSingleBatch<TInput, TOutput>(
    batch: TInput[],
    batchIndex: number,
    processor: (item: TInput) => Promise<TOutput>,
    options: Required<BatchProcessingOptions>,
    progress: BatchProgress,
    result: BatchResult<TOutput>
  ): Promise<{ successful: TOutput[]; failed: Array<{ item: TInput; error: string; attempts: number }> }> {
    const batchStartTime = Date.now();
    const batchResult = { successful: [] as TOutput[], failed: [] as Array<{ item: TInput; error: string; attempts: number }> };

    logger.debug(`Processing batch ${batchIndex + 1}: ${batch.length} items`);

    for (const item of batch) {
      let attempts = 0;
      let lastError = '';

      while (attempts < options.retryAttempts) {
        try {
          const processedItem = await this.processWithTimeout(
            () => processor(item),
            options.timeoutMs
          );
          
          batchResult.successful.push(processedItem);
          progress.successfulItems++;
          break;

        } catch (error) {
          attempts++;
          lastError = error instanceof Error ? error.message : 'Unknown error';
          
          if (attempts < options.retryAttempts) {
            logger.debug(`Retrying item (attempt ${attempts + 1}/${options.retryAttempts}): ${lastError}`);
            await this.delay(options.retryDelayMs);
          } else {
            batchResult.failed.push({ item, error: lastError, attempts });
            progress.failedItems++;
          }
        }
      }

      progress.processedItems++;
      progress.percentage = (progress.processedItems / progress.totalItems) * 100;
      
      // Update time estimates
      const elapsedTime = Date.now() - batchStartTime;
      progress.averageTimePerItem = elapsedTime / progress.processedItems;
      progress.estimatedTimeRemaining = 
        (progress.totalItems - progress.processedItems) * progress.averageTimePerItem;

      if (options.progressCallback) {
        options.progressCallback(progress);
      }
    }

    // Record batch metrics
    const batchTime = Date.now() - batchStartTime;
    result.metrics.batchBreakdown.push({
      batchIndex,
      itemCount: batch.length,
      processingTime: batchTime,
      successRate: batchResult.successful.length / batch.length
    });

    return batchResult;
  }

  private async processWithTimeout<T>(
    processor: () => Promise<T>,
    timeoutMs: number
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Processing timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      processor()
        .then(result => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch(error => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  private createBatches<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    return batches;
  }

  private calculateMetrics(
    startTime: number,
    totalItems: number,
    result: BatchResult<any>
  ): BatchMetrics {
    const totalTime = Date.now() - startTime;
    const successfulItems = result.successful.length;

    // Ensure we have memory tracking data
    if (this.memoryTracking.length === 0) {
      this.memoryTracking.push(this.getCurrentMemoryUsage());
    }

    return {
      totalProcessingTime: totalTime,
      averageItemTime: totalTime / totalItems,
      throughputPerSecond: (successfulItems / totalTime) * 1000,
      memoryUsage: {
        peak: Math.max(...this.memoryTracking),
        average: this.memoryTracking.reduce((a, b) => a + b, 0) / this.memoryTracking.length,
        final: this.getCurrentMemoryUsage()
      },
      batchBreakdown: result.metrics.batchBreakdown
    };
  }

  private trackMemoryUsage(): void {
    this.memoryTracking.push(this.getCurrentMemoryUsage());
  }

  private getCurrentMemoryUsage(): number {
    if (typeof process !== 'undefined' && process.memoryUsage) {
      return process.memoryUsage().heapUsed;
    }
    return 0;
  }

  private async waitForMemoryToStabilize(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 1000));
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private getDefaultOptions(options: BatchProcessingOptions): Required<BatchProcessingOptions> {
    return {
      batchSize: 10,
      concurrentBatches: 3,
      retryAttempts: 3,
      retryDelayMs: 1000,
      progressCallback: () => {},
      memoryLimitMB: 1024, // 1GB default
      timeoutMs: 300000, // 5 minutes
      ...options
    };
  }
}

/**
 * Simple semaphore for controlling concurrency
 */
class Semaphore {
  private permits: number;
  private waiting: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }

    return new Promise(resolve => {
      this.waiting.push(resolve);
    });
  }

  release(): void {
    this.permits++;
    const next = this.waiting.shift();
    if (next) {
      this.permits--;
      next();
    }
  }
}