import { logger } from './logger.js';

export interface ShutdownTask {
  name: string;
  priority: number; // Lower numbers run first
  timeout: number; // Maximum time to wait for this task (ms)
  cleanup(): Promise<void>;
}

export class GracefulShutdown {
  private tasks: ShutdownTask[] = [];
  private isShuttingDown = false;
  private shutdownPromise: Promise<void> | null = null;

  addTask(task: ShutdownTask): void {
    this.tasks.push(task);
    // Sort by priority (ascending)
    this.tasks.sort((a, b) => a.priority - b.priority);
  }

  async shutdown(reason: string = 'Unknown'): Promise<void> {
    if (this.isShuttingDown) {
      return this.shutdownPromise!;
    }

    this.isShuttingDown = true;
    logger.info(`Initiating graceful shutdown: ${reason}`);

    this.shutdownPromise = this.performShutdown();
    return this.shutdownPromise;
  }

  private async performShutdown(): Promise<void> {
    const startTime = Date.now();

    for (const task of this.tasks) {
      try {
        logger.info(`Running shutdown task: ${task.name}`);
        
        // Run task with timeout
        const timeoutPromise = new Promise<void>((_, reject) => {
          setTimeout(() => reject(new Error(`Timeout: ${task.name}`)), task.timeout);
        });

        await Promise.race([
          task.cleanup(),
          timeoutPromise
        ]);

        logger.info(`Completed shutdown task: ${task.name}`);
      } catch (error) {
        logger.error(`Shutdown task failed: ${task.name}`, error);
        // Continue with other tasks even if one fails
      }
    }

    const totalTime = Date.now() - startTime;
    logger.info(`Graceful shutdown completed in ${totalTime}ms`);
  }

  setupSignalHandlers(): void {
    // Handle SIGTERM (Docker, systemd)
    process.on('SIGTERM', () => {
      this.shutdown('SIGTERM received').finally(() => {
        process.exit(0);
      });
    });

    // Handle SIGINT (Ctrl+C)
    process.on('SIGINT', () => {
      this.shutdown('SIGINT received').finally(() => {
        process.exit(0);
      });
    });

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception:', error);
      this.shutdown('Uncaught exception').finally(() => {
        process.exit(1);
      });
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled rejection at:', promise, 'reason:', reason);
      this.shutdown('Unhandled promise rejection').finally(() => {
        process.exit(1);
      });
    });
  }
}

// Default shutdown tasks
export class DatabaseShutdownTask implements ShutdownTask {
  name = 'Database';
  priority = 1;
  timeout = 5000;

  async cleanup(): Promise<void> {
    try {
      const { database } = await import('../core/database/connection.js');
      await database.close();
      logger.info('Database connection closed');
    } catch (error) {
      logger.error('Failed to close database connection:', error);
    }
  }
}

export class ProcessingShutdownTask implements ShutdownTask {
  name = 'Processing';
  priority = 2;
  timeout = 30000; // 30 seconds for processing to complete

  async cleanup(): Promise<void> {
    try {
      // Cancel any running processing jobs
      const { VideoProcessingRepository } = await import('../core/database/repositories/VideoProcessingRepository.js');
      const repo = new VideoProcessingRepository();
      
      // Find jobs that are currently processing
      const processingJobs = await repo.findByStatus('processing');
      
      for (const job of processingJobs) {
        // Mark as failed due to shutdown
        await repo.updateStatus(job.id, 'failed', 'System shutdown');
        logger.info(`Marked processing job as failed due to shutdown: ${job.id}`);
      }
    } catch (error) {
      logger.error('Failed to cleanup processing jobs:', error);
    }
  }
}

export class TempFileCleanupTask implements ShutdownTask {
  name = 'TempFileCleanup';
  priority = 3;
  timeout = 10000;

  async cleanup(): Promise<void> {
    try {
      const { config } = await import('./config.js');
      const tempDir = config.getTempDir();
      
      const fs = await import('fs/promises');
      const path = await import('path');
      
      // Clean up temporary files
      try {
        const tempFiles = await fs.readdir(tempDir);
        for (const file of tempFiles) {
          const filePath = path.join(tempDir, file);
          const stats = await fs.stat(filePath);
          
          // Only clean up files older than 1 hour
          const hourAgo = Date.now() - (60 * 60 * 1000);
          if (stats.mtime.getTime() < hourAgo) {
            await fs.unlink(filePath);
            logger.debug(`Cleaned up temp file: ${filePath}`);
          }
        }
      } catch (error) {
        // Temp directory might not exist or be empty
        logger.debug('Temp directory cleanup skipped:', error);
      }
    } catch (error) {
      logger.error('Failed to cleanup temp files:', error);
    }
  }
}

export class LogFlushTask implements ShutdownTask {
  name = 'LogFlush';
  priority = 10; // Run last
  timeout = 2000;

  async cleanup(): Promise<void> {
    try {
      // Ensure all logs are flushed
      await new Promise<void>((resolve) => {
        // Give winston time to flush
        setTimeout(resolve, 100);
      });
      logger.info('Log flush completed');
    } catch (error) {
      console.error('Failed to flush logs:', error);
    }
  }
}

// Global graceful shutdown instance
export const gracefulShutdown = new GracefulShutdown();

// Setup default shutdown tasks
gracefulShutdown.addTask(new ProcessingShutdownTask());
gracefulShutdown.addTask(new DatabaseShutdownTask());
gracefulShutdown.addTask(new TempFileCleanupTask());
gracefulShutdown.addTask(new LogFlushTask());

// Auto-setup signal handlers
gracefulShutdown.setupSignalHandlers();