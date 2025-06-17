import { logger } from './logger.js';

export class SpiralmemError extends Error {
  public code: string;
  public context?: Record<string, any>;
  public recoverable: boolean;
  public timestamp: Date;

  constructor(
    message: string,
    code: string = 'SPIRALMEM_ERROR',
    context?: Record<string, any>,
    recoverable: boolean = false
  ) {
    super(message);
    this.name = 'SpiralmemError';
    this.code = code;
    this.context = context;
    this.recoverable = recoverable;
    this.timestamp = new Date();
    
    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, SpiralmemError);
    }
  }
}

export class ValidationError extends SpiralmemError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, 'VALIDATION_ERROR', context, true);
    this.name = 'ValidationError';
  }
}

export class ProcessingError extends SpiralmemError {
  constructor(message: string, context?: Record<string, any>, recoverable: boolean = true) {
    super(message, 'PROCESSING_ERROR', context, recoverable);
    this.name = 'ProcessingError';
  }
}

export class DatabaseError extends SpiralmemError {
  constructor(message: string, context?: Record<string, any>, recoverable: boolean = false) {
    super(message, 'DATABASE_ERROR', context, recoverable);
    this.name = 'DatabaseError';
  }
}

export class SystemError extends SpiralmemError {
  constructor(message: string, context?: Record<string, any>, recoverable: boolean = false) {
    super(message, 'SYSTEM_ERROR', context, recoverable);
    this.name = 'SystemError';
  }
}

export class ConfigurationError extends SpiralmemError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, 'CONFIGURATION_ERROR', context, true);
    this.name = 'ConfigurationError';
  }
}

// Error recovery strategies
export interface RecoveryStrategy {
  canRecover(error: SpiralmemError): boolean;
  recover(error: SpiralmemError): Promise<boolean>;
}

export class FileSystemRecovery implements RecoveryStrategy {
  canRecover(error: SpiralmemError): boolean {
    return error.code === 'PROCESSING_ERROR' && 
           error.context?.type === 'file_access';
  }

  async recover(error: SpiralmemError): Promise<boolean> {
    try {
      if (error.context?.filePath) {
        // Attempt to create directory if it doesn't exist
        const fs = await import('fs/promises');
        const path = await import('path');
        
        const dir = path.dirname(error.context.filePath);
        await fs.mkdir(dir, { recursive: true });
        
        logger.info(`Created missing directory: ${dir}`);
        return true;
      }
    } catch (recoveryError) {
      logger.error('File system recovery failed:', recoveryError);
    }
    return false;
  }
}

export class DatabaseRecovery implements RecoveryStrategy {
  canRecover(error: SpiralmemError): boolean {
    return error.code === 'DATABASE_ERROR' && 
           error.context?.type === 'connection_lost';
  }

  async recover(error: SpiralmemError): Promise<boolean> {
    try {
      // Attempt to reconnect to database
      const { database } = await import('../core/database/connection.js');
      await database.close();
      await database.initialize();
      
      logger.info('Database connection recovered');
      return true;
    } catch (recoveryError) {
      logger.error('Database recovery failed:', recoveryError);
    }
    return false;
  }
}

export class ProcessingRecovery implements RecoveryStrategy {
  canRecover(error: SpiralmemError): boolean {
    return error.code === 'PROCESSING_ERROR' && 
           (error.context?.type === 'transcription_timeout' ||
            error.context?.type === 'temporary_file_cleanup');
  }

  async recover(error: SpiralmemError): Promise<boolean> {
    try {
      if (error.context?.type === 'temporary_file_cleanup') {
        // Clean up temporary files
        const fs = await import('fs/promises');
        if (error.context.tempFiles) {
          for (const filePath of error.context.tempFiles) {
            try {
              await fs.unlink(filePath);
              logger.debug(`Cleaned up temp file: ${filePath}`);
            } catch {
              // Ignore cleanup errors
            }
          }
        }
        return true;
      }
      
      if (error.context?.type === 'transcription_timeout') {
        // Kill any hanging processes
        if (error.context.processId) {
          try {
            process.kill(error.context.processId, 'SIGTERM');
            logger.info(`Terminated hanging transcription process: ${error.context.processId}`);
          } catch {
            // Process might already be dead
          }
        }
        return true;
      }
    } catch (recoveryError) {
      logger.error('Processing recovery failed:', recoveryError);
    }
    return false;
  }
}

export class ErrorHandler {
  private recoveryStrategies: RecoveryStrategy[] = [
    new FileSystemRecovery(),
    new DatabaseRecovery(),
    new ProcessingRecovery()
  ];

