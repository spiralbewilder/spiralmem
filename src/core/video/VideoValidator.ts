import fs from 'fs/promises';
import path from 'path';
import { logger } from '../../utils/logger.js';

export interface VideoFileInfo {
  filePath: string;
  fileName: string;
  fileSize: number;
  fileExtension: string;
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export interface ValidationOptions {
  maxFileSize?: number; // in bytes
  allowedFormats?: string[];
  minDuration?: number; // in seconds
  maxDuration?: number; // in seconds
  checkCorruption?: boolean;
}

export interface VideoValidationResult {
  isValid: boolean;
  fileInfo: VideoFileInfo;
  errors: string[];
  warnings: string[];
  metadata?: {
    duration: number;
    format: string;
    codec: string;
    resolution: { width: number; height: number };
    bitrate: number;
    fps: number;
    hasAudio: boolean;
    audioCodec?: string;
    createdAt?: Date;
  };
}

/**
 * Video file validation and basic metadata extraction
 * Validates file format, size, accessibility, and basic properties
 */
export class VideoValidator {
  private static readonly DEFAULT_OPTIONS: Required<ValidationOptions> = {
    maxFileSize: 5 * 1024 * 1024 * 1024, // 5GB
    allowedFormats: ['mp4', 'avi', 'mov', 'mkv', 'webm', 'm4v', 'wmv', 'flv'],
    minDuration: 1, // 1 second
    maxDuration: 8 * 60 * 60, // 8 hours
    checkCorruption: true
  };

  /**
   * Validate a video file and extract basic information
   */
  static async validateVideoFile(
    filePath: string, 
    options: ValidationOptions = {}
  ): Promise<VideoValidationResult> {
    const opts = { ...this.DEFAULT_OPTIONS, ...options };
    const result: VideoValidationResult = {
      isValid: false,
      fileInfo: {
        filePath,
        fileName: path.basename(filePath),
        fileSize: 0,
        fileExtension: '',
        isValid: false,
        errors: [],
        warnings: []
      },
      errors: [],
      warnings: []
    };

    try {
      // Step 1: Basic file existence and accessibility check
      await this.validateFileAccess(filePath, result);
      if (result.errors.length > 0) return result;

      // Step 2: File size validation
      await this.validateFileSize(filePath, opts.maxFileSize, result);
      if (result.errors.length > 0) return result;

      // Step 3: File format validation
      this.validateFileFormat(filePath, opts.allowedFormats, result);
      if (result.errors.length > 0) return result;

      // Step 4: Basic file integrity check
      if (opts.checkCorruption) {
        await this.checkFileIntegrity(filePath, result);
        if (result.errors.length > 0) return result;
      }

      // If we get here, basic validation passed
      result.isValid = true;
      result.fileInfo.isValid = true;

      logger.info(`Video file validation passed: ${filePath}`);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown validation error';
      result.errors.push(errorMessage);
      result.fileInfo.errors.push(errorMessage);
      result.isValid = false;
      logger.error(`Video validation failed for ${filePath}:`, error);
    }

    return result;
  }

  /**
   * Validate multiple video files in batch
   */
  static async validateVideoFiles(
    filePaths: string[],
    options: ValidationOptions = {}
  ): Promise<VideoValidationResult[]> {
    const results: VideoValidationResult[] = [];
    
    for (const filePath of filePaths) {
      const result = await this.validateVideoFile(filePath, options);
      results.push(result);
    }

    const validCount = results.filter(r => r.isValid).length;
    logger.info(`Batch validation completed: ${validCount}/${filePaths.length} files valid`);

    return results;
  }

  /**
   * Check if a file extension is supported
   */
  static isSupportedFormat(filePath: string, allowedFormats?: string[]): boolean {
    const extension = path.extname(filePath).toLowerCase().slice(1);
    const formats = allowedFormats || this.DEFAULT_OPTIONS.allowedFormats;
    return formats.includes(extension);
  }

