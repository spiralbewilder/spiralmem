import { BaseRepository } from './BaseRepository.js';
import { ContentCorrelation } from '../../models/types.js';

interface ContentCorrelationRow {
  id: string;
  source_memory_id: string;
  target_memory_id: string;
  correlation_type: string;
  correlation_score: number;
  correlation_metadata: string;
  created_at: string;
}

export class ContentCorrelationRepository extends BaseRepository {
  async create(correlation: Omit<ContentCorrelation, 'id' | 'createdAt'>): Promise<ContentCorrelation> {
    const id = this.generateId();
    const now = this.formatDate(new Date());

    const newCorrelation: ContentCorrelation = {
      ...correlation,
      id,
      createdAt: new Date(),
    };

    await this.db.run(`
      INSERT INTO content_correlations (
        id, source_memory_id, target_memory_id, correlation_type, 
        correlation_score, correlation_metadata, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, id, correlation.sourceMemoryId, correlation.targetMemoryId,
       correlation.correlationType, correlation.correlationScore,
       this.serializeJson(correlation.correlationMetadata), now);

    return newCorrelation;
  }

  async findById(id: string): Promise<ContentCorrelation | null> {
    const row = await this.db.get('SELECT * FROM content_correlations WHERE id = ?', id) as ContentCorrelationRow | undefined;
    return row ? this.mapRowToCorrelation(row) : null;
  }

  async findBySourceMemory(sourceMemoryId: string, correlationType?: ContentCorrelation['correlationType']): Promise<ContentCorrelation[]> {
    let query = 'SELECT * FROM content_correlations WHERE source_memory_id = ?';
    const params: any[] = [sourceMemoryId];

    if (correlationType) {
      query += ' AND correlation_type = ?';
      params.push(correlationType);
    }

    query += ' ORDER BY correlation_score DESC, created_at DESC';

    const rows = await this.db.all(query, ...params) as ContentCorrelationRow[];
    return rows.map(row => this.mapRowToCorrelation(row));
  }

  async findByTargetMemory(targetMemoryId: string, correlationType?: ContentCorrelation['correlationType']): Promise<ContentCorrelation[]> {
    let query = 'SELECT * FROM content_correlations WHERE target_memory_id = ?';
    const params: any[] = [targetMemoryId];

    if (correlationType) {
      query += ' AND correlation_type = ?';
      params.push(correlationType);
    }

    query += ' ORDER BY correlation_score DESC, created_at DESC';

    const rows = await this.db.all(query, ...params) as ContentCorrelationRow[];
    return rows.map(row => this.mapRowToCorrelation(row));
  }

  async findBiDirectional(memoryIdA: string, memoryIdB: string): Promise<ContentCorrelation[]> {
    const rows = await this.db.all(`
      SELECT * FROM content_correlations 
      WHERE (source_memory_id = ? AND target_memory_id = ?) 
         OR (source_memory_id = ? AND target_memory_id = ?)
      ORDER BY correlation_score DESC, created_at DESC
    `, memoryIdA, memoryIdB, memoryIdB, memoryIdA) as ContentCorrelationRow[];

    return rows.map(row => this.mapRowToCorrelation(row));
  }

  async findByType(correlationType: ContentCorrelation['correlationType'], limit?: number, minScore?: number): Promise<ContentCorrelation[]> {
    let query = 'SELECT * FROM content_correlations WHERE correlation_type = ?';
    const params: any[] = [correlationType];

    if (minScore !== undefined) {
      query += ' AND correlation_score >= ?';
      params.push(minScore);
    }

    query += ' ORDER BY correlation_score DESC, created_at DESC';

    if (limit) {
      query += ' LIMIT ?';
      params.push(limit);
    }

    const rows = await this.db.all(query, ...params) as ContentCorrelationRow[];
    return rows.map(row => this.mapRowToCorrelation(row));
  }

  async findHighestScored(limit = 10, correlationType?: ContentCorrelation['correlationType']): Promise<ContentCorrelation[]> {
    let query = 'SELECT * FROM content_correlations';
    const params: any[] = [];

    if (correlationType) {
      query += ' WHERE correlation_type = ?';
      params.push(correlationType);
    }

    query += ' ORDER BY correlation_score DESC LIMIT ?';
    params.push(limit);

    const rows = await this.db.all(query, ...params) as ContentCorrelationRow[];
    return rows.map(row => this.mapRowToCorrelation(row));
  }

  async findByScoreRange(minScore: number, maxScore: number, correlationType?: ContentCorrelation['correlationType']): Promise<ContentCorrelation[]> {
    let query = 'SELECT * FROM content_correlations WHERE correlation_score >= ? AND correlation_score <= ?';
    const params: any[] = [minScore, maxScore];

    if (correlationType) {
      query += ' AND correlation_type = ?';
      params.push(correlationType);
    }

    query += ' ORDER BY correlation_score DESC, created_at DESC';

    const rows = await this.db.all(query, ...params) as ContentCorrelationRow[];
    return rows.map(row => this.mapRowToCorrelation(row));
  }

  async findRelatedMemories(memoryId: string, limit = 10, minScore = 0.1): Promise<{
    asSource: ContentCorrelation[];
    asTarget: ContentCorrelation[];
    combined: string[]; // Unique memory IDs
  }> {
    const asSource = await this.findBySourceMemory(memoryId);
    const asTarget = await this.findByTargetMemory(memoryId);

    const filteredAsSource = asSource.filter(c => c.correlationScore >= minScore).slice(0, limit);
    const filteredAsTarget = asTarget.filter(c => c.correlationScore >= minScore).slice(0, limit);

    // Collect unique related memory IDs
    const relatedIds = new Set<string>();
    filteredAsSource.forEach(c => relatedIds.add(c.targetMemoryId));
    filteredAsTarget.forEach(c => relatedIds.add(c.sourceMemoryId));

    return {
      asSource: filteredAsSource,
      asTarget: filteredAsTarget,
      combined: Array.from(relatedIds)
    };
  }

  async update(id: string, updates: Partial<Pick<ContentCorrelation, 'correlationScore' | 'correlationMetadata'>>): Promise<boolean> {
    const existing = await this.findById(id);
    if (!existing) {
      return false;
    }

    const updatedCorrelation = {
      ...existing,
      ...updates,
    };

    const result = await this.db.run(`
      UPDATE content_correlations 
      SET correlation_score = ?, correlation_metadata = ?
      WHERE id = ?
    `, updatedCorrelation.correlationScore, this.serializeJson(updatedCorrelation.correlationMetadata), id);

    return result.changes > 0;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.db.run('DELETE FROM content_correlations WHERE id = ?', id);
    return result.changes > 0;
  }

  async deleteByMemory(memoryId: string): Promise<number> {
    const result = await this.db.run(
      'DELETE FROM content_correlations WHERE source_memory_id = ? OR target_memory_id = ?',
      memoryId, memoryId
    );
    return result.changes;
  }

  async deleteBelowScore(minScore: number): Promise<number> {
    const result = await this.db.run('DELETE FROM content_correlations WHERE correlation_score < ?', minScore);
    return result.changes;
  }

  async count(correlationType?: ContentCorrelation['correlationType']): Promise<number> {
    let query = 'SELECT COUNT(*) as count FROM content_correlations';
    const params: any[] = [];

    if (correlationType) {
      query += ' WHERE correlation_type = ?';
      params.push(correlationType);
    }

    const result = await this.db.get(query, ...params) as { count: number };
    return result.count;
  }

  async getTypeBreakdown(): Promise<Record<ContentCorrelation['correlationType'], number>> {
    const rows = await this.db.all(`
      SELECT correlation_type, COUNT(*) as count 
      FROM content_correlations 
      GROUP BY correlation_type
    `) as { correlation_type: string; count: number }[];

    const breakdown: Record<string, number> = {};
    for (const row of rows) {
      breakdown[row.correlation_type] = row.count;
    }

    return breakdown as Record<ContentCorrelation['correlationType'], number>;
  }

  async getScoreStatistics(correlationType?: ContentCorrelation['correlationType']): Promise<{
    count: number;
    averageScore: number;
    minScore: number;
    maxScore: number;
    standardDeviation?: number;
  }> {
    let query = `
      SELECT 
        COUNT(*) as count,
        AVG(correlation_score) as avg_score,
        MIN(correlation_score) as min_score,
        MAX(correlation_score) as max_score
      FROM content_correlations
    `;
    const params: any[] = [];

    if (correlationType) {
      query += ' WHERE correlation_type = ?';
      params.push(correlationType);
    }

    const result = await this.db.get(query, ...params) as {
      count: number;
      avg_score: number;
      min_score: number;
      max_score: number;
    };

    return {
      count: result.count,
      averageScore: result.avg_score || 0,
      minScore: result.min_score || 0,
      maxScore: result.max_score || 0,
    };
  }

  // Bulk operations for performance
  async createBatch(correlations: Omit<ContentCorrelation, 'id' | 'createdAt'>[]): Promise<ContentCorrelation[]> {
    const now = this.formatDate(new Date());
    const created: ContentCorrelation[] = [];

    for (const correlation of correlations) {
      const id = this.generateId();
      const newCorrelation: ContentCorrelation = {
        ...correlation,
        id,
        createdAt: new Date(),
      };

      await this.db.run(`
        INSERT INTO content_correlations (
          id, source_memory_id, target_memory_id, correlation_type, 
          correlation_score, correlation_metadata, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, id, correlation.sourceMemoryId, correlation.targetMemoryId,
         correlation.correlationType, correlation.correlationScore,
         this.serializeJson(correlation.correlationMetadata), now);

      created.push(newCorrelation);
    }

    return created;
  }