  async handleError(error: Error | SpiralmemError): Promise<void> {
    const spiralmemError = this.normalizeError(error);
    
    // Log the error with context
    this.logError(spiralmemError);
    
    // Attempt recovery if error is recoverable
    if (spiralmemError.recoverable) {
      const recovered = await this.attemptRecovery(spiralmemError);
      if (recovered) {
        logger.info(`Successfully recovered from error: ${spiralmemError.code}`);
        return;
      }
    }
    
    // If recovery failed or error is not recoverable, handle appropriately
    this.escalateError(spiralmemError);
  }

  private normalizeError(error: Error | SpiralmemError): SpiralmemError {
    if (error instanceof SpiralmemError) {
      return error;
    }
    
    // Convert common Node.js errors to SpiralmemErrors
    if (error.message.includes('ENOENT')) {
      return new ProcessingError(
        'File or directory not found',
        'PROCESSING_ERROR',
        { type: 'file_access', originalError: error.message },
        true
      );
    }
    
    if (error.message.includes('EACCES')) {
      return new SystemError(
        'Permission denied',
        'SYSTEM_ERROR',
        { type: 'permission_denied', originalError: error.message },
        false
      );
    }
    
    if (error.message.includes('SQLITE')) {
      return new DatabaseError(
        'Database operation failed',
        'DATABASE_ERROR',
        { type: 'query_failed', originalError: error.message },
        true
      );
    }
    
    // Default to generic error
    return new SpiralmemError(
      error.message,
      'UNKNOWN_ERROR',
      { originalError: error.message },
      false
    );
  }

  private logError(error: SpiralmemError): void {
    const logData = {
      code: error.code,
      message: error.message,
      recoverable: error.recoverable,
      timestamp: error.timestamp.toISOString(),
      context: error.context,
      stack: error.stack
    };
    
    if (error.recoverable) {
      logger.warn('Recoverable error occurred:', logData);
    } else {
      logger.error('Critical error occurred:', logData);
    }
  }

  private async attemptRecovery(error: SpiralmemError): Promise<boolean> {
    for (const strategy of this.recoveryStrategies) {
      if (strategy.canRecover(error)) {
        try {
          const recovered = await strategy.recover(error);
          if (recovered) {
            return true;
          }
        } catch (recoveryError) {
          logger.error('Recovery strategy failed:', recoveryError);
        }
      }
    }
    return false;
  }

  private escalateError(error: SpiralmemError): void {
    // For now, just re-throw the error
    // In a production system, this might send alerts, create tickets, etc.
    throw error;
  }
}

// Global error handler instance
export const errorHandler = new ErrorHandler();

// Utility functions for common error patterns
export function withErrorHandling<T extends any[], R>(
  fn: (...args: T) => Promise<R>
) {
  return async (...args: T): Promise<R> => {
    try {
      return await fn(...args);
    } catch (error) {
      await errorHandler.handleError(error as Error);
      throw error; // Re-throw after handling
    }
  };
}

export function validateRequired<T>(
  value: T | null | undefined,
  fieldName: string
): T {
  if (value === null || value === undefined) {
    throw new ValidationError(`Required field missing: ${fieldName}`);
  }
  return value;
}

export function validateFileExists(filePath: string): void {
  const fs = require('fs');
  if (!fs.existsSync(filePath)) {
    throw new ValidationError(
      `File does not exist: ${filePath}`,
      { filePath, type: 'file_not_found' }
    );
  }
}

export function validateVideoFile(filePath: string): void {
  validateFileExists(filePath);
  
  const path = require('path');
  const ext = path.extname(filePath).toLowerCase();
  const supportedFormats = ['.mp4', '.avi', '.mov', '.mkv', '.webm', '.flv'];
  
  if (!supportedFormats.includes(ext)) {
    throw new ValidationError(
      `Unsupported video format: ${ext}`,
      { 
        filePath, 
        extension: ext, 
        supportedFormats,
        type: 'unsupported_format' 
      }
    );
  }
}

export function validateConfiguration(config: any): void {
  if (!config.database?.path) {
    throw new ConfigurationError(
      'Database path not configured',
      { config }
    );
  }
  
  if (!config.video?.processing?.tempDir) {
    throw new ConfigurationError(
      'Video processing temp directory not configured',
      { config }
    );
  }
}

// Process-level error handlers
export function setupGlobalErrorHandlers(): void {
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception:', error);
    errorHandler.handleError(error).finally(() => {
      process.exit(1);
    });
  });

  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled rejection at:', promise, 'reason:', reason);
    if (reason instanceof Error) {
      errorHandler.handleError(reason).finally(() => {
        process.exit(1);
      });
    } else {
      process.exit(1);
    }
  });

  process.on('SIGTERM', () => {
    logger.info('SIGTERM received, shutting down gracefully');
    process.exit(0);
  });

  process.on('SIGINT', () => {
    logger.info('SIGINT received, shutting down gracefully');
    process.exit(0);
  });
}

export {
  SpiralmemError,
  ValidationError,
  ProcessingError,
  DatabaseError,
  SystemError,
  ConfigurationError
};