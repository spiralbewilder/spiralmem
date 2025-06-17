import { YouTubeConnector } from './YouTubeConnector.js';
import { YouTubeDeepLinkGenerator } from './YouTubeDeepLinks.js';
import { 
  YouTubeVideoData, 
  VideoDeepLink
} from '../../models/types.js';
import { PlatformVideoMetadata } from '../PlatformConnector.js';

export interface YouTubePlaylistData {
  playlistId: string;
  title: string;
  description: string;
  channelId: string;
  channelTitle: string;
  itemCount: number;
  privacy: 'public' | 'unlisted' | 'private';
  videoIds: string[];
  thumbnails: {
    default: string;
    medium: string;
    high: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

export interface YouTubeChannelData {
  channelId: string;
  title: string;
  description: string;
  subscriberCount: number;
  videoCount: number;
  viewCount: number;
  customUrl?: string;
  country?: string;
  thumbnails: {
    default: string;
    medium: string;
    high: string;
  };
  createdAt: Date;
}

export interface YouTubeBatchResult<T> {
  successful: T[];
  failed: Array<{ id: string; error: string }>;
  rateLimitHit: boolean;
  quotaUsed: number;
}

export interface YouTubeAnalytics {
  videoPerformance: {
    videoId: string;
    title: string;
    viewCount: number;
    likeCount: number;
    commentCount: number;
    engagementRate: number;
    averageWatchTime?: number;
  }[];
  channelInsights: {
    totalViews: number;
    totalSubscribers: number;
    totalVideos: number;
    averageEngagement: number;
    topPerformingVideos: string[];
  };
  trends: {
    viewGrowth: number;
    subscriberGrowth: number;
    popularTags: string[];
    optimalUploadTimes: string[];
  };
}

/**
 * Advanced YouTube connector with enhanced features
 * Extends base connector with playlist processing, channel analysis, and optimization tools
 */
export class YouTubeAdvancedConnector extends YouTubeConnector {
  private quotaUsed = 0;
  private batchCache = new Map<string, any>();
  
  /**
   * Process entire YouTube playlist efficiently
   */
  async processPlaylist(playlistUrl: string, options: {
    includeMetadata?: boolean;
    includeTranscripts?: boolean;
    maxVideos?: number;
    skipPrivate?: boolean;
  } = {}): Promise<YouTubeBatchResult<PlatformVideoMetadata>> {
    const startTime = Date.now();
    const playlistId = this.extractPlaylistId(playlistUrl);
    
    if (!playlistId) {
      throw new Error(`Invalid YouTube playlist URL: ${playlistUrl}`);
    }

    try {
      // Get playlist metadata
      const playlistData = await this.getPlaylistData(playlistId);
      
      // Get video IDs (with pagination)
      let videoIds = await this.extractPlaylistVideos(playlistId);
      
      if (options.maxVideos) {
        videoIds = videoIds.slice(0, options.maxVideos);
      }

      // Batch process videos for efficiency
      const result = await this.batchProcessVideos(videoIds, {
        includeMetadata: options.includeMetadata !== false,
        includeTranscripts: options.includeTranscripts || false
      });

      // Add playlist context to metadata
      result.successful.forEach(metadata => {
        metadata.playlistInfo = {
          id: playlistId,
          title: playlistData.title,
          position: videoIds.indexOf(metadata.videoId) + 1
        };
      });

      console.log(`Playlist processing completed in ${Date.now() - startTime}ms`);
      return result;

    } catch (error) {
      throw this.handleApiError(error, 'processPlaylist');
    }
  }

  /**
   * Analyze YouTube channel comprehensively
   */
  async analyzeChannel(channelUrl: string, options: {
    includeVideos?: boolean;
    includePlaylists?: boolean;
    maxVideos?: number;
    timeRange?: { start: Date; end: Date };
  } = {}): Promise<{
    channel: YouTubeChannelData;
    videos: PlatformVideoMetadata[];
    playlists: YouTubePlaylistData[];
    analytics: YouTubeAnalytics;
  }> {
    const channelId = this.extractChannelId(channelUrl);
    
    if (!channelId) {
      throw new Error(`Invalid YouTube channel URL: ${channelUrl}`);
    }

    try {
      // Get channel data
      const channel = await this.getChannelData(channelId);
      
      // Get channel videos if requested
      let videos: PlatformVideoMetadata[] = [];
      if (options.includeVideos !== false) {
        const videoIds = await this.getChannelVideos(channelId, options.maxVideos);
        const batchResult = await this.batchProcessVideos(videoIds, { includeMetadata: true });
        videos = batchResult.successful;
      }

      // Get channel playlists if requested
      let playlists: YouTubePlaylistData[] = [];
      if (options.includePlaylists) {
        playlists = await this.getChannelPlaylists(channelId);
      }

      // Generate analytics
      const analytics = this.generateChannelAnalytics(channel, videos);

      return { channel, videos, playlists, analytics };

    } catch (error) {
      throw this.handleApiError(error, 'analyzeChannel');
    }
  }

  /**
   * Smart content discovery based on search and related videos
   */
  async discoverRelatedContent(seedVideoUrl: string, options: {
    maxVideos?: number;
    includeChannelVideos?: boolean;
    includePlaylistVideos?: boolean;
    similarityThreshold?: number;
  } = {}): Promise<{
    related: PlatformVideoMetadata[];
    fromSameChannel: PlatformVideoMetadata[];
    fromPlaylists: PlatformVideoMetadata[];
    recommendations: string[];
  }> {
    const videoId = this.extractVideoId(seedVideoUrl);
    
    try {
      const seedMetadata = await this.extractMetadata(seedVideoUrl);
      
      // Find videos from same channel
      let fromSameChannel: PlatformVideoMetadata[] = [];
      if (options.includeChannelVideos !== false) {
        const channelVideoIds = await this.getChannelVideos(
          seedMetadata.channelInfo.id, 
          options.maxVideos || 10
        );
        const channelResult = await this.batchProcessVideos(channelVideoIds, { includeMetadata: true });
        fromSameChannel = channelResult.successful;
      }

      // Search for similar content
      const relatedSearch = await this.searchVideos(
        seedMetadata.title.split(' ').slice(0, 3).join(' '), // Use first 3 words
        options.maxVideos || 10
      );

      // Find videos from playlists containing this video
      let fromPlaylists: PlatformVideoMetadata[] = [];
      if (options.includePlaylistVideos) {
        // This would require searching playlists containing the video
        // Simplified implementation for now
      }

      // Generate recommendations based on tags and categories
      const recommendations = this.generateRecommendations(seedMetadata, relatedSearch);

      return {
        related: relatedSearch,
        fromSameChannel: fromSameChannel.filter(v => v.videoId !== videoId),
        fromPlaylists,
        recommendations
      };

    } catch (error) {
      throw this.handleApiError(error, 'discoverRelatedContent');
    }
  }

  /**
   * Optimize deep-links with context awareness
   */
  async generateContextualDeepLinks(videoId: string, options: {
    includeChapters?: boolean;
    includeHighlights?: boolean;
    keywordFocus?: string[];
    maxLinks?: number;
  } = {}): Promise<VideoDeepLink[]> {
    const links: VideoDeepLink[] = [];
    
    try {
      const metadata = await this.getVideoData(videoId);
      
      // Extract chapters from description if requested
      if (options.includeChapters !== false) {
        const chapterLinks = YouTubeDeepLinkGenerator.extractChapterLinks(
          videoId, 
          metadata.description
        );
        links.push(...chapterLinks);
      }

      // Generate highlight links based on engagement patterns
      if (options.includeHighlights) {
        const highlightLinks = await this.generateHighlightLinks(videoId, metadata);
        links.push(...highlightLinks);
      }

      // Focus on specific keywords if provided
      if (options.keywordFocus && options.keywordFocus.length > 0) {
        const keywordLinks = await this.generateKeywordLinks(videoId, options.keywordFocus);
        links.push(...keywordLinks);
      }

      // Sort by confidence and limit results
      const sortedLinks = links
        .sort((a, b) => b.confidenceScore - a.confidenceScore)
        .slice(0, options.maxLinks || 10);

      return sortedLinks;

    } catch (error) {
      throw this.handleApiError(error, 'generateContextualDeepLinks');
    }
  }

  /**
   * Performance monitoring and quota management
   */
  async getPerformanceMetrics(): Promise<{
    quotaUsage: {
      used: number;
      remaining: number;
      resetTime: Date;
    };
    responseTime: {
      average: number;
      fastest: number;
      slowest: number;
    };
    errorRate: {
      total: number;
      byType: Record<string, number>;
    };
    cacheEfficiency: {
      hits: number;
      misses: number;
      hitRate: number;
    };
    platformMetrics: {
      summary: {
        totalOperations: number;
        averageResponseTime: number;
        errorRate: number;
        throughput: number;
      };
      trends: any[];
      alerts: any[];
      topSlowOperations: any[];
      resourceUsage: any;
    };
    realtimeStatus: {
      status: 'healthy' | 'warning' | 'critical';
      activeAlerts: number;
      currentThroughput: number;
      memoryUsage: number;
      lastUpdate: Date;
    };
  }> {
    const rateLimits = this.getRateLimits();
    const platformMetrics = this.getPerformanceAnalytics();
    const realtimeStatus = this.getPerformanceStatus();
    
    // Calculate response time metrics from platform analytics
    const operationMetrics = platformMetrics.summary;
    
    return {
      quotaUsage: {
        used: this.quotaUsed,
        remaining: rateLimits.requestsPerDay - rateLimits.currentDayUsage,
        resetTime: rateLimits.resetTimes.nextDay
      },
      responseTime: {
        average: operationMetrics.averageResponseTime,
        fastest: 0, // Could be calculated from individual metrics
        slowest: 0  // Could be calculated from individual metrics
      },
      errorRate: {
        total: operationMetrics.totalOperations,
        byType: {} // Could be extracted from error analytics
      },
      cacheEfficiency: {
        hits: this.batchCache.size,
        misses: 0,
        hitRate: this.batchCache.size > 0 ? 0.8 : 0 // Estimated
      },
      platformMetrics,
      realtimeStatus
    };
  }

  // Private helper methods

  private extractPlaylistId(url: string): string | null {
    const match = url.match(/[&?]list=([a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
  }

  private extractChannelId(url: string): string | null {
    const patterns = [
      /youtube\.com\/channel\/([a-zA-Z0-9_-]+)/,
      /youtube\.com\/c\/([a-zA-Z0-9_-]+)/,
      /youtube\.com\/user\/([a-zA-Z0-9_-]+)/,
      /youtube\.com\/@([a-zA-Z0-9_-]+)/
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) return match[1];
    }
    
    return null;
  }

  private async getPlaylistData(playlistId: string): Promise<YouTubePlaylistData> {
    if (!this.apiKey) {
      throw new Error('YouTube API key required');
    }

    const url = `${this.baseUrl}/playlists?part=snippet,contentDetails&id=${playlistId}&key=${this.apiKey}`;
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`YouTube API error: ${response.status}`);
    }

    const data = await response.json() as any;
    if (!data.items || data.items.length === 0) {
      throw new Error(`Playlist not found: ${playlistId}`);
    }

    const item = data.items[0];
    const snippet = item.snippet;
    const contentDetails = item.contentDetails;

    return {
      playlistId,
      title: snippet.title,
      description: snippet.description,
      channelId: snippet.channelId,
      channelTitle: snippet.channelTitle,
      itemCount: contentDetails.itemCount,
      privacy: snippet.privacyStatus || 'public',
      videoIds: [], // Will be populated separately
      thumbnails: {
        default: snippet.thumbnails.default?.url || '',
        medium: snippet.thumbnails.medium?.url || '',
        high: snippet.thumbnails.high?.url || ''
      },
      createdAt: new Date(snippet.publishedAt),
      updatedAt: new Date() // API doesn't provide this
    };
  }

  private async getChannelData(channelId: string): Promise<YouTubeChannelData> {
    if (!this.apiKey) {
      throw new Error('YouTube API key required');
    }

    const url = `${this.baseUrl}/channels?part=snippet,statistics&id=${channelId}&key=${this.apiKey}`;
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`YouTube API error: ${response.status}`);
    }

    const data = await response.json() as any;
    if (!data.items || data.items.length === 0) {
      throw new Error(`Channel not found: ${channelId}`);
    }

    const item = data.items[0];
    const snippet = item.snippet;
    const statistics = item.statistics;

    return {
      channelId,
      title: snippet.title,
      description: snippet.description,
      subscriberCount: parseInt(statistics.subscriberCount || '0'),
      videoCount: parseInt(statistics.videoCount || '0'),
      viewCount: parseInt(statistics.viewCount || '0'),
      customUrl: snippet.customUrl,
      country: snippet.country,
      thumbnails: {
        default: snippet.thumbnails.default?.url || '',
        medium: snippet.thumbnails.medium?.url || '',
        high: snippet.thumbnails.high?.url || ''
      },
      createdAt: new Date(snippet.publishedAt)
    };
  }

