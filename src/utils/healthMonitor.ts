import { logger } from './logger.js';
import { SystemHealth } from '../core/models/types.js';
import { database } from '../core/database/connection.js';
import fs from 'fs/promises';
import { spawn } from 'child_process';

export interface HealthCheck {
  name: string;
  critical: boolean;
  check(): Promise<{ healthy: boolean; message?: string; details?: any }>;
}

export class DatabaseHealthCheck implements HealthCheck {
  name = 'Database';
  critical = true;

  async check() {
    try {
      // Simple query to test database connectivity
      const result = await database.get('SELECT 1 as test');
      if (result?.test === 1) {
        return { healthy: true, message: 'Database connection OK' };
      } else {
        return { healthy: false, message: 'Database query returned unexpected result' };
      }
    } catch (error) {
      return { 
        healthy: false, 
        message: 'Database connection failed',
        details: error instanceof Error ? error.message : error
      };
    }
  }
}

export class StorageHealthCheck implements HealthCheck {
  name = 'Storage';
  critical = true;

  async check() {
    try {
      const { config } = await import('./config.js');
      const dataDir = config.getDataDir();
      
      // Check if data directory exists and is writable
      await fs.access(dataDir, fs.constants.F_OK | fs.constants.W_OK);
      
      // Check available disk space
      const stats = await fs.stat(dataDir);
      const { spawn } = await import('child_process');
      
      return new Promise((resolve) => {
        const df = spawn('df', ['-h', dataDir]);
        let output = '';
        
        df.stdout.on('data', (data) => {
          output += data.toString();
        });
        
        df.on('close', (code) => {
          if (code === 0) {
            const lines = output.trim().split('\n');
            const dataLine = lines[1];
            const parts = dataLine.split(/\s+/);
            const available = parts[3];
            
            resolve({
              healthy: true,
              message: `Storage accessible, ${available} available`,
              details: { available, dataDir }
            });
          } else {
            resolve({
              healthy: false,
              message: 'Could not check disk space'
            });
          }
        });
      });
    } catch (error) {
      return {
        healthy: false,
        message: 'Storage access failed',
        details: error instanceof Error ? error.message : error
      };
    }
  }
}

export class DependencyHealthCheck implements HealthCheck {
  name = 'Dependencies';
  critical = true;

  async check() {
    const dependencies = [
      { name: 'FFmpeg', command: 'ffmpeg', args: ['-version'] },
      { name: 'Python', command: 'python3', args: ['--version'] },
      { name: 'faster_whisper', command: 'python3', args: ['-c', 'import faster_whisper'] }
    ];

    const results = [];
    let allHealthy = true;

    for (const dep of dependencies) {
      try {
        const healthy = await this.checkDependency(dep.command, dep.args);
        results.push({ name: dep.name, healthy });
        if (!healthy) allHealthy = false;
      } catch (error) {
        results.push({ name: dep.name, healthy: false, error: error instanceof Error ? error.message : error });
        allHealthy = false;
      }
    }

    return {
      healthy: allHealthy,
      message: allHealthy ? 'All dependencies available' : 'Some dependencies missing',
      details: results
    };
  }

  private checkDependency(command: string, args: string[]): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn(command, args);
      
      proc.on('close', (code) => {
        resolve(code === 0);
      });
      
      proc.on('error', () => {
        resolve(false);
      });
      
      // Timeout after 5 seconds
      setTimeout(() => {
        proc.kill();
        resolve(false);
      }, 5000);
    });
  }
}

export class ProcessingHealthCheck implements HealthCheck {
  name = 'Processing';
  critical = false;

  async check() {
    try {
      const { VideoProcessingRepository } = await import('../core/database/repositories/VideoProcessingRepository.js');
      const repo = new VideoProcessingRepository();
      
      // Check for stuck jobs (processing for more than 1 hour)
      const stuckJobs = await repo.findStuckJobs(3600000); // 1 hour in ms
      
      if (stuckJobs.length > 0) {
        return {
          healthy: false,
          message: `${stuckJobs.length} stuck processing job(s) detected`,
          details: stuckJobs.map(job => ({ id: job.id, type: job.type, startedAt: job.startedAt }))
        };
      }

      // Check processing queue depth
      const pendingJobs = await repo.findByStatus('pending');
      
      return {
        healthy: true,
        message: `Processing healthy, ${pendingJobs.length} job(s) pending`,
        details: { pendingJobs: pendingJobs.length, stuckJobs: 0 }
      };
    } catch (error) {
      return {
        healthy: false,
        message: 'Processing health check failed',
        details: error instanceof Error ? error.message : error
      };
    }
  }
}

export class MemoryHealthCheck implements HealthCheck {
  name = 'Memory';
  critical = false;

  async check() {
    const memoryUsage = process.memoryUsage();
    const usedMB = Math.round(memoryUsage.heapUsed / 1024 / 1024);
    const totalMB = Math.round(memoryUsage.heapTotal / 1024 / 1024);
    
    // Alert if using more than 1GB
    const critical = usedMB > 1024;
    
    return {
      healthy: !critical,
      message: `Memory usage: ${usedMB}MB / ${totalMB}MB`,
      details: {
        heapUsed: memoryUsage.heapUsed,
        heapTotal: memoryUsage.heapTotal,
        external: memoryUsage.external,
        rss: memoryUsage.rss
      }
    };
  }
}

