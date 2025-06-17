import { BaseRepository } from './BaseRepository.js';
import { PlatformVideo, VideoDeepLink, PlatformVideoInput } from '../../models/types.js';

interface PlatformVideoRow {
  id: string;
  memory_id: string;
  platform: string;
  platform_video_id: string;
  video_url: string;
  thumbnail_url: string | null;
  duration: number | null;
  upload_date: string | null;
  channel_info: string | null;
  playlist_info: string | null;
  platform_metadata: string;
  last_indexed: string;
  accessibility_data: string | null;
  created_at: string;
  updated_at: string;
}

interface VideoDeepLinkRow {
  id: string;
  video_id: string;
  video_type: string;
  timestamp_start: number;
  timestamp_end: number | null;
  deeplink_url: string;
  context_summary: string | null;
  search_keywords: string | null;
  confidence_score: number;
  created_at: string;
}

export class PlatformVideoRepository extends BaseRepository {
  async create(input: PlatformVideoInput, memoryId: string): Promise<PlatformVideo> {
    const id = this.generateId();
    const now = this.formatDate(new Date());

    // Parse platform from URL if not provided
    const platform = input.platform || this.detectPlatformFromUrl(input.platformUrl);
    const platformVideoId = this.extractVideoIdFromUrl(input.platformUrl, platform);

    const platformVideo: PlatformVideo = {
      id,
      memoryId,
      platform: platform as PlatformVideo['platform'],
      platformVideoId,
      videoUrl: input.platformUrl,
      thumbnailUrl: undefined,
      duration: undefined,
      uploadDate: undefined,
      channelInfo: undefined,
      playlistInfo: undefined,
      platformMetadata: {},
      lastIndexed: new Date(),
      accessibilityData: undefined,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await this.db.run(`
      INSERT INTO platform_videos (
        id, memory_id, platform, platform_video_id, video_url, thumbnail_url,
        duration, upload_date, channel_info, playlist_info, platform_metadata,
        last_indexed, accessibility_data, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, id, memoryId, platform, platformVideoId, input.platformUrl, null,
       null, null, null, null, this.serializeJson({}),
       now, null, now, now);

    return platformVideo;
  }

  async findById(id: string): Promise<PlatformVideo | null> {
    const row = await this.db.get('SELECT * FROM platform_videos WHERE id = ?', id) as PlatformVideoRow | undefined;
    return row ? this.mapRowToPlatformVideo(row) : null;
  }

  async findByMemoryId(memoryId: string): Promise<PlatformVideo | null> {
    const row = await this.db.get('SELECT * FROM platform_videos WHERE memory_id = ?', memoryId) as PlatformVideoRow | undefined;
    return row ? this.mapRowToPlatformVideo(row) : null;
  }

  async findByPlatformAndVideoId(platform: string, platformVideoId: string): Promise<PlatformVideo | null> {
    const row = await this.db.get(
      'SELECT * FROM platform_videos WHERE platform = ? AND platform_video_id = ?',
      platform, platformVideoId
    ) as PlatformVideoRow | undefined;
    return row ? this.mapRowToPlatformVideo(row) : null;
  }

  async findByUrl(url: string): Promise<PlatformVideo | null> {
    const row = await this.db.get('SELECT * FROM platform_videos WHERE video_url = ?', url) as PlatformVideoRow | undefined;
    return row ? this.mapRowToPlatformVideo(row) : null;
  }

  async findByPlatform(platform: string, limit?: number, offset?: number): Promise<PlatformVideo[]> {
    let query = 'SELECT * FROM platform_videos WHERE platform = ? ORDER BY last_indexed DESC';
    const params: any[] = [platform];

    if (limit) {
      query += ' LIMIT ?';
      params.push(limit);
      if (offset) {
        query += ' OFFSET ?';
        params.push(offset);
      }
    }

    const rows = await this.db.all(query, ...params) as PlatformVideoRow[];
    return rows.map(row => this.mapRowToPlatformVideo(row));
  }

  async updateMetadata(id: string, metadata: {
    thumbnailUrl?: string;
    duration?: number;
    uploadDate?: Date;
    channelInfo?: Record<string, any>;
    playlistInfo?: Record<string, any>;
    platformMetadata?: Record<string, any>;
    accessibilityData?: Record<string, any>;
  }): Promise<boolean> {
    const existing = await this.findById(id);
    if (!existing) {
      return false;
    }

    const now = this.formatDate(new Date());
    const result = await this.db.run(`
      UPDATE platform_videos 
      SET 
        thumbnail_url = COALESCE(?, thumbnail_url),
        duration = COALESCE(?, duration),
        upload_date = COALESCE(?, upload_date),
        channel_info = COALESCE(?, channel_info),
        playlist_info = COALESCE(?, playlist_info),
        platform_metadata = COALESCE(?, platform_metadata),
        accessibility_data = COALESCE(?, accessibility_data),
        last_indexed = ?,
        updated_at = ?
      WHERE id = ?
    `, 
      metadata.thumbnailUrl || null,
      metadata.duration || null,
      metadata.uploadDate ? this.formatDate(metadata.uploadDate) : null,
      metadata.channelInfo ? this.serializeJson(metadata.channelInfo) : null,
      metadata.playlistInfo ? this.serializeJson(metadata.playlistInfo) : null,
      metadata.platformMetadata ? this.serializeJson(metadata.platformMetadata) : null,
      metadata.accessibilityData ? this.serializeJson(metadata.accessibilityData) : null,
      now, now, id
    );

    return result.changes > 0;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.db.run('DELETE FROM platform_videos WHERE id = ?', id);
    return result.changes > 0;
  }

  async count(platform?: string): Promise<number> {
    let query = 'SELECT COUNT(*) as count FROM platform_videos';
    const params: any[] = [];

    if (platform) {
      query += ' WHERE platform = ?';
      params.push(platform);
    }

    const result = await this.db.get(query, ...params) as { count: number };
    return result.count;
  }

  async getRecentlyIndexed(limit = 10, platform?: string): Promise<PlatformVideo[]> {
    let query = 'SELECT * FROM platform_videos';
    const params: any[] = [];

    if (platform) {
      query += ' WHERE platform = ?';
      params.push(platform);
    }

    query += ' ORDER BY last_indexed DESC LIMIT ?';
    params.push(limit);

    const rows = await this.db.all(query, ...params) as PlatformVideoRow[];
    return rows.map(row => this.mapRowToPlatformVideo(row));
  }

  async getNeedingRefresh(staleHours = 24): Promise<PlatformVideo[]> {
    const staleDate = new Date(Date.now() - staleHours * 60 * 60 * 1000);
    const staleDateStr = this.formatDate(staleDate);

    const rows = await this.db.all(
      'SELECT * FROM platform_videos WHERE last_indexed < ? ORDER BY last_indexed ASC',
      staleDateStr
    ) as PlatformVideoRow[];

    return rows.map(row => this.mapRowToPlatformVideo(row));
  }

  // Deep link management
  async createDeepLink(deepLink: Omit<VideoDeepLink, 'id' | 'createdAt'>): Promise<VideoDeepLink> {
    const id = this.generateId();
    const now = this.formatDate(new Date());

    const newDeepLink: VideoDeepLink = {
      ...deepLink,
      id,
      createdAt: new Date(),
    };

    await this.db.run(`
      INSERT INTO video_deeplinks (
        id, video_id, video_type, timestamp_start, timestamp_end,
        deeplink_url, context_summary, search_keywords, confidence_score, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, id, deepLink.videoId, deepLink.videoType, deepLink.timestampStart,
       deepLink.timestampEnd || null, deepLink.deeplinkUrl,
       deepLink.contextSummary || null, deepLink.searchKeywords || null,
       deepLink.confidenceScore, now);

    return newDeepLink;
  }

  async findDeepLinks(videoId: string, videoType: 'local' | 'platform'): Promise<VideoDeepLink[]> {
    const rows = await this.db.all(
      'SELECT * FROM video_deeplinks WHERE video_id = ? AND video_type = ? ORDER BY timestamp_start ASC',
      videoId, videoType
    ) as VideoDeepLinkRow[];

    return rows.map(row => this.mapRowToDeepLink(row));
  }

  async findDeepLinksByTimestamp(videoId: string, videoType: 'local' | 'platform', timestamp: number, tolerance = 30): Promise<VideoDeepLink[]> {
    const rows = await this.db.all(`
      SELECT * FROM video_deeplinks 
      WHERE video_id = ? AND video_type = ? 
        AND timestamp_start <= ? AND (timestamp_end IS NULL OR timestamp_end >= ?)
      ORDER BY ABS(timestamp_start - ?) ASC
    `, videoId, videoType, timestamp + tolerance, timestamp - tolerance, timestamp) as VideoDeepLinkRow[];

    return rows.map(row => this.mapRowToDeepLink(row));
  }

  async deleteDeepLink(id: string): Promise<boolean> {
    const result = await this.db.run('DELETE FROM video_deeplinks WHERE id = ?', id);
    return result.changes > 0;
  }

  async searchDeepLinks(keywords: string, limit = 20): Promise<VideoDeepLink[]> {
    const rows = await this.db.all(`
      SELECT * FROM video_deeplinks 
      WHERE search_keywords LIKE ? OR context_summary LIKE ?
      ORDER BY confidence_score DESC, timestamp_start ASC
      LIMIT ?
    `, `%${keywords}%`, `%${keywords}%`, limit) as VideoDeepLinkRow[];

    return rows.map(row => this.mapRowToDeepLink(row));
  }

  // Platform-specific URL handling
  private detectPlatformFromUrl(url: string): string {
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
      return 'youtube';
    } else if (url.includes('spotify.com')) {
      return 'spotify';
    } else if (url.includes('zoom.us')) {
      return 'zoom';
    } else if (url.includes('teams.microsoft.com')) {
      return 'teams';
    } else if (url.includes('vimeo.com')) {
      return 'vimeo';
    }
    throw new Error(`Unsupported platform URL: ${url}`);
  }

  private extractVideoIdFromUrl(url: string, platform: string): string {
    switch (platform) {
      case 'youtube':
        return this.extractYouTubeVideoId(url);
      case 'spotify':
        return this.extractSpotifyId(url);
      case 'zoom':
        return this.extractZoomId(url);
      case 'teams':
        return this.extractTeamsId(url);
      case 'vimeo':
        return this.extractVimeoId(url);
      default:
        throw new Error(`Unsupported platform: ${platform}`);
    }
  }

  private extractYouTubeVideoId(url: string): string {
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
      /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
      /youtube\.com\/v\/([a-zA-Z0-9_-]{11})/
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) {
        return match[1];
      }
    }

