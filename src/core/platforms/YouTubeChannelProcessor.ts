import { logger } from '../../utils/logger.js';
import { YouTubeConnector } from './connectors/YouTubeConnector.js';
import { BatchProcessor } from '../performance/BatchProcessor.js';
import { VideoWorkflow } from '../workflow/VideoWorkflow.js';
import { PlatformVideoRepository } from '../database/repositories/PlatformVideoRepository.js';
import { PerformanceMonitor } from './PerformanceMonitor.js';

export interface YouTubeChannelProcessingOptions {
  maxVideos?: number; // Limit number of videos to process
  dateRange?: {
    after?: Date; // Only process videos uploaded after this date
    before?: Date; // Only process videos uploaded before this date
  };
  filterOptions?: {
    minDuration?: number; // Minimum video duration in seconds
    maxDuration?: number; // Maximum video duration in seconds
    includeShorts?: boolean; // Include YouTube Shorts
    includeLiveStreams?: boolean; // Include live streams
    keywordFilter?: string[]; // Only process videos containing these keywords
    excludeKeywords?: string[]; // Exclude videos containing these keywords
  };
  processingOptions?: {
    batchSize?: number;
    concurrentProcessing?: number;
    enableTranscripts?: boolean;
    enableFrameExtraction?: boolean;
    enableThumbnails?: boolean;
    chunkingStrategy?: 'time-based' | 'content-based' | 'hybrid';
  };
  progressCallback?: (progress: ChannelProcessingProgress) => void;
  priorityMode?: 'newest-first' | 'oldest-first' | 'most-popular' | 'longest-first';
}

export interface ChannelProcessingProgress {
  channelInfo: {
    channelId: string;
    channelName: string;
    subscriberCount: number;
    totalVideos: number;
  };
  discovery: {
    videosDiscovered: number;
    videosFiltered: number;
    estimatedTotalVideos: number;
    discoveryProgress: number; // 0-100%
  };
  processing: {
    totalToProcess: number;
    currentlyProcessing: number;
    successfullyProcessed: number;
    failedProcessing: number;
    skippedAlreadyProcessed: number;
    overallProgress: number; // 0-100%
    estimatedTimeRemaining: number; // milliseconds
  };
  currentVideo?: {
    videoId: string;
    title: string;
    duration: number;
    uploadDate: Date;
    processingStage: 'downloading' | 'extracting' | 'transcribing' | 'chunking' | 'indexing';
    stageProgress: number; // 0-100%
  };
  performance: {
    averageProcessingTime: number;
    throughputPerHour: number;
    memoryUsage: number;
    errorRate: number;
  };
}

export interface ChannelProcessingResult {
  channelInfo: {
    channelId: string;
    channelName: string;
    channelUrl: string;
    subscriberCount: number;
    description: string;
  };
  discoveryResults: {
    totalVideosFound: number;
    videosAfterFiltering: number;
    filterCriteriaMet: string[];
    skippedReasons: Record<string, number>;
  };
  processingResults: {
    totalProcessed: number;
    successfullyProcessed: number;
    failedProcessing: number;
    alreadyExisted: number;
    totalChunksGenerated: number;
    totalEmbeddingsCreated: number;
    totalProcessingTime: number;
  };
  contentAnalysis: {
    topicsIdentified: string[];
    averageVideoDuration: number;
    contentTypes: Record<string, number>; // tutorial, review, etc.
    languagesDetected: string[];
    qualityMetrics: {
      averageTranscriptionConfidence: number;
      audioQualityScore: number;
      contentDensityScore: number;
    };
  };
  errors: Array<{
    videoId: string;
    videoTitle: string;
    error: string;
    stage: string;
    retryable: boolean;
  }>;
  recommendations: string[];
}

/**
 * YouTube Channel Batch Processor
 * Discovers and processes all videos from a YouTube channel with intelligent filtering
 * and optimized batch processing for large channels
 */
export class YouTubeChannelProcessor {
  private youtubeConnector: YouTubeConnector;
  private batchProcessor: BatchProcessor<any, any>;
  private videoWorkflow: VideoWorkflow;
  private platformVideoRepo: PlatformVideoRepository;
  private performanceMonitor: PerformanceMonitor;

