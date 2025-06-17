import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { logger } from '../../utils/logger.js';
import { PerformanceMonitor } from '../platforms/PerformanceMonitor.js';

export interface FrameSamplingOptions {
  method?: 'uniform' | 'keyframes' | 'scene-change' | 'quality-based';
  frameCount?: number; // Total frames to extract
  interval?: number; // Seconds between frames (for uniform sampling)
  startTime?: number; // Seconds to start sampling from
  endTime?: number; // Seconds to end sampling at
  outputFormat?: 'jpg' | 'png' | 'webp';
  quality?: number; // 1-100 for JPEG quality
  maxWidth?: number; // Resize frames to max width
  maxHeight?: number; // Resize frames to max height
  outputDirectory?: string;
  includeTimestamps?: boolean; // Include timestamp in filename
  sceneThreshold?: number; // For scene-change detection (0.0-1.0)
  keyframeOnly?: boolean; // Extract only keyframes
}

export interface FrameInfo {
  filename: string;
  filepath: string;
  timestamp: number; // seconds
  frameNumber: number;
  isKeyframe?: boolean;
  sceneScore?: number; // Scene change score
  qualityScore?: number; // Frame quality score
  fileSize: number; // bytes
  width: number;
  height: number;
}

export interface FrameSamplingResult {
  success: boolean;
  videoFilePath: string;
  outputDirectory: string;
  frames: FrameInfo[];
  samplingMethod: string;
  totalFramesExtracted: number;
  videoDuration: number; // seconds
  processingTime: number; // ms
  errors: string[];
  warnings: string[];
  
  // Quality metrics
  averageFileSize: number;
  averageQualityScore?: number;
  keyframeCount?: number;
  sceneChangeCount?: number;
  
  // Processing stats
  extractionSpeed: number; // frames per second
  compressionRatio?: number;
}

export interface ThumbnailOptions {
  timestamp?: number; // Specific time to capture (seconds)
  position?: 'start' | 'middle' | 'end' | 'best-quality'; // Auto-select position
  width?: number;
  height?: number;
  quality?: number; // 1-100 for JPEG
  format?: 'jpg' | 'png' | 'webp';
  outputPath?: string;
  analyzeQuality?: boolean; // Find best quality frame in vicinity
  searchWindow?: number; // Seconds to search around timestamp for best frame
}

export interface ThumbnailResult {
  success: boolean;
  videoFilePath: string;
  thumbnailPath?: string;
  timestamp: number;
  width: number;
  height: number;
  fileSize: number;
  quality?: number;
  processingTime: number; // ms
  errors: string[];
  warnings: string[];
}

/**
 * FFmpeg-based frame sampling and thumbnail generation
 * Extracts frames at specified intervals or based on content analysis
 */
export class FrameSampler {
  private static readonly FFMPEG_TIMEOUT = 300000; // 5 minutes
  private performanceMonitor: PerformanceMonitor;

  constructor() {
    this.performanceMonitor = new PerformanceMonitor();
  }

