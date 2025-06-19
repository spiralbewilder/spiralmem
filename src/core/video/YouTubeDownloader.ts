import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { logger } from '../../utils/logger.js';
import { PerformanceMonitor } from '../platforms/PerformanceMonitor.js';

export interface YouTubeDownloadOptions {
  outputDirectory?: string;
  format?: 'mp4' | 'webm' | 'mkv' | 'best';
  quality?: 'highest' | 'lowest' | '720p' | '1080p' | '480p';
  audioOnly?: boolean;
  extractAudioFormat?: 'mp3' | 'wav' | 'aac' | 'm4a';
  maxFileSize?: string; // e.g., '100M', '1G'
  maxDuration?: number; // seconds
  subtitles?: boolean;
  embedSubtitles?: boolean;
}

export interface YouTubeVideoInfo {
  id: string;
  title: string;
  uploader: string;
  duration: number; // seconds
  description: string;
  uploadDate: string;
  viewCount?: number;
  likeCount?: number;
  thumbnail?: string;
  url: string;
  fileSize?: number;
  format?: string;
}

export interface YouTubeDownloadResult {
  success: boolean;
  videoInfo?: YouTubeVideoInfo;
  downloadedFile?: string;
  downloadTime: number; // ms
  errors: string[];
  warnings: string[];
  
  // Processing hints for video workflow
  suggestedTitle?: string;
  extractedAudioPath?: string;
  subtitlePath?: string;
}

/**
 * YouTube video downloader using yt-dlp
 * Provides safe, configurable downloading for video processing pipeline
 */
export class YouTubeDownloader {
  private performanceMonitor: PerformanceMonitor;
  
  constructor() {
    this.performanceMonitor = new PerformanceMonitor();
  }

  /**
   * Download YouTube video for processing
   */
  async downloadVideo(
    url: string, 
    options: YouTubeDownloadOptions = {}
  ): Promise<YouTubeDownloadResult> {
    const operationId = `downloadVideo-${Date.now()}`;
    this.performanceMonitor.startOperation(operationId);
    const startTime = Date.now();

    const opts = this.getDefaultOptions(options);
    const result: YouTubeDownloadResult = {
      success: false,
      downloadTime: 0,
      errors: [],
      warnings: []
    };

    try {
      logger.info(`Starting YouTube download: ${url}`);

      // Step 1: Validate yt-dlp availability
      await this.checkYtDlpAvailable();

      // Step 2: Extract video info first (fast operation)
      const videoInfo = await this.extractVideoInfo(url);
      result.videoInfo = videoInfo;
      result.suggestedTitle = this.sanitizeTitle(videoInfo.title);

      // Step 3: Validate video constraints
      this.validateVideoConstraints(videoInfo, opts);

      // Step 4: Ensure output directory exists
      await fs.mkdir(opts.outputDirectory!, { recursive: true });

      // Step 5: Download video
      const downloadedFile = await this.performDownload(url, videoInfo, opts);
      result.downloadedFile = downloadedFile;

      // Step 6: Post-download processing
      if (opts.audioOnly) {
        result.extractedAudioPath = downloadedFile;
      }

      result.downloadTime = Date.now() - startTime;
      result.success = true;

      logger.info(`YouTube download completed: ${downloadedFile} (${result.downloadTime}ms)`);

      this.performanceMonitor.recordMetric({
        name: 'youtube.download.duration',
        value: result.downloadTime,
        unit: 'ms',
        timestamp: new Date(),
        tags: {
          format: opts.format,
          quality: opts.quality,
          success: 'true',
          videoId: videoInfo.id
        }
      });

      this.performanceMonitor.endOperation(operationId, 'youtube-download', true);

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown download error';
      result.errors.push(errorMsg);
      result.downloadTime = Date.now() - startTime;

      logger.error(`YouTube download failed for ${url}:`, error);

      this.performanceMonitor.recordMetric({
        name: 'youtube.download.error',
        value: 1,
        unit: 'count',
        timestamp: new Date(),
        tags: { error: errorMsg.substring(0, 50) }
      });

      this.performanceMonitor.endOperation(operationId, 'youtube-download', false);
    }

    return result;
  }

