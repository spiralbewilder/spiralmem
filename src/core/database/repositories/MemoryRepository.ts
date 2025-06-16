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
  private insertStmt = this.db.prepare(`
    INSERT INTO memories (id, space_id, content_type, title, content, source, file_path, metadata, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  private updateStmt = this.db.prepare(`
    UPDATE memories 
    SET title = ?, content = ?, metadata = ?, updated_at = ?
    WHERE id = ?
  `);

  private selectByIdStmt = this.db.prepare(`
    SELECT * FROM memories WHERE id = ?
  `);

  private deleteStmt = this.db.prepare(`
    DELETE FROM memories WHERE id = ?
  `);

  create(input: ContentInput): Memory {
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

    this.insertStmt.run(
      id,
      spaceId,
      contentType,
      input.title || null,
      input.content,
      input.source,
      input.filePath || null,
      this.serializeJson(memory.metadata),
      now,
      now
    );

    return memory;
  }

  findById(id: string): Memory | null {
    const row = this.selectByIdStmt.get(id) as MemoryRow | undefined;
    return row ? this.mapRowToMemory(row) : null;
  }

  findBySpace(spaceId: string, limit?: number, offset?: number): Memory[] {
    let query = 'SELECT * FROM memories WHERE space_id = ? ORDER BY created_at DESC';
    query = this.addPagination(query, limit, offset);
    
    const stmt = this.db.prepare(query);
    const rows = stmt.all(spaceId) as MemoryRow[];
    return rows.map(row => this.mapRowToMemory(row));
  }

  findByContentType(contentType: string, spaceId?: string, limit?: number, offset?: number): Memory[] {
    let query = 'SELECT * FROM memories WHERE content_type = ?';
    const params: any[] = [contentType];

    if (spaceId) {
      query += ' AND space_id = ?';
      params.push(spaceId);
    }

    query += ' ORDER BY created_at DESC';
    query = this.addPagination(query, limit, offset);

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as MemoryRow[];
    return rows.map(row => this.mapRowToMemory(row));
  }

  search(query: SearchQuery): SearchResult[] {
    // Basic keyword search implementation
    // This will be enhanced with vector search later
    let sql = `
      SELECT * FROM memories 
      WHERE content LIKE ? OR title LIKE ?
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
    sql = this.addPagination(sql, query.limit, query.offset);

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as MemoryRow[];
    
    return rows.map(row => ({
      memory: this.mapRowToMemory(row),
      similarity: 0.8, // Placeholder similarity score
      highlights: this.extractHighlights(row.content, query.query),
    }));
  }

  update(id: string, updates: Partial<Pick<Memory, 'title' | 'content' | 'metadata'>>): boolean {
    const existing = this.findById(id);
    if (!existing) {
      return false;
    }

    const updatedMemory = {
      ...existing,
      ...updates,
      updatedAt: new Date(),
    };

    const result = this.updateStmt.run(
      updatedMemory.title || null,
      updatedMemory.content,
      this.serializeJson(updatedMemory.metadata),
      this.formatDate(updatedMemory.updatedAt),
      id
    );

    return result.changes > 0;
  }

  delete(id: string): boolean {
    const result = this.deleteStmt.run(id);
    return result.changes > 0;
  }

  count(spaceId?: string): number {
    let query = 'SELECT COUNT(*) as count FROM memories';
    const params: any[] = [];

    if (spaceId) {
      query += ' WHERE space_id = ?';
      params.push(spaceId);
    }

    const stmt = this.db.prepare(query);
    const result = stmt.get(...params) as { count: number };
    return result.count;
  }

  getRecentMemories(limit = 10, spaceId?: string): Memory[] {
    let query = 'SELECT * FROM memories';
    const params: any[] = [];

    if (spaceId) {
      query += ' WHERE space_id = ?';
      params.push(spaceId);
    }

    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as MemoryRow[];
    return rows.map(row => this.mapRowToMemory(row));
  }

  getContentTypeBreakdown(spaceId?: string): Record<string, number> {
    let query = 'SELECT content_type, COUNT(*) as count FROM memories';
    const params: any[] = [];

    if (spaceId) {
      query += ' WHERE space_id = ?';
      params.push(spaceId);
    }

    query += ' GROUP BY content_type';

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as { content_type: string; count: number }[];
    
    const breakdown: Record<string, number> = {};
    for (const row of rows) {
      breakdown[row.content_type] = row.count;
    }
    
    return breakdown;
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