  /**
   * Extract frames from video using various sampling methods
   */
  async extractFrames(
    videoFilePath: string,
    options: FrameSamplingOptions = {}
  ): Promise<FrameSamplingResult> {
    const operationId = `extractFrames-${Date.now()}`;
    this.performanceMonitor.startOperation(operationId);
    const startTime = Date.now();

    const opts = this.getDefaultSamplingOptions(options);
    const result: FrameSamplingResult = {
      success: false,
      videoFilePath,
      outputDirectory: opts.outputDirectory,
      frames: [],
      samplingMethod: opts.method,
      totalFramesExtracted: 0,
      videoDuration: 0,
      processingTime: 0,
      errors: [],
      warnings: [],
      averageFileSize: 0,
      extractionSpeed: 0
    };

    try {
      logger.info(`Starting frame extraction: ${videoFilePath} using ${opts.method} method`);

      // Step 1: Validate video and get info
      const videoInfo = await this.getVideoInfo(videoFilePath);
      result.videoDuration = videoInfo.duration;

      // Step 2: Create output directory
      await fs.mkdir(opts.outputDirectory, { recursive: true });

      // Step 3: Extract frames based on method
      switch (opts.method) {
        case 'uniform':
          await this.extractUniformFrames(videoFilePath, opts, result);
          break;
        case 'keyframes':
          await this.extractKeyframes(videoFilePath, opts, result);
          break;
        case 'scene-change':
          await this.extractSceneChangeFrames(videoFilePath, opts, result);
          break;
        case 'quality-based':
          await this.extractQualityBasedFrames(videoFilePath, opts, result);
          break;
        default:
          throw new Error(`Unknown sampling method: ${opts.method}`);
      }

      // Step 4: Analyze extracted frames
      await this.analyzeExtractedFrames(result);

      // Step 5: Calculate metrics
      result.processingTime = Date.now() - startTime;
      result.extractionSpeed = result.totalFramesExtracted / (result.processingTime / 1000);
      result.success = true;

      logger.info(`Frame extraction completed: ${result.totalFramesExtracted} frames in ${result.processingTime}ms`);

      // Record performance metrics
      this.performanceMonitor.recordMetric({
        name: 'frame.extraction.duration',
        value: result.processingTime,
        unit: 'ms',
        timestamp: new Date(),
        tags: {
          method: opts.method,
          frameCount: result.totalFramesExtracted.toString(),
          success: 'true'
        }
      });

      this.performanceMonitor.endOperation(operationId, 'frame-extraction', true);

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown extraction error';
      result.errors.push(errorMsg);
      result.processingTime = Date.now() - startTime;

      logger.error(`Frame extraction failed for ${videoFilePath}:`, error);

      this.performanceMonitor.recordMetric({
        name: 'frame.extraction.error',
        value: 1,
        unit: 'count',
        timestamp: new Date(),
        tags: { error: errorMsg.substring(0, 50) }
      });

      this.performanceMonitor.endOperation(operationId, 'frame-extraction', false);
    }

    return result;
  }

  /**
   * Generate a thumbnail from the video
   */
  async generateThumbnail(
    videoFilePath: string,
    options: ThumbnailOptions = {}
  ): Promise<ThumbnailResult> {
    const operationId = `generateThumbnail-${Date.now()}`;
    this.performanceMonitor.startOperation(operationId);
    const startTime = Date.now();

    const opts = this.getDefaultThumbnailOptions(options);
    const result: ThumbnailResult = {
      success: false,
      videoFilePath,
      timestamp: 0,
      width: 0,
      height: 0,
      fileSize: 0,
      processingTime: 0,
      errors: [],
      warnings: []
    };

    try {
      logger.info(`Generating thumbnail: ${videoFilePath} at ${opts.timestamp || 'auto'}s`);

      // Step 1: Get video info
      const videoInfo = await this.getVideoInfo(videoFilePath);
      
      // Step 2: Determine optimal timestamp
      const timestamp = await this.determineOptimalTimestamp(videoFilePath, videoInfo, opts);
      result.timestamp = timestamp;

      // Step 3: Generate output path
      const outputPath = await this.generateThumbnailPath(videoFilePath, opts, timestamp);
      result.thumbnailPath = outputPath;

      // Step 4: Extract thumbnail
      await this.extractThumbnailFrame(videoFilePath, outputPath, timestamp, opts);

      // Step 5: Get thumbnail info
      const thumbnailInfo = await this.getThumbnailInfo(outputPath);
      result.width = thumbnailInfo.width;
      result.height = thumbnailInfo.height;
      result.fileSize = thumbnailInfo.fileSize;
      result.quality = thumbnailInfo.quality;

      result.processingTime = Date.now() - startTime;
      result.success = true;

      logger.info(`Thumbnail generated: ${result.thumbnailPath} (${result.width}x${result.height})`);

      // Record performance metrics
      this.performanceMonitor.recordMetric({
        name: 'thumbnail.generation.duration',
        value: result.processingTime,
        unit: 'ms',
        timestamp: new Date(),
        tags: {
          format: opts.format,
          size: `${result.width}x${result.height}`,
          success: 'true'
        }
      });

      this.performanceMonitor.endOperation(operationId, 'thumbnail', true);

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown thumbnail error';
      result.errors.push(errorMsg);
      result.processingTime = Date.now() - startTime;

      logger.error(`Thumbnail generation failed for ${videoFilePath}:`, error);

      this.performanceMonitor.recordMetric({
        name: 'thumbnail.generation.error',
        value: 1,
        unit: 'count',
        timestamp: new Date(),
        tags: { error: errorMsg.substring(0, 50) }
      });

      this.performanceMonitor.endOperation(operationId, 'thumbnail', false);
    }

    return result;
  }

