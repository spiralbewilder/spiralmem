import { BaseRepository } from './BaseRepository.js';
import { logger } from '../../../utils/logger.js';

// Video processing domain types
export interface VideoProcessingJob {
  id: string;
  sourceId: string;
  sourceType: 'local' | 'youtube' | 'platform';
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number; // 0-100
  videoPath?: string;
  audioPath?: string;
  transcriptPath?: string;
  processingSteps: ProcessingStep[];
  metadata: {
    originalUrl?: string;
    videoInfo?: {
      duration: number;
      format: string;
      resolution: { width: number; height: number };
      fileSize: number;
    };
    processingTime?: {
      total: number;
      validation: number;
      audioExtraction: number;
      transcription: number;
      chunking: number;
      embedding: number;
    };
    error?: string;
  };
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

export interface ProcessingStep {
  step: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startTime?: Date;
  endTime?: Date;
  duration?: number; // ms
  error?: string;
  metadata?: any;
}

export interface ProcessedVideoContent {
  id: string;
  jobId: string;
  memoryId: string; // Links to memory table
  chunks: ContentChunkData[];
  embeddings?: EmbeddingData[];
  transcript: {
    language: string;
    duration: number;
    segmentCount: number;
    fullText: string;
    segments: TranscriptSegment[];
  };
  frames?: FrameData[];
  thumbnails?: ThumbnailData[];
  metadata: {
    chunkCount: number;
    embeddingCount: number;
    processingQuality: number;
    hasTimestamps: boolean;
  };
  createdAt: Date;
}

export interface ContentChunkData {
  id: string;
  chunkIndex: number;
  content: string;
  startTime?: number;
  endTime?: number;
  wordCount: number;
  characterCount: number;
  embedding?: number[];
}

export interface EmbeddingData {
  chunkId: string;
  embedding: number[];
  dimensions: number;
  model: string;
  processingTime: number;
}

export interface TranscriptSegment {
  text: string;
  start: number;
  end: number;
  confidence?: number;
}

export interface FrameData {
  filepath: string;
  timestamp: number;
  frameNumber: number;
  isKeyframe?: boolean;
  width: number;
  height: number;
  fileSize: number;
}

export interface ThumbnailData {
  filepath: string;
  timestamp: number;
  width: number;
  height: number;
  quality?: number;
  fileSize: number;
}

// Database row interfaces
interface VideoProcessingJobRow {
  id: string;
  source_id: string;
  source_type: string;
  status: string;
  progress: number;
  video_path: string | null;
  audio_path: string | null;
  transcript_path: string | null;
  processing_steps: string;
  metadata: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface ProcessedVideoContentRow {
  id: string;
  job_id: string;
  memory_id: string;
  chunks_data: string;
  embeddings_data: string | null;
  transcript_data: string;
  frames_data: string | null;
  thumbnails_data: string | null;
  metadata: string;
  created_at: string;
}

/**
 * Repository for managing video processing jobs and results
 * Handles the complete video processing lifecycle from input to searchable content
 */
export class VideoProcessingRepository extends BaseRepository {
  
  // Video Processing Job methods
  