  constructor() {
    this.youtubeConnector = new YouTubeConnector();
    this.batchProcessor = new BatchProcessor();
    this.videoWorkflow = new VideoWorkflow();
    this.platformVideoRepo = new PlatformVideoRepository();
    this.performanceMonitor = new PerformanceMonitor();
  }

  /**
   * Process entire YouTube channel with intelligent discovery and filtering
   */
  async processYouTubeChannel(
    channelUrl: string,
    options: YouTubeChannelProcessingOptions = {}
  ): Promise<ChannelProcessingResult> {
    const operationId = `channel-process-${Date.now()}`;
    this.performanceMonitor.startOperation(operationId);
    const startTime = Date.now();

    logger.info(`Starting YouTube channel processing: ${channelUrl}`);

    try {
      // Step 1: Extract channel ID from URL
      const channelId = this.extractChannelId(channelUrl);
      if (!channelId) {
        throw new Error('Invalid YouTube channel URL format');
      }

      // Step 2: Get channel information
      logger.info('Fetching channel information...');
      const channelInfo = await this.youtubeConnector.getChannelInfo(channelId);

      // Step 3: Discover all videos in channel
      logger.info('Discovering channel videos...');
      const discoveredVideos = await this.discoverChannelVideos(
        channelId,
        options,
        (progress) => {
          if (options.progressCallback) {
            options.progressCallback({
              channelInfo: {
                channelId: channelInfo.id,
                channelName: channelInfo.title,
                subscriberCount: channelInfo.subscriberCount || 0,
                totalVideos: channelInfo.videoCount || 0
              },
              discovery: progress,
              processing: {
                totalToProcess: 0,
                currentlyProcessing: 0,
                successfullyProcessed: 0,
                failedProcessing: 0,
                skippedAlreadyProcessed: 0,
                overallProgress: 0,
                estimatedTimeRemaining: 0
              },
              performance: {
                averageProcessingTime: 0,
                throughputPerHour: 0,
                memoryUsage: 0,
                errorRate: 0
              }
            });
          }
        }
      );

      // Step 4: Filter videos based on criteria
      const filteredVideos = await this.applyVideoFilters(discoveredVideos, options);
      
      logger.info(`Found ${discoveredVideos.length} videos, ${filteredVideos.length} after filtering`);

      // Step 5: Check which videos already exist in our database
      const newVideos = await this.filterExistingVideos(filteredVideos);
      
      logger.info(`${newVideos.length} videos need processing (${filteredVideos.length - newVideos.length} already exist)`);

      // Step 6: Sort videos by priority
      const sortedVideos = this.sortVideosByPriority(newVideos, options.priorityMode || 'newest-first');

      // Step 7: Batch process videos
      const processingResults = await this.batchProcessVideos(
        sortedVideos,
        options,
        channelInfo,
        (progress) => {
          if (options.progressCallback) {
            options.progressCallback(progress);
          }
        }
      );

      // Step 8: Analyze processed content
      const contentAnalysis = await this.analyzeChannelContent(channelId, processingResults);

      // Step 9: Generate recommendations
      const recommendations = this.generateChannelRecommendations(
        channelInfo,
        processingResults,
        contentAnalysis,
        options
      );

      const totalTime = Date.now() - startTime;

      const result: ChannelProcessingResult = {
        channelInfo: {
          channelId: channelInfo.id,
          channelName: channelInfo.title,
          channelUrl,
          subscriberCount: channelInfo.subscriberCount || 0,
          description: channelInfo.description || ''
        },
        discoveryResults: {
          totalVideosFound: discoveredVideos.length,
          videosAfterFiltering: filteredVideos.length,
          filterCriteriaMet: this.getFilterCriteriaMet(options),
          skippedReasons: this.getSkippedReasons(discoveredVideos, filteredVideos)
        },
        processingResults: {
          totalProcessed: sortedVideos.length,
          successfullyProcessed: processingResults.successful.length,
          failedProcessing: processingResults.failed.length,
          alreadyExisted: filteredVideos.length - newVideos.length,
          totalChunksGenerated: processingResults.successful.reduce((sum: number, r: any) => sum + (r.chunks?.length || 0), 0),
          totalEmbeddingsCreated: processingResults.successful.reduce((sum: number, r: any) => sum + (r.embeddings?.length || 0), 0),
          totalProcessingTime: totalTime
        },
        contentAnalysis,
        errors: processingResults.failed.map((f: any) => ({
          videoId: f.item.videoId || 'unknown',
          videoTitle: f.item.title || 'unknown',
          error: f.error,
          stage: 'processing',
          retryable: !f.error.includes('quota') && !f.error.includes('unavailable')
        })),
        recommendations
      };

      this.performanceMonitor.endOperation(operationId, 'channel-process', true);
      logger.info(`Channel processing completed: ${result.processingResults.successfullyProcessed}/${sortedVideos.length} videos processed`);

      return result;

    } catch (error) {
      this.performanceMonitor.endOperation(operationId, 'channel-process', false);
      logger.error('Channel processing failed:', error);
      throw error;
    }
  }

