# Week 2 Enhanced Tasks: Hybrid Video Architecture

## Strategic Enhancement: Platform Video Integration

Building on Week 1's foundation, Week 2 introduces **revolutionary hybrid video capabilities** that transform spiralmem from a local-only tool into a universal video memory system.

## Core Enhancement: Two-Tiered Video Strategy

### **Tier 1: Full Local Processing** (Existing)
- Complete video file ingestion and storage
- Local Whisper transcription
- Frame extraction and visual analysis
- Full local playback capabilities

### **Tier 2: Platform Video Indexing** (NEW)
- Metadata harvesting from video platforms
- Transcript extraction without file download
- Deep-linking with timestamp precision
- Cross-platform search and discovery

---

## Week 2 Task Breakdown

### **Phase 1: Database Foundation Fixes** (Days 1-2)

#### **Priority 1A: Async Database Layer Completion**
```typescript
Critical Fixes:
✅ Complete async/await conversion for all repository methods
✅ Fix PromisifiedDatabase interface consistency  
✅ Test all database operations end-to-end
✅ Resolve TypeScript compilation issues
✅ Add proper error handling for async operations
```

#### **Priority 1B: Repository Pattern Completion**
```typescript
Missing Components:
✅ ChunkRepository - Content chunking operations
✅ TagRepository - Tagging system management
✅ Complete MemoryRepository async methods
✅ Add repository integration tests
✅ Database transaction management
```

### **Phase 2: Platform Integration Architecture** (Days 3-4)

#### **Priority 2A: Extended Database Schema**
```sql
-- Platform video references table
CREATE TABLE platform_videos (
  id TEXT PRIMARY KEY,
  memory_id TEXT REFERENCES memories(id),
  platform TEXT NOT NULL, -- 'youtube', 'spotify', 'zoom', etc.
  platform_video_id TEXT NOT NULL,
  video_url TEXT NOT NULL,
  thumbnail_url TEXT,
  duration REAL,
  upload_date TEXT,
  channel_info JSON,
  playlist_info JSON,
  platform_metadata JSON,
  last_indexed TEXT,
  accessibility_data JSON, -- captions, descriptions
  UNIQUE(platform, platform_video_id)
);

-- Timestamp-based deep links for precise navigation
CREATE TABLE video_deeplinks (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL, -- references platform_videos.id or videos.id
  video_type TEXT CHECK (video_type IN ('local', 'platform')),
  timestamp_start REAL NOT NULL,
  timestamp_end REAL,
  deeplink_url TEXT NOT NULL,
  context_summary TEXT,
  search_keywords TEXT,
  confidence_score REAL DEFAULT 1.0
);

-- Platform API credentials and rate limiting
CREATE TABLE platform_connections (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL UNIQUE,
  api_credentials JSON,
  rate_limit_info JSON,
  last_sync TEXT,
  sync_status TEXT DEFAULT 'active',
  error_log JSON
);
```

#### **Priority 2B: Platform Connector Architecture**
```typescript
// Abstract base for all platform integrations
abstract class PlatformConnector {
  abstract platform: string;
  abstract extractMetadata(url: string): Promise<PlatformVideoMetadata>;
  abstract extractTranscript(videoId: string): Promise<TranscriptData>;
  abstract generateDeepLink(videoId: string, timestamp: number): string;
  abstract validateUrl(url: string): boolean;
  abstract getRateLimits(): RateLimitInfo;
}

// YouTube implementation as primary proof-of-concept
class YouTubeConnector extends PlatformConnector {
  platform = 'youtube';
  private apiKey: string;
  
  async extractMetadata(url: string): Promise<YouTubeVideoMetadata>
  async extractTranscript(videoId: string): Promise<YouTubeTranscript>
  generateDeepLink(videoId: string, timestamp: number): string
  validateUrl(url: string): boolean
}

// Platform factory for extensibility
class PlatformFactory {
  static createConnector(platform: string): PlatformConnector
  static getSupportedPlatforms(): string[]
  static detectPlatform(url: string): string | null
}
```

### **Phase 3: Hybrid Content Types** (Days 5-6)

#### **Priority 3A: Enhanced Content Input Types**
```typescript
// Extended content input for platform videos
interface PlatformVideoInput {
  platformUrl: string;
  platform?: string; // auto-detect if not provided
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

// Unified content input supporting both local and platform
interface UniversalContentInput {
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
```

#### **Priority 3B: Repository Extensions**
```typescript
// Platform video repository
class PlatformVideoRepository extends BaseRepository {
  async create(platformVideo: PlatformVideoInput): Promise<PlatformVideo>
  async findByUrl(url: string): Promise<PlatformVideo | null>
  async findByPlatform(platform: string): Promise<PlatformVideo[]>
  async updateMetadata(id: string, metadata: Record<string, any>): Promise<boolean>
  async createDeepLink(videoId: string, timestamp: number, context: string): Promise<string>
  async findDeepLinks(videoId: string): Promise<VideoDeepLink[]>
  async scheduleRefresh(videoId: string, interval: string): Promise<void>
}

// Enhanced memory repository for hybrid operations
class HybridMemoryRepository extends MemoryRepository {
  async searchAcrossPlatforms(query: SearchQuery): Promise<HybridSearchResult[]>
  async findRelatedContent(memoryId: string, includePlatforms: boolean): Promise<RelatedContent[]>
  async generatePlaybackQueue(searchQuery: string): Promise<PlaybackQueueItem[]>
}
```

### **Phase 4: Hybrid Search System** (Days 6-7)

