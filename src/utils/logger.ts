import winston from 'winston';
import path from 'path';
import fs from 'fs';
import { config } from './config.js';

// Ensure logs directory exists
const ensureLogDir = () => {
  const logFile = config.getLogFile();
  const logDir = path.dirname(logFile);
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
};

// Custom format for console output
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let log = `${timestamp} [${level}] ${message}`;
    if (Object.keys(meta).length > 0) {
      log += ` ${JSON.stringify(meta)}`;
    }
    return log;
  })
);

// Custom format for file output
const fileFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Create logger instance
const createLogger = () => {
  ensureLogDir();
  
  const logConfig = config.get().logging;
  
  const transports: winston.transport[] = [
    // Console transport
    new winston.transports.Console({
      format: consoleFormat,
    }),
  ];
  
  // File transport (only if file logging is configured)
  if (logConfig.file) {
    transports.push(
      new winston.transports.File({
        filename: logConfig.file,
        format: fileFormat,
        maxsize: parseSize(logConfig.maxSize),
        maxFiles: logConfig.maxFiles,
      })
    );
  }
  
  return winston.createLogger({
    level: logConfig.level,
    transports,
    // Prevent exit on handled exceptions
    exitOnError: false,
  });
};

// Helper function to parse size strings like "10MB"
const parseSize = (sizeStr: string): number => {
  const units: { [key: string]: number } = {
    B: 1,
    KB: 1024,
    MB: 1024 * 1024,
    GB: 1024 * 1024 * 1024,
  };
  
  const match = sizeStr.match(/^(\d+)\s*([A-Z]*B?)$/i);
  if (!match) return 10 * 1024 * 1024; // Default 10MB
  
  const [, size, unit] = match;
  return parseInt(size) * (units[unit.toUpperCase()] || 1);
};

// Create and export logger instance
export const logger = createLogger();

// Export typed logger interface
export interface Logger {
  error(message: string, meta?: any): void;
  warn(message: string, meta?: any): void;
  info(message: string, meta?: any): void;
  debug(message: string, meta?: any): void;
}

// Helper functions for common logging patterns
export const logError = (error: Error, context?: string) => {
  logger.error(`${context ? `[${context}] ` : ''}${error.message}`, {
    stack: error.stack,
    context,
  });
};

export const logPerformance = (operation: string, startTime: number) => {
  const duration = Date.now() - startTime;
  logger.info(`Performance: ${operation} completed in ${duration}ms`);
};

export const logMemoryUsage = (context?: string) => {
  const usage = process.memoryUsage();
  logger.debug(`Memory usage${context ? ` [${context}]` : ''}:`, {
    rss: `${Math.round(usage.rss / 1024 / 1024)}MB`,
    heapTotal: `${Math.round(usage.heapTotal / 1024 / 1024)}MB`,
    heapUsed: `${Math.round(usage.heapUsed / 1024 / 1024)}MB`,
    external: `${Math.round(usage.external / 1024 / 1024)}MB`,
  });
};