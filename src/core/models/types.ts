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