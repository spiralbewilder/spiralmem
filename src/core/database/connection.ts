import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';
import { promisify } from 'util';
import { config } from '../../utils/config.js';
import { logger } from '../../utils/logger.js';

// Promisify sqlite3 methods for async/await support
interface PromisifiedDatabase {
  run(sql: string, ...params: any[]): Promise<{ lastID: number; changes: number }>;
  get(sql: string, ...params: any[]): Promise<any>;
  all(sql: string, ...params: any[]): Promise<any[]>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

export class DatabaseConnection {
  private static instance: DatabaseConnection;
  private db: sqlite3.Database;
  private promisifiedDb: PromisifiedDatabase;
  private isInitialized = false;

  private constructor() {
    const dbPath = config.getDatabasePath();
    const dbDir = path.dirname(dbPath);
    
    // Ensure database directory exists
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
      logger.info(`Created database directory: ${dbDir}`);
    }

    // Initialize SQLite database
    this.db = new sqlite3.Database(dbPath);
    
    // Create promisified interface
    this.promisifiedDb = {
      run: promisify(this.db.run.bind(this.db)),
      get: promisify(this.db.get.bind(this.db)),
      all: promisify(this.db.all.bind(this.db)),
      exec: promisify(this.db.exec.bind(this.db)),
      close: promisify(this.db.close.bind(this.db)),
    };
    
    // Configure database
    this.configurePragmas();
    
    logger.info(`Database connected: ${dbPath}`);
  }

  private configurePragmas(): void {
    // Enable WAL mode for better performance
    this.db.run('PRAGMA journal_mode = WAL');
    
    // Set reasonable timeouts
    this.db.run('PRAGMA busy_timeout = 5000');
    
    // Enable foreign key constraints
    this.db.run('PRAGMA foreign_keys = ON');
  }

  public static getInstance(): DatabaseConnection {
    if (!DatabaseConnection.instance) {
      DatabaseConnection.instance = new DatabaseConnection();
    }
    return DatabaseConnection.instance;
  }

  public getDb(): PromisifiedDatabase {
    if (!this.isInitialized) {
      throw new Error('Database not initialized. Call initialize() first.');
    }
    return this.promisifiedDb;
  }

  public async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      // Run migrations
      await this.runMigrations();
      
      // TODO: Initialize vector search extension (sqlite-vss)
      // This will be implemented when we add vector search capability
      