  async createJob(job: Omit<VideoProcessingJob, 'createdAt' | 'updatedAt'>): Promise<VideoProcessingJob> {
    const id = job.id || this.generateId();
    const now = this.formatDate(new Date());

    const newJob: VideoProcessingJob = {
      ...job,
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await this.db.run(`
      INSERT INTO video_processing_jobs (
        id, source_id, source_type, status, progress, 
        video_path, audio_path, transcript_path, 
        processing_steps, metadata, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, 
      id, job.sourceId, job.sourceType, job.status, job.progress,
      job.videoPath || null, job.audioPath || null, job.transcriptPath || null,
      this.serializeJson(job.processingSteps), this.serializeJson(job.metadata),
      now, now
    );

    logger.info(`Created video processing job: ${id} for source: ${job.sourceId}`);
    return newJob;
  }

  async findJobById(id: string): Promise<VideoProcessingJob | null> {
    const row = await this.db.get(
      'SELECT * FROM video_processing_jobs WHERE id = ?', 
      id
    ) as VideoProcessingJobRow | undefined;
    
    return row ? this.mapRowToJob(row) : null;
  }

  async findJobBySourceId(sourceId: string): Promise<VideoProcessingJob | null> {
    const row = await this.db.get(
      'SELECT * FROM video_processing_jobs WHERE source_id = ? ORDER BY created_at DESC LIMIT 1', 
      sourceId
    ) as VideoProcessingJobRow | undefined;
    
    return row ? this.mapRowToJob(row) : null;
  }

  async findJobsByStatus(status: VideoProcessingJob['status']): Promise<VideoProcessingJob[]> {
    const rows = await this.db.all(
      'SELECT * FROM video_processing_jobs WHERE status = ? ORDER BY created_at ASC',
      status
    ) as VideoProcessingJobRow[];
    
    return rows.map(row => this.mapRowToJob(row));
  }

  async updateJobStatus(
    id: string, 
    status: VideoProcessingJob['status'], 
    progress?: number,
    error?: string
  ): Promise<boolean> {
    const now = this.formatDate(new Date());
    const completedAt = status === 'completed' || status === 'failed' ? now : null;
    
    // Get existing job to update metadata
    const existing = await this.findJobById(id);
    if (!existing) return false;

    const updatedMetadata = { ...existing.metadata };
    if (error) {
      updatedMetadata.error = error;
    }

    const result = await this.db.run(`
      UPDATE video_processing_jobs 
      SET status = ?, progress = ?, metadata = ?, updated_at = ?, completed_at = ?
      WHERE id = ?
    `, 
      status, 
      progress !== undefined ? progress : existing.progress,
      this.serializeJson(updatedMetadata),
      now, 
      completedAt, 
      id
    );

    if (result && result.changes > 0) {
      logger.info(`Updated job ${id} status to ${status} (${progress}%)`);
    }

    return result ? result.changes > 0 : false;
  }

  async updateJobStep(
    id: string, 
    stepName: string, 
    stepStatus: ProcessingStep['status'],
    stepMetadata?: any,
    error?: string
  ): Promise<boolean> {
    const job = await this.findJobById(id);
    if (!job) return false;

    const steps = [...job.processingSteps];
    const stepIndex = steps.findIndex(s => s.step === stepName);
    const now = new Date();

    if (stepIndex >= 0) {
      // Update existing step
      const step = steps[stepIndex];
      step.status = stepStatus;
      step.endTime = stepStatus === 'completed' || stepStatus === 'failed' ? now : undefined;
      step.duration = step.startTime && step.endTime ? 
        (step.endTime instanceof Date ? step.endTime.getTime() : new Date(step.endTime).getTime()) - 
        (step.startTime instanceof Date ? step.startTime.getTime() : new Date(step.startTime).getTime()) : undefined;
      if (error) step.error = error;
      if (stepMetadata) step.metadata = stepMetadata;
    } else {
      // Add new step
      steps.push({
        step: stepName,
        status: stepStatus,
        startTime: stepStatus === 'running' ? now : undefined,
        endTime: stepStatus === 'completed' || stepStatus === 'failed' ? now : undefined,
        error,
        metadata: stepMetadata
      });
    }

    const result = await this.db.run(`
      UPDATE video_processing_jobs 
      SET processing_steps = ?, updated_at = ?
      WHERE id = ?
    `, 
      this.serializeJson(steps),
      this.formatDate(now),
      id
    );

    return result ? result.changes > 0 : false;
  }

  async updateJobPaths(
    id: string, 
    paths: { 
      videoPath?: string; 
      audioPath?: string; 
      transcriptPath?: string; 
    }
  ): Promise<boolean> {
    const job = await this.findJobById(id);
    if (!job) return false;

    const result = await this.db.run(`
      UPDATE video_processing_jobs 
      SET video_path = ?, audio_path = ?, transcript_path = ?, updated_at = ?
      WHERE id = ?
    `, 
      paths.videoPath || job.videoPath || null,
      paths.audioPath || job.audioPath || null,
      paths.transcriptPath || job.transcriptPath || null,
      this.formatDate(new Date()),
      id
    );

    return result ? result.changes > 0 : false;
  }

  // Processed Content methods

  async storeProcessedContent(content: Omit<ProcessedVideoContent, 'createdAt'>): Promise<ProcessedVideoContent> {
    const id = content.id || this.generateId();
    const now = this.formatDate(new Date());

    const newContent: ProcessedVideoContent = {
      ...content,
      id,
      createdAt: new Date(),
    };

    await this.db.run(`
      INSERT INTO processed_video_content (
        id, job_id, memory_id, chunks_data, embeddings_data, 
        transcript_data, frames_data, thumbnails_data, metadata, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, 
      id, content.jobId, content.memoryId,
      this.serializeJson(content.chunks),
      content.embeddings ? this.serializeJson(content.embeddings) : null,
      this.serializeJson(content.transcript),
      content.frames ? this.serializeJson(content.frames) : null,
      content.thumbnails ? this.serializeJson(content.thumbnails) : null,
      this.serializeJson(content.metadata),
      now
    );

    logger.info(`Stored processed content: ${id} for job: ${content.jobId}`);
    return newContent;
  }

  async findProcessedContentByJobId(jobId: string): Promise<ProcessedVideoContent | null> {
    const row = await this.db.get(
      'SELECT * FROM processed_video_content WHERE job_id = ?', 
      jobId
    ) as ProcessedVideoContentRow | undefined;
    
    return row ? this.mapRowToProcessedContent(row) : null;
  }

  async findProcessedContentByMemoryId(memoryId: string): Promise<ProcessedVideoContent | null> {
    const row = await this.db.get(
      'SELECT * FROM processed_video_content WHERE memory_id = ?', 
      memoryId
    ) as ProcessedVideoContentRow | undefined;
    
    return row ? this.mapRowToProcessedContent(row) : null;
  }

  async searchProcessedContent(
    query: string, 
    limit?: number
  ): Promise<ProcessedVideoContent[]> {
    let sql = `
      SELECT pvc.* FROM processed_video_content pvc
      WHERE json_extract(pvc.transcript_data, '$.fullText') LIKE ?
      ORDER BY pvc.created_at DESC
    `;
    
    const params: any[] = [`%${query}%`];
    
    if (limit) {
      sql += ' LIMIT ?';
      params.push(limit);
    }

    const rows = await this.db.all(sql, ...params) as ProcessedVideoContentRow[];
    return rows.map(row => this.mapRowToProcessedContent(row));
  }

  // Analytics and reporting methods

  async getJobStats(): Promise<{
    total: number;
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    averageProcessingTime: number;
  }> {
    const stats = await this.db.get(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processing,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        AVG(CASE 
          WHEN status = 'completed' AND completed_at IS NOT NULL 
          THEN (julianday(completed_at) - julianday(created_at)) * 24 * 60 * 60 * 1000 
          ELSE NULL 
        END) as avg_processing_time
      FROM video_processing_jobs
    `) as any;

    return {
      total: stats.total || 0,
      pending: stats.pending || 0,
      processing: stats.processing || 0,
      completed: stats.completed || 0,
      failed: stats.failed || 0,
      averageProcessingTime: stats.avg_processing_time || 0
    };
  }

  async getProcessingMetrics(): Promise<{
    totalVideosProcessed: number;
    totalChunksGenerated: number;
    totalEmbeddingsGenerated: number;
    averageChunksPerVideo: number;
    totalProcessingTimeHours: number;
  }> {
    const metrics = await this.db.get(`
      SELECT 
        COUNT(pvc.id) as total_videos,
        SUM(json_extract(pvc.metadata, '$.chunkCount')) as total_chunks,
        SUM(json_extract(pvc.metadata, '$.embeddingCount')) as total_embeddings,
        AVG(json_extract(pvc.metadata, '$.chunkCount')) as avg_chunks_per_video,
        SUM(CASE 
          WHEN vpj.status = 'completed' AND vpj.completed_at IS NOT NULL 
          THEN (julianday(vpj.completed_at) - julianday(vpj.created_at)) * 24 
          ELSE 0 
        END) as total_processing_hours
      FROM processed_video_content pvc
      JOIN video_processing_jobs vpj ON pvc.job_id = vpj.id
    `) as any;

    return {
      totalVideosProcessed: metrics.total_videos || 0,
      totalChunksGenerated: metrics.total_chunks || 0,
      totalEmbeddingsGenerated: metrics.total_embeddings || 0,
      averageChunksPerVideo: metrics.avg_chunks_per_video || 0,
      totalProcessingTimeHours: metrics.total_processing_hours || 0
    };
  }

  // Private mapping methods

  private mapRowToJob(row: VideoProcessingJobRow): VideoProcessingJob {
    return {
      id: row.id,
      sourceId: row.source_id,
      sourceType: row.source_type as VideoProcessingJob['sourceType'],
      status: row.status as VideoProcessingJob['status'],
      progress: row.progress,
      videoPath: row.video_path || undefined,
      audioPath: row.audio_path || undefined,
      transcriptPath: row.transcript_path || undefined,
      processingSteps: this.deserializeJson(row.processing_steps) || [],
      metadata: this.deserializeJson(row.metadata) || {},
      createdAt: this.parseDate(row.created_at),
      updatedAt: this.parseDate(row.updated_at),
      completedAt: row.completed_at ? this.parseDate(row.completed_at) : undefined,
    };
  }

  private mapRowToProcessedContent(row: ProcessedVideoContentRow): ProcessedVideoContent {
    return {
      id: row.id,
      jobId: row.job_id,
      memoryId: row.memory_id,
      chunks: this.deserializeJson(row.chunks_data) || [],
      embeddings: row.embeddings_data ? this.deserializeJson(row.embeddings_data) : undefined,
      transcript: this.deserializeJson(row.transcript_data),
      frames: row.frames_data ? this.deserializeJson(row.frames_data) : undefined,
      thumbnails: row.thumbnails_data ? this.deserializeJson(row.thumbnails_data) : undefined,
      metadata: this.deserializeJson(row.metadata) || {},
      createdAt: this.parseDate(row.created_at),
    };
  }
}