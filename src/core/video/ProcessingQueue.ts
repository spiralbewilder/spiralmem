import { EventEmitter } from 'events';
import fs from 'fs/promises';
import path from 'path';
import { logger } from '../../utils/logger.js';
import { PerformanceMonitor } from '../platforms/PerformanceMonitor.js';
import { VideoProcessor, VideoProcessingOptions, VideoProcessingResult } from './VideoProcessor.js';

export interface ProcessingJob {
  id: string;
  filePath: string;
  options: VideoProcessingOptions;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  retryCount: number;
  maxRetries: number;
  estimatedDuration?: number; // seconds
  actualDuration?: number; // seconds
  result?: VideoProcessingResult;
  error?: string;
  metadata?: Record<string, any>;
}

export interface QueueStats {
  totalJobs: number;
  pendingJobs: number;
  processingJobs: number;
  completedJobs: number;
  failedJobs: number;
  cancelledJobs: number;
  averageProcessingTime: number;
  throughputPerHour: number;
  queueDepth: number;
  estimatedWaitTime: number; // seconds
}

export interface ProcessingQueueOptions {
  maxConcurrentJobs?: number;
  maxRetries?: number;
  retryDelay?: number; // milliseconds
  jobTimeout?: number; // milliseconds
  persistentStorage?: boolean;
  storageDirectory?: string;
  priorityMode?: 'fifo' | 'priority' | 'shortest-first';
  autoStart?: boolean;
}

/**
 * Processing queue system for video processing jobs
 * Handles job scheduling, concurrency control, and retry logic
 */
export class ProcessingQueue extends EventEmitter {
  private static readonly DEFAULT_MAX_CONCURRENT = 2;
  private static readonly DEFAULT_MAX_RETRIES = 3;
  private static readonly DEFAULT_RETRY_DELAY = 5000;
  private static readonly DEFAULT_JOB_TIMEOUT = 3600000; // 1 hour

  private jobs: Map<string, ProcessingJob> = new Map();
  private activeJobs: Set<string> = new Set();
  private processor: VideoProcessor;
  private performanceMonitor: PerformanceMonitor;
  private options: Required<ProcessingQueueOptions>;
  private isRunning: boolean = false;
  private processingLoop?: NodeJS.Timeout;
  private statsHistory: QueueStats[] = [];

  constructor(options: ProcessingQueueOptions = {}) {
    super();
    
    this.options = {
      maxConcurrentJobs: options.maxConcurrentJobs || ProcessingQueue.DEFAULT_MAX_CONCURRENT,
      maxRetries: options.maxRetries || ProcessingQueue.DEFAULT_MAX_RETRIES,
      retryDelay: options.retryDelay || ProcessingQueue.DEFAULT_RETRY_DELAY,
      jobTimeout: options.jobTimeout || ProcessingQueue.DEFAULT_JOB_TIMEOUT,
      persistentStorage: options.persistentStorage ?? true,
      storageDirectory: options.storageDirectory || './temp/queue',
      priorityMode: options.priorityMode || 'priority',
      autoStart: options.autoStart ?? true
    };

    this.processor = new VideoProcessor();
    this.performanceMonitor = new PerformanceMonitor();

    if (this.options.autoStart) {
      this.start();
    }
  }