#### **Priority 4A: Unified Search Architecture**
```typescript
// Enhanced search that queries both local and platform content
class HybridSearchEngine {
  async searchUniversal(query: SearchQuery): Promise<UniversalSearchResult[]>
  async searchByTimestamp(query: string, timeRange?: TimeRange): Promise<TimestampSearchResult[]>
  async findAcrossPlatforms(query: string, platforms: string[]): Promise<CrossPlatformResult[]>
  async generateContentCorrelations(memoryId: string): Promise<ContentCorrelation[]>
  
  private async combineResults(localResults: SearchResult[], platformResults: PlatformSearchResult[]): Promise<UniversalSearchResult[]>
  private async rankHybridResults(results: UniversalSearchResult[]): Promise<UniversalSearchResult[]>
}

// Search result types for platform integration
interface UniversalSearchResult {
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
}

interface PlaybackQueueItem {
  title: string;
  source: 'local' | 'platform';
  videoId: string;
  startTimestamp: number;
  endTimestamp?: number;
  deeplinkUrl?: string;
  relevanceReason: string;
  estimatedDuration: number;
}
```

### **Phase 5: YouTube Integration Foundation** (Days 7)

#### **Priority 5A: YouTube Data API Integration**
```typescript
// YouTube-specific implementation
class YouTubeService {
  private apiKey: string;
  private rateLimiter: RateLimiter;
  
  async getVideoMetadata(videoId: string): Promise<YouTubeVideoData>
  async getVideoTranscript(videoId: string): Promise<YouTubeTranscript>
  async searchYouTubeVideos(query: string): Promise<YouTubeSearchResult[]>
  async getPlaylistVideos(playlistId: string): Promise<YouTubeVideo[]>
  async getChannelVideos(channelId: string): Promise<YouTubeVideo[]>
  
  // Batch operations for efficiency
  async batchGetMetadata(videoIds: string[]): Promise<YouTubeVideoData[]>
  async batchIndexPlaylist(playlistUrl: string, spaceId: string): Promise<IndexingJob>
}

// Deep-link generation for YouTube
class YouTubeDeepLinkGenerator {
  static generateTimestampUrl(videoId: string, timestamp: number): string
  static generatePlaylistUrl(playlistId: string, videoId: string, timestamp: number): string
  static parseYouTubeUrl(url: string): YouTubeUrlParts
  static validateTimestamp(videoId: string, timestamp: number): Promise<boolean>
}
```

---

## Week 2 Deliverables

### **Core Infrastructure**
✅ **Async Database Layer**: All repository operations fully async/await compliant  
✅ **Platform Integration Schema**: Database support for platform videos and deep-links  
✅ **Repository Pattern Complete**: All CRUD operations tested and functional  
✅ **Error Handling**: Comprehensive error management across all operations  

### **Platform Integration Foundation**
✅ **PlatformConnector Architecture**: Extensible base for all platform integrations  
✅ **YouTube Connector**: Full YouTube Data API integration with metadata and transcript extraction  
✅ **Deep-Link System**: Timestamp-precise URL generation for platform videos  
✅ **Rate Limiting**: Intelligent API usage management  

### **Hybrid Search Capabilities**
✅ **Universal Search**: Single search interface for local + platform content  
✅ **Cross-Platform Results**: Unified result ranking and presentation  
✅ **Playback Queue**: Smart playlist generation mixing local and platform videos  
✅ **Content Correlation**: "Related content" across local and platform libraries  

### **Testing & Documentation**
✅ **Comprehensive Test Suite**: >90% coverage including platform integration mocks  
✅ **API Documentation**: Complete documentation for hybrid operations  
✅ **Performance Benchmarks**: Search and indexing performance baselines  
✅ **Integration Examples**: Working examples of YouTube video indexing  

---

## Success Metrics for Week 2

### **Functional Requirements**
```yaml
✅ Index YouTube video by URL in <10 seconds
✅ Search across local + YouTube content simultaneously  
✅ Generate deep-links with timestamp precision
✅ Handle YouTube API rate limits gracefully
✅ Process video transcripts with 95%+ accuracy preservation
✅ Cross-platform content correlation working
```

### **Performance Targets**
```yaml
✅ Platform video indexing: <5 seconds per video
✅ Hybrid search response: <2 seconds for 1000+ local + platform items
✅ Deep-link generation: <500ms per link
✅ Database operations: All async, no blocking calls
✅ Memory usage: <200MB additional for platform operations
```

### **Integration Capabilities**
```yaml
✅ YouTube Data API: Full metadata and transcript extraction
✅ Batch operations: Process YouTube playlists efficiently  
✅ Error recovery: Robust handling of API failures
✅ Cross-platform search: Unified results from multiple sources
✅ Playback queue: Smart mixed-content playlists
```

---

## Strategic Impact

### **Competitive Advantage Created**
- **Universal Video Memory**: Only tool combining local + platform indexing
- **Timestamp Precision**: Direct playback at exact moments found in search
- **Cross-Platform Discovery**: Find related content across your entire video universe
- **Privacy Preserved**: Only metadata indexed, original content remains on platforms

### **User Value Propositions**
- **Instant Library Expansion**: Index years of YouTube/platform content in minutes
- **Unified Search**: One search across local files + entire platform libraries  
- **Smart Discovery**: Find connections between local videos and platform content
- **Precise Navigation**: Jump directly to relevant moments across all video sources

### **Technical Foundation**
- **Extensible Architecture**: Easy addition of new platforms (Spotify, Zoom, etc.)
- **Scalable Design**: Handle millions of platform video references efficiently
- **API-First**: All operations available via MCP tools for AI integration
- **Future-Proof**: Ready for advanced AI features like content correlation and recommendation

This enhanced Week 2 transforms spiralmem from a "local video processor" into a **"universal video intelligence system"** - a category-defining advancement that positions it as an essential tool for anyone working with video content across platforms.