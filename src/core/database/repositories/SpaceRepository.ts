import { BaseRepository } from './BaseRepository.js';
import { Space, SpaceSettings } from '../../models/types.js';

interface SpaceRow {
  id: string;
  name: string;
  description: string | null;
  settings: string;
  created_at: string;
  updated_at: string;
}

export class SpaceRepository extends BaseRepository {
  async create(space: Omit<Space, 'createdAt' | 'updatedAt'>): Promise<Space> {
    const id = space.id || this.generateId();
    const now = this.formatDate(new Date());

    const newSpace: Space = {
      ...space,
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await this.db.run(`
      INSERT INTO spaces (id, name, description, settings, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `, id, space.name, space.description || null, this.serializeJson(space.settings), now, now);

    return newSpace;
  }

  async findById(id: string): Promise<Space | null> {
    const row = await this.db.get('SELECT * FROM spaces WHERE id = ?', id) as SpaceRow | undefined;
    return row ? this.mapRowToSpace(row) : null;
  }

  async findByName(name: string): Promise<Space | null> {
    const row = await this.db.get('SELECT * FROM spaces WHERE name = ?', name) as SpaceRow | undefined;
    return row ? this.mapRowToSpace(row) : null;
  }

  async findAll(): Promise<Space[]> {
    const rows = await this.db.all('SELECT * FROM spaces ORDER BY created_at DESC') as SpaceRow[];
    return rows.map(row => this.mapRowToSpace(row));
  }

  async update(id: string, updates: Partial<Pick<Space, 'name' | 'description' | 'settings'>>): Promise<boolean> {
    const existing = await this.findById(id);
    if (!existing) {
      return false;
    }

    const updatedSpace = {
      ...existing,
      ...updates,
      updatedAt: new Date(),
    };

    const result = await this.db.run(`
      UPDATE spaces 
      SET name = ?, description = ?, settings = ?, updated_at = ?
      WHERE id = ?
    `, updatedSpace.name, updatedSpace.description || null, this.serializeJson(updatedSpace.settings), this.formatDate(updatedSpace.updatedAt), id);

    return result.changes > 0;
  }

  async delete(id: string): Promise<boolean> {
    // Don't allow deletion of default space
    if (id === 'default') {
      throw new Error('Cannot delete default space');
    }

    // Check if space has memories
    const memoriesCount = await this.db.get('SELECT COUNT(*) as count FROM memories WHERE space_id = ?', id) as { count: number };
    if (memoriesCount.count > 0) {
      throw new Error(`Cannot delete space with ${memoriesCount.count} memories. Move or delete memories first.`);
    }

    const result = await this.db.run('DELETE FROM spaces WHERE id = ?', id);
    return result.changes > 0;
  }

  async exists(id: string): Promise<boolean> {
    const space = await this.findById(id);
    return space !== null;
  }

  async getMemoryCount(spaceId: string): Promise<number> {
    const result = await this.db.get('SELECT COUNT(*) as count FROM memories WHERE space_id = ?', spaceId) as { count: number };
    return result.count;
  }

  private mapRowToSpace(row: SpaceRow): Space {
    return {
      id: row.id,
      name: row.name,
      description: row.description || undefined,
      settings: this.deserializeJson<SpaceSettings>(row.settings),
      createdAt: this.parseDate(row.created_at),
      updatedAt: this.parseDate(row.updated_at),
    };
  }

  // Utility method to ensure default space exists
  async ensureDefaultSpace(): Promise<void> {
    const defaultSpace = await this.findById('default');
    if (!defaultSpace) {
      await this.create({
        id: 'default',
        name: 'Default',
        description: 'Default memory space',
        settings: {},
      });
    }
  }
}