  /**
   * Generate multiple thumbnails at different positions
   */
  async generateThumbnailSet(
    videoFilePath: string,
    positions: number[], // Array of timestamps in seconds
    options: Omit<ThumbnailOptions, 'timestamp'> = {}
  ): Promise<ThumbnailResult[]> {
    const results: ThumbnailResult[] = [];

    logger.info(`Generating thumbnail set: ${positions.length} thumbnails`);

    for (let i = 0; i < positions.length; i++) {
      const timestamp = positions[i];
      
      try {
        const result = await this.generateThumbnail(videoFilePath, {
          ...options,
          timestamp,
          outputPath: options.outputPath ? 
            this.addIndexToPath(options.outputPath, i) : 
            undefined
        });
        results.push(result);
      } catch (error) {
        logger.warn(`Failed to generate thumbnail at ${timestamp}s: ${error instanceof Error ? error.message : 'Unknown error'}`);
        
        const errorResult: ThumbnailResult = {
          success: false,
          videoFilePath,
          timestamp,
          width: 0,
          height: 0,
          fileSize: 0,
          processingTime: 0,
          errors: [error instanceof Error ? error.message : 'Unknown error'],
          warnings: []
        };
        results.push(errorResult);
      }
    }

    const successCount = results.filter(r => r.success).length;
    logger.info(`Thumbnail set completed: ${successCount}/${positions.length} successful`);

    return results;
  }

  // Private methods

  private getDefaultSamplingOptions(options: FrameSamplingOptions): Required<FrameSamplingOptions> {
    return {
      method: 'uniform',
      frameCount: 10,
      interval: 30,
      startTime: 0,
      endTime: 0, // 0 means end of video
      outputFormat: 'jpg',
      quality: 85,
      maxWidth: 1280,
      maxHeight: 720,
      outputDirectory: './temp/frames',
      includeTimestamps: true,
      sceneThreshold: 0.3,
      keyframeOnly: false,
      ...options
    };
  }

  private getDefaultThumbnailOptions(options: ThumbnailOptions): Required<ThumbnailOptions> {
    return {
      timestamp: 0, // Will be auto-determined
      position: 'middle',
      width: 320,
      height: 240,
      quality: 85,
      format: 'jpg',
      outputPath: '',
      analyzeQuality: false,
      searchWindow: 5,
      ...options
    };
  }

  private async getVideoInfo(videoFilePath: string): Promise<{
    duration: number;
    width: number;
    height: number;
    fps: number;
    totalFrames: number;
  }> {
    const probeOutput = await this.runFFprobeCommand([
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      '-select_streams', 'v:0',
      videoFilePath
    ]);

    const data = JSON.parse(probeOutput);
    const videoStream = data.streams[0];
    const format = data.format;

    if (!videoStream) {
      throw new Error('No video stream found');
    }

    const duration = parseFloat(format.duration) || 0;
    const width = videoStream.width || 0;
    const height = videoStream.height || 0;
    
    // Calculate FPS
    let fps = 30; // default
    if (videoStream.r_frame_rate) {
      const [num, den] = videoStream.r_frame_rate.split('/').map(Number);
      fps = den > 0 ? num / den : 30;
    }

    const totalFrames = Math.floor(duration * fps);

    return { duration, width, height, fps, totalFrames };
  }