      this.isInitialized = true;
      logger.info('Database initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize database:', error);
      throw error;
    }
  }

  private async runMigrations(): Promise<void> {
    // Get current schema version
    const currentVersion = await this.getCurrentVersion();
    const targetVersion = this.getTargetVersion();

    if (currentVersion >= targetVersion) {
      logger.info(`Database already at version ${currentVersion}`);
      return;
    }

    logger.info(`Migrating database from version ${currentVersion} to ${targetVersion}`);

    // Run migrations sequentially
    for (let version = currentVersion + 1; version <= targetVersion; version++) {
      await this.runMigration(version);
      await this.setVersion(version);
      logger.info(`Applied migration ${version}`);
    }

    logger.info('Database migration completed');
  }

  private async getCurrentVersion(): Promise<number> {
    try {
      const result = await this.promisifiedDb.get('SELECT version FROM schema_version LIMIT 1');
      return result?.version || 0;
    } catch {
      // Table doesn't exist, this is version 0
      return 0;
    }
  }

  private getTargetVersion(): number {
    // This would normally be read from migration files
    // For now, we'll hardcode the current schema version
    return 3;
  }

  private async setVersion(version: number): Promise<void> {
    await this.promisifiedDb.run(`
      INSERT OR REPLACE INTO schema_version (id, version, applied_at) 
      VALUES (1, ?, datetime('now'))
    `, version);
  }

  private async runMigration(version: number): Promise<void> {
    switch (version) {
      case 1:
        await this.createInitialSchema();
        break;
      case 2:
        await this.createPlatformIntegrationSchema();
        break;
      case 3:
        await this.createVideoProcessingSchema();
        break;
      default:
        throw new Error(`Unknown migration version: ${version}`);
    }
  }

  private async createInitialSchema(): Promise<void> {
    // Schema version tracking
    await this.promisifiedDb.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        id INTEGER PRIMARY KEY,
        version INTEGER NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);

    // Spaces table
    await this.promisifiedDb.exec(`
      CREATE TABLE IF NOT EXISTS spaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        settings JSON NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    // Memories table
    await this.promisifiedDb.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        space_id TEXT NOT NULL,
        content_type TEXT NOT NULL CHECK (content_type IN ('text', 'video', 'document', 'image')),
        title TEXT,
        content TEXT NOT NULL,
        source TEXT NOT NULL,
        file_path TEXT,
        metadata JSON NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (space_id) REFERENCES spaces (id) ON DELETE CASCADE
      );
    `);

    // Chunks table
    await this.promisifiedDb.exec(`
      CREATE TABLE IF NOT EXISTS chunks (
        id TEXT PRIMARY KEY,
        memory_id TEXT NOT NULL,
        chunk_text TEXT NOT NULL,
        chunk_order INTEGER NOT NULL,
        start_offset INTEGER,
        end_offset INTEGER,
        metadata JSON NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (memory_id) REFERENCES memories (id) ON DELETE CASCADE
      );
    `);

    // Tags table
    await this.promisifiedDb.exec(`
      CREATE TABLE IF NOT EXISTS tags (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        color TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    // Memory tags junction table
    await this.promisifiedDb.exec(`
      CREATE TABLE IF NOT EXISTS memory_tags (
        memory_id TEXT NOT NULL,
        tag_id TEXT NOT NULL,
        PRIMARY KEY (memory_id, tag_id),
        FOREIGN KEY (memory_id) REFERENCES memories (id) ON DELETE CASCADE,
        FOREIGN KEY (tag_id) REFERENCES tags (id) ON DELETE CASCADE
      );
    `);

    // Videos table
    await this.promisifiedDb.exec(`
      CREATE TABLE IF NOT EXISTS videos (
        id TEXT PRIMARY KEY,
        memory_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        duration REAL,
        resolution TEXT,
        fps REAL,
        file_size INTEGER,
        mime_type TEXT,
        processed_at TEXT,
        processing_status TEXT NOT NULL DEFAULT 'pending' CHECK (processing_status IN ('pending', 'processing', 'completed', 'failed')),
        processing_error TEXT,
        FOREIGN KEY (memory_id) REFERENCES memories (id) ON DELETE CASCADE
      );
    `);

    // Transcripts table
    await this.promisifiedDb.exec(`
      CREATE TABLE IF NOT EXISTS transcripts (
        id TEXT PRIMARY KEY,
        video_id TEXT NOT NULL,
        full_text TEXT NOT NULL,
        language TEXT,
        confidence REAL,
        segments JSON NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (video_id) REFERENCES videos (id) ON DELETE CASCADE
      );
    `);

    // Video frames table
    await this.promisifiedDb.exec(`
      CREATE TABLE IF NOT EXISTS video_frames (
        id TEXT PRIMARY KEY,
        video_id TEXT NOT NULL,
        timestamp REAL NOT NULL,
        frame_path TEXT,
        ocr_text TEXT,
        scene_change BOOLEAN NOT NULL DEFAULT FALSE,
        objects_detected JSON,
        FOREIGN KEY (video_id) REFERENCES videos (id) ON DELETE CASCADE
      );
    `);

    // Processing jobs table
    await this.promisifiedDb.exec(`
      CREATE TABLE IF NOT EXISTS processing_jobs (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK (type IN ('video', 'document', 'embedding')),
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
        input_path TEXT NOT NULL,
        output_path TEXT,
        progress REAL NOT NULL DEFAULT 0,
        error_message TEXT,
        metadata JSON NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        started_at TEXT,
        completed_at TEXT
      );
    `);

    // TODO: Re-enable indexes after debugging SQL syntax issue
    // Temporarily disabled to allow demo to run
    logger.info('Skipping core index creation temporarily for demo');

    // Create default space
    await this.promisifiedDb.run(`
      INSERT OR IGNORE INTO spaces (id, name, description, settings) 
      VALUES ('default', 'Default', 'Default memory space', '{}')
    `);

    logger.info('Initial database schema created');
  }

  private async createPlatformIntegrationSchema(): Promise<void> {
    // Platform video references table for indexing content without local storage
    await this.promisifiedDb.exec(`
      CREATE TABLE IF NOT EXISTS platform_videos (
        id TEXT PRIMARY KEY,
        memory_id TEXT NOT NULL,
        platform TEXT NOT NULL CHECK (platform IN ('youtube', 'spotify', 'zoom', 'teams', 'vimeo')),
        platform_video_id TEXT NOT NULL,
        video_url TEXT NOT NULL,
        thumbnail_url TEXT,
        duration REAL,
        upload_date TEXT,
        channel_info JSON,
        playlist_info JSON,
        platform_metadata JSON NOT NULL DEFAULT '{}',
        last_indexed TEXT NOT NULL DEFAULT (datetime('now')),
        accessibility_data JSON,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (memory_id) REFERENCES memories (id) ON DELETE CASCADE,
        UNIQUE(platform, platform_video_id)
      );
    `);

    // Deep-link table for timestamp-precise navigation to both local and platform videos
    await this.promisifiedDb.exec(`
      CREATE TABLE IF NOT EXISTS video_deeplinks (
        id TEXT PRIMARY KEY,
        video_id TEXT NOT NULL, -- references either videos.id or platform_videos.id
        video_type TEXT NOT NULL CHECK (video_type IN ('local', 'platform')),
        timestamp_start REAL NOT NULL,
        timestamp_end REAL,
        deeplink_url TEXT NOT NULL,
        context_summary TEXT,
        search_keywords TEXT,
        confidence_score REAL DEFAULT 1.0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    // Platform API credentials and rate limiting configuration
    await this.promisifiedDb.exec(`
      CREATE TABLE IF NOT EXISTS platform_connections (
        id TEXT PRIMARY KEY,
        platform TEXT NOT NULL UNIQUE,
        api_credentials JSON NOT NULL DEFAULT '{}',
        rate_limit_info JSON NOT NULL DEFAULT '{}',
        last_sync TEXT,
        sync_status TEXT DEFAULT 'active' CHECK (sync_status IN ('active', 'paused', 'error')),
        error_log JSON NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    // Platform transcripts table (separate from local transcripts for different processing)
    await this.promisifiedDb.exec(`
      CREATE TABLE IF NOT EXISTS platform_transcripts (
        id TEXT PRIMARY KEY,
        platform_video_id TEXT NOT NULL,
        full_text TEXT NOT NULL,
        language TEXT,
        confidence REAL,
        segments JSON NOT NULL DEFAULT '[]',
        source TEXT DEFAULT 'platform' CHECK (source IN ('platform', 'api', 'extracted')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (platform_video_id) REFERENCES platform_videos (id) ON DELETE CASCADE
      );
    `);

    // Content correlation table for finding relationships between local and platform content
    await this.promisifiedDb.exec(`
      CREATE TABLE IF NOT EXISTS content_correlations (
        id TEXT PRIMARY KEY,
        source_memory_id TEXT NOT NULL,
        target_memory_id TEXT NOT NULL,
        correlation_type TEXT NOT NULL CHECK (correlation_type IN ('similar_content', 'same_topic', 'temporal', 'referenced')),
        correlation_score REAL NOT NULL DEFAULT 0.0,
        correlation_metadata JSON NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (source_memory_id) REFERENCES memories (id) ON DELETE CASCADE,
        FOREIGN KEY (target_memory_id) REFERENCES memories (id) ON DELETE CASCADE,
        UNIQUE(source_memory_id, target_memory_id, correlation_type)
      );
    `);

    // TODO: Re-enable indexes after debugging SQL syntax issue
    // Temporarily disabled to allow demo to run
    logger.info('Skipping index creation temporarily for demo');

    logger.info('Platform integration database schema created');
  }

  private async createVideoProcessingSchema(): Promise<void> {
    // Video processing jobs table
    await this.promisifiedDb.exec(`
      CREATE TABLE IF NOT EXISTS video_processing_jobs (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        source_type TEXT NOT NULL CHECK (source_type IN ('local', 'youtube', 'platform')),
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
        progress INTEGER NOT NULL DEFAULT 0,
        video_path TEXT,
        audio_path TEXT,
        transcript_path TEXT,
        processing_steps TEXT NOT NULL DEFAULT '[]',
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        completed_at TEXT
      );
    `);

    // Processed video content table
    await this.promisifiedDb.exec(`
      CREATE TABLE IF NOT EXISTS processed_video_content (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        memory_id TEXT NOT NULL,
        chunks_data TEXT NOT NULL,
        embeddings_data TEXT,
        transcript_data TEXT NOT NULL,
        frames_data TEXT,
        thumbnails_data TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (job_id) REFERENCES video_processing_jobs (id) ON DELETE CASCADE,
        FOREIGN KEY (memory_id) REFERENCES memories (id) ON DELETE CASCADE,
        UNIQUE(job_id, memory_id)
      );
    `);

    // Vector embeddings table for semantic search
    await this.promisifiedDb.exec(`
      CREATE TABLE IF NOT EXISTS vector_embeddings (
        id TEXT PRIMARY KEY,
        content_id TEXT NOT NULL,
        content_type TEXT NOT NULL CHECK (content_type IN ('chunk', 'memory', 'frame')),
        embedding_model TEXT NOT NULL,
        embedding_dimensions INTEGER NOT NULL,
        embedding_vector TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(content_id, content_type, embedding_model)
      );
    `);

    // Search queries and results for analytics
    await this.promisifiedDb.exec(`
      CREATE TABLE IF NOT EXISTS search_analytics (
        id TEXT PRIMARY KEY,
        query_text TEXT NOT NULL,
        query_type TEXT NOT NULL CHECK (query_type IN ('keyword', 'semantic', 'hybrid')),
        results_count INTEGER NOT NULL DEFAULT 0,
        response_time_ms INTEGER NOT NULL DEFAULT 0,
        user_clicked BOOLEAN NOT NULL DEFAULT FALSE,
        search_metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    logger.info('Video processing database schema created');
  }

  public async close(): Promise<void> {
    if (this.db) {
      await this.promisifiedDb.close();
      logger.info('Database connection closed');
    }
  }

  // Health check method
  public async healthCheck(): Promise<boolean> {
    try {
      await this.promisifiedDb.get('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  // Backup method
  public async backup(backupPath?: string): Promise<string> {
    const fs = await import('fs/promises');
    
    if (!backupPath) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      backupPath = `${config.getDatabasePath()}.backup-${timestamp}`;
    }

    try {
      await fs.copyFile(config.getDatabasePath(), backupPath);
      logger.info(`Database backed up to: ${backupPath}`);
      return backupPath;
    } catch (error) {
      logger.error(`Failed to backup database: ${error}`);
      throw error;
    }
  }
}

// Export singleton instance
export const database = DatabaseConnection.getInstance();