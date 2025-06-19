import { FrameSampler, ThumbnailOptions, ThumbnailResult, FrameInfo } from './FrameSampler.js';
import { logger } from '../../utils/logger.js';
import { PerformanceMonitor } from '../platforms/PerformanceMonitor.js';

export interface VideoInfo {
  duration: number;
  width: number;
  height: number;
  frameRate: number;
  totalFrames: number;
}

export interface OnDemandFrameOptions extends ThumbnailOptions {
  cacheFrame?: boolean; // Whether to cache extracted frames
  useCache?: boolean; // Whether to use cached frames if available
}

/**
 * Lazy frame extraction service for audio-first processing
 * Only extracts frames when specifically requested, not during initial video processing
 */
export class LazyFrameExtractor {
  private frameSampler: FrameSampler;
  private performanceMonitor: PerformanceMonitor;
  private videoInfoCache = new Map<string, VideoInfo>();
  private frameCache = new Map<string, FrameInfo>();

  constructor() {
    this.frameSampler = new FrameSampler();
    this.performanceMonitor = new PerformanceMonitor();
  }

  /**
   * Prepare video for on-demand frame extraction
   * Only extracts metadata, doesn't process any frames
   */
  async prepareVideo(videoPath: string): Promise<VideoInfo> {
    const operationId = `prepareVideo-${Date.now()}`;
    this.performanceMonitor.startOperation(operationId);

    try {
      // Check cache first
      if (this.videoInfoCache.has(videoPath)) {
        const cached = this.videoInfoCache.get(videoPath)!;
        logger.debug(`Using cached video info for: ${videoPath}`);
        return cached;
      }

      // Extract only video metadata (lightweight operation)
      const videoInfo = await this.getVideoInfo(videoPath);
      this.videoInfoCache.set(videoPath, videoInfo);

      logger.debug(`Prepared video for on-demand extraction: ${videoPath}`, {
        duration: videoInfo.duration,
        totalFrames: videoInfo.totalFrames
      });

      this.performanceMonitor.endOperation(operationId, 'video-preparation', true);
      return videoInfo;

    } catch (error) {
      logger.error(`Failed to prepare video for extraction: ${videoPath}`, error);
      this.performanceMonitor.endOperation(operationId, 'video-preparation', false);
      throw error;
    }
  }

  /**
   * Extract a single frame at the specified timestamp
   * Only processes the requested frame, not the entire video
   */
  async extractFrameOnDemand(
    videoPath: string,
    timestamp: number,
    options: OnDemandFrameOptions = {}
  ): Promise<ThumbnailResult> {
    const operationId = `extractFrame-${Date.now()}`;
    this.performanceMonitor.startOperation(operationId);

    try {
      const cacheKey = `${videoPath}:${timestamp}:${JSON.stringify(options)}`;

      // Check frame cache if enabled
      if (options.useCache && this.frameCache.has(cacheKey)) {
        logger.debug(`Using cached frame: ${videoPath} at ${timestamp}s`);
        const cachedFrame = this.frameCache.get(cacheKey)!;
        return {
          success: true,
          videoFilePath: videoPath,
          thumbnailPath: cachedFrame.filepath,
          timestamp: cachedFrame.timestamp,
          width: cachedFrame.width,
          height: cachedFrame.height,
          fileSize: cachedFrame.fileSize,
          processingTime: 0, // Cached, no processing time
          errors: [],
          warnings: []
        };
      }

      // Extract frame using existing FrameSampler
      const result = await this.frameSampler.generateThumbnail(videoPath, {
        timestamp,
        ...options
      });

      // Cache the result if enabled
      if (options.cacheFrame && result.success && result.thumbnailPath) {
        const frameInfo: FrameInfo = {
          filename: result.thumbnailPath.split('/').pop() || '',
          filepath: result.thumbnailPath,
          timestamp: result.timestamp,
          frameNumber: Math.floor(timestamp * 30), // Approximate frame number
          fileSize: result.fileSize,
          width: result.width,
          height: result.height
        };
        this.frameCache.set(cacheKey, frameInfo);
      }

      logger.debug(`Extracted frame on-demand: ${videoPath} at ${timestamp}s`, {
        success: result.success,
        processingTime: result.processingTime
      });

      this.performanceMonitor.recordMetric({
        name: 'frame.extraction.ondemand.duration',
        value: result.processingTime,
        unit: 'ms',
        timestamp: new Date(),
        tags: {
          success: result.success.toString(),
          cached: 'false'
        }
      });

      this.performanceMonitor.endOperation(operationId, 'frame-extraction', result.success);
      return result;

    } catch (error) {
      logger.error(`Failed to extract frame on-demand: ${videoPath} at ${timestamp}s`, error);
      this.performanceMonitor.endOperation(operationId, 'frame-extraction', false);
      throw error;
    }
  }