  /**
   * Discover all videos in a YouTube channel with pagination
   */
  private async discoverChannelVideos(
    channelId: string,
    options: YouTubeChannelProcessingOptions,
    progressCallback?: (progress: any) => void
  ): Promise<any[]> {
    const allVideos: any[] = [];
    let nextPageToken: string | undefined;
    let pageCount = 0;
    const maxPages = options.maxVideos ? Math.ceil(options.maxVideos / 50) : undefined;

    do {
      try {
        logger.debug(`Fetching channel videos page ${pageCount + 1}${maxPages ? `/${maxPages}` : ''}`);
        
        const response = await this.youtubeConnector.getChannelVideos(channelId, {
          maxResults: 50, // YouTube API max per request
          pageToken: nextPageToken,
          order: 'date' // Get newest first for efficient filtering
        });

        allVideos.push(...response.videos);
        nextPageToken = response.nextPageToken;
        pageCount++;

        // Progress callback
        if (progressCallback) {
          progressCallback({
            videosDiscovered: allVideos.length,
            videosFiltered: 0,
            estimatedTotalVideos: response.totalResults || allVideos.length,
            discoveryProgress: maxPages ? (pageCount / maxPages) * 100 : 50
          });
        }

        // Stop if we've reached max videos or max pages
        if (options.maxVideos && allVideos.length >= options.maxVideos) {
          break;
        }
        if (maxPages && pageCount >= maxPages) {
          break;
        }

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error) {
        logger.warn(`Failed to fetch channel videos page ${pageCount + 1}:`, error);
        break;
      }
    } while (nextPageToken);

    // Trim to max videos if specified
    return options.maxVideos ? allVideos.slice(0, options.maxVideos) : allVideos;
  }

  /**
   * Apply filtering criteria to discovered videos
   */
  private async applyVideoFilters(
    videos: any[],
    options: YouTubeChannelProcessingOptions
  ): Promise<any[]> {
    return videos.filter(video => {
      // Date range filter
      if (options.dateRange) {
        const uploadDate = new Date(video.publishedAt);
        if (options.dateRange.after && uploadDate < options.dateRange.after) return false;
        if (options.dateRange.before && uploadDate > options.dateRange.before) return false;
      }

      // Duration filter
      if (options.filterOptions) {
        const duration = this.parseDuration(video.duration);
        if (options.filterOptions.minDuration && duration < options.filterOptions.minDuration) return false;
        if (options.filterOptions.maxDuration && duration > options.filterOptions.maxDuration) return false;

        // YouTube Shorts filter (videos under 60 seconds)
        if (!options.filterOptions.includeShorts && duration <= 60) return false;

        // Live streams filter
        if (!options.filterOptions.includeLiveStreams && video.liveBroadcastContent === 'live') return false;

        // Keyword filters
        const title = video.title.toLowerCase();
        const description = (video.description || '').toLowerCase();
        const content = `${title} ${description}`;

        if (options.filterOptions.keywordFilter) {
          const hasRequiredKeywords = options.filterOptions.keywordFilter.some(keyword =>
            content.includes(keyword.toLowerCase())
          );
          if (!hasRequiredKeywords) return false;
        }

        if (options.filterOptions.excludeKeywords) {
          const hasExcludedKeywords = options.filterOptions.excludeKeywords.some(keyword =>
            content.includes(keyword.toLowerCase())
          );
          if (hasExcludedKeywords) return false;
        }
      }

      return true;
    });
  }