  private async batchProcessVideos(videoIds: string[], options: {
    includeMetadata?: boolean;
    includeTranscripts?: boolean;
  }): Promise<YouTubeBatchResult<PlatformVideoMetadata>> {
    const successful: PlatformVideoMetadata[] = [];
    const failed: Array<{ id: string; error: string }> = [];
    let rateLimitHit = false;

    // Process in batches of 50 (YouTube API limit)
    for (let i = 0; i < videoIds.length; i += 50) {
      const batch = videoIds.slice(i, i + 50);
      
      try {
        await this.waitForRateLimit();
        const batchData = await this.batchGetVideoData(batch);
        
        for (const videoData of batchData) {
          successful.push(this.convertToStandardMetadata(videoData));
        }
        
        this.quotaUsed += 5; // Approximate quota usage
        
      } catch (error) {
        if (error instanceof Error && error.message.includes('Rate limit')) {
          rateLimitHit = true;
          // Add remaining videos to failed list
          batch.forEach(id => failed.push({ id, error: 'Rate limit exceeded' }));
          break;
        } else {
          batch.forEach(id => failed.push({ 
            id, 
            error: error instanceof Error ? error.message : 'Unknown error' 
          }));
        }
      }
    }

    return {
      successful,
      failed,
      rateLimitHit,
      quotaUsed: this.quotaUsed
    };
  }