  /**
   * Add a job to the processing queue
   */
  async addJob(
    filePath: string,
    options: VideoProcessingOptions = {},
    jobOptions: {
      priority?: ProcessingJob['priority'];
      maxRetries?: number;
      metadata?: Record<string, any>;
    } = {}
  ): Promise<string> {
    const jobId = this.generateJobId();
    
    const job: ProcessingJob = {
      id: jobId,
      filePath,
      options,
      priority: jobOptions.priority || 'normal',
      status: 'pending',
      createdAt: new Date(),
      retryCount: 0,
      maxRetries: jobOptions.maxRetries ?? this.options.maxRetries,
      metadata: jobOptions.metadata
    };

    // Estimate duration based on file size and historical data
    try {
      job.estimatedDuration = await this.estimateProcessingDuration(filePath);
    } catch (error) {
      logger.warn(`Could not estimate duration for ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    this.jobs.set(jobId, job);
    
    if (this.options.persistentStorage) {
      await this.persistJob(job);
    }

    logger.info(`Job ${jobId} added to queue: ${path.basename(filePath)} (priority: ${job.priority})`);
    
    this.emit('jobAdded', job);
    this.updateStats();

    return jobId;
  }

  /**
   * Add multiple jobs to the queue
   */
  async addBatchJobs(
    filePaths: string[],
    options: VideoProcessingOptions = {},
    jobOptions: {
      priority?: ProcessingJob['priority'];
      maxRetries?: number;
      metadata?: Record<string, any>;
    } = {}
  ): Promise<string[]> {
    const jobIds: string[] = [];
    
    logger.info(`Adding batch of ${filePaths.length} jobs to queue`);
    
    for (const filePath of filePaths) {
      try {
        const jobId = await this.addJob(filePath, options, jobOptions);
        jobIds.push(jobId);
      } catch (error) {
        logger.error(`Failed to add job for ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    return jobIds;
  }

  /**
   * Cancel a job
   */
  async cancelJob(jobId: string): Promise<boolean> {
    const job = this.jobs.get(jobId);
    if (!job) {
      return false;
    }

    if (job.status === 'processing') {
      // Job is currently processing, mark for cancellation
      job.status = 'cancelled';
      this.activeJobs.delete(jobId);
      logger.info(`Job ${jobId} marked for cancellation`);
    } else if (job.status === 'pending') {
      // Job hasn't started, can cancel immediately
      job.status = 'cancelled';
      job.completedAt = new Date();
      logger.info(`Job ${jobId} cancelled`);
    } else {
      return false; // Already completed or failed
    }

    if (this.options.persistentStorage) {
      await this.persistJob(job);
    }

    this.emit('jobCancelled', job);
    this.updateStats();
    return true;
  }

  /**
   * Get job status
   */
  getJob(jobId: string): ProcessingJob | undefined {
    return this.jobs.get(jobId);
  }

  /**
   * Get all jobs with optional filtering
   */
  getJobs(filter?: {
    status?: ProcessingJob['status'];
    priority?: ProcessingJob['priority'];
    limit?: number;
  }): ProcessingJob[] {
    let jobs = Array.from(this.jobs.values());

    if (filter?.status) {
      jobs = jobs.filter(job => job.status === filter.status);
    }

    if (filter?.priority) {
      jobs = jobs.filter(job => job.priority === filter.priority);
    }

    if (filter?.limit) {
      jobs = jobs.slice(0, filter.limit);
    }

    return jobs.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * Get queue statistics
   */
  getStats(): QueueStats {
    const jobs = Array.from(this.jobs.values());
    const completedJobs = jobs.filter(j => j.status === 'completed');
    const processingTimes = completedJobs
      .map(j => j.actualDuration)
      .filter(d => d !== undefined) as number[];

    const now = Date.now();
    const hourAgo = now - (60 * 60 * 1000);
    const recentCompletedJobs = completedJobs.filter(j => 
      j.completedAt && j.completedAt.getTime() > hourAgo
    );

    const pendingJobs = jobs.filter(j => j.status === 'pending');
    const averageProcessingTime = processingTimes.length > 0 
      ? processingTimes.reduce((sum, time) => sum + time, 0) / processingTimes.length 
      : 0;
    const estimatedWaitTime = this.calculateEstimatedWaitTime(pendingJobs, averageProcessingTime);

    const stats: QueueStats = {
      totalJobs: jobs.length,
      pendingJobs: jobs.filter(j => j.status === 'pending').length,
      processingJobs: jobs.filter(j => j.status === 'processing').length,
      completedJobs: jobs.filter(j => j.status === 'completed').length,
      failedJobs: jobs.filter(j => j.status === 'failed').length,
      cancelledJobs: jobs.filter(j => j.status === 'cancelled').length,
      averageProcessingTime,
      throughputPerHour: recentCompletedJobs.length,
      queueDepth: pendingJobs.length,
      estimatedWaitTime
    };

    return stats;
  }

  /**
   * Start the processing queue
   */
  start(): void {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    logger.info('Starting processing queue');
    
    this.processingLoop = setInterval(() => {
      this.processNextJobs();
    }, 1000);

    this.emit('queueStarted');
  }

  /**
   * Stop the processing queue
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    
    if (this.processingLoop) {
      clearInterval(this.processingLoop);
    }

    // Wait for active jobs to complete
    while (this.activeJobs.size > 0) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    logger.info('Processing queue stopped');
    this.emit('queueStopped');
  }

  /**
   * Clear completed and failed jobs
   */
  async clearFinishedJobs(): Promise<number> {
    const before = this.jobs.size;
    const finishedJobs = Array.from(this.jobs.values())
      .filter(job => ['completed', 'failed', 'cancelled'].includes(job.status));

    for (const job of finishedJobs) {
      this.jobs.delete(job.id);
      
      if (this.options.persistentStorage) {
        await this.removePersistedJob(job.id);
      }
    }

    const cleared = before - this.jobs.size;
    logger.info(`Cleared ${cleared} finished jobs from queue`);
    
    this.updateStats();
    return cleared;
  }

  /**
   * Load persisted jobs from storage
   */
  async loadPersistedJobs(): Promise<void> {
    if (!this.options.persistentStorage) {
      return;
    }

    try {
      const storageDir = this.options.storageDirectory;
      await fs.mkdir(storageDir, { recursive: true });
      
      const files = await fs.readdir(storageDir);
      const jobFiles = files.filter(f => f.endsWith('.json'));

      for (const file of jobFiles) {
        try {
          const filePath = path.join(storageDir, file);
          const content = await fs.readFile(filePath, 'utf-8');
          const job: ProcessingJob = JSON.parse(content);
          
          // Convert date strings back to Date objects
          job.createdAt = new Date(job.createdAt);
          if (job.startedAt) job.startedAt = new Date(job.startedAt);
          if (job.completedAt) job.completedAt = new Date(job.completedAt);
          
          // Reset processing jobs to pending on startup
          if (job.status === 'processing') {
            job.status = 'pending';
          }
          
          this.jobs.set(job.id, job);
        } catch (error) {
          logger.warn(`Failed to load job from ${file}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }

      logger.info(`Loaded ${this.jobs.size} persisted jobs`);
    } catch (error) {
      logger.error(`Failed to load persisted jobs: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Private methods

  private generateJobId(): string {
    return `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private async estimateProcessingDuration(filePath: string): Promise<number> {
    try {
      const stats = await fs.stat(filePath);
      const fileSizeMB = stats.size / (1024 * 1024);
      
      // Simple estimation: ~30 seconds per 100MB (varies greatly by hardware)
      const baseDuration = Math.max(30, fileSizeMB * 0.3);
      
      // Adjust based on historical data
      const historicalAvg = this.getStats().averageProcessingTime;
      if (historicalAvg > 0) {
        return (baseDuration + historicalAvg) / 2;
      }
      
      return baseDuration;
    } catch {
      return 300; // 5 minutes default
    }
  }

  private async processNextJobs(): Promise<void> {
    if (!this.isRunning || this.activeJobs.size >= this.options.maxConcurrentJobs) {
      return;
    }

    const nextJob = this.getNextJob();
    if (!nextJob) {
      return;
    }

    await this.processJob(nextJob);
  }

  private getNextJob(): ProcessingJob | undefined {
    const pendingJobs = Array.from(this.jobs.values())
      .filter(job => job.status === 'pending');

    if (pendingJobs.length === 0) {
      return undefined;
    }

    // Sort based on priority mode
    switch (this.options.priorityMode) {
      case 'priority':
        return this.sortByPriority(pendingJobs)[0];
      case 'shortest-first':
        return this.sortByEstimatedDuration(pendingJobs)[0];
      case 'fifo':
      default:
        return pendingJobs.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
    }
  }

  private sortByPriority(jobs: ProcessingJob[]): ProcessingJob[] {
    const priorityOrder = { urgent: 4, high: 3, normal: 2, low: 1 };
    return jobs.sort((a, b) => {
      const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
  }

  private sortByEstimatedDuration(jobs: ProcessingJob[]): ProcessingJob[] {
    return jobs.sort((a, b) => {
      const aDuration = a.estimatedDuration || 999999;
      const bDuration = b.estimatedDuration || 999999;
      return aDuration - bDuration;
    });
  }

  private async processJob(job: ProcessingJob): Promise<void> {
    job.status = 'processing';
    job.startedAt = new Date();
    this.activeJobs.add(job.id);

    if (this.options.persistentStorage) {
      await this.persistJob(job);
    }

    logger.info(`Starting job ${job.id}: ${path.basename(job.filePath)}`);
    this.emit('jobStarted', job);

    const startTime = Date.now();
    
    try {
      // Set up timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Job timed out after ${this.options.jobTimeout}ms`));
        }, this.options.jobTimeout);
      });

      // Process the video
      const processingPromise = this.processor.processVideo(job.filePath, job.options);
      
      const result = await Promise.race([processingPromise, timeoutPromise]);
      
      job.result = result;
      job.status = result.success ? 'completed' : 'failed';
      job.completedAt = new Date();
      job.actualDuration = (Date.now() - startTime) / 1000;

      if (!result.success) {
        job.error = result.errors.join('; ');
      }

      logger.info(`Job ${job.id} ${job.status} in ${job.actualDuration.toFixed(1)}s`);
      this.emit(job.status === 'completed' ? 'jobCompleted' : 'jobFailed', job);

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      job.error = errorMsg;
      job.actualDuration = (Date.now() - startTime) / 1000;

      // Check if we should retry
      if (job.retryCount < job.maxRetries && !['cancelled', 'completed', 'failed'].includes(job.status)) {
        job.retryCount++;
        job.status = 'pending';
        job.startedAt = undefined;
        
        logger.warn(`Job ${job.id} failed, scheduling retry ${job.retryCount}/${job.maxRetries}: ${errorMsg}`);
        
        // Schedule retry with delay
        setTimeout(() => {
          // Job might have been cancelled during delay
          if (job.status === 'pending') {
            this.emit('jobRetry', job);
          }
        }, this.options.retryDelay);

      } else {
        job.status = 'failed';
        job.completedAt = new Date();
        logger.error(`Job ${job.id} failed permanently: ${errorMsg}`);
        this.emit('jobFailed', job);
      }
    } finally {
      this.activeJobs.delete(job.id);
      
      if (this.options.persistentStorage) {
        await this.persistJob(job);
      }
      
      this.updateStats();
    }
  }

  private calculateEstimatedWaitTime(pendingJobs: ProcessingJob[], averageProcessingTime: number): number {
    if (pendingJobs.length === 0) return 0;

    const avgTime = averageProcessingTime || 300; // 5 min default
    const jobsAhead = Math.max(0, pendingJobs.length - this.options.maxConcurrentJobs);
    
    return (jobsAhead * avgTime) / this.options.maxConcurrentJobs;
  }

  private updateStats(): void {
    const stats = this.getStats();
    this.statsHistory.push(stats);
    
    // Keep last 100 stat snapshots
    if (this.statsHistory.length > 100) {
      this.statsHistory.shift();
    }

    this.emit('statsUpdated', stats);
  }

  private async persistJob(job: ProcessingJob): Promise<void> {
    try {
      const storageDir = this.options.storageDirectory;
      await fs.mkdir(storageDir, { recursive: true });
      
      const filePath = path.join(storageDir, `${job.id}.json`);
      await fs.writeFile(filePath, JSON.stringify(job, null, 2));
    } catch (error) {
      logger.error(`Failed to persist job ${job.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async removePersistedJob(jobId: string): Promise<void> {
    try {
      const filePath = path.join(this.options.storageDirectory, `${jobId}.json`);
      await fs.unlink(filePath);
    } catch (error) {
      // File might not exist, which is fine
    }
  }
}