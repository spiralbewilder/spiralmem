import { spawn } from 'child_process';
import { logger } from '../../utils/logger.js';
import { VideoValidationResult } from './VideoValidator.js';

export interface VideoMetadata {
  duration: number; // seconds
  format: string;
  fileSize: number;
  bitrate: number;
  
  // Video stream info
  videoCodec: string;
  resolution: {
    width: number;
    height: number;
  };
  fps: number;
  videoBitrate?: number;
  
  // Audio stream info
  hasAudio: boolean;
  audioCodec?: string;
  audioSampleRate?: number;
  audioChannels?: number;
  audioBitrate?: number;
  
  // Additional metadata
  createdAt?: Date;
  title?: string;
  artist?: string;
  album?: string;
  comment?: string;
  
  // Technical details
  containerFormat: string;
  streamCount: number;
  chapters: VideoChapter[];
  
  // Quality assessment
  estimatedQuality: 'low' | 'medium' | 'high' | 'very_high';
  
  // Extraction info
  extractedAt: Date;
  extractionTime: number; // ms
}

export interface VideoChapter {
  id: number;
  title?: string;
  startTime: number; // seconds
  endTime: number; // seconds
}

export interface FFprobeStream {
  index: number;
  codec_name: string;
  codec_type: 'video' | 'audio' | 'subtitle' | 'data';
  width?: number;
  height?: number;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  sample_rate?: string;
  channels?: number;
  bit_rate?: string;
  duration?: string;
  tags?: Record<string, string>;
}

export interface FFprobeFormat {
  filename: string;
  nb_streams: number;
  format_name: string;
  format_long_name: string;
  start_time: string;
  duration: string;
  size: string;
  bit_rate: string;
  probe_score: number;
  tags?: Record<string, string>;
}

export interface FFprobeOutput {
  streams: FFprobeStream[];
  format: FFprobeFormat;
  chapters?: Array<{
    id: number;
    time_base: string;
    start: number;
    start_time: string;
    end: number;
    end_time: string;
    tags?: Record<string, string>;
  }>;
}

/**
 * FFmpeg-based metadata extraction for video files
 * Uses ffprobe to extract comprehensive video metadata
 */
export class MetadataExtractor {
  private static readonly FFPROBE_TIMEOUT = 30000; // 30 seconds
  