    throw new Error(`Invalid YouTube URL: ${url}`);
  }

  private extractSpotifyId(url: string): string {
    const match = url.match(/spotify\.com\/.+\/([a-zA-Z0-9]{22})/);
    if (match) {
      return match[1];
    }
    throw new Error(`Invalid Spotify URL: ${url}`);
  }

  private extractZoomId(url: string): string {
    const match = url.match(/zoom\.us\/rec\/share\/([a-zA-Z0-9_-]+)/);
    if (match) {
      return match[1];
    }
    throw new Error(`Invalid Zoom URL: ${url}`);
  }

  private extractTeamsId(url: string): string {
    const match = url.match(/teams\.microsoft\.com.+\/([a-zA-Z0-9_-]+)/);
    if (match) {
      return match[1];
    }
    throw new Error(`Invalid Teams URL: ${url}`);
  }

  private extractVimeoId(url: string): string {
    const match = url.match(/vimeo\.com\/(\d+)/);
    if (match) {
      return match[1];
    }
    throw new Error(`Invalid Vimeo URL: ${url}`);
  }

  private mapRowToPlatformVideo(row: PlatformVideoRow): PlatformVideo {
    return {
      id: row.id,
      memoryId: row.memory_id,
      platform: row.platform as PlatformVideo['platform'],
      platformVideoId: row.platform_video_id,
      videoUrl: row.video_url,
      thumbnailUrl: row.thumbnail_url || undefined,
      duration: row.duration || undefined,
      uploadDate: row.upload_date ? this.parseDate(row.upload_date) : undefined,
      channelInfo: row.channel_info ? this.deserializeJson(row.channel_info) : undefined,
      playlistInfo: row.playlist_info ? this.deserializeJson(row.playlist_info) : undefined,
      platformMetadata: this.deserializeJson(row.platform_metadata),
      lastIndexed: this.parseDate(row.last_indexed),
      accessibilityData: row.accessibility_data ? this.deserializeJson(row.accessibility_data) : undefined,
      createdAt: this.parseDate(row.created_at),
      updatedAt: this.parseDate(row.updated_at),
    };
  }

  private mapRowToDeepLink(row: VideoDeepLinkRow): VideoDeepLink {
    return {
      id: row.id,
      videoId: row.video_id,
      videoType: row.video_type as 'local' | 'platform',
      timestampStart: row.timestamp_start,
      timestampEnd: row.timestamp_end || undefined,
      deeplinkUrl: row.deeplink_url,
      contextSummary: row.context_summary || undefined,
      searchKeywords: row.search_keywords || undefined,
      confidenceScore: row.confidence_score,
      createdAt: this.parseDate(row.created_at),
    };
  }
}