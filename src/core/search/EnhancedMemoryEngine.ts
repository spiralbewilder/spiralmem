import { MemoryEngine } from '../MemoryEngine.js';
import { HybridSearchEngine, HybridSearchOptions } from './HybridSearchEngine.js';
import { 
  PlatformVideoInput, 
  UniversalContentInput,
  PlatformVideo,
  UniversalSearchResult,
  HybridSearchResult,
  PlaybackQueueItem,
  ContentCorrelation,
  SearchQuery
} from '../models/types.js';

import { 
  PlatformVideoRepository, 
  PlatformTranscriptRepository,
  ContentCorrelationRepository 
} from '../database/repositories/index.js';

import { PlatformFactory, PlatformConnector } from '../platforms/index.js';
import { logger, logError, logPerformance } from '../../utils/logger.js';

/**
 * Enhanced memory engine with hybrid local + platform content capabilities
 * Extends the base MemoryEngine with platform integration and hybrid search
 */
export class EnhancedMemoryEngine extends MemoryEngine {
  private hybridSearchEngine: HybridSearchEngine;
  private platformVideoRepo: PlatformVideoRepository;
  private transcriptRepo: PlatformTranscriptRepository;
  private correlationRepo: ContentCorrelationRepository;
  private platformFactory: PlatformFactory;

  constructor() {
    super();
    this.hybridSearchEngine = new HybridSearchEngine();
    this.platformVideoRepo = new PlatformVideoRepository();
    this.transcriptRepo = new PlatformTranscriptRepository();
    this.correlationRepo = new ContentCorrelationRepository();
    this.platformFactory = PlatformFactory.getInstance();
  }

  async initialize(): Promise<void> {
    await super.initialize();
    
    // Initialize platform factory with default configurations
    this.platformFactory.configurePlatform('youtube', {
      platform: 'youtube',
      enabled: true,
      credentials: {
        apiKey: process.env.YOUTUBE_API_KEY
      }
    });

    logger.info('Enhanced MemoryEngine initialized with platform support');
  }

  // Platform Content Management

  /**
   * Add platform video content (YouTube, etc.) without downloading
   */
  async addPlatformVideo(input: PlatformVideoInput): Promise<string> {
    this.ensureInitialized();
    
    try {
      const startTime = Date.now();
      
      // Detect platform from URL
      const platform = this.platformFactory.detectPlatform(input.platformUrl);
      if (!platform) {
        throw new Error(`Unsupported platform URL: ${input.platformUrl}`);
      }

      // Get platform connector
      const connector = await this.platformFactory.createConnectorFromUrl(input.platformUrl);
      
      // Extract metadata
      const metadata = await connector.extractMetadata(input.platformUrl);
      
      // Create memory record
      const memoryId = await this.addContent({
        content: metadata.description,
        title: metadata.title,
        source: `${platform}:${metadata.videoId}`,
        spaceId: input.spaceId || 'default',
        contentType: 'video',
        tags: input.tags,
        metadata: {
          platform,
          videoId: metadata.videoId,
          duration: metadata.duration,
          thumbnailUrl: metadata.thumbnailUrl,
          channelInfo: metadata.channelInfo,
          originalUrl: input.platformUrl
        }
      });

      // Create platform video record
      const platformVideo = await this.platformVideoRepo.create(input, memoryId);

      // Update platform video with extracted metadata
      await this.platformVideoRepo.updateMetadata(platformVideo.id, {
        thumbnailUrl: metadata.thumbnailUrl,
        duration: metadata.duration,
        uploadDate: metadata.uploadDate,
        channelInfo: metadata.channelInfo,
        platformMetadata: {
          viewCount: metadata.viewCount,
          likeCount: metadata.likeCount,
          commentCount: metadata.commentCount,
          tags: metadata.tags,
          category: metadata.category
        }
      });

      // Extract transcript if requested
      if (input.extractionOptions.includeTranscript) {
        try {
          const transcript = await connector.extractTranscript(metadata.videoId);
          await this.transcriptRepo.create({
            platformVideoId: platformVideo.id,
            fullText: transcript.segments.map(s => s.text).join(' '),
            language: transcript.language,
            confidence: transcript.isGenerated ? 0.8 : 0.95,
            segments: transcript.segments.map(s => ({
              start: s.start,
              end: s.start + s.duration,
              text: s.text,
              confidence: s.confidence
            })),
            source: transcript.source
          });
        } catch (transcriptError) {
          logger.warn(`Failed to extract transcript for ${metadata.videoId}:`, transcriptError);
        }
      }

      // Generate smart deep-links if requested
      if (input.extractionOptions.extractKeyMoments) {
        await this.generateSmartDeepLinks(platformVideo.id, metadata, connector);
      }

      logPerformance('Add platform video', startTime);
      logger.info(`Added platform video: ${metadata.title} (${platform}:${metadata.videoId})`);
      
      return memoryId;
    } catch (error) {
      logError(error as Error, 'addPlatformVideo');
      throw error;
    }
  }

