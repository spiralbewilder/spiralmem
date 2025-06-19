// Core type definitions for spiralmem

export interface Memory {
  id: string;
  spaceId: string;
  contentType: 'text' | 'video' | 'document' | 'image';
  title?: string;
  content: string;
  source: string;
  filePath?: string;
  metadata: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export interface Chunk {
  id: string;
  memoryId: string;
  chunkText: string;
  chunkOrder: number;
  startOffset?: number;
  endOffset?: number;
  metadata: Record<string, any>;
  createdAt: Date;
}

export interface Space {
  id: string;
  name: string;
  description?: string;
  settings: SpaceSettings;
  createdAt: Date;
  updatedAt: Date;
}

export interface SpaceSettings {
  retentionPolicy?: string;
  embeddingModel?: string;
  autoTagging?: boolean;
  [key: string]: any;
}

export interface Tag {
  id: string;
  name: string;
  color?: string;
  createdAt: Date;
}

export interface MemoryTag {
  memoryId: string;
  tagId: string;
}

export interface Video {
  id: string;
  memoryId: string;
  filePath: string;
  duration?: number;
  resolution?: string;
  fps?: number;
  fileSize?: number;
  mimeType?: string;
  processedAt?: Date;
  processingStatus: 'pending' | 'processing' | 'completed' | 'failed';
  processingError?: string;
}

export interface Transcript {
  id: string;
  videoId: string;
  fullText: string;
  language?: string;
  confidence?: number;
  segments: TranscriptSegment[];
  createdAt: Date;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  confidence?: number;
  speaker?: string;
}

export interface VideoFrame {
  id: string;
  videoId: string;
  timestamp: number;
  framePath?: string;
  ocrText?: string;
  sceneChange: boolean;
  objectsDetected?: Record<string, any>;
}

export interface ProcessingJob {
  id: string;
  type: 'video' | 'document' | 'embedding';
  status: 'pending' | 'processing' | 'completed' | 'failed';
  inputPath: string;
  outputPath?: string;
  progress: number;
  errorMessage?: string;
  metadata: Record<string, any>;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

// Search related types
export interface SearchQuery {
  query: string;
  spaceId?: string;
  contentTypes?: string[];
  limit?: number;
  offset?: number;
  filters?: SearchFilters;
}

export interface SearchFilters {
  dateRange?: {
    start: Date;
    end: Date;
  };
  tags?: string[];
  minConfidence?: number;
  [key: string]: any;
}

export interface SearchResult {
  memory: Memory;
  chunk?: Chunk;
  similarity?: number;
  highlights?: string[];
  context?: string;
  timestamps?: {
    startMs: number;
    endMs: number;
    wordMatches?: Array<{
      word: string;
      startMs: number;
      endMs: number;
      matchIndex: number;
    }>;
  };
}

export interface SearchOptions {
  similarityThreshold?: number;
  maxResults?: number;
  includeContext?: boolean;
  searchMode?: 'semantic' | 'keyword' | 'hybrid';
}

// Content input types
export interface ContentInput {
  content: string;
  title?: string;
  source: string;
  spaceId?: string;
  contentType?: Memory['contentType'];
  filePath?: string;
  tags?: string[];
  metadata?: Record<string, any>;
}

export interface VideoInput {
  filePath: string;
  title?: string;
  spaceId?: string;
  tags?: string[];
  processingOptions?: VideoProcessingOptions;
  metadata?: Record<string, any>;
}

export interface VideoProcessingOptions {
  transcriptionModel?: 'base' | 'small' | 'medium' | 'large';
  extractFrames?: boolean;
  frameInterval?: number;
  enableSpeakerDiarization?: boolean;
  language?: string;
}

// Statistics and analytics
export interface MemoryStats {
  totalMemories: number;
  totalChunks: number;
  totalSpaces: number;
  storageUsed: number;
  contentTypeBreakdown: Record<string, number>;
  recentActivity: {
    memoriesAdded: number;
    videosProcessed: number;
    searchesPerformed: number;
  };
}

export interface SystemHealth {
  database: 'healthy' | 'degraded' | 'down';
  vectorStore: 'healthy' | 'degraded' | 'down';
  processing: 'healthy' | 'degraded' | 'down';
  storage: {
    usage: number;
    available: number;
    status: 'healthy' | 'warning' | 'critical';
  };
  uptime: number;
}

// Export and import types
export interface ExportOptions {
  spaceId?: string;
  format: 'json' | 'csv' | 'markdown';
  includeEmbeddings?: boolean;
  includeFiles?: boolean;
  dateRange?: {
    start: Date;
    end: Date;
  };
}

export interface ExportData {
  memories: Memory[];
  chunks?: Chunk[];
  spaces: Space[];
  tags: Tag[];
  metadata: {
    exportedAt: Date;
    version: string;
    format: string;
  };
}

// Platform integration types (Week 2 Enhanced)
export interface PlatformVideo {
  id: string;
  memoryId: string;
  platform: 'youtube' | 'spotify' | 'zoom' | 'teams' | 'vimeo';
  platformVideoId: string;
  videoUrl: string;
  thumbnailUrl?: string;
  duration?: number;
  uploadDate?: Date;
  channelInfo?: Record<string, any>;
  playlistInfo?: Record<string, any>;
  platformMetadata: Record<string, any>;
  lastIndexed: Date;
  accessibilityData?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export interface VideoDeepLink {
  id: string;
  videoId: string; // References either videos.id or platform_videos.id
  videoType: 'local' | 'platform';
  timestampStart: number;
  timestampEnd?: number;
  deeplinkUrl: string;
  contextSummary?: string;
  searchKeywords?: string;
  confidenceScore: number;
  createdAt: Date;
}

export interface PlatformConnection {
  id: string;
  platform: string;
  apiCredentials: Record<string, any>;
  rateLimitInfo: Record<string, any>;
  lastSync?: Date;
  syncStatus: 'active' | 'paused' | 'error';
  errorLog: any[];
  createdAt: Date;
  updatedAt: Date;
}

export interface PlatformTranscript {
  id: string;
  platformVideoId: string;
  fullText: string;
  language?: string;
  confidence?: number;
  segments: TranscriptSegment[];
  source: 'platform' | 'api' | 'extracted';
  createdAt: Date;
}

export interface ContentCorrelation {
  id: string;
  sourceMemoryId: string;
  targetMemoryId: string;
  correlationType: 'similar_content' | 'same_topic' | 'temporal' | 'referenced';
  correlationScore: number;
  correlationMetadata: Record<string, any>;
  createdAt: Date;
}

// Enhanced input types for platform integration
export interface PlatformVideoInput {
  platformUrl: string;
  platform?: string; // Auto-detect if not provided
  title?: string;
  spaceId?: string;
  tags?: string[];
  extractionOptions: {
    includeTranscript: boolean;
    includeMetadata: boolean;
    includeComments: boolean;
    generateSummary: boolean;
    extractKeyMoments: boolean;
  };
  indexingPriority: 'immediate' | 'background' | 'scheduled';
}

export interface UniversalContentInput {
  type: 'local_video' | 'platform_video' | 'text' | 'document';
  content?: string; // for text/document
  filePath?: string; // for local video
  platformUrl?: string; // for platform video
  commonMetadata: {
    title?: string;
    spaceId?: string;
    tags?: string[];
    source: string;
  };
  processingOptions?: VideoProcessingOptions | PlatformExtractionOptions;
}

export interface PlatformExtractionOptions {
  includeTranscript: boolean;
  includeMetadata: boolean;
  includeComments: boolean;
  generateSummary: boolean;
  extractKeyMoments: boolean;
  transcriptLanguage?: string;
  qualityLevel?: 'basic' | 'detailed' | 'comprehensive';
}

// Enhanced search types for hybrid local + platform content
export interface UniversalSearchResult {
  memory: Memory;
  source: 'local' | 'platform';
  platform?: string;
  playbackInfo: {
    type: 'local' | 'platform';
    videoId: string;
    timestamp?: number;
    deeplinkUrl?: string;
    thumbnailUrl?: string;
  };
  relevanceScore: number;
  matchContext: string[];
  highlights?: string[];
}

export interface PlaybackQueueItem {
  title: string;
  source: 'local' | 'platform';
  videoId: string;
  startTimestamp: number;
  endTimestamp?: number;
  deeplinkUrl?: string;
  relevanceReason: string;
  estimatedDuration: number;
}

export interface CrossPlatformResult {
  localContent: SearchResult[];
  platformContent: PlatformSearchResult[];
  correlations: ContentCorrelation[];
  totalResults: number;
}

export interface PlatformSearchResult {
  platformVideo: PlatformVideo;
  memory: Memory;
  similarity?: number;
  highlights?: string[];
  deepLinks: VideoDeepLink[];
}

export interface HybridSearchResult {
  unified: UniversalSearchResult[];
  breakdown: {
    local: SearchResult[];
    platform: PlatformSearchResult[];
  };
  correlations: ContentCorrelation[];
  performance: {
    searchTime: number;
    localResults: number;
    platformResults: number;
    correlationsFound: number;
  };
}

// Platform-specific types
export interface YouTubeVideoData {
  videoId: string;
  title: string;
  description: string;
  duration: number;
  uploadDate: Date;
  channelId: string;
  channelTitle: string;
  viewCount?: number;
  likeCount?: number;
  commentCount?: number;
  tags: string[];
  categoryId: string;
  defaultLanguage?: string;
  thumbnails: {
    default: string;
    medium: string;
    high: string;
    maxres?: string;
  };
}

export interface YouTubeTranscript {
  videoId: string;
  language: string;
  segments: YouTubeTranscriptSegment[];
  isGenerated: boolean;
  confidence?: number;
}

export interface YouTubeTranscriptSegment {
  start: number;
  duration: number;
  text: string;
}

export interface YouTubeUrlParts {
  videoId?: string;
  playlistId?: string;
  timestamp?: number;
  channelId?: string;
  isValid: boolean;
}