  private async extractUniformFrames(
    videoFilePath: string,
    options: Required<FrameSamplingOptions>,
    result: FrameSamplingResult
  ): Promise<void> {
    const videoInfo = await this.getVideoInfo(videoFilePath);
    const duration = options.endTime > 0 ? 
      Math.min(options.endTime, videoInfo.duration) : 
      videoInfo.duration;
    
    const effectiveDuration = duration - options.startTime;
    const interval = options.interval > 0 ? 
      options.interval : 
      effectiveDuration / Math.max(1, options.frameCount - 1);

    const timestamps: number[] = [];
    for (let i = 0; i < options.frameCount; i++) {
      const timestamp = options.startTime + (i * interval);
      if (timestamp <= duration) {
        timestamps.push(timestamp);
      }
    }

    // Extract frames at calculated timestamps
    for (let i = 0; i < timestamps.length; i++) {
      const timestamp = timestamps[i];
      const frameInfo = await this.extractSingleFrame(
        videoFilePath, 
        timestamp, 
        i, 
        options
      );
      result.frames.push(frameInfo);
    }

    result.totalFramesExtracted = result.frames.length;
  }

  private async extractKeyframes(
    videoFilePath: string,
    options: Required<FrameSamplingOptions>,
    result: FrameSamplingResult
  ): Promise<void> {
    // Use ffprobe to find keyframe positions
    const keyframeData = await this.runFFprobeCommand([
      '-v', 'quiet',
      '-select_streams', 'v:0',
      '-show_entries', 'frame=key_frame,best_effort_timestamp_time',
      '-of', 'csv=p=0',
      '-read_intervals', `${options.startTime}%${options.endTime || '+#'}`,
      videoFilePath
    ]);

    const lines = keyframeData.trim().split('\n');
    const keyframeTimestamps: number[] = [];

    for (const line of lines) {
      const [isKeyframe, timestamp] = line.split(',');
      if (isKeyframe === '1' && timestamp) {
        keyframeTimestamps.push(parseFloat(timestamp));
      }
    }

    // Limit to requested frame count
    const selectedTimestamps = keyframeTimestamps.slice(0, options.frameCount);

    // Extract keyframes
    for (let i = 0; i < selectedTimestamps.length; i++) {
      const timestamp = selectedTimestamps[i];
      const frameInfo = await this.extractSingleFrame(
        videoFilePath, 
        timestamp, 
        i, 
        options,
        { isKeyframe: true }
      );
      result.frames.push(frameInfo);
    }

    result.totalFramesExtracted = result.frames.length;
    result.keyframeCount = result.frames.length;
  }

  private async extractSceneChangeFrames(
    videoFilePath: string,
    options: Required<FrameSamplingOptions>,
    result: FrameSamplingResult
  ): Promise<void> {
    // Use ffmpeg scene detection filter
    const sceneOutput = await this.runFFmpegCommand([
      '-i', videoFilePath,
      '-vf', `select='gt(scene,${options.sceneThreshold})',showinfo`,
      '-vsync', 'vfr',
      '-f', 'null',
      '-'
    ]);

    // Parse scene change timestamps from ffmpeg output
    const sceneTimestamps: number[] = [];
    const timestampRegex = /pts_time:(\d+\.?\d*)/g;
    let match;

    while ((match = timestampRegex.exec(sceneOutput)) !== null) {
      const timestamp = parseFloat(match[1]);
      if (timestamp >= options.startTime && 
          (options.endTime === 0 || timestamp <= options.endTime)) {
        sceneTimestamps.push(timestamp);
      }
    }

    // Limit to requested frame count
    const selectedTimestamps = sceneTimestamps.slice(0, options.frameCount);

    // Extract scene change frames
    for (let i = 0; i < selectedTimestamps.length; i++) {
      const timestamp = selectedTimestamps[i];
      const frameInfo = await this.extractSingleFrame(
        videoFilePath, 
        timestamp, 
        i, 
        options,
        { sceneScore: 1.0 }
      );
      result.frames.push(frameInfo);
    }

    result.totalFramesExtracted = result.frames.length;
    result.sceneChangeCount = result.frames.length;
  }

