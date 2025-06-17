import { EventEmitter } from 'events';
import fs from 'fs/promises';
import path from 'path';
import { logger } from '../../utils/logger.js';
import { ProcessingQueue, ProcessingJob, QueueStats, ProcessingQueueOptions } from './ProcessingQueue.js';
import { VideoProcessingOptions } from './VideoProcessor.js';

export interface JobManagerOptions {
  maxQueues?: number;
  defaultQueueOptions?: ProcessingQueueOptions;
  enableJobHistory?: boolean;
  historyRetentionDays?: number;
  enableScheduling?: boolean;
  healthCheckInterval?: number; // milliseconds
}

export interface ScheduledJob {
  id: string;
  name: string;
  filePaths: string[];
  options: VideoProcessingOptions;
  jobOptions: {
    priority?: ProcessingJob['priority'];
    maxRetries?: number;
    metadata?: Record<string, any>;
  };
  schedule: {
    type: 'once' | 'recurring';
    executeAt?: Date;
    interval?: number; // milliseconds for recurring jobs
    enabled: boolean;
  };
  queueName?: string;
  createdAt: Date;
  lastExecuted?: Date;
  nextExecution?: Date;
}

export interface JobHistory {
  id: string;
  jobId: string;
  queueName: string;
  filePath: string;
  status: ProcessingJob['status'];
  startTime: Date;
  endTime?: Date;
  duration?: number; // seconds
  fileSize?: number;
  errorMessage?: string;
  metadata?: Record<string, any>;
}

/**
 * Job Manager for orchestrating multiple processing queues
 * Handles job distribution, scheduling, and monitoring across queues
 */
export class JobManager extends EventEmitter {
  private static readonly DEFAULT_HEALTH_CHECK_INTERVAL = 30000; // 30 seconds
  
  private queues: Map<string, ProcessingQueue> = new Map();
  private scheduledJobs: Map<string, ScheduledJob> = new Map();
  private jobHistory: JobHistory[] = [];
  private options: Required<JobManagerOptions>;
  private healthCheckTimer?: NodeJS.Timeout;
  private schedulingTimer?: NodeJS.Timeout;

  constructor(options: JobManagerOptions = {}) {
    super();
    
    this.options = {
      maxQueues: options.maxQueues || 5,
      defaultQueueOptions: options.defaultQueueOptions || {},
      enableJobHistory: options.enableJobHistory ?? true,
      historyRetentionDays: options.historyRetentionDays || 30,
      enableScheduling: options.enableScheduling ?? true,
      healthCheckInterval: options.healthCheckInterval || JobManager.DEFAULT_HEALTH_CHECK_INTERVAL
    };

    // Create default queue
    this.createQueue('default');
    
    // Start health monitoring
    this.startHealthMonitoring();
    
    if (this.options.enableScheduling) {
      this.startScheduling();
    }
  }

  /**
   * Create a new processing queue
   */
  createQueue(name: string, options?: ProcessingQueueOptions): ProcessingQueue {
    if (this.queues.has(name)) {
      throw new Error(`Queue '${name}' already exists`);
    }

    if (this.queues.size >= this.options.maxQueues) {
      throw new Error(`Maximum number of queues (${this.options.maxQueues}) reached`);
    }

    const queueOptions = { ...this.options.defaultQueueOptions, ...options };
    const queue = new ProcessingQueue(queueOptions);
    
    // Set up event forwarding
    this.setupQueueEventForwarding(queue, name);
    
    this.queues.set(name, queue);
    logger.info(`Created processing queue: ${name}`);
    
    this.emit('queueCreated', { name, queue });
    return queue;
  }

  /**
   * Get a processing queue by name
   */
  getQueue(name: string): ProcessingQueue | undefined {
    return this.queues.get(name);
  }

  /**
   * Remove a processing queue
   */
  async removeQueue(name: string): Promise<boolean> {
    if (name === 'default') {
      throw new Error('Cannot remove default queue');
    }

    const queue = this.queues.get(name);
    if (!queue) {
      return false;
    }

    await queue.stop();
    this.queues.delete(name);
    
    logger.info(`Removed processing queue: ${name}`);
    this.emit('queueRemoved', { name });
    return true;
  }