  /**
   * Download specific time segments from YouTube/Rumble videos
   */
  async downloadSegments(url: string, segments: Array<{
    startMs: number;
    endMs: number;
    outputName?: string;
  }>, options: {
    outputDirectory?: string;
    format?: 'mp4' | 'webm' | 'mkv';
    quality?: string;
  } = {}): Promise<{
    success: boolean;
    segments: Array<{
      startMs: number;
      endMs: number;
      filePath: string;
      duration: number;
      success: boolean;
      error?: string;
    }>;
    errors: string[];
    totalDownloadTime: number;
  }> {
    const startTime = Date.now();
    const operationId = `downloadSegments-${Date.now()}`;
    this.performanceMonitor.startOperation(operationId);

    const opts = {
      outputDirectory: './temp/segments',
      format: 'mp4' as const,
      quality: '720p',
      ...options
    };

    const result = {
      success: false,
      segments: [] as Array<{
        startMs: number;
        endMs: number;
        filePath: string;
        duration: number;
        success: boolean;
        error?: string;
      }>,
      errors: [] as string[],
      totalDownloadTime: 0
    };

    try {
      // Ensure output directory exists
      await fs.mkdir(opts.outputDirectory, { recursive: true });

      // Get video info first to validate URL
      const videoInfo = await this.extractVideoInfo(url);
      if (!videoInfo.id) {
        throw new Error('Could not extract video ID from URL');
      }

      logger.info(`Downloading ${segments.length} segments from: ${videoInfo.title}`);

      // Download each segment
      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        const segmentResult = {
          startMs: segment.startMs,
          endMs: segment.endMs,
          filePath: '',
          duration: (segment.endMs - segment.startMs) / 1000,
          success: false,
          error: undefined as string | undefined
        };

        try {
          const startSec = segment.startMs / 1000;
          const endSec = segment.endMs / 1000;
          const duration = endSec - startSec;

          // Generate output filename
          const timestamp = `${startSec.toFixed(1)}s-${endSec.toFixed(1)}s`;
          const filename = segment.outputName || 
            `${videoInfo.id}_${timestamp}_${Math.random().toString(36).substr(2, 6)}.${opts.format}`;
          const outputPath = path.join(opts.outputDirectory, filename);

          logger.info(`Downloading segment ${i + 1}/${segments.length}: ${timestamp} (${duration.toFixed(1)}s)`);

          // Use yt-dlp with time range options
          await this.downloadVideoSegment(url, outputPath, startSec, endSec, opts);

          segmentResult.filePath = outputPath;
          segmentResult.success = true;

          logger.info(`Segment downloaded: ${filename}`);

        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown segment download error';
          segmentResult.error = errorMsg;
          result.errors.push(`Segment ${i + 1} (${segment.startMs}-${segment.endMs}ms): ${errorMsg}`);
          logger.error(`Failed to download segment ${i + 1}:`, error);
        }

        result.segments.push(segmentResult);
      }

      const successfulSegments = result.segments.filter(s => s.success).length;
      result.success = successfulSegments > 0;
      result.totalDownloadTime = Date.now() - startTime;

      logger.info(`Segment download completed: ${successfulSegments}/${segments.length} successful (${result.totalDownloadTime}ms)`);

      this.performanceMonitor.recordMetric({
        name: 'youtube.segments.download.duration',
        value: result.totalDownloadTime,
        unit: 'ms',
        timestamp: new Date(),
        tags: {
          totalSegments: segments.length.toString(),
          successful: successfulSegments.toString(),
          videoId: videoInfo.id
        }
      });

      this.performanceMonitor.endOperation(operationId, 'segment-download', result.success);

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown segments download error';
      result.errors.push(errorMsg);
      result.totalDownloadTime = Date.now() - startTime;

      logger.error(`Segments download failed for ${url}:`, error);

      this.performanceMonitor.recordMetric({
        name: 'youtube.segments.download.error',
        value: 1,
        unit: 'count',
        timestamp: new Date(),
        tags: { error: errorMsg.substring(0, 50) }
      });

      this.performanceMonitor.endOperation(operationId, 'segment-download', false);
    }