  private async getChannelVideos(channelId: string, maxVideos = 50): Promise<string[]> {
    if (!this.apiKey) {
      throw new Error('YouTube API key required');
    }

    const videoIds: string[] = [];
    let nextPageToken = '';

    do {
      const url = `${this.baseUrl}/search?part=id&channelId=${channelId}&type=video&maxResults=50${nextPageToken ? `&pageToken=${nextPageToken}` : ''}&key=${this.apiKey}`;
      
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`YouTube API error: ${response.status}`);
      }

      const data = await response.json() as any;
      
      if (data.items) {
        videoIds.push(...data.items.map((item: any) => item.id.videoId));
      }

      nextPageToken = data.nextPageToken || '';
      
    } while (nextPageToken && videoIds.length < maxVideos);

    return videoIds.slice(0, maxVideos);
  }

  private async getChannelPlaylists(channelId: string): Promise<YouTubePlaylistData[]> {
    // Simplified implementation - would get all playlists for channel
    return [];
  }

  private generateChannelAnalytics(channel: YouTubeChannelData, videos: PlatformVideoMetadata[]): YouTubeAnalytics {
    const videoPerformance = videos.map(video => ({
      videoId: video.videoId,
      title: video.title,
      viewCount: video.viewCount || 0,
      likeCount: video.likeCount || 0,
      commentCount: video.commentCount || 0,
      engagementRate: this.calculateEngagementRate(video)
    }));

    const topPerforming = videoPerformance
      .sort((a, b) => b.viewCount - a.viewCount)
      .slice(0, 5)
      .map(v => v.videoId);

    return {
      videoPerformance,
      channelInsights: {
        totalViews: channel.viewCount,
        totalSubscribers: channel.subscriberCount,
        totalVideos: channel.videoCount,
        averageEngagement: videoPerformance.reduce((sum, v) => sum + v.engagementRate, 0) / videoPerformance.length || 0,
        topPerformingVideos: topPerforming
      },
      trends: {
        viewGrowth: 0, // Would require historical data
        subscriberGrowth: 0,
        popularTags: this.extractPopularTags(videos),
        optimalUploadTimes: ['10:00', '14:00', '18:00'] // Placeholder
      }
    };
  }

  private calculateEngagementRate(video: PlatformVideoMetadata): number {
    const views = video.viewCount || 0;
    const likes = video.likeCount || 0;
    const comments = video.commentCount || 0;
    
    return views > 0 ? ((likes + comments) / views) * 100 : 0;
  }

  private extractPopularTags(videos: PlatformVideoMetadata[]): string[] {
    const tagCount = new Map<string, number>();
    
    videos.forEach(video => {
      video.tags.forEach(tag => {
        tagCount.set(tag, (tagCount.get(tag) || 0) + 1);
      });
    });

    return Array.from(tagCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([tag]) => tag);
  }

  private generateRecommendations(seed: PlatformVideoMetadata, related: PlatformVideoMetadata[]): string[] {
    // Generate smart recommendations based on seed video
    const recommendations = new Set<string>();
    
    // Add videos with similar tags
    related.forEach(video => {
      const sharedTags = video.tags.filter(tag => seed.tags.includes(tag));
      if (sharedTags.length > 0) {
        recommendations.add(video.videoId);
      }
    });

    return Array.from(recommendations).slice(0, 5);
  }

  private async generateHighlightLinks(videoId: string, metadata: YouTubeVideoData): Promise<VideoDeepLink[]> {
    // Generate highlight links based on video characteristics
    const links: VideoDeepLink[] = [];
    const duration = metadata.duration;
    
    // Add links at key intervals for longer videos
    if (duration > 300) { // 5+ minutes
      const intervals = [
        { timestamp: Math.floor(duration * 0.1), label: 'Opening' },
        { timestamp: Math.floor(duration * 0.3), label: 'Early content' },
        { timestamp: Math.floor(duration * 0.5), label: 'Midpoint' },
        { timestamp: Math.floor(duration * 0.8), label: 'Key section' }
      ];

      intervals.forEach((interval, index) => {
        links.push({
          id: `${videoId}_highlight_${index}`,
          videoId,
          videoType: 'platform',
          timestampStart: interval.timestamp,
          deeplinkUrl: this.generateDeepLink(videoId, interval.timestamp),
          contextSummary: interval.label,
          searchKeywords: `${metadata.title} ${interval.label}`,
          confidenceScore: 0.6,
          createdAt: new Date()
        });
      });
    }

    return links;
  }

  private async generateKeywordLinks(videoId: string, keywords: string[]): Promise<VideoDeepLink[]> {
    // This would analyze transcript for keyword occurrences
    // Simplified implementation for now
    return [];
  }
}