import { VideoDeepLink } from '../../models/types.js';

export interface YouTubeDeepLinkOptions {
  videoId: string;
  timestamp?: number;
  playlistId?: string;
  playlistIndex?: number;
  quality?: 'auto' | 'small' | 'medium' | 'large' | 'hd720' | 'hd1080' | 'hd1440' | 'hd2160';
  autoplay?: boolean;
  muted?: boolean;
  loop?: boolean;
  controls?: boolean;
  startSeconds?: number;
  endSeconds?: number;
}

export interface YouTubeTimestampRange {
  start: number;
  end?: number;
  title?: string;
  description?: string;
}

/**
 * Utility class for generating YouTube deep-links with timestamp precision
 * Supports various YouTube URL formats and parameters
 */
export class YouTubeDeepLinkGenerator {
  /**
   * Generate a standard YouTube deep-link with timestamp
   */
  static generateTimestampUrl(videoId: string, timestamp: number, options?: Partial<YouTubeDeepLinkOptions>): string {
    const params = new URLSearchParams();
    params.set('v', videoId);
    
    if (timestamp > 0) {
      params.set('t', `${timestamp}s`);
    }
    
    if (options?.playlistId) {
      params.set('list', options.playlistId);
      if (options.playlistIndex !== undefined) {
        params.set('index', options.playlistIndex.toString());
      }
    }
    
    if (options?.autoplay) {
      params.set('autoplay', '1');
    }
    
    if (options?.muted) {
      params.set('mute', '1');
    }
    
    if (options?.loop) {
      params.set('loop', '1');
    }
    
    if (options?.controls === false) {
      params.set('controls', '0');
    }

    return `https://youtube.com/watch?${params.toString()}`;
  }

  /**
   * Generate a shortened YouTube URL (youtu.be format)
   */
  static generateShortUrl(videoId: string, timestamp?: number): string {
    const baseUrl = `https://youtu.be/${videoId}`;
    return timestamp ? `${baseUrl}?t=${timestamp}s` : baseUrl;
  }

  /**
   * Generate an embed URL for iframe integration
   */
  static generateEmbedUrl(videoId: string, options?: Partial<YouTubeDeepLinkOptions>): string {
    const params = new URLSearchParams();
    
    if (options?.startSeconds) {
      params.set('start', options.startSeconds.toString());
    }
    
    if (options?.endSeconds) {
      params.set('end', options.endSeconds.toString());
    }
    
    if (options?.autoplay) {
      params.set('autoplay', '1');
    }
    
    if (options?.muted) {
      params.set('mute', '1');
    }
    
    if (options?.loop) {
      params.set('loop', '1');
      // Loop requires playlist parameter with the same video
      params.set('playlist', videoId);
    }
    
    if (options?.controls === false) {
      params.set('controls', '0');
    }

    const queryString = params.toString();
    return `https://youtube.com/embed/${videoId}${queryString ? '?' + queryString : ''}`;
  }

  /**
   * Generate a playlist deep-link with video and timestamp
   */
  static generatePlaylistUrl(playlistId: string, videoId: string, timestamp?: number, index?: number): string {
    const params = new URLSearchParams();
    params.set('list', playlistId);
    params.set('v', videoId);
    
    if (index !== undefined) {
      params.set('index', index.toString());
    }
    
    if (timestamp) {
      params.set('t', `${timestamp}s`);
    }

    return `https://youtube.com/watch?${params.toString()}`;
  }

  /**
   * Generate deep-links for multiple timestamp ranges
   */
  static generateRangeUrls(videoId: string, ranges: YouTubeTimestampRange[]): VideoDeepLink[] {
    return ranges.map((range, index) => ({
      id: `${videoId}_range_${index}`,
      videoId,
      videoType: 'platform' as const,
      timestampStart: range.start,
      timestampEnd: range.end,
      deeplinkUrl: this.generateTimestampUrl(videoId, range.start),
      contextSummary: range.description,
      searchKeywords: range.title,
      confidenceScore: 1.0,
      createdAt: new Date()
    }));
  }