  /**
   * Submit a job to a specific queue or auto-select best queue
   */
  async submitJob(
    filePath: string,
    options: VideoProcessingOptions = {},
    jobOptions: {
      priority?: ProcessingJob['priority'];
      maxRetries?: number;
      metadata?: Record<string, any>;
      queueName?: string;
    } = {}
  ): Promise<{ jobId: string; queueName: string }> {
    const queueName = jobOptions.queueName || this.selectOptimalQueue();
    const queue = this.queues.get(queueName);
    
    if (!queue) {
      throw new Error(`Queue '${queueName}' not found`);
    }

    const jobId = await queue.addJob(filePath, options, {
      priority: jobOptions.priority,
      maxRetries: jobOptions.maxRetries,
      metadata: { ...jobOptions.metadata, queueName }
    });

    logger.info(`Job ${jobId} submitted to queue ${queueName}: ${path.basename(filePath)}`);
    
    this.emit('jobSubmitted', { jobId, queueName, filePath });
    return { jobId, queueName };
  }

  /**
   * Submit multiple jobs as a batch
   */
  async submitBatchJobs(
    filePaths: string[],
    options: VideoProcessingOptions = {},
    jobOptions: {
      priority?: ProcessingJob['priority'];
      maxRetries?: number;
      metadata?: Record<string, any>;
      queueName?: string;
      distributeAcrossQueues?: boolean;
    } = {}
  ): Promise<Array<{ jobId: string; queueName: string; filePath: string }>> {
    const results: Array<{ jobId: string; queueName: string; filePath: string }> = [];
    
    logger.info(`Submitting batch of ${filePaths.length} jobs`);

    if (jobOptions.distributeAcrossQueues && this.queues.size > 1) {
      // Distribute jobs across available queues
      const queueNames = Array.from(this.queues.keys());
      
      for (let i = 0; i < filePaths.length; i++) {
        const filePath = filePaths[i];
        const queueName = queueNames[i % queueNames.length];
        
        try {
          const result = await this.submitJob(filePath, options, {
            ...jobOptions,
            queueName
          });
          results.push({ ...result, filePath });
        } catch (error) {
          logger.error(`Failed to submit job for ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }
    } else {
      // Submit all jobs to the same queue
      const queueName = jobOptions.queueName || this.selectOptimalQueue();
      const queue = this.queues.get(queueName);
      
      if (!queue) {
        throw new Error(`Queue '${queueName}' not found`);
      }

      const jobIds = await queue.addBatchJobs(filePaths, options, {
        priority: jobOptions.priority,
        maxRetries: jobOptions.maxRetries,
        metadata: { ...jobOptions.metadata, queueName }
      });

      for (let i = 0; i < jobIds.length; i++) {
        results.push({
          jobId: jobIds[i],
          queueName,
          filePath: filePaths[i]
        });
      }
    }

    this.emit('batchJobsSubmitted', { count: results.length, results });
    return results;
  }

  /**
   * Get job from any queue
   */
  getJob(jobId: string): { job: ProcessingJob; queueName: string } | undefined {
    for (const [queueName, queue] of this.queues.entries()) {
      const job = queue.getJob(jobId);
      if (job) {
        return { job, queueName };
      }
    }
    return undefined;
  }

  /**
   * Cancel job from any queue
   */
  async cancelJob(jobId: string): Promise<boolean> {
    for (const queue of this.queues.values()) {
      const success = await queue.cancelJob(jobId);
      if (success) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get comprehensive statistics across all queues
   */
  getAllStats(): Record<string, QueueStats> {
    const stats: Record<string, QueueStats> = {};
    
    for (const [name, queue] of this.queues.entries()) {
      stats[name] = queue.getStats();
    }
    
    return stats;
  }

  /**
   * Get aggregated statistics
   */
  getAggregatedStats(): QueueStats & { queueCount: number; activeQueues: number } {
    const allStats = this.getAllStats();
    const statsList = Object.values(allStats);
    
    const aggregated: QueueStats & { queueCount: number; activeQueues: number } = {
      totalJobs: 0,
      pendingJobs: 0,
      processingJobs: 0,
      completedJobs: 0,
      failedJobs: 0,
      cancelledJobs: 0,
      averageProcessingTime: 0,
      throughputPerHour: 0,
      queueDepth: 0,
      estimatedWaitTime: 0,
      queueCount: this.queues.size,
      activeQueues: statsList.filter(s => s.processingJobs > 0 || s.pendingJobs > 0).length
    };

    if (statsList.length === 0) {
      return aggregated;
    }

    // Sum up totals
    for (const stats of statsList) {
      aggregated.totalJobs += stats.totalJobs;
      aggregated.pendingJobs += stats.pendingJobs;
      aggregated.processingJobs += stats.processingJobs;
      aggregated.completedJobs += stats.completedJobs;
      aggregated.failedJobs += stats.failedJobs;
      aggregated.cancelledJobs += stats.cancelledJobs;
      aggregated.throughputPerHour += stats.throughputPerHour;
      aggregated.queueDepth += stats.queueDepth;
    }

    // Calculate averages
    const processingTimes = statsList
      .map(s => s.averageProcessingTime)
      .filter(t => t > 0);
    
    if (processingTimes.length > 0) {
      aggregated.averageProcessingTime = processingTimes.reduce((sum, t) => sum + t, 0) / processingTimes.length;
    }

    // Estimate wait time as maximum across queues
    aggregated.estimatedWaitTime = Math.max(...statsList.map(s => s.estimatedWaitTime));

    return aggregated;
  }

  /**
   * Schedule a job to run at a specific time or interval
   */
  scheduleJob(
    name: string,
    filePaths: string[],
    options: VideoProcessingOptions,
    schedule: ScheduledJob['schedule'],
    jobOptions: ScheduledJob['jobOptions'] = {},
    queueName?: string
  ): string {
    if (!this.options.enableScheduling) {
      throw new Error('Scheduling is disabled');
    }

    const scheduleId = `schedule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const scheduledJob: ScheduledJob = {
      id: scheduleId,
      name,
      filePaths,
      options,
      jobOptions,
      schedule,
      queueName,
      createdAt: new Date()
    };

    if (schedule.type === 'once' && schedule.executeAt) {
      scheduledJob.nextExecution = schedule.executeAt;
    } else if (schedule.type === 'recurring' && schedule.interval) {
      scheduledJob.nextExecution = new Date(Date.now() + schedule.interval);
    }

    this.scheduledJobs.set(scheduleId, scheduledJob);
    
    logger.info(`Scheduled job '${name}' created with ID ${scheduleId}`);
    this.emit('jobScheduled', scheduledJob);
    
    return scheduleId;
  }

  /**
   * Cancel a scheduled job
   */
  cancelScheduledJob(scheduleId: string): boolean {
    const scheduled = this.scheduledJobs.get(scheduleId);
    if (!scheduled) {
      return false;
    }

    scheduled.schedule.enabled = false;
    logger.info(`Scheduled job ${scheduleId} cancelled`);
    this.emit('scheduledJobCancelled', scheduled);
    
    return true;
  }

  /**
   * Get job history with optional filtering
   */
  getJobHistory(filter?: {
    queueName?: string;
    status?: ProcessingJob['status'];
    startDate?: Date;
    endDate?: Date;
    limit?: number;
  }): JobHistory[] {
    let history = [...this.jobHistory];

    if (filter?.queueName) {
      history = history.filter(h => h.queueName === filter.queueName);
    }

    if (filter?.status) {
      history = history.filter(h => h.status === filter.status);
    }

    if (filter?.startDate) {
      history = history.filter(h => h.startTime >= filter.startDate!);
    }

    if (filter?.endDate) {
      history = history.filter(h => h.startTime <= filter.endDate!);
    }

    history.sort((a, b) => b.startTime.getTime() - a.startTime.getTime());

    if (filter?.limit) {
      history = history.slice(0, filter.limit);
    }

    return history;
  }

  /**
   * Stop all queues and cleanup
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down job manager...');

    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }

    if (this.schedulingTimer) {
      clearInterval(this.schedulingTimer);
    }

    // Stop all queues
    const stopPromises = Array.from(this.queues.values()).map(queue => queue.stop());
    await Promise.all(stopPromises);

    logger.info('Job manager shutdown complete');
    this.emit('shutdown');
  }

  // Private methods

  private selectOptimalQueue(): string {
    if (this.queues.size === 1) {
      return 'default';
    }

    // Select queue with lowest load (pending + processing jobs)
    let bestQueue = 'default';
    let lowestLoad = Infinity;

    for (const [name, queue] of this.queues.entries()) {
      const stats = queue.getStats();
      const load = stats.pendingJobs + stats.processingJobs;
      
      if (load < lowestLoad) {
        lowestLoad = load;
        bestQueue = name;
      }
    }

    return bestQueue;
  }

  private setupQueueEventForwarding(queue: ProcessingQueue, queueName: string): void {
    const events = [
      'jobAdded', 'jobStarted', 'jobCompleted', 'jobFailed', 
      'jobCancelled', 'jobRetry', 'statsUpdated'
    ];

    for (const event of events) {
      queue.on(event, (data) => {
        // Add queue information to event data
        const eventData = { ...data, queueName };
        
        // Forward to our own listeners
        this.emit(event, eventData);
        
        // Record job history
        if (this.options.enableJobHistory && ['jobStarted', 'jobCompleted', 'jobFailed', 'jobCancelled'].includes(event)) {
          this.recordJobHistory(event, eventData, queueName);
        }
      });
    }
  }

  private recordJobHistory(event: string, jobData: any, queueName: string): void {
    const job = jobData as ProcessingJob;
    
    if (event === 'jobStarted') {
      const historyEntry: JobHistory = {
        id: `history_${job.id}_${Date.now()}`,
        jobId: job.id,
        queueName,
        filePath: job.filePath,
        status: 'processing',
        startTime: job.startedAt || new Date(),
        metadata: job.metadata
      };
      
      this.jobHistory.push(historyEntry);
    } else if (['jobCompleted', 'jobFailed', 'jobCancelled'].includes(event)) {
      // Update existing history entry
      const historyEntry = this.jobHistory.find(h => h.jobId === job.id);
      if (historyEntry) {
        historyEntry.status = job.status;
        historyEntry.endTime = job.completedAt || new Date();
        historyEntry.duration = job.actualDuration;
        historyEntry.errorMessage = job.error;
        
        // Try to get file size
        if (job.result) {
          historyEntry.fileSize = job.result.stats.fileSize;
        }
      }
    }

    // Cleanup old history entries
    this.cleanupJobHistory();
  }

  private cleanupJobHistory(): void {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.options.historyRetentionDays);
    
    const before = this.jobHistory.length;
    this.jobHistory = this.jobHistory.filter(h => h.startTime >= cutoffDate);
    
    const removed = before - this.jobHistory.length;
    if (removed > 0) {
      logger.debug(`Cleaned up ${removed} old history entries`);
    }
  }

  private startHealthMonitoring(): void {
    this.healthCheckTimer = setInterval(() => {
      this.performHealthCheck();
    }, this.options.healthCheckInterval);
  }

  private performHealthCheck(): void {
    const stats = this.getAggregatedStats();
    
    // Emit health status
    this.emit('healthCheck', {
      timestamp: new Date(),
      queueCount: stats.queueCount,
      activeQueues: stats.activeQueues,
      totalJobs: stats.totalJobs,
      processingJobs: stats.processingJobs,
      failedJobs: stats.failedJobs,
      throughput: stats.throughputPerHour
    });

    // Check for potential issues
    if (stats.failedJobs > stats.completedJobs * 0.1) { // More than 10% failure rate
      this.emit('healthAlert', {
        type: 'high_failure_rate',
        message: `High failure rate detected: ${stats.failedJobs} failed vs ${stats.completedJobs} completed`,
        severity: 'warning'
      });
    }

    if (stats.estimatedWaitTime > 3600) { // More than 1 hour wait time
      this.emit('healthAlert', {
        type: 'long_wait_time',
        message: `Long estimated wait time: ${Math.round(stats.estimatedWaitTime / 60)} minutes`,
        severity: 'info'
      });
    }
  }

  private startScheduling(): void {
    this.schedulingTimer = setInterval(() => {
      this.processScheduledJobs();
    }, 60000); // Check every minute
  }

  private async processScheduledJobs(): Promise<void> {
    const now = new Date();
    
    for (const [scheduleId, scheduledJob] of this.scheduledJobs.entries()) {
      if (!scheduledJob.schedule.enabled || !scheduledJob.nextExecution) {
        continue;
      }

      if (now >= scheduledJob.nextExecution) {
        try {
          await this.executeScheduledJob(scheduledJob);
          
          if (scheduledJob.schedule.type === 'recurring' && scheduledJob.schedule.interval) {
            // Schedule next execution
            scheduledJob.nextExecution = new Date(now.getTime() + scheduledJob.schedule.interval);
            scheduledJob.lastExecuted = now;
          } else {
            // One-time job, disable it
            scheduledJob.schedule.enabled = false;
          }
        } catch (error) {
          logger.error(`Failed to execute scheduled job ${scheduleId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
          this.emit('scheduledJobError', { scheduledJob, error });
        }
      }
    }
  }

  private async executeScheduledJob(scheduledJob: ScheduledJob): Promise<void> {
    logger.info(`Executing scheduled job: ${scheduledJob.name}`);
    
    await this.submitBatchJobs(
      scheduledJob.filePaths,
      scheduledJob.options,
      {
        ...scheduledJob.jobOptions,
        queueName: scheduledJob.queueName,
        metadata: {
          ...scheduledJob.jobOptions.metadata,
          scheduledJobId: scheduledJob.id,
          scheduledJobName: scheduledJob.name
        }
      }
    );

    this.emit('scheduledJobExecuted', scheduledJob);
  }
}