  /**
   * Get file size in human-readable format
   */
  static formatFileSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(2)} ${units[unitIndex]}`;
  }

  /**
   * Extract basic file information without deep inspection
   */
  static async getBasicFileInfo(filePath: string): Promise<VideoFileInfo> {
    const fileInfo: VideoFileInfo = {
      filePath,
      fileName: path.basename(filePath),
      fileSize: 0,
      fileExtension: path.extname(filePath).toLowerCase().slice(1),
      isValid: false,
      errors: [],
      warnings: []
    };

    try {
      const stats = await fs.stat(filePath);
      fileInfo.fileSize = stats.size;
      
      if (stats.isFile()) {
        fileInfo.isValid = this.isSupportedFormat(filePath);
        if (!fileInfo.isValid) {
          fileInfo.errors.push(`Unsupported file format: ${fileInfo.fileExtension}`);
        }
      } else {
        fileInfo.errors.push('Path is not a file');
      }

    } catch (error) {
      fileInfo.errors.push(`Cannot access file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    return fileInfo;
  }

  // Private validation methods

  private static async validateFileAccess(filePath: string, result: VideoValidationResult): Promise<void> {
    try {
      const stats = await fs.stat(filePath);
      
      if (!stats.isFile()) {
        result.errors.push('Path is not a file');
        return;
      }

      result.fileInfo.fileSize = stats.size;
      result.fileInfo.fileName = path.basename(filePath);
      result.fileInfo.fileExtension = path.extname(filePath).toLowerCase().slice(1);

      // Check read permissions
      await fs.access(filePath, fs.constants.R_OK);

    } catch (error: any) {
      if (error.code === 'ENOENT') {
        result.errors.push('File does not exist');
      } else if (error.code === 'EACCES') {
        result.errors.push('No read permission for file');
      } else {
        result.errors.push(`File access error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  }

  private static async validateFileSize(
    filePath: string, 
    maxFileSize: number, 
    result: VideoValidationResult
  ): Promise<void> {
    if (result.fileInfo.fileSize === 0) {
      result.errors.push('File is empty');
      return;
    }

    if (result.fileInfo.fileSize > maxFileSize) {
      result.errors.push(
        `File too large: ${this.formatFileSize(result.fileInfo.fileSize)} > ${this.formatFileSize(maxFileSize)}`
      );
      return;
    }

    // Warn if file is very small (likely not a real video)
    if (result.fileInfo.fileSize < 1024 * 1024) { // 1MB
      result.warnings.push(`File very small: ${this.formatFileSize(result.fileInfo.fileSize)}`);
    }
  }

  private static validateFileFormat(
    filePath: string, 
    allowedFormats: string[], 
    result: VideoValidationResult
  ): void {
    const extension = result.fileInfo.fileExtension;
    
    if (!extension) {
      result.errors.push('File has no extension');
      return;
    }

    if (!allowedFormats.includes(extension)) {
      result.errors.push(`Unsupported format: ${extension}. Allowed: ${allowedFormats.join(', ')}`);
      return;
    }
  }

  private static async checkFileIntegrity(filePath: string, result: VideoValidationResult): Promise<void> {
    try {
      // Basic integrity check - try to read the first and last few bytes
      const fileHandle = await fs.open(filePath, 'r');
      
      try {
        // Read first 1KB
        const firstChunk = Buffer.alloc(1024);
        await fileHandle.read(firstChunk, 0, 1024, 0);
        
        // Read last 1KB
        const lastChunk = Buffer.alloc(1024);
        const fileSize = result.fileInfo.fileSize;
        const lastPosition = Math.max(0, fileSize - 1024);
        await fileHandle.read(lastChunk, 0, 1024, lastPosition);
        
        // Basic sanity checks
        if (firstChunk.every(byte => byte === 0)) {
          result.warnings.push('File starts with null bytes - may be corrupted');
        }
        
        // Check for common video file signatures
        this.checkVideoSignature(firstChunk, result);
        
      } finally {
        await fileHandle.close();
      }

    } catch (error) {
      result.errors.push(`File integrity check failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private static checkVideoSignature(buffer: Buffer, result: VideoValidationResult): void {
    const signatures = {
      mp4: [0x00, 0x00, 0x00, null, 0x66, 0x74, 0x79, 0x70], // ....ftyp
      avi: [0x52, 0x49, 0x46, 0x46, null, null, null, null, 0x41, 0x56, 0x49, 0x20], // RIFF....AVI 
      mov: [0x00, 0x00, 0x00, null, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74], // ....ftypqt
      mkv: [0x1A, 0x45, 0xDF, 0xA3], // Matroska header
      webm: [0x1A, 0x45, 0xDF, 0xA3], // WebM (also Matroska-based)
    };

    let signatureFound = false;
    const extension = result.fileInfo.fileExtension;

    for (const [format, signature] of Object.entries(signatures)) {
      if (this.matchesSignature(buffer, signature)) {
        signatureFound = true;
        
        // Warn if extension doesn't match signature
        if (extension !== format && !(extension === 'mov' && format === 'mp4')) {
          result.warnings.push(`File signature suggests ${format} but extension is ${extension}`);
        }
        break;
      }
    }

    if (!signatureFound) {
      result.warnings.push('No recognized video file signature found');
    }
  }

  private static matchesSignature(buffer: Buffer, signature: (number | null)[]): boolean {
    if (buffer.length < signature.length) return false;

    for (let i = 0; i < signature.length; i++) {
      if (signature[i] !== null && buffer[i] !== signature[i]) {
        return false;
      }
    }

    return true;
  }
}