    return result;
  }

  /**
   * Download a single video segment using yt-dlp
   */
  private async downloadVideoSegment(
    url: string, 
    outputPath: string, 
    startSec: number, 
    endSec: number,
    options: { format: string; quality: string }
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = [
        url,
        '--format', `best[height<=${options.quality.replace('p', '')}]`,
        '--output', outputPath,
        '--external-downloader', 'ffmpeg',
        '--external-downloader-args', `ffmpeg_i:-ss ${startSec} -to ${endSec}`,
        '--no-playlist',
        '--no-warnings',
        '--ignore-errors',
        '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        '--referer', 'https://www.youtube.com/',
        '--extractor-retries', '3',
        '--fragment-retries', '3',
        '--retry-sleep', '1'
      ];

      logger.debug(`yt-dlp segment command: ${args.join(' ')}`);

      const process = spawn('yt-dlp', args);
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
          resolve();
        } else {
          reject(new Error(`yt-dlp segment download failed: ${stderr}`));
        }
      });

      process.on('error', (error) => {
        reject(new Error(`Failed to run yt-dlp: ${error.message}`));
      });

      // Timeout after 5 minutes per segment
      setTimeout(() => {
        process.kill();
        reject(new Error('Segment download timed out'));
      }, 300000);
    });
  }

  /**
   * Extract video information without downloading
   */
  async extractVideoInfo(url: string): Promise<YouTubeVideoInfo> {
    return new Promise((resolve, reject) => {
      const process = spawn('yt-dlp', [
        '--dump-json',
        '--no-download',
        '--no-warnings',
        '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        '--referer', 'https://www.youtube.com/',
        '--extractor-retries', '3',
        url
      ]);

      let output = '';
      let errorOutput = '';

      process.stdout.on('data', (data: Buffer) => {
        output += data.toString();
      });

      process.stderr.on('data', (data: Buffer) => {
        errorOutput += data.toString();
      });

      process.on('close', (code: number) => {
        if (code !== 0) {
          reject(new Error(`yt-dlp info extraction failed: ${errorOutput}`));
          return;
        }

        try {
          const info = JSON.parse(output);
          
          const videoInfo: YouTubeVideoInfo = {
            id: info.id || '',
            title: info.title || 'Unknown Title',
            uploader: info.uploader || info.channel || 'Unknown',
            duration: info.duration || 0,
            description: info.description || '',
            uploadDate: info.upload_date || '',
            viewCount: info.view_count,
            likeCount: info.like_count,
            thumbnail: info.thumbnail,
            url: info.webpage_url || url,
            fileSize: info.filesize,
            format: info.ext
          };

          resolve(videoInfo);

        } catch (parseError) {
          reject(new Error(`Failed to parse video info: ${parseError}`));
        }
      });

      process.on('error', (error: Error) => {
        reject(new Error(`Failed to run yt-dlp: ${error.message}`));
      });
    });
  }

  /**
   * Check if yt-dlp is available
   */
  async checkYtDlpAvailable(): Promise<void> {
    return new Promise((resolve, reject) => {
      const process = spawn('yt-dlp', ['--version']);
      
      let version = '';
      process.stdout.on('data', (data: Buffer) => {
        version += data.toString();
      });

      process.on('close', (code: number) => {
        if (code === 0) {
          logger.debug(`yt-dlp available: ${version.trim()}`);
          resolve();
        } else {
          reject(new Error('yt-dlp not found. Please install yt-dlp: pip install yt-dlp'));
        }
      });

      process.on('error', () => {
        reject(new Error('yt-dlp not found. Please install yt-dlp: pip install yt-dlp'));
      });
    });
  }

  private async performDownload(
    url: string, 
    videoInfo: YouTubeVideoInfo, 
    options: Required<YouTubeDownloadOptions>
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const outputTemplate = path.join(
        options.outputDirectory,
        `${this.sanitizeFilename(videoInfo.title)}-${videoInfo.id}.%(ext)s`
      );

      const args = [
        '--format', this.getFormatSelector(options),
        '--output', outputTemplate,
        '--no-warnings',
        '--no-playlist',
        '--ignore-errors',
        '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        '--referer', 'https://www.youtube.com/',
        '--extractor-retries', '3',
        '--fragment-retries', '3',
        '--retry-sleep', '1',
        url
      ];

      // Add optional flags
      if (options.maxFileSize) {
        args.push('--max-filesize', options.maxFileSize);
      }

      if (options.subtitles) {
        args.push('--write-subs');
        if (options.embedSubtitles) {
          args.push('--embed-subs');
        }
      }

      // Extract audio if requested
      if (options.audioOnly) {
        args.push('--extract-audio');
        args.push('--audio-format', options.extractAudioFormat!);
      }

      logger.debug(`Running yt-dlp with args: ${args.join(' ')}`);

      const process = spawn('yt-dlp', args);
      
      let downloadedFile = '';
      let errorOutput = '';

      process.stdout.on('data', (data: Buffer) => {
        const output = data.toString();
        // Extract downloaded filename from yt-dlp output
        const downloadMatch = output.match(/\[download\] Destination: (.+)/);
        if (downloadMatch) {
          downloadedFile = downloadMatch[1];
        }
        
        // Log progress for long downloads
        const progressMatch = output.match(/\[download\]\s+(\d+\.\d+)%/);
        if (progressMatch) {
          logger.debug(`Download progress: ${progressMatch[1]}%`);
        }
      });

      process.stderr.on('data', (data: Buffer) => {
        errorOutput += data.toString();
      });

      process.on('close', (code: number) => {
        if (code === 0 && downloadedFile) {
          resolve(downloadedFile);
        } else {
          reject(new Error(`yt-dlp download failed: ${errorOutput}`));
        }
      });

      process.on('error', (error: Error) => {
        reject(new Error(`Failed to run yt-dlp: ${error.message}`));
      });
    });
  }

  private getDefaultOptions(options: YouTubeDownloadOptions): Required<YouTubeDownloadOptions> {
    return {
      outputDirectory: './temp/youtube-downloads',
      format: 'mp4',
      quality: '720p',
      audioOnly: false,
      extractAudioFormat: 'wav',
      maxFileSize: '500M', // 500MB limit by default
      maxDuration: 3600, // 1 hour limit by default
      subtitles: false,
      embedSubtitles: false,
      ...options
    };
  }

  private getFormatSelector(options: Required<YouTubeDownloadOptions>): string {
    if (options.audioOnly) {
      return 'bestaudio';
    }

    // Build format selector based on quality preference
    switch (options.quality) {
      case 'highest':
        return `best[ext=${options.format}]/best`;
      case 'lowest':
        return `worst[ext=${options.format}]/worst`;
      case '1080p':
        return `best[height<=1080][ext=${options.format}]/best[height<=1080]/best`;
      case '720p':
        return `best[height<=720][ext=${options.format}]/best[height<=720]/best`;
      case '480p':
        return `best[height<=480][ext=${options.format}]/best[height<=480]/best`;
      default:
        return `best[ext=${options.format}]/best`;
    }
  }

  private validateVideoConstraints(
    videoInfo: YouTubeVideoInfo, 
    options: Required<YouTubeDownloadOptions>
  ): void {
    if (options.maxDuration && videoInfo.duration > options.maxDuration) {
      throw new Error(
        `Video duration (${Math.round(videoInfo.duration / 60)}min) exceeds maximum allowed (${Math.round(options.maxDuration / 60)}min)`
      );
    }

    if (!videoInfo.title || videoInfo.title.trim() === '') {
      throw new Error('Video title is empty or unavailable');
    }
  }

  private sanitizeTitle(title: string): string {
    return title
      .replace(/[^\w\s-]/g, '') // Remove special characters
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim()
      .substring(0, 100); // Limit length
  }

  private sanitizeFilename(filename: string): string {
    return filename
      .replace(/[<>:"/\\|?*]/g, '') // Remove filesystem-invalid characters
      .replace(/\s+/g, '_') // Replace spaces with underscores
      .substring(0, 50); // Limit length for filesystem compatibility
  }
}