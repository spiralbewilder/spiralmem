import { BaseRepository } from './BaseRepository.js';
import { Memory, ContentInput, SearchQuery, SearchResult } from '../../models/types.js';

interface MemoryRow {
  id: string;
  space_id: string;
  content_type: string;
  title: string | null;
  content: string;
  source: string;
  file_path: string | null;
  metadata: string;
  created_at: string;
  updated_at: string;
}

export class MemoryRepository extends BaseRepository {
  async create(input: ContentInput): Promise<Memory> {
    const id = this.generateId();
    const now = this.formatDate(new Date());
    const spaceId = input.spaceId || 'default';
    const contentType = input.contentType || 'text';

    const memory: Memory = {
      id,
      spaceId,
      contentType,
      title: input.title,
      content: input.content,
      source: input.source,
      filePath: input.filePath,
      metadata: input.metadata || {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await this.db.run(`
      INSERT INTO memories (id, space_id, content_type, title, content, source, file_path, metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, id, spaceId, contentType, input.title || null, input.content, input.source, 
       input.filePath || null, this.serializeJson(memory.metadata), now, now);

    return memory;
  }

  async findById(id: string): Promise<Memory | null> {
    const row = await this.db.get('SELECT * FROM memories WHERE id = ?', id) as MemoryRow | undefined;
    return row ? this.mapRowToMemory(row) : null;
  }

  async findBySpace(spaceId: string, limit?: number, offset?: number): Promise<Memory[]> {
    let query = 'SELECT * FROM memories WHERE space_id = ? ORDER BY created_at DESC';
    const params: any[] = [spaceId];
    
    if (limit) {
      query += ' LIMIT ?';
      params.push(limit);
      if (offset) {
        query += ' OFFSET ?';
        params.push(offset);
      }
    }
    
    const rows = await this.db.all(query, ...params) as MemoryRow[];
    return rows.map(row => this.mapRowToMemory(row));
  }

  async findByContentType(contentType: string, spaceId?: string, limit?: number, offset?: number): Promise<Memory[]> {
    let query = 'SELECT * FROM memories WHERE content_type = ?';
    const params: any[] = [contentType];

    if (spaceId) {
      query += ' AND space_id = ?';
      params.push(spaceId);
    }

    query += ' ORDER BY created_at DESC';
    
    if (limit) {
      query += ' LIMIT ?';
      params.push(limit);
      if (offset) {
        query += ' OFFSET ?';
        params.push(offset);
      }
    }

    const rows = await this.db.all(query, ...params) as MemoryRow[];
    return rows.map(row => this.mapRowToMemory(row));
  }

  async search(query: SearchQuery): Promise<SearchResult[]> {
    // Enhanced keyword search implementation
    let sql = `
      SELECT * FROM memories 
      WHERE (content LIKE ? OR title LIKE ?)
    `;
    const params: any[] = [`%${query.query}%`, `%${query.query}%`];

    if (query.spaceId) {
      sql += ' AND space_id = ?';
      params.push(query.spaceId);
    }

    if (query.contentTypes && query.contentTypes.length > 0) {
      const placeholders = query.contentTypes.map(() => '?').join(', ');
      sql += ` AND content_type IN (${placeholders})`;
      params.push(...query.contentTypes);
    }

    if (query.filters?.dateRange) {
      sql += ' AND created_at BETWEEN ? AND ?';
      params.push(
        this.formatDate(query.filters.dateRange.start),
        this.formatDate(query.filters.dateRange.end)
      );
    }

    sql += ' ORDER BY created_at DESC';
    
    if (query.limit) {
      sql += ' LIMIT ?';
      params.push(query.limit);
      if (query.offset) {
        sql += ' OFFSET ?';
        params.push(query.offset);
      }
    }

    const rows = await this.db.all(sql, ...params) as MemoryRow[];
    
    return rows.map(row => ({
      memory: this.mapRowToMemory(row),
      similarity: this.calculateSimilarity(row.content, query.query),
      highlights: this.extractHighlights(row.content, query.query),
    }));
  }

  async update(id: string, updates: Partial<Pick<Memory, 'title' | 'content' | 'metadata'>>): Promise<boolean> {
    const existing = await this.findById(id);
    if (!existing) {
      return false;
    }

    const updatedMemory = {
      ...existing,
      ...updates,
      updatedAt: new Date(),
    };

    const result = await this.db.run(`
      UPDATE memories 
      SET title = ?, content = ?, metadata = ?, updated_at = ?
      WHERE id = ?
    `, updatedMemory.title || null, updatedMemory.content, 
       this.serializeJson(updatedMemory.metadata), this.formatDate(updatedMemory.updatedAt), id);

    return result.changes > 0;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.db.run('DELETE FROM memories WHERE id = ?', id);
    return result.changes > 0;
  }

  async count(spaceId?: string): Promise<number> {
    let query = 'SELECT COUNT(*) as count FROM memories';
    const params: any[] = [];

    if (spaceId) {
      query += ' WHERE space_id = ?';
      params.push(spaceId);
    }

    const result = await this.db.get(query, ...params) as { count: number };
    return result.count;
  }

  async getRecentMemories(limit = 10, spaceId?: string): Promise<Memory[]> {
    let query = 'SELECT * FROM memories';
    const params: any[] = [];

    if (spaceId) {
      query += ' WHERE space_id = ?';
      params.push(spaceId);
    }

    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    const rows = await this.db.all(query, ...params) as MemoryRow[];
    return rows.map(row => this.mapRowToMemory(row));
  }

  async getContentTypeBreakdown(spaceId?: string): Promise<Record<string, number>> {
    let query = 'SELECT content_type, COUNT(*) as count FROM memories';
    const params: any[] = [];

    if (spaceId) {
      query += ' WHERE space_id = ?';
      params.push(spaceId);
    }

    query += ' GROUP BY content_type';

    const rows = await this.db.all(query, ...params) as { content_type: string; count: number }[];
    
    const breakdown: Record<string, number> = {};
    for (const row of rows) {
      breakdown[row.content_type] = row.count;
    }
    
    return breakdown;
  }

  // Full-text search using SQLite FTS5 (when available)
  async fullTextSearch(query: string, spaceId?: string, limit?: number): Promise<SearchResult[]> {
    // This will be enhanced when we implement FTS5 virtual tables
    // For now, fall back to regular search
    return this.search({
      query,
      spaceId,
      limit: limit || 20,
    });
  }

  // Find related content based on similar metadata or content
  async findRelated(memoryId: string, limit = 5): Promise<Memory[]> {
    const memory = await this.findById(memoryId);
    if (!memory) {
      return [];
    }

    // Simple related content based on content type and space
    const rows = await this.db.all(`
      SELECT * FROM memories 
      WHERE id != ? AND space_id = ? AND content_type = ?
      ORDER BY created_at DESC 
      LIMIT ?
    `, memoryId, memory.spaceId, memory.contentType, limit) as MemoryRow[];

    return rows.map(row => this.mapRowToMemory(row));
  }

  private mapRowToMemory(row: MemoryRow): Memory {
    return {
      id: row.id,
      spaceId: row.space_id,
      contentType: row.content_type as Memory['contentType'],
      title: row.title || undefined,
      content: row.content,
      source: row.source,
      filePath: row.file_path || undefined,
      metadata: this.deserializeJson(row.metadata),
      createdAt: this.parseDate(row.created_at),
      updatedAt: this.parseDate(row.updated_at),
    };
  }

  private calculateSimilarity(content: string, query: string): number {
    // Simple similarity based on keyword matches
    const queryWords = query.toLowerCase().split(' ').filter(word => word.length > 2);
    const contentWords = content.toLowerCase().split(' ');
    
    let matches = 0;
    for (const queryWord of queryWords) {
      if (contentWords.some(word => word.includes(queryWord))) {
        matches++;
      }
    }
    
    return queryWords.length > 0 ? matches / queryWords.length : 0;
  }

  private extractHighlights(content: string, query: string, maxLength = 200): string[] {
    const words = query.toLowerCase().split(' ').filter(word => word.length > 0);
    const highlights: string[] = [];
    
    for (const word of words) {
      const index = content.toLowerCase().indexOf(word);
      if (index !== -1) {
        const start = Math.max(0, index - 50);
        const end = Math.min(content.length, index + maxLength);
        const highlight = content.substring(start, end).trim();
        if (highlight && !highlights.includes(highlight)) {
          highlights.push(highlight);
        }
      }
    }
    
    return highlights.slice(0, 3); // Limit to 3 highlights
  }
}