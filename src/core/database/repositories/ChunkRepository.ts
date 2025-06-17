import { BaseRepository } from './BaseRepository.js';
import { Chunk } from '../../models/types.js';

interface ChunkRow {
  id: string;
  memory_id: string;
  chunk_text: string;
  chunk_order: number;
  start_offset: number | null;
  end_offset: number | null;
  metadata: string;
  created_at: string;
}

export class ChunkRepository extends BaseRepository {
  async create(chunk: Omit<Chunk, 'createdAt'>): Promise<Chunk> {
    const id = chunk.id || this.generateId();
    const now = this.formatDate(new Date());

    const newChunk: Chunk = {
      ...chunk,
      id,
      createdAt: new Date(),
    };

    await this.db.run(`
      INSERT INTO chunks (id, memory_id, chunk_text, chunk_order, start_offset, end_offset, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, id, chunk.memoryId, chunk.chunkText, chunk.chunkOrder, 
       chunk.startOffset || null, chunk.endOffset || null, 
       this.serializeJson(chunk.metadata), now);

    return newChunk;
  }

  async findById(id: string): Promise<Chunk | null> {
    const row = await this.db.get('SELECT * FROM chunks WHERE id = ?', id) as ChunkRow | undefined;
    return row ? this.mapRowToChunk(row) : null;
  }

  async findByMemoryId(memoryId: string): Promise<Chunk[]> {
    const rows = await this.db.all(
      'SELECT * FROM chunks WHERE memory_id = ? ORDER BY chunk_order ASC', 
      memoryId
    ) as ChunkRow[];
    return rows.map(row => this.mapRowToChunk(row));
  }

  async findByMemoryIds(memoryIds: string[]): Promise<Chunk[]> {
    if (memoryIds.length === 0) {
      return [];
    }

    const placeholders = memoryIds.map(() => '?').join(', ');
    const rows = await this.db.all(
      `SELECT * FROM chunks WHERE memory_id IN (${placeholders}) ORDER BY memory_id, chunk_order ASC`,
      ...memoryIds
    ) as ChunkRow[];
    return rows.map(row => this.mapRowToChunk(row));
  }

  async search(query: string, memoryIds?: string[], limit?: number): Promise<Chunk[]> {
    let sql = 'SELECT * FROM chunks WHERE chunk_text LIKE ?';
    const params: any[] = [`%${query}%`];

    if (memoryIds && memoryIds.length > 0) {
      const placeholders = memoryIds.map(() => '?').join(', ');
      sql += ` AND memory_id IN (${placeholders})`;
      params.push(...memoryIds);
    }

    sql += ' ORDER BY created_at DESC';

    if (limit) {
      sql += ' LIMIT ?';
      params.push(limit);
    }

    const rows = await this.db.all(sql, ...params) as ChunkRow[];
    return rows.map(row => this.mapRowToChunk(row));
  }

  async update(id: string, updates: Partial<Pick<Chunk, 'chunkText' | 'chunkOrder' | 'startOffset' | 'endOffset' | 'metadata'>>): Promise<boolean> {
    const existing = await this.findById(id);
    if (!existing) {
      return false;
    }

    const updatedChunk = {
      ...existing,
      ...updates,
    };

    const result = await this.db.run(`
      UPDATE chunks 
      SET chunk_text = ?, chunk_order = ?, start_offset = ?, end_offset = ?, metadata = ?
      WHERE id = ?
    `, updatedChunk.chunkText, updatedChunk.chunkOrder, 
       updatedChunk.startOffset || null, updatedChunk.endOffset || null,
       this.serializeJson(updatedChunk.metadata), id);

    return result.changes > 0;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.db.run('DELETE FROM chunks WHERE id = ?', id);
    return result.changes > 0;
  }

  async deleteByMemoryId(memoryId: string): Promise<number> {
    const result = await this.db.run('DELETE FROM chunks WHERE memory_id = ?', memoryId);
    return result.changes;
  }

  async count(memoryId?: string): Promise<number> {
    let query = 'SELECT COUNT(*) as count FROM chunks';
    const params: any[] = [];

    if (memoryId) {
      query += ' WHERE memory_id = ?';
      params.push(memoryId);
    }

    const result = await this.db.get(query, ...params) as { count: number };
    return result.count;
  }

  async getChunksByTextLength(minLength?: number, maxLength?: number): Promise<Chunk[]> {
    let query = 'SELECT * FROM chunks WHERE 1=1';
    const params: any[] = [];

    if (minLength !== undefined) {
      query += ' AND LENGTH(chunk_text) >= ?';
      params.push(minLength);
    }

    if (maxLength !== undefined) {
      query += ' AND LENGTH(chunk_text) <= ?';
      params.push(maxLength);
    }

    query += ' ORDER BY created_at DESC';

    const rows = await this.db.all(query, ...params) as ChunkRow[];
    return rows.map(row => this.mapRowToChunk(row));
  }

  async getMaxChunkOrder(memoryId: string): Promise<number> {
    const result = await this.db.get(
      'SELECT MAX(chunk_order) as max_order FROM chunks WHERE memory_id = ?',
      memoryId
    ) as { max_order: number | null };
    return result.max_order || 0;
  }

  async reorderChunks(memoryId: string, chunkOrderMap: Record<string, number>): Promise<boolean> {
    const chunkIds = Object.keys(chunkOrderMap);
    
    // Verify all chunks belong to the memory
    const chunks = await this.findByMemoryIds([memoryId]);
    const validChunkIds = chunks.filter(c => c.memoryId === memoryId).map(c => c.id);
    
    const invalidIds = chunkIds.filter(id => !validChunkIds.includes(id));
    if (invalidIds.length > 0) {
      throw new Error(`Invalid chunk IDs for memory ${memoryId}: ${invalidIds.join(', ')}`);
    }

    // Update each chunk's order
    let updatedCount = 0;
    for (const [chunkId, newOrder] of Object.entries(chunkOrderMap)) {
      const result = await this.db.run(
        'UPDATE chunks SET chunk_order = ? WHERE id = ? AND memory_id = ?',
        newOrder, chunkId, memoryId
      );
      updatedCount += result.changes;
    }

    return updatedCount === chunkIds.length;
  }

  private mapRowToChunk(row: ChunkRow): Chunk {
    return {
      id: row.id,
      memoryId: row.memory_id,
      chunkText: row.chunk_text,
      chunkOrder: row.chunk_order,
      startOffset: row.start_offset || undefined,
      endOffset: row.end_offset || undefined,
      metadata: this.deserializeJson(row.metadata),
      createdAt: this.parseDate(row.created_at),
    };
  }
}