  /**
   * Universal content input supporting both local and platform content
   */
  async addUniversalContent(input: UniversalContentInput): Promise<string> {
    this.ensureInitialized();

    switch (input.type) {
      case 'platform_video':
        if (!input.platformUrl) {
          throw new Error('Platform URL required for platform video content');
        }
        return this.addPlatformVideo({
          platformUrl: input.platformUrl,
          title: input.commonMetadata.title,
          spaceId: input.commonMetadata.spaceId,
          tags: input.commonMetadata.tags,
          extractionOptions: {
            includeTranscript: true,
            includeMetadata: true,
            includeComments: false,
            generateSummary: false,
            extractKeyMoments: true
          },
          indexingPriority: 'immediate'
        });

      case 'local_video':
        if (!input.filePath) {
          throw new Error('File path required for local video content');
        }
        // Would integrate with video processing pipeline
        return this.addContent({
          content: input.content || '',
          title: input.commonMetadata.title,
          source: input.commonMetadata.source,
          spaceId: input.commonMetadata.spaceId,
          contentType: 'video',
          filePath: input.filePath,
          tags: input.commonMetadata.tags
        });

      case 'text':
      case 'document':
        return this.addContent({
          content: input.content || '',
          title: input.commonMetadata.title,
          source: input.commonMetadata.source,
          spaceId: input.commonMetadata.spaceId,
          contentType: input.type === 'text' ? 'text' : 'document',
          tags: input.commonMetadata.tags
        });

      default:
        throw new Error(`Unsupported content type: ${input.type}`);
    }
  }

  // Enhanced Search Operations