  private async extractQualityBasedFrames(
    videoFilePath: string,
    options: Required<FrameSamplingOptions>,
    result: FrameSamplingResult
  ): Promise<void> {
    // First extract uniform frames with quality analysis
    const uniformResult = { ...result };
    await this.extractUniformFrames(videoFilePath, {
      ...options,
      frameCount: options.frameCount * 3 // Extract more frames to analyze
    }, uniformResult);

    // Analyze quality of extracted frames
    const framesWithQuality = await this.analyzeFrameQuality(uniformResult.frames);

    // Sort by quality score and select best frames
    const bestFrames = framesWithQuality
      .sort((a, b) => (b.qualityScore || 0) - (a.qualityScore || 0))
      .slice(0, options.frameCount);

    result.frames = bestFrames;
    result.totalFramesExtracted = bestFrames.length;
    result.averageQualityScore = bestFrames.reduce((sum, f) => sum + (f.qualityScore || 0), 0) / bestFrames.length;
  }

  private async extractSingleFrame(
    videoFilePath: string,
    timestamp: number,
    frameNumber: number,
    options: Required<FrameSamplingOptions>,
    metadata: Partial<FrameInfo> = {}
  ): Promise<FrameInfo> {
    const filename = this.generateFrameFilename(timestamp, frameNumber, options);
    const filepath = path.join(options.outputDirectory, filename);

    const ffmpegArgs = [
      '-i', videoFilePath,
      '-ss', timestamp.toString(),
      '-vframes', '1',
      '-q:v', options.quality.toString()
    ];

    // Add scaling if specified
    if (options.maxWidth || options.maxHeight) {
      const scale = `${options.maxWidth || -1}:${options.maxHeight || -1}`;
      ffmpegArgs.push('-vf', `scale=${scale}`);
    }

    ffmpegArgs.push('-update', '1', '-y', filepath);

    await this.runFFmpegCommand(ffmpegArgs);

    // Get frame info
    const stats = await fs.stat(filepath);
    const imageInfo = await this.getImageInfo(filepath);

    return {
      filename,
      filepath,
      timestamp,
      frameNumber,
      fileSize: stats.size,
      width: imageInfo.width,
      height: imageInfo.height,
      ...metadata
    };
  }

  private generateFrameFilename(
    timestamp: number,
    frameNumber: number,
    options: Required<FrameSamplingOptions>
  ): string {
    const base = path.basename(options.outputDirectory);
    const timestampStr = options.includeTimestamps ? 
      `_${Math.floor(timestamp)}s` : '';
    
    return `frame_${frameNumber.toString().padStart(4, '0')}${timestampStr}.${options.outputFormat}`;
  }

  private async determineOptimalTimestamp(
    videoFilePath: string,
    videoInfo: { duration: number },
    options: Required<ThumbnailOptions>
  ): Promise<number> {
    if (options.timestamp > 0) {
      return Math.min(options.timestamp, videoInfo.duration);
    }

    switch (options.position) {
      case 'start':
        return Math.min(10, videoInfo.duration * 0.1); // 10s or 10% into video
      case 'middle':
        return videoInfo.duration / 2;
      case 'end':
        return Math.max(0, videoInfo.duration - 10); // 10s before end
      case 'best-quality':
        return await this.findBestQualityTimestamp(videoFilePath, videoInfo);
      default:
        return videoInfo.duration / 2;
    }
  }

  private async findBestQualityTimestamp(
    videoFilePath: string,
    videoInfo: { duration: number }
  ): Promise<number> {
    // Sample a few frames and find the one with best quality
    const sampleCount = Math.min(5, Math.floor(videoInfo.duration / 60)); // 1 sample per minute, max 5
    const timestamps: number[] = [];
    
    for (let i = 0; i < sampleCount; i++) {
      timestamps.push((videoInfo.duration * (i + 1)) / (sampleCount + 1));
    }

    // For now, return middle timestamp (can be enhanced with actual quality analysis)
    return videoInfo.duration / 2;
  }

  private async generateThumbnailPath(
    videoFilePath: string,
    options: Required<ThumbnailOptions>,
    timestamp: number
  ): Promise<string> {
    if (options.outputPath) {
      return options.outputPath;
    }

    const videoName = path.basename(videoFilePath, path.extname(videoFilePath));
    const timestampStr = Math.floor(timestamp).toString().padStart(4, '0');
    
    return path.join(
      path.dirname(videoFilePath),
      `${videoName}_thumb_${timestampStr}s.${options.format}`
    );
  }

