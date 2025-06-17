import { BaseRepository } from './BaseRepository.js';
import { PlatformTranscript, TranscriptSegment } from '../../models/types.js';

interface PlatformTranscriptRow {
  id: string;
  platform_video_id: string;
  full_text: string;
  language: string | null;
  confidence: number | null;
  segments: string;
  source: string;
  created_at: string;
}

export class PlatformTranscriptRepository extends BaseRepository {
  async create(transcript: Omit<PlatformTranscript, 'id' | 'createdAt'>): Promise<PlatformTranscript> {
    const id = this.generateId();
    const now = this.formatDate(new Date());

    const newTranscript: PlatformTranscript = {
      ...transcript,
      id,
      createdAt: new Date(),
    };

    await this.db.run(`
      INSERT INTO platform_transcripts (
        id, platform_video_id, full_text, language, confidence, segments, source, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, id, transcript.platformVideoId, transcript.fullText,
       transcript.language || null, transcript.confidence || null,
       this.serializeJson(transcript.segments), transcript.source, now);

    return newTranscript;
  }

  async findById(id: string): Promise<PlatformTranscript | null> {
    const row = await this.db.get('SELECT * FROM platform_transcripts WHERE id = ?', id) as PlatformTranscriptRow | undefined;
    return row ? this.mapRowToTranscript(row) : null;
  }

  async findByPlatformVideoId(platformVideoId: string): Promise<PlatformTranscript | null> {
    const row = await this.db.get(
      'SELECT * FROM platform_transcripts WHERE platform_video_id = ? ORDER BY created_at DESC LIMIT 1',
      platformVideoId
    ) as PlatformTranscriptRow | undefined;
    return row ? this.mapRowToTranscript(row) : null;
  }

  async findByPlatformVideoIds(platformVideoIds: string[]): Promise<PlatformTranscript[]> {
    if (platformVideoIds.length === 0) {
      return [];
    }

    const placeholders = platformVideoIds.map(() => '?').join(', ');
    const rows = await this.db.all(
      `SELECT * FROM platform_transcripts WHERE platform_video_id IN (${placeholders}) ORDER BY created_at DESC`,
      ...platformVideoIds
    ) as PlatformTranscriptRow[];

    return rows.map(row => this.mapRowToTranscript(row));
  }

  async search(query: string, language?: string, limit?: number): Promise<PlatformTranscript[]> {
    let sql = 'SELECT * FROM platform_transcripts WHERE full_text LIKE ?';
    const params: any[] = [`%${query}%`];

    if (language) {
      sql += ' AND language = ?';
      params.push(language);
    }

    sql += ' ORDER BY created_at DESC';

    if (limit) {
      sql += ' LIMIT ?';
      params.push(limit);
    }

    const rows = await this.db.all(sql, ...params) as PlatformTranscriptRow[];
    return rows.map(row => this.mapRowToTranscript(row));
  }

  async searchInSegments(query: string, platformVideoId?: string, limit?: number): Promise<{
    transcript: PlatformTranscript;
    matchingSegments: TranscriptSegment[];
  }[]> {
    let sql = 'SELECT * FROM platform_transcripts WHERE segments LIKE ?';
    const params: any[] = [`%${query}%`];

    if (platformVideoId) {
      sql += ' AND platform_video_id = ?';
      params.push(platformVideoId);
    }

    sql += ' ORDER BY created_at DESC';

    if (limit) {
      sql += ' LIMIT ?';
      params.push(limit);
    }

    const rows = await this.db.all(sql, ...params) as PlatformTranscriptRow[];
    
    return rows.map(row => {
      const transcript = this.mapRowToTranscript(row);
      const matchingSegments = transcript.segments.filter(segment => 
        segment.text.toLowerCase().includes(query.toLowerCase())
      );
      
      return {
        transcript,
        matchingSegments
      };
    });
  }

  async update(id: string, updates: Partial<Pick<PlatformTranscript, 'fullText' | 'language' | 'confidence' | 'segments' | 'source'>>): Promise<boolean> {
    const existing = await this.findById(id);
    if (!existing) {
      return false;
    }

    const updatedTranscript = {
      ...existing,
      ...updates,
    };

    const result = await this.db.run(`
      UPDATE platform_transcripts 
      SET full_text = ?, language = ?, confidence = ?, segments = ?, source = ?
      WHERE id = ?
    `, updatedTranscript.fullText, updatedTranscript.language || null,
       updatedTranscript.confidence || null, this.serializeJson(updatedTranscript.segments),
       updatedTranscript.source, id);

    return result.changes > 0;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.db.run('DELETE FROM platform_transcripts WHERE id = ?', id);
    return result.changes > 0;
  }

  async deleteByPlatformVideoId(platformVideoId: string): Promise<number> {
    const result = await this.db.run('DELETE FROM platform_transcripts WHERE platform_video_id = ?', platformVideoId);
    return result.changes;
  }

  async count(source?: PlatformTranscript['source']): Promise<number> {
    let query = 'SELECT COUNT(*) as count FROM platform_transcripts';
    const params: any[] = [];

    if (source) {
      query += ' WHERE source = ?';
      params.push(source);
    }

    const result = await this.db.get(query, ...params) as { count: number };
    return result.count;
  }

  async getBySource(source: PlatformTranscript['source'], limit?: number, offset?: number): Promise<PlatformTranscript[]> {
    let query = 'SELECT * FROM platform_transcripts WHERE source = ? ORDER BY created_at DESC';
    const params: any[] = [source];

    if (limit) {
      query += ' LIMIT ?';
      params.push(limit);
      if (offset) {
        query += ' OFFSET ?';
        params.push(offset);
      }
    }

    const rows = await this.db.all(query, ...params) as PlatformTranscriptRow[];
    return rows.map(row => this.mapRowToTranscript(row));
  }

  async getByLanguage(language: string, limit?: number): Promise<PlatformTranscript[]> {
    let query = 'SELECT * FROM platform_transcripts WHERE language = ? ORDER BY created_at DESC';
    const params: any[] = [language];

    if (limit) {
      query += ' LIMIT ?';
      params.push(limit);
    }

    const rows = await this.db.all(query, ...params) as PlatformTranscriptRow[];
    return rows.map(row => this.mapRowToTranscript(row));
  }

  async getByConfidenceRange(minConfidence: number, maxConfidence: number = 1.0): Promise<PlatformTranscript[]> {
    const rows = await this.db.all(
      'SELECT * FROM platform_transcripts WHERE confidence >= ? AND confidence <= ? ORDER BY confidence DESC',
      minConfidence, maxConfidence
    ) as PlatformTranscriptRow[];

    return rows.map(row => this.mapRowToTranscript(row));
  }

  async getRecentTranscripts(limit = 10): Promise<PlatformTranscript[]> {
    const rows = await this.db.all(
      'SELECT * FROM platform_transcripts ORDER BY created_at DESC LIMIT ?',
      limit
    ) as PlatformTranscriptRow[];

    return rows.map(row => this.mapRowToTranscript(row));
  }

  // Find segments within a specific time range
  async findSegmentsByTimeRange(platformVideoId: string, startTime: number, endTime: number): Promise<TranscriptSegment[]> {
    const transcript = await this.findByPlatformVideoId(platformVideoId);
    if (!transcript) {
      return [];
    }

    return transcript.segments.filter(segment => 
      segment.start >= startTime && segment.end <= endTime
    );
  }

  // Find the segment at a specific timestamp
  async findSegmentAtTimestamp(platformVideoId: string, timestamp: number): Promise<TranscriptSegment | null> {
    const transcript = await this.findByPlatformVideoId(platformVideoId);
    if (!transcript) {
      return null;
    }

    return transcript.segments.find(segment => 
      segment.start <= timestamp && segment.end >= timestamp
    ) || null;
  }

  // Get word-level search results with timestamps
  async searchWithTimestamps(query: string, platformVideoId?: string): Promise<Array<{
    transcript: PlatformTranscript;
    matches: Array<{
      segment: TranscriptSegment;
      matchContext: string;
      timestamp: number;
    }>;
  }>> {
    let sql = 'SELECT * FROM platform_transcripts WHERE full_text LIKE ?';
    const params: any[] = [`%${query}%`];

    if (platformVideoId) {
      sql += ' AND platform_video_id = ?';
      params.push(platformVideoId);
    }

    const rows = await this.db.all(sql, ...params) as PlatformTranscriptRow[];
    
    return rows.map(row => {
      const transcript = this.mapRowToTranscript(row);
      const matches: Array<{
        segment: TranscriptSegment;
        matchContext: string;
        timestamp: number;
      }> = [];

      transcript.segments.forEach(segment => {
        if (segment.text.toLowerCase().includes(query.toLowerCase())) {
          const contextStart = Math.max(0, segment.text.toLowerCase().indexOf(query.toLowerCase()) - 20);
          const contextEnd = Math.min(segment.text.length, contextStart + query.length + 40);
          const matchContext = segment.text.substring(contextStart, contextEnd);

          matches.push({
            segment,
            matchContext: contextStart > 0 ? '...' + matchContext : matchContext,
            timestamp: segment.start
          });
        }
      });

      return { transcript, matches };
    }).filter(result => result.matches.length > 0);
  }

  private mapRowToTranscript(row: PlatformTranscriptRow): PlatformTranscript {
    return {
      id: row.id,
      platformVideoId: row.platform_video_id,
      fullText: row.full_text,
      language: row.language || undefined,
      confidence: row.confidence || undefined,
      segments: this.deserializeJson<TranscriptSegment[]>(row.segments),
      source: row.source as PlatformTranscript['source'],
      createdAt: this.parseDate(row.created_at),
    };
  }
}