  /**
   * Hybrid search across local and platform content
   */
  async searchUniversal(query: string, options: HybridSearchOptions = {}): Promise<HybridSearchResult> {
    this.ensureInitialized();
    
    try {
      const startTime = Date.now();
      
      const searchQuery: SearchQuery = { 
        query, 
        limit: options.maxResults || 20,
        spaceId: undefined // Use default space
      };

      const result = await this.hybridSearchEngine.search(query, options);
      
      logPerformance(`Hybrid search: "${query}"`, startTime);
      logger.info(`Hybrid search returned ${result.results.length} results for: "${query}"`);
      
      // Convert to expected HybridSearchResult format
      const unified: UniversalSearchResult[] = result.results.map(r => ({
        memory: {
          id: r.contentId,
          content: r.content,
          title: r.content.substring(0, 50) + '...',
          source: 'unknown',
          contentType: 'text' as const,
          spaceId: 'default',
          metadata: r.metadata || {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        source: 'local' as const,
        playbackInfo: {
          type: 'local' as const,
          videoId: r.contentId
        },
        relevanceScore: r.combinedScore,
        matchContext: r.highlights || [],
        highlights: r.highlights
      }));

      return {
        unified,
        breakdown: {
          local: result.results.map(r => ({
            memory: unified.find(u => u.memory.id === r.contentId)?.memory!,
            similarity: r.combinedScore,
            highlights: r.highlights
          })),
          platform: []
        },
        correlations: [],
        performance: {
          searchTime: result.metrics.totalTime,
          localResults: result.results.length,
          platformResults: 0,
          correlationsFound: 0
        }
      };
    } catch (error) {
      logError(error as Error, 'searchUniversal');
      throw error;
    }
  }

  /**
   * Generate smart playback queue from search results
   */
  async generatePlaybackQueue(query: string, options: HybridSearchOptions = {}): Promise<PlaybackQueueItem[]> {
    this.ensureInitialized();
    
    try {
      const searchResult = await this.hybridSearchEngine.search(query, options);
      const queue = this.convertResultsToPlaybackQueue(searchResult.results);
      logger.info(`Generated playback queue with ${queue.length} items for: "${query}"`);
      return queue;
    } catch (error) {
      logError(error as Error, 'generatePlaybackQueue');
      throw error;
    }
  }

  /**
   * Find content correlations and relationships
   */
  async findContentCorrelations(memoryId: string, options: {
    includeLocal?: boolean;
    includePlatform?: boolean;
    minScore?: number;
    limit?: number;
  } = {}): Promise<{
    related: ContentCorrelation[];
    recommendedContent: UniversalSearchResult[];
  }> {
    this.ensureInitialized();
    
    try {
      const related = await this.correlationRepo.findRelatedMemories(
        memoryId, 
        options.limit || 10, 
        options.minScore || 0.3
      );

      // Get content for related memories
      const recommendedContent: UniversalSearchResult[] = [];
      
      for (const relatedId of related.combined) {
        const memory = await this.getContent(relatedId);
        if (memory) {
          // Check if it's a platform video
          const platformVideo = await this.platformVideoRepo.findByMemoryId(relatedId);
          
          if (platformVideo && options.includePlatform !== false) {
            recommendedContent.push({
              memory,
              source: 'platform',
              platform: platformVideo.platform,
              playbackInfo: {
                type: 'platform',
                videoId: platformVideo.platformVideoId,
                deeplinkUrl: platformVideo.videoUrl,
                thumbnailUrl: platformVideo.thumbnailUrl
              },
              relevanceScore: 0.8, // High relevance for correlated content
              matchContext: []
            });
          } else if (!platformVideo && options.includeLocal !== false) {
            recommendedContent.push({
              memory,
              source: 'local',
              playbackInfo: {
                type: 'local',
                videoId: memory.id
              },
              relevanceScore: 0.8,
              matchContext: []
            });
          }
        }
      }

      return {
        related: [...related.asSource, ...related.asTarget],
        recommendedContent
      };
    } catch (error) {
      logError(error as Error, 'findContentCorrelations');
      throw error;
    }
  }

  // Platform Management

  /**
   * Configure platform integration
   */
  async configurePlatform(platform: string, config: {
    enabled?: boolean;
    apiKey?: string;
    rateLimits?: Record<string, number>;
  }): Promise<void> {
    this.ensureInitialized();
    
    try {
      this.platformFactory.configurePlatform(platform, {
        platform,
        enabled: config.enabled !== false,
        credentials: config.apiKey ? { apiKey: config.apiKey } : undefined,
        rateLimits: config.rateLimits ? {
          requestsPerMinute: config.rateLimits.minute,
          requestsPerHour: config.rateLimits.hour,
          requestsPerDay: config.rateLimits.day
        } : undefined
      });

      logger.info(`Configured platform: ${platform} (enabled: ${config.enabled !== false})`);
    } catch (error) {
      logError(error as Error, 'configurePlatform');
      throw error;
    }
  }

  /**
   * Get platform health status
   */
  async getPlatformHealth(): Promise<Record<string, any>> {
    this.ensureInitialized();
    
    try {
      return await this.platformFactory.healthCheckAll();
    } catch (error) {
      logError(error as Error, 'getPlatformHealth');
      return {};
    }
  }

  /**
   * Batch process platform URLs
   */
  async batchAddPlatformVideos(urls: string[], options: {
    spaceId?: string;
    extractTranscripts?: boolean;
    extractKeyMoments?: boolean;
    batchSize?: number;
  } = {}): Promise<{
    successful: string[];
    failed: Array<{ url: string; error: string }>;
  }> {
    this.ensureInitialized();
    
    const successful: string[] = [];
    const failed: Array<{ url: string; error: string }> = [];
    const batchSize = options.batchSize || 5;

    try {
      // Process in batches to respect rate limits
      for (let i = 0; i < urls.length; i += batchSize) {
        const batch = urls.slice(i, i + batchSize);
        
        const batchPromises = batch.map(async (url) => {
          try {
            const memoryId = await this.addPlatformVideo({
              platformUrl: url,
              spaceId: options.spaceId,
              extractionOptions: {
                includeTranscript: options.extractTranscripts !== false,
                includeMetadata: true,
                includeComments: false,
                generateSummary: false,
                extractKeyMoments: options.extractKeyMoments !== false
              },
              indexingPriority: 'background'
            });
            successful.push(url);
            return memoryId;
          } catch (error) {
            failed.push({ 
              url, 
              error: error instanceof Error ? error.message : 'Unknown error' 
            });
            return null;
          }
        });

        await Promise.allSettled(batchPromises);
        
        // Add delay between batches
        if (i + batchSize < urls.length) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }

      logger.info(`Batch processing complete: ${successful.length} successful, ${failed.length} failed`);
      return { successful, failed };
    } catch (error) {
      logError(error as Error, 'batchAddPlatformVideos');
      throw error;
    }
  }

  // Private helper methods

  private async generateSmartDeepLinks(
    platformVideoId: string, 
    metadata: any, 
    connector: PlatformConnector
  ): Promise<void> {
    try {
      // Generate deep-link at the beginning
      const startLink = await this.platformVideoRepo.createDeepLink({
        videoId: platformVideoId,
        videoType: 'platform',
        timestampStart: 0,
        deeplinkUrl: connector.generateDeepLink(metadata.videoId, 0),
        contextSummary: 'Video start',
        searchKeywords: metadata.title,
        confidenceScore: 1.0
      });

      // If we have a transcript, generate content-based deep-links
      const transcript = await this.transcriptRepo.findByPlatformVideoId(platformVideoId);
      if (transcript && transcript.segments.length > 0) {
        // Generate deep-links for segments with high information density
        const importantSegments = transcript.segments
          .filter(segment => segment.text.length > 50) // Meaningful content
          .slice(0, 5); // Limit to 5 key moments

        for (const segment of importantSegments) {
          await this.platformVideoRepo.createDeepLink({
            videoId: platformVideoId,
            videoType: 'platform',
            timestampStart: segment.start,
            timestampEnd: segment.end,
            deeplinkUrl: connector.generateDeepLink(metadata.videoId, Math.floor(segment.start)),
            contextSummary: segment.text.substring(0, 200),
            searchKeywords: this.extractKeywords(segment.text),
            confidenceScore: 0.8
          });
        }
      }
    } catch (error) {
      logger.warn(`Failed to generate smart deep-links for ${platformVideoId}:`, error);
    }
  }

  private convertResultsToPlaybackQueue(results: any[]): PlaybackQueueItem[] {
    return results.map((result, index) => ({
      title: result.content.substring(0, 50) + '...',
      source: 'local' as const,
      videoId: result.contentId,
      startTimestamp: result.metadata?.timestamp || 0,
      relevanceReason: `Search result #${index + 1}`,
      estimatedDuration: 300 // 5 minutes default
    }));
  }

  private extractKeywords(text: string): string {
    // Simple keyword extraction - could be enhanced with NLP
    const words = text.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(' ')
      .filter(word => word.length > 3)
      .filter(word => !['this', 'that', 'with', 'from', 'they', 'have', 'been', 'were', 'said', 'each', 'will'].includes(word));
    
    return words.slice(0, 5).join(' ');
  }
}