  async findOrCreate(correlation: Omit<ContentCorrelation, 'id' | 'createdAt'>): Promise<{
    correlation: ContentCorrelation;
    created: boolean;
  }> {
    // Check if correlation already exists
    const existing = await this.db.get(`
      SELECT * FROM content_correlations 
      WHERE source_memory_id = ? AND target_memory_id = ? AND correlation_type = ?
    `, correlation.sourceMemoryId, correlation.targetMemoryId, correlation.correlationType) as ContentCorrelationRow | undefined;

    if (existing) {
      return {
        correlation: this.mapRowToCorrelation(existing),
        created: false
      };
    }

    // Create new correlation
    const newCorrelation = await this.create(correlation);
    return {
      correlation: newCorrelation,
      created: true
    };
  }

  async updateOrCreate(correlation: Omit<ContentCorrelation, 'id' | 'createdAt'>): Promise<ContentCorrelation> {
    const result = await this.findOrCreate(correlation);
    
    if (!result.created && result.correlation.correlationScore !== correlation.correlationScore) {
      // Update the score if it's different
      await this.update(result.correlation.id, {
        correlationScore: correlation.correlationScore,
        correlationMetadata: correlation.correlationMetadata
      });
      
      // Return updated correlation
      return {
        ...result.correlation,
        correlationScore: correlation.correlationScore,
        correlationMetadata: correlation.correlationMetadata
      };
    }

    return result.correlation;
  }

  private mapRowToCorrelation(row: ContentCorrelationRow): ContentCorrelation {
    return {
      id: row.id,
      sourceMemoryId: row.source_memory_id,
      targetMemoryId: row.target_memory_id,
      correlationType: row.correlation_type as ContentCorrelation['correlationType'],
      correlationScore: row.correlation_score,
      correlationMetadata: this.deserializeJson(row.correlation_metadata),
      createdAt: this.parseDate(row.created_at),
    };
  }
}