import { BaseRepository } from './BaseRepository.js';
import { Tag, MemoryTag } from '../../models/types.js';

interface TagRow {
  id: string;
  name: string;
  color: string | null;
  created_at: string;
}

interface MemoryTagRow {
  memory_id: string;
  tag_id: string;
}

export class TagRepository extends BaseRepository {
  async create(tag: Omit<Tag, 'createdAt'>): Promise<Tag> {
    const id = tag.id || this.generateId();
    const now = this.formatDate(new Date());

    const newTag: Tag = {
      ...tag,
      id,
      createdAt: new Date(),
    };

    await this.db.run(`
      INSERT INTO tags (id, name, color, created_at)
      VALUES (?, ?, ?, ?)
    `, id, tag.name, tag.color || null, now);

    return newTag;
  }

  async findById(id: string): Promise<Tag | null> {
    const row = await this.db.get('SELECT * FROM tags WHERE id = ?', id) as TagRow | undefined;
    return row ? this.mapRowToTag(row) : null;
  }

  async findByName(name: string): Promise<Tag | null> {
    const row = await this.db.get('SELECT * FROM tags WHERE name = ? COLLATE NOCASE', name) as TagRow | undefined;
    return row ? this.mapRowToTag(row) : null;
  }

  async findAll(limit?: number, offset?: number): Promise<Tag[]> {
    let query = 'SELECT * FROM tags ORDER BY name ASC';
    const params: any[] = [];

    if (limit) {
      query += ' LIMIT ?';
      params.push(limit);
      if (offset) {
        query += ' OFFSET ?';
        params.push(offset);
      }
    }

    const rows = await this.db.all(query, ...params) as TagRow[];
    return rows.map(row => this.mapRowToTag(row));
  }

  async searchByName(namePattern: string, limit?: number): Promise<Tag[]> {
    let query = 'SELECT * FROM tags WHERE name LIKE ? COLLATE NOCASE ORDER BY name ASC';
    const params: any[] = [`%${namePattern}%`];

    if (limit) {
      query += ' LIMIT ?';
      params.push(limit);
    }

    const rows = await this.db.all(query, ...params) as TagRow[];
    return rows.map(row => this.mapRowToTag(row));
  }

  async update(id: string, updates: Partial<Pick<Tag, 'name' | 'color'>>): Promise<boolean> {
    const existing = await this.findById(id);
    if (!existing) {
      return false;
    }

    const updatedTag = {
      ...existing,
      ...updates,
    };

    const result = await this.db.run(`
      UPDATE tags 
      SET name = ?, color = ?
      WHERE id = ?
    `, updatedTag.name, updatedTag.color || null, id);

    return result.changes > 0;
  }

  async delete(id: string): Promise<boolean> {
    // First remove all memory-tag associations
    await this.db.run('DELETE FROM memory_tags WHERE tag_id = ?', id);
    
    // Then delete the tag
    const result = await this.db.run('DELETE FROM tags WHERE id = ?', id);
    return result.changes > 0;
  }

  async count(): Promise<number> {
    const result = await this.db.get('SELECT COUNT(*) as count FROM tags') as { count: number };
    return result.count;
  }

  // Memory-Tag Association Methods
  async addTagToMemory(memoryId: string, tagId: string): Promise<boolean> {
    try {
      await this.db.run(`
        INSERT INTO memory_tags (memory_id, tag_id)
        VALUES (?, ?)
      `, memoryId, tagId);
      return true;
    } catch (error: any) {
      // Handle unique constraint violation (tag already associated)
      if (error.message?.includes('UNIQUE constraint failed')) {
        return false; // Already exists
      }
      throw error;
    }
  }

  async removeTagFromMemory(memoryId: string, tagId: string): Promise<boolean> {
    const result = await this.db.run(
      'DELETE FROM memory_tags WHERE memory_id = ? AND tag_id = ?',
      memoryId, tagId
    );
    return result.changes > 0;
  }

  async getTagsForMemory(memoryId: string): Promise<Tag[]> {
    const rows = await this.db.all(`
      SELECT t.* FROM tags t
      INNER JOIN memory_tags mt ON t.id = mt.tag_id
      WHERE mt.memory_id = ?
      ORDER BY t.name ASC
    `, memoryId) as TagRow[];
    return rows.map(row => this.mapRowToTag(row));
  }

  async getMemoriesForTag(tagId: string): Promise<string[]> {
    const rows = await this.db.all(
      'SELECT memory_id FROM memory_tags WHERE tag_id = ?',
      tagId
    ) as { memory_id: string }[];
    return rows.map(row => row.memory_id);
  }

  async getMemoryTags(memoryId: string): Promise<MemoryTag[]> {
    const rows = await this.db.all(
      'SELECT * FROM memory_tags WHERE memory_id = ?',
      memoryId
    ) as MemoryTagRow[];
    return rows.map(row => ({
      memoryId: row.memory_id,
      tagId: row.tag_id,
    }));
  }

  async removeAllTagsFromMemory(memoryId: string): Promise<number> {
    const result = await this.db.run('DELETE FROM memory_tags WHERE memory_id = ?', memoryId);
    return result.changes;
  }

  async getTagUsageStats(): Promise<Array<{ tag: Tag; usageCount: number }>> {
    const rows = await this.db.all(`
      SELECT t.*, COUNT(mt.memory_id) as usage_count
      FROM tags t
      LEFT JOIN memory_tags mt ON t.id = mt.tag_id
      GROUP BY t.id, t.name, t.color, t.created_at
      ORDER BY usage_count DESC, t.name ASC
    `) as (TagRow & { usage_count: number })[];

    return rows.map(row => ({
      tag: this.mapRowToTag(row),
      usageCount: row.usage_count,
    }));
  }

  async findOrCreateByName(name: string, color?: string): Promise<Tag> {
    const existing = await this.findByName(name);
    if (existing) {
      return existing;
    }

    return this.create({
      id: this.generateId(),
      name,
      color,
    });
  }

  async bulkAddTagsToMemory(memoryId: string, tagNames: string[]): Promise<{ added: number; existing: number }> {
    let added = 0;
    let existing = 0;

    for (const tagName of tagNames) {
      const tag = await this.findOrCreateByName(tagName.trim());
      const wasAdded = await this.addTagToMemory(memoryId, tag.id);
      if (wasAdded) {
        added++;
      } else {
        existing++;
      }
    }

    return { added, existing };
  }

  async getUnusedTags(): Promise<Tag[]> {
    const rows = await this.db.all(`
      SELECT t.* FROM tags t
      LEFT JOIN memory_tags mt ON t.id = mt.tag_id
      WHERE mt.tag_id IS NULL
      ORDER BY t.name ASC
    `) as TagRow[];
    return rows.map(row => this.mapRowToTag(row));
  }

  async cleanupUnusedTags(): Promise<number> {
    const result = await this.db.run(`
      DELETE FROM tags WHERE id IN (
        SELECT t.id FROM tags t
        LEFT JOIN memory_tags mt ON t.id = mt.tag_id
        WHERE mt.tag_id IS NULL
      )
    `);
    return result.changes;
  }

  private mapRowToTag(row: TagRow): Tag {
    return {
      id: row.id,
      name: row.name,
      color: row.color || undefined,
      createdAt: this.parseDate(row.created_at),
    };
  }
}