  /**
   * Extract complete metadata from a video file
   */
  static async extractMetadata(filePath: string): Promise<VideoMetadata> {
    const startTime = Date.now();
    
    try {
      logger.info(`Starting metadata extraction for: ${filePath}`);
      
      // Run ffprobe to get detailed metadata
      const ffprobeData = await this.runFFprobe(filePath);
      
      // Parse and convert to our metadata format
      const metadata = this.parseFFprobeOutput(ffprobeData, filePath);
      
      metadata.extractedAt = new Date();
      metadata.extractionTime = Date.now() - startTime;
      
      logger.info(`Metadata extraction completed in ${metadata.extractionTime}ms`);
      return metadata;
      
    } catch (error) {
      logger.error(`Metadata extraction failed for ${filePath}:`, error);
      throw new Error(`Failed to extract metadata: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Extract metadata and update validation result
   */
  static async extractAndValidateMetadata(
    validationResult: VideoValidationResult
  ): Promise<VideoValidationResult> {
    if (!validationResult.isValid) {
      return validationResult;
    }

    try {
      const metadata = await this.extractMetadata(validationResult.fileInfo.filePath);
      validationResult.metadata = {
        duration: metadata.duration,
        format: metadata.containerFormat,
        codec: metadata.videoCodec,
        resolution: metadata.resolution,
        bitrate: metadata.bitrate,
        fps: metadata.fps,
        hasAudio: metadata.hasAudio,
        audioCodec: metadata.audioCodec,
        createdAt: metadata.createdAt
      };

      // Additional validations based on metadata
      this.validateMetadata(metadata, validationResult);

    } catch (error) {
      validationResult.warnings.push(`Could not extract metadata: ${error instanceof Error ? error.message : 'Unknown error'}`);
      logger.warn(`Metadata extraction failed for ${validationResult.fileInfo.filePath}:`, error);
    }

    return validationResult;
  }

  /**
   * Check if FFmpeg/ffprobe is available
   */
  static async checkFFmpegAvailability(): Promise<{
    ffmpeg: boolean;
    ffprobe: boolean;
    version?: string;
  }> {
    const result = {
      ffmpeg: false,
      ffprobe: false,
      version: undefined as string | undefined
    };

    try {
      // Check ffprobe
      const ffprobeVersion = await this.runCommand('ffprobe', ['-version']);
      result.ffprobe = true;
      
      // Extract version
      const versionMatch = ffprobeVersion.match(/ffprobe version (\S+)/);
      if (versionMatch) {
        result.version = versionMatch[1];
      }
      
      // Check ffmpeg
      await this.runCommand('ffmpeg', ['-version']);
      result.ffmpeg = true;
      
    } catch (error) {
      logger.warn('FFmpeg/ffprobe not available:', error instanceof Error ? error.message : 'Unknown error');
    }

    return result;
  }

  // Private methods

  private static async runFFprobe(filePath: string): Promise<FFprobeOutput> {
    const args = [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      '-show_chapters',
      filePath
    ];

    const output = await this.runCommand('ffprobe', args);
    
    try {
      return JSON.parse(output) as FFprobeOutput;
    } catch (error) {
      throw new Error(`Failed to parse ffprobe output: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private static runCommand(command: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const process = spawn(command, args);
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
          reject(new Error(`${command} exited with code ${code}: ${stderr}`));
        }
      });

      process.on('error', (error) => {
        reject(new Error(`Failed to run ${command}: ${error instanceof Error ? error.message : 'Unknown error'}`));
      });

      // Set timeout
      setTimeout(() => {
        process.kill();
        reject(new Error(`${command} timed out after ${this.FFPROBE_TIMEOUT}ms`));
      }, this.FFPROBE_TIMEOUT);
    });
  }

  private static parseFFprobeOutput(data: FFprobeOutput, filePath: string): VideoMetadata {
    const format = data.format;
    const videoStream = data.streams.find(s => s.codec_type === 'video');
    const audioStream = data.streams.find(s => s.codec_type === 'audio');

    if (!videoStream) {
      throw new Error('No video stream found in file');
    }

    // Parse duration
    const duration = parseFloat(format.duration);
    if (isNaN(duration)) {
      throw new Error('Could not determine video duration');
    }

    // Parse resolution
    const width = videoStream.width || 0;
    const height = videoStream.height || 0;
    if (width === 0 || height === 0) {
      throw new Error('Could not determine video resolution');
    }

    // Parse frame rate
    const fps = this.parseFrameRate(videoStream.r_frame_rate || videoStream.avg_frame_rate);

    // Parse bitrates
    const bitrate = parseInt(format.bit_rate) || 0;
    const videoBitrate = videoStream.bit_rate ? parseInt(videoStream.bit_rate) : undefined;
    const audioBitrate = audioStream?.bit_rate ? parseInt(audioStream.bit_rate) : undefined;

    // Parse chapters
    const chapters: VideoChapter[] = (data.chapters || []).map(chapter => ({
      id: chapter.id,
      title: chapter.tags?.title,
      startTime: parseFloat(chapter.start_time),
      endTime: parseFloat(chapter.end_time)
    }));

    // Estimate quality
    const estimatedQuality = this.estimateQuality(width, height, bitrate, fps);

    const metadata: VideoMetadata = {
      duration,
      format: format.format_name,
      fileSize: parseInt(format.size),
      bitrate,
      
      videoCodec: videoStream.codec_name,
      resolution: { width, height },
      fps,
      videoBitrate,
      
      hasAudio: !!audioStream,
      audioCodec: audioStream?.codec_name,
      audioSampleRate: audioStream?.sample_rate ? parseInt(audioStream.sample_rate) : undefined,
      audioChannels: audioStream?.channels,
      audioBitrate,
      
      // Extract metadata tags
      createdAt: this.parseCreationDate(format.tags || videoStream.tags),
      title: format.tags?.title || videoStream.tags?.title,
      artist: format.tags?.artist || videoStream.tags?.artist,
      album: format.tags?.album || videoStream.tags?.album,
      comment: format.tags?.comment || videoStream.tags?.comment,
      
      containerFormat: format.format_name,
      streamCount: data.streams.length,
      chapters,
      
      estimatedQuality,
      
      extractedAt: new Date(),
      extractionTime: 0 // Will be set by caller
    };

    return metadata;
  }

  private static parseFrameRate(frameRateStr?: string): number {
    if (!frameRateStr) return 0;
    
    // Handle fraction format like "30/1" or "2997/100"
    if (frameRateStr.includes('/')) {
      const [num, den] = frameRateStr.split('/').map(parseFloat);
      return den > 0 ? num / den : 0;
    }
    
    return parseFloat(frameRateStr) || 0;
  }

  private static parseCreationDate(tags?: Record<string, string>): Date | undefined {
    if (!tags) return undefined;
    
    const dateFields = ['creation_time', 'date', 'creation_date', 'encoded_date'];
    
    for (const field of dateFields) {
      const dateStr = tags[field];
      if (dateStr) {
        const date = new Date(dateStr);
        if (!isNaN(date.getTime())) {
          return date;
        }
      }
    }
    
    return undefined;
  }

  private static estimateQuality(
    width: number, 
    height: number, 
    bitrate: number, 
    fps: number
  ): 'low' | 'medium' | 'high' | 'very_high' {
    const pixels = width * height;
    const bitratePerPixel = bitrate / pixels;
    
    // HD thresholds
    if (height >= 2160) { // 4K
      return bitratePerPixel > 0.1 ? 'very_high' : 'high';
    } else if (height >= 1080) { // Full HD
      return bitratePerPixel > 0.05 ? 'high' : 'medium';
    } else if (height >= 720) { // HD
      return bitratePerPixel > 0.03 ? 'medium' : 'low';
    } else { // SD
      return bitratePerPixel > 0.02 ? 'medium' : 'low';
    }
  }

  private static validateMetadata(metadata: VideoMetadata, result: VideoValidationResult): void {
    // Check duration
    if (metadata.duration < 1) {
      result.warnings.push('Video duration is very short (< 1 second)');
    } else if (metadata.duration > 8 * 60 * 60) { // 8 hours
      result.warnings.push('Video duration is very long (> 8 hours)');
    }

    // Check resolution
    if (metadata.resolution.width < 240 || metadata.resolution.height < 180) {
      result.warnings.push('Video resolution is very low');
    }

    // Check frame rate
    if (metadata.fps < 15) {
      result.warnings.push('Video frame rate is very low');
    } else if (metadata.fps > 120) {
      result.warnings.push('Video frame rate is unusually high');
    }

    // Check if video has audio
    if (!metadata.hasAudio) {
      result.warnings.push('Video has no audio track');
    }

    // Check bitrate
    if (metadata.bitrate < 100000) { // 100 kbps
      result.warnings.push('Video bitrate is very low');
    }

    // Log quality assessment
    logger.info(`Video quality assessment: ${metadata.estimatedQuality} (${metadata.resolution.width}x${metadata.resolution.height}, ${Math.round(metadata.bitrate/1000)}kbps)`);
  }
}