  /**
   * Parse YouTube URL and extract components
   */
  static parseYouTubeUrl(url: string): {
    videoId?: string;
    playlistId?: string;
    timestamp?: number;
    channelId?: string;
    isValid: boolean;
    urlType: 'video' | 'playlist' | 'channel' | 'embed' | 'unknown';
  } {
    const patterns = [
      {
        type: 'video' as const,
        pattern: /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})(?:.*?&list=([a-zA-Z0-9_-]+))?(?:.*?[&?]t=(\d+))?/,
        groups: { videoId: 1, playlistId: 2, timestamp: 3 }
      },
      {
        type: 'video' as const,
        pattern: /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})(?:\?.*?list=([a-zA-Z0-9_-]+))?(?:.*?[&?]t=(\d+))?/,
        groups: { videoId: 1, playlistId: 2, timestamp: 3 }
      },
      {
        type: 'embed' as const,
        pattern: /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})(?:\?.*?start=(\d+))?/,
        groups: { videoId: 1, timestamp: 2 }
      },
      {
        type: 'playlist' as const,
        pattern: /(?:youtube\.com\/playlist\?list=)([a-zA-Z0-9_-]+)/,
        groups: { playlistId: 1 }
      },
      {
        type: 'channel' as const,
        pattern: /(?:youtube\.com\/(?:channel\/|c\/|user\/))([a-zA-Z0-9_-]+)/,
        groups: { channelId: 1 }
      }
    ];

    for (const { type, pattern, groups } of patterns) {
      const match = url.match(pattern);
      if (match) {
        return {
          videoId: groups.videoId ? match[groups.videoId] : undefined,
          playlistId: groups.playlistId ? match[groups.playlistId] : undefined,
          timestamp: groups.timestamp ? parseInt(match[groups.timestamp], 10) : undefined,
          channelId: groups.channelId ? match[groups.channelId] : undefined,
          isValid: true,
          urlType: type
        };
      }
    }

    return { isValid: false, urlType: 'unknown' };
  }

  /**
   * Validate if a timestamp is within video duration
   */
  static async validateTimestamp(videoId: string, timestamp: number, apiKey?: string): Promise<boolean> {
    if (!apiKey) {
      // Without API access, assume timestamp is valid
      return true;
    }

    try {
      const response = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${videoId}&key=${apiKey}`);
      if (!response.ok) return false;

      const data = await response.json() as any;
      if (!data.items || data.items.length === 0) return false;

      const duration = this.parseDuration(data.items[0].contentDetails.duration);
      return timestamp <= duration;
    } catch {
      return false;
    }
  }

  /**
   * Generate chapter-based deep-links from video description
   */
  static extractChapterLinks(videoId: string, description: string): VideoDeepLink[] {
    // Pattern to match chapter timestamps in descriptions
    // Matches formats like: 0:00, 1:23, 12:34, 1:23:45
    const chapterPattern = /(?:^|\n)(\d{1,2}:?\d{0,2}:?\d{2})\s+(.+?)(?=\n\d{1,2}:?\d{0,2}:?\d{2}|\n\n|$)/gm;
    const chapters: VideoDeepLink[] = [];
    
    let match;
    let chapterIndex = 0;

    while ((match = chapterPattern.exec(description)) !== null) {
      const timeString = match[1];
      const title = match[2].trim();
      
      const timestamp = this.parseTimeString(timeString);
      if (timestamp >= 0) {
        chapters.push({
          id: `${videoId}_chapter_${chapterIndex}`,
          videoId,
          videoType: 'platform',
          timestampStart: timestamp,
          deeplinkUrl: this.generateTimestampUrl(videoId, timestamp),
          contextSummary: `Chapter: ${title}`,
          searchKeywords: title,
          confidenceScore: 0.9, // High confidence for explicit chapters
          createdAt: new Date()
        });
        chapterIndex++;
      }
    }

    return chapters;
  }

  /**
   * Generate smart deep-links based on transcript content
   */
  static generateTranscriptBasedLinks(
    videoId: string, 
    transcriptSegments: Array<{ start: number; text: string }>,
    keywords: string[]
  ): VideoDeepLink[] {
    const links: VideoDeepLink[] = [];
    
    keywords.forEach(keyword => {
      const matchingSegments = transcriptSegments.filter(segment =>
        segment.text.toLowerCase().includes(keyword.toLowerCase())
      );

      matchingSegments.forEach((segment, index) => {
        links.push({
          id: `${videoId}_keyword_${keyword}_${index}`,
          videoId,
          videoType: 'platform',
          timestampStart: segment.start,
          deeplinkUrl: this.generateTimestampUrl(videoId, Math.floor(segment.start)),
          contextSummary: segment.text.substring(0, 200) + (segment.text.length > 200 ? '...' : ''),
          searchKeywords: keyword,
          confidenceScore: 0.7, // Medium confidence for keyword matches
          createdAt: new Date()
        });
      });
    });

    return links;
  }

  /**
   * Optimize deep-link URLs for sharing
   */
  static optimizeForSharing(url: string): string {
    const parsed = this.parseYouTubeUrl(url);
    if (!parsed.isValid || !parsed.videoId) {
      return url;
    }

    // Use shortened format for sharing
    return this.generateShortUrl(parsed.videoId, parsed.timestamp);
  }

  /**
   * Generate QR code friendly URLs
   */
  static generateQRFriendlyUrl(videoId: string, timestamp?: number): string {
    // Use shortest possible format for QR codes
    return this.generateShortUrl(videoId, timestamp);
  }

  /**
   * Convert various timestamp formats to seconds
   */
  private static parseTimeString(timeString: string): number {
    const parts = timeString.split(':').reverse();
    let seconds = 0;
    
    for (let i = 0; i < parts.length; i++) {
      const value = parseInt(parts[i], 10);
      if (isNaN(value)) return -1;
      
      seconds += value * Math.pow(60, i);
    }
    
    return seconds;
  }

  /**
   * Parse ISO 8601 duration to seconds
   */
  private static parseDuration(isoDuration: string): number {
    const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return 0;

    const hours = parseInt(match[1] || '0', 10);
    const minutes = parseInt(match[2] || '0', 10);
    const seconds = parseInt(match[3] || '0', 10);

    return hours * 3600 + minutes * 60 + seconds;
  }

  /**
   * Format seconds to human readable time string
   */
  static formatTimestamp(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    } else {
      return `${minutes}:${secs.toString().padStart(2, '0')}`;
    }
  }

  /**
   * Generate accessibility-friendly deep-links
   */
  static generateAccessibleUrl(videoId: string, timestamp: number, description?: string): string {
    const baseUrl = this.generateTimestampUrl(videoId, timestamp);
    
    // Add accessibility parameters
    const url = new URL(baseUrl);
    url.searchParams.set('cc_load_policy', '1'); // Force captions
    url.searchParams.set('hl', 'en'); // Set language
    
    if (description) {
      // Add description as a comment parameter (not standard but useful for context)
      url.searchParams.set('desc', encodeURIComponent(description.substring(0, 100)));
    }
    
    return url.toString();
  }
}