  /**
   * Extract frames for multiple timestamps efficiently
   * Optimized for search result enhancement
   */
  async extractFramesForTimestamps(
    videoPath: string,
    timestamps: number[],
    options: OnDemandFrameOptions = {}
  ): Promise<ThumbnailResult[]> {
    const operationId = `extractMultipleFrames-${Date.now()}`;
    this.performanceMonitor.startOperation(operationId);

    try {
      logger.debug(`Extracting ${timestamps.length} frames for: ${videoPath}`);

      // Process frames concurrently but limit concurrency to avoid overwhelming system
      const results: ThumbnailResult[] = [];
      const batchSize = 3; // Process 3 frames at a time

      for (let i = 0; i < timestamps.length; i += batchSize) {
        const batch = timestamps.slice(i, i + batchSize);
        const batchPromises = batch.map(timestamp =>
          this.extractFrameOnDemand(videoPath, timestamp, options)
        );

        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);
      }

      const successCount = results.filter(r => r.success).length;
      logger.info(`Extracted ${successCount}/${timestamps.length} frames for: ${videoPath}`);

      this.performanceMonitor.endOperation(operationId, 'multi-frame-extraction', true);
      return results;

    } catch (error) {
      logger.error(`Failed to extract multiple frames: ${videoPath}`, error);
      this.performanceMonitor.endOperation(operationId, 'multi-frame-extraction', false);
      throw error;
    }
  }

  /**
   * Get suggested timestamps for frame extraction based on video duration
   */
  async getSuggestedTimestamps(
    videoPath: string,
    frameCount: number = 5
  ): Promise<number[]> {
    const videoInfo = await this.prepareVideo(videoPath);
    const timestamps: number[] = [];

    // Distribute frames evenly across video duration, avoiding very start/end
    const padding = videoInfo.duration * 0.05; // 5% padding from start/end
    const effectiveDuration = videoInfo.duration - (2 * padding);
    const interval = effectiveDuration / (frameCount - 1);

    for (let i = 0; i < frameCount; i++) {
      const timestamp = padding + (i * interval);
      timestamps.push(Math.round(timestamp * 100) / 100); // Round to 2 decimal places
    }

    return timestamps;
  }

  /**
   * Clear caches to free memory
   */
  clearCaches(): void {
    this.videoInfoCache.clear();
    this.frameCache.clear();
    logger.debug('Cleared frame extraction caches');
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { videoInfoCached: number; framesCached: number } {
    return {
      videoInfoCached: this.videoInfoCache.size,
      framesCached: this.frameCache.size
    };
  }

  private async getVideoInfo(videoPath: string): Promise<VideoInfo> {
    // Use existing FrameSampler method to get video info
    // This is a lightweight operation that only reads metadata
    return new Promise((resolve, reject) => {
      const { spawn } = require('child_process');
      
      const process = spawn('ffprobe', [
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_format',
        '-show_streams',
        videoPath
      ]);

      let output = '';
      process.stdout.on('data', (data: Buffer) => {
        output += data.toString();
      });

      process.on('close', (code: number) => {
        if (code !== 0) {
          reject(new Error(`ffprobe failed with code ${code}`));
          return;
        }

        try {
          const data = JSON.parse(output);
          const videoStream = data.streams.find((s: any) => s.codec_type === 'video');
          
          if (!videoStream) {
            reject(new Error('No video stream found'));
            return;
          }

          const duration = parseFloat(data.format.duration) || 0;
          const frameRate = this.parseFrameRate(videoStream.r_frame_rate) || 30;
          
          resolve({
            duration,
            width: videoStream.width || 0,
            height: videoStream.height || 0,
            frameRate,
            totalFrames: Math.floor(duration * frameRate)
          });

        } catch (error) {
          reject(new Error(`Failed to parse ffprobe output: ${error}`));
        }
      });

      process.on('error', (error: Error) => {
        reject(new Error(`Failed to run ffprobe: ${error.message}`));
      });
    });
  }

  private parseFrameRate(frameRateString: string): number {
    if (!frameRateString) return 30;
    
    if (frameRateString.includes('/')) {
      const [num, den] = frameRateString.split('/').map(Number);
      return den > 0 ? num / den : 30;
    }
    
    return parseFloat(frameRateString) || 30;
  }
}