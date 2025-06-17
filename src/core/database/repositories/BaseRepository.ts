import { randomUUID } from 'crypto';
import { database } from '../connection.js';

// Define the promisified database interface
interface PromisifiedDatabase {
  run(sql: string, ...params: any[]): Promise<{ lastID: number; changes: number }>;
  get(sql: string, ...params: any[]): Promise<any>;
  all(sql: string, ...params: any[]): Promise<any[]>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

export abstract class BaseRepository {
  protected get db(): PromisifiedDatabase {
    return database.getDb();
  }

  protected generateId(): string {
    return randomUUID();
  }

  protected serializeJson(obj: any): string {
    return JSON.stringify(obj);
  }

  protected deserializeJson<T>(json: string): T {
    return JSON.parse(json);
  }

  protected formatDate(date: Date): string {
    return date.toISOString();
  }

  protected parseDate(dateString: string): Date {
    return new Date(dateString);
  }

  protected formatBoolean(value: boolean): number {
    return value ? 1 : 0;
  }

  protected parseBoolean(value: number): boolean {
    return value === 1;
  }

  // Helper method for paginated queries
  protected addPagination(query: string, limit?: number, offset?: number): string {
    if (limit) {
      query += ` LIMIT ${limit}`;
      if (offset) {
        query += ` OFFSET ${offset}`;
      }
    }
    return query;
  }

  // Helper method for building WHERE clauses
  protected buildWhereClause(conditions: Record<string, any>): { clause: string; params: any[] } {
    const clauses: string[] = [];
    const params: any[] = [];

    for (const [key, value] of Object.entries(conditions)) {
      if (value !== undefined && value !== null) {
        if (Array.isArray(value)) {
          const placeholders = value.map(() => '?').join(', ');
          clauses.push(`${key} IN (${placeholders})`);
          params.push(...value);
        } else {
          clauses.push(`${key} = ?`);
          params.push(value);
        }
      }
    }

    const clause = clauses.length > 0 ? 'WHERE ' + clauses.join(' AND ') : '';
    return { clause, params };
  }

  // TODO: Implement transaction support when needed
  // protected async transaction<T>(fn: () => Promise<T>): Promise<T> {
  //   // Transaction implementation would go here
  //   return fn();
  // }
}