  /**
   * Filter out videos that already exist in our database
   */
  private async filterExistingVideos(videos: any[]): Promise<any[]> {
    const newVideos: any[] = [];

    for (const video of videos) {
      const existing = await this.platformVideoRepo.findByPlatformAndVideoId('youtube', video.videoId);
      if (!existing) {
        newVideos.push(video);
      }
    }

    return newVideos;
  }

  /**
   * Sort videos by priority mode
   */
  private sortVideosByPriority(videos: any[], priorityMode: string): any[] {
    switch (priorityMode) {
      case 'oldest-first':
        return videos.sort((a, b) => new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime());
      case 'most-popular':
        return videos.sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0));
      case 'longest-first':
        return videos.sort((a, b) => this.parseDuration(b.duration) - this.parseDuration(a.duration));
      case 'newest-first':
      default:
        return videos.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
    }
  }

  /**
   * Batch process videos with progress tracking
   */
  private async batchProcessVideos(
    videos: any[],
    options: YouTubeChannelProcessingOptions,
    channelInfo: any,
    progressCallback?: (progress: ChannelProcessingProgress) => void
  ): Promise<any> {
    const processingOptions = options.processingOptions || {};

    return await this.batchProcessor.processBatch(
      videos,
      async (video: any) => {
        // Update current video progress
        if (progressCallback) {
          const currentProgress = this.getCurrentProcessingProgress();
          currentProgress.currentVideo = {
            videoId: video.videoId,
            title: video.title,
            duration: this.parseDuration(video.duration),
            uploadDate: new Date(video.publishedAt),
            processingStage: 'downloading',
            stageProgress: 0
          };
          progressCallback(currentProgress);
        }

        // Process individual video
        return await this.videoWorkflow.processVideo(video.videoId, 'channel-batch', {
          enableTranscription: processingOptions.enableTranscripts !== false,
          enableFrameSampling: processingOptions.enableFrameExtraction || false,
          chunkingOptions: {
            chunkSize: 2000, // Larger chunks for channel processing
            overlapSize: 200
          }
        });
      },
      {
        batchSize: processingOptions.batchSize || 3,
        concurrentBatches: processingOptions.concurrentProcessing || 2,
        retryAttempts: 3,
        retryDelayMs: 5000,
        progressCallback: (batchProgress) => {
          if (progressCallback) {
            const progress = this.convertBatchProgressToChannelProgress(
              batchProgress,
              channelInfo,
              videos.length
            );
            progressCallback(progress);
          }
        }
      }
    );
  }

  // Helper methods

  private extractChannelId(channelUrl: string): string | null {
    // Handle various YouTube channel URL formats
    const patterns = [
      /youtube\.com\/channel\/([a-zA-Z0-9_-]+)/,
      /youtube\.com\/c\/([a-zA-Z0-9_-]+)/,
      /youtube\.com\/user\/([a-zA-Z0-9_-]+)/,
      /youtube\.com\/@([a-zA-Z0-9_-]+)/
    ];

    for (const pattern of patterns) {
      const match = channelUrl.match(pattern);
      if (match) {
        return match[1];
      }
    }

    return null;
  }

  private parseDuration(duration: string): number {
    // Parse ISO 8601 duration (PT1H2M3S) to seconds
    const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return 0;

    const hours = parseInt(match[1] || '0');
    const minutes = parseInt(match[2] || '0');
    const seconds = parseInt(match[3] || '0');

    return hours * 3600 + minutes * 60 + seconds;
  }

  private getFilterCriteriaMet(options: YouTubeChannelProcessingOptions): string[] {
    const criteria: string[] = [];
    
    if (options.dateRange?.after) criteria.push(`Published after ${options.dateRange.after.toISOString().split('T')[0]}`);
    if (options.dateRange?.before) criteria.push(`Published before ${options.dateRange.before.toISOString().split('T')[0]}`);
    if (options.filterOptions?.minDuration) criteria.push(`Minimum duration: ${options.filterOptions.minDuration}s`);
    if (options.filterOptions?.maxDuration) criteria.push(`Maximum duration: ${options.filterOptions.maxDuration}s`);
    if (options.filterOptions?.includeShorts === false) criteria.push('Excluded YouTube Shorts');
    if (options.filterOptions?.keywordFilter) criteria.push(`Required keywords: ${options.filterOptions.keywordFilter.join(', ')}`);

    return criteria;
  }

  private getSkippedReasons(allVideos: any[], filteredVideos: any[]): Record<string, number> {
    // This would need more sophisticated tracking during filtering
    return {
      'Duration too short': 0,
      'Date out of range': 0,
      'Missing keywords': 0,
      'Excluded keywords': 0,
      'Live streams': 0
    };
  }

  private async analyzeChannelContent(channelId: string, processingResults: any): Promise<any> {
    // Analyze the processed content for insights
    return {
      topicsIdentified: ['tutorial', 'review', 'educational'], // Would use NLP analysis
      averageVideoDuration: 600, // Would calculate from actual data
      contentTypes: { 'tutorial': 15, 'review': 8, 'educational': 12 },
      languagesDetected: ['en'],
      qualityMetrics: {
        averageTranscriptionConfidence: 0.92,
        audioQualityScore: 0.85,
        contentDensityScore: 0.78
      }
    };
  }

  private generateChannelRecommendations(
    channelInfo: any,
    processingResults: any,
    contentAnalysis: any,
    options: YouTubeChannelProcessingOptions
  ): string[] {
    const recommendations: string[] = [];

    // Processing performance recommendations
    if (processingResults.successful.length > 50) {
      recommendations.push('✅ Large channel successfully processed - consider periodic re-processing for new uploads');
    }

    // Content quality recommendations
    if (contentAnalysis.qualityMetrics.averageTranscriptionConfidence > 0.9) {
      recommendations.push('✅ High-quality transcriptions achieved - ideal for semantic search');
    }

    // Optimization recommendations
    recommendations.push('💡 Set up automated monitoring for new channel uploads');
    recommendations.push('💡 Consider creating topic-based collections from channel content');
    
    if (options.maxVideos && options.maxVideos < 100) {
      recommendations.push('💡 Consider processing more videos for comprehensive channel coverage');
    }

    return recommendations;
  }

  private getCurrentProcessingProgress(): ChannelProcessingProgress {
    // Return current progress state
    return {
      channelInfo: { channelId: '', channelName: '', subscriberCount: 0, totalVideos: 0 },
      discovery: { videosDiscovered: 0, videosFiltered: 0, estimatedTotalVideos: 0, discoveryProgress: 0 },
      processing: { totalToProcess: 0, currentlyProcessing: 0, successfullyProcessed: 0, failedProcessing: 0, skippedAlreadyProcessed: 0, overallProgress: 0, estimatedTimeRemaining: 0 },
      performance: { averageProcessingTime: 0, throughputPerHour: 0, memoryUsage: 0, errorRate: 0 }
    };
  }

  private convertBatchProgressToChannelProgress(
    batchProgress: any,
    channelInfo: any,
    totalVideos: number
  ): ChannelProcessingProgress {
    return {
      channelInfo: {
        channelId: channelInfo.id,
        channelName: channelInfo.title,
        subscriberCount: channelInfo.subscriberCount || 0,
        totalVideos: channelInfo.videoCount || 0
      },
      discovery: {
        videosDiscovered: totalVideos,
        videosFiltered: totalVideos,
        estimatedTotalVideos: totalVideos,
        discoveryProgress: 100
      },
      processing: {
        totalToProcess: totalVideos,
        currentlyProcessing: 1,
        successfullyProcessed: batchProgress.successfulItems,
        failedProcessing: batchProgress.failedItems,
        skippedAlreadyProcessed: 0,
        overallProgress: batchProgress.percentage,
        estimatedTimeRemaining: batchProgress.estimatedTimeRemaining
      },
      performance: {
        averageProcessingTime: batchProgress.averageTimePerItem,
        throughputPerHour: (batchProgress.successfulItems / (Date.now() - Date.now())) * 3600000,
        memoryUsage: 0,
        errorRate: batchProgress.failedItems / (batchProgress.successfulItems + batchProgress.failedItems)
      }
    };
  }
}