  private async extractThumbnailFrame(
    videoFilePath: string,
    outputPath: string,
    timestamp: number,
    options: Required<ThumbnailOptions>
  ): Promise<void> {
    const ffmpegArgs = [
      '-i', videoFilePath,
      '-ss', timestamp.toString(),
      '-vframes', '1',
      '-vf', `scale=${options.width}:${options.height}`,
      '-q:v', options.quality.toString(),
      '-update', '1',
      '-y', outputPath
    ];

    await this.runFFmpegCommand(ffmpegArgs);
  }

  private async getThumbnailInfo(thumbnailPath: string): Promise<{
    width: number;
    height: number;
    fileSize: number;
    quality?: number;
  }> {
    const stats = await fs.stat(thumbnailPath);
    const imageInfo = await this.getImageInfo(thumbnailPath);
    
    return {
      width: imageInfo.width,
      height: imageInfo.height,
      fileSize: stats.size,
      quality: imageInfo.quality
    };
  }

  private async getImageInfo(imagePath: string): Promise<{
    width: number;
    height: number;
    quality?: number;
  }> {
    try {
      const probeOutput = await this.runFFprobeCommand([
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_streams',
        imagePath
      ]);

      const data = JSON.parse(probeOutput);
      const stream = data.streams[0];

      return {
        width: stream.width || 0,
        height: stream.height || 0
      };
    } catch {
      return { width: 0, height: 0 };
    }
  }

  private async analyzeExtractedFrames(result: FrameSamplingResult): Promise<void> {
    if (result.frames.length === 0) return;

    // Calculate average file size
    result.averageFileSize = result.frames.reduce((sum, frame) => sum + frame.fileSize, 0) / result.frames.length;

    // Count special frame types
    result.keyframeCount = result.frames.filter(f => f.isKeyframe).length;
    result.sceneChangeCount = result.frames.filter(f => f.sceneScore && f.sceneScore > 0.5).length;

    // Calculate average quality score if available
    const qualityScores = result.frames
      .map(f => f.qualityScore)
      .filter(s => s !== undefined) as number[];
    
    if (qualityScores.length > 0) {
      result.averageQualityScore = qualityScores.reduce((sum, score) => sum + score, 0) / qualityScores.length;
    }
  }

  private async analyzeFrameQuality(frames: FrameInfo[]): Promise<FrameInfo[]> {
    // Simple quality analysis based on file size (larger generally means more detail)
    // In production, this could use more sophisticated image analysis
    
    const maxFileSize = Math.max(...frames.map(f => f.fileSize));
    
    return frames.map(frame => ({
      ...frame,
      qualityScore: frame.fileSize / maxFileSize
    }));
  }

  private addIndexToPath(originalPath: string, index: number): string {
    const ext = path.extname(originalPath);
    const base = originalPath.slice(0, -ext.length);
    return `${base}_${index.toString().padStart(2, '0')}${ext}`;
  }

  private async runFFmpegCommand(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const process = spawn('ffmpeg', args);
      let stdout = '';
      let stderr = '';

      process.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      process.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      process.on('close', (code) => {
        if (code === 0) {
          resolve(stderr); // FFmpeg outputs to stderr by default
        } else {
          reject(new Error(`FFmpeg exited with code ${code}: ${stderr}`));
        }
      });

      process.on('error', (error) => {
        reject(new Error(`Failed to run FFmpeg: ${error.message}`));
      });

      setTimeout(() => {
        process.kill();
        reject(new Error(`FFmpeg timed out after ${FrameSampler.FFMPEG_TIMEOUT}ms`));
      }, FrameSampler.FFMPEG_TIMEOUT);
    });
  }

  private async runFFprobeCommand(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const process = spawn('ffprobe', args);
      let stdout = '';
      let stderr = '';

      process.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      process.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      process.on('close', (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`FFprobe exited with code ${code}: ${stderr}`));
        }
      });

      process.on('error', (error) => {
        reject(new Error(`Failed to run FFprobe: ${error.message}`));
      });

      setTimeout(() => {
        process.kill();
        reject(new Error('FFprobe command timed out'));
      }, 30000);
    });
  }
}