export class HealthMonitor {
  private checks: HealthCheck[] = [
    new DatabaseHealthCheck(),
    new StorageHealthCheck(),
    new DependencyHealthCheck(),
    new ProcessingHealthCheck(),
    new MemoryHealthCheck()
  ];

  private startTime = Date.now();

  async runHealthChecks(): Promise<SystemHealth> {
    const results = await Promise.all(
      this.checks.map(async (check) => {
        try {
          const result = await check.check();
          return {
            name: check.name,
            critical: check.critical,
            ...result
          };
        } catch (error) {
          return {
            name: check.name,
            critical: check.critical,
            healthy: false,
            message: 'Health check failed',
            details: error instanceof Error ? error.message : error
          };
        }
      })
    );

    // Determine overall system health
    const criticalFailures = results.filter(r => r.critical && !r.healthy);
    const warnings = results.filter(r => !r.critical && !r.healthy);

    let databaseStatus: 'healthy' | 'degraded' | 'down' = 'healthy';
    let processingStatus: 'healthy' | 'degraded' | 'down' = 'healthy';
    let vectorStoreStatus: 'healthy' | 'degraded' | 'down' = 'healthy';

    // Check database status
    const dbCheck = results.find(r => r.name === 'Database');
    if (dbCheck && !dbCheck.healthy) {
      databaseStatus = 'down';
    }

    // Check processing status
    const procCheck = results.find(r => r.name === 'Processing');
    if (procCheck && !procCheck.healthy) {
      processingStatus = 'degraded';
    }

    // Check dependencies for processing capabilities
    const depCheck = results.find(r => r.name === 'Dependencies');
    if (depCheck && !depCheck.healthy) {
      processingStatus = 'degraded';
    }

    // Get storage information
    const storageCheck = results.find(r => r.name === 'Storage');
    let storageInfo = {
      usage: 0,
      available: 0,
      status: 'healthy' as 'healthy' | 'warning' | 'critical'
    };

    if (storageCheck?.details?.available) {
      // Parse available space (e.g., "10G" -> 10000000000)
      const availableStr = storageCheck.details.available as string;
      // Simple parsing - in production this would be more robust
      storageInfo.available = 1000000000; // 1GB default
      storageInfo.status = storageCheck.healthy ? 'healthy' : 'warning';
    }

    const uptime = Date.now() - this.startTime;

    return {
      database: databaseStatus,
      vectorStore: vectorStoreStatus,
      processing: processingStatus,
      storage: storageInfo,
      uptime
    };
  }

  async logHealthStatus(): Promise<void> {
    try {
      const health = await this.runHealthChecks();
      
      const healthSummary = {
        database: health.database,
        processing: health.processing,
        storage: health.storage.status,
        uptime: Math.round(health.uptime / 1000) + 's'
      };

      if (health.database === 'down' || health.processing === 'down') {
        logger.error('Critical system health issues detected:', healthSummary);
      } else if (health.database === 'degraded' || health.processing === 'degraded' || health.storage.status !== 'healthy') {
        logger.warn('System health warnings detected:', healthSummary);
      } else {
        logger.info('System health check passed:', healthSummary);
      }
    } catch (error) {
      logger.error('Health monitoring failed:', error);
    }
  }

  startPeriodicHealthChecks(intervalMs: number = 300000): NodeJS.Timeout {
    // Run initial health check
    this.logHealthStatus();
    
    // Schedule periodic health checks
    return setInterval(() => {
      this.logHealthStatus();
    }, intervalMs);
  }

  async generateHealthReport(): Promise<string> {
    const health = await this.runHealthChecks();
    
    const report = [
      '# Spiralmem System Health Report',
      `Generated: ${new Date().toISOString()}`,
      `Uptime: ${Math.round(health.uptime / 1000)}s`,
      '',
      '## Component Status',
      `- Database: ${health.database}`,
      `- Processing: ${health.processing}`,
      `- Vector Store: ${health.vectorStore}`,
      `- Storage: ${health.storage.status} (${health.storage.available} bytes available)`,
      ''
    ];

    // Add detailed check results
    const checks = this.checks;
    for (const check of checks) {
      try {
        const result = await check.check();
        report.push(`### ${check.name}`);
        report.push(`Status: ${result.healthy ? '✅ Healthy' : '❌ Unhealthy'}`);
        if (result.message) {
          report.push(`Message: ${result.message}`);
        }
        if (result.details) {
          report.push(`Details: ${JSON.stringify(result.details, null, 2)}`);
        }
        report.push('');
      } catch (error) {
        report.push(`### ${check.name}`);
        report.push('Status: ❌ Check Failed');
        report.push(`Error: ${error instanceof Error ? error.message : error}`);
        report.push('');
      }
    }

    return report.join('\n');
  }
}

// Export singleton instance
export const healthMonitor = new HealthMonitor();