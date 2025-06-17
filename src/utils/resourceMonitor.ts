import { logger } from './logger.js';
import { EventEmitter } from 'events';

export interface ResourceThresholds {
  maxMemoryMB: number;
  maxCpuPercent: number;
  maxDiskUsagePercent: number;
  maxConcurrentJobs: number;
}

export interface ResourceUsage {
  memoryMB: number;
  cpuPercent: number;
  diskUsagePercent: number;
  activeJobs: number;
  timestamp: Date;
}

export interface ResourceAlert {
  type: 'memory' | 'cpu' | 'disk' | 'jobs';
  level: 'warning' | 'critical';
  current: number;
  threshold: number;
  message: string;
  timestamp: Date;
}

export class ResourceMonitor extends EventEmitter {
  private thresholds: ResourceThresholds;
  private monitoringInterval: NodeJS.Timeout | null = null;
  private usageHistory: ResourceUsage[] = [];
  private maxHistorySize = 100;
  private alertCooldown = new Map<string, number>();
  private alertCooldownMs = 60000; // 1 minute

  constructor(thresholds: Partial<ResourceThresholds> = {}) {
    super();
    
    this.thresholds = {
      maxMemoryMB: 1024, // 1GB
      maxCpuPercent: 80,
      maxDiskUsagePercent: 90,
      maxConcurrentJobs: 3,
      ...thresholds
    };
  }

  async getCurrentUsage(): Promise<ResourceUsage> {
    const memoryUsage = process.memoryUsage();
    const memoryMB = Math.round(memoryUsage.heapUsed / 1024 / 1024);
    
    // Get CPU usage (simplified - would use more sophisticated monitoring in production)
    const cpuPercent = await this.getCpuUsage();
    
    // Get disk usage
    const diskUsagePercent = await this.getDiskUsage();
    
    // Get active jobs count
    const activeJobs = await this.getActiveJobsCount();

    return {
      memoryMB,
      cpuPercent,
      diskUsagePercent,
      activeJobs,
      timestamp: new Date()
    };
  }

  private async getCpuUsage(): Promise<number> {
    try {
      const os = await import('os');
      const cpus = os.cpus();
      
      // Simple CPU load approximation
      const load = os.loadavg()[0];
      const cpuCount = cpus.length;
      
      return Math.min((load / cpuCount) * 100, 100);
    } catch (error) {
      logger.debug('Failed to get CPU usage:', error);
      return 0;
    }
  }

  private async getDiskUsage(): Promise<number> {
    try {
      const { config } = await import('./config.js');
      const dataDir = config.getDataDir();
      const { spawn } = await import('child_process');
      
      return new Promise((resolve) => {
        const df = spawn('df', [dataDir]);
        let output = '';
        
        df.stdout.on('data', (data) => {
          output += data.toString();
        });
        
        df.on('close', (code) => {
          if (code === 0) {
            try {
              const lines = output.trim().split('\n');
              const dataLine = lines[1];
              const parts = dataLine.split(/\s+/);
              const usedPercent = parseInt(parts[4].replace('%', ''));
              resolve(usedPercent);
            } catch (error) {
              resolve(0);
            }
          } else {
            resolve(0);
          }
        });
        
        // Timeout after 5 seconds
        setTimeout(() => {
          df.kill();
          resolve(0);
        }, 5000);
      });
    } catch (error) {
      logger.debug('Failed to get disk usage:', error);
      return 0;
    }
  }

  private async getActiveJobsCount(): Promise<number> {
    try {
      const { VideoProcessingRepository } = await import('../core/database/repositories/VideoProcessingRepository.js');
      const repo = new VideoProcessingRepository();
      const activeJobs = await repo.findJobsByStatus('processing');
      return activeJobs.length;
    } catch (error) {
      logger.debug('Failed to get active jobs count:', error);
      return 0;
    }
  }

  checkThresholds(usage: ResourceUsage): ResourceAlert[] {
    const alerts: ResourceAlert[] = [];
    const now = Date.now();

    // Check memory usage
    if (usage.memoryMB > this.thresholds.maxMemoryMB) {
      const alertKey = 'memory';
      if (!this.isInCooldown(alertKey, now)) {
        const level = usage.memoryMB > this.thresholds.maxMemoryMB * 1.2 ? 'critical' : 'warning';
        alerts.push({
          type: 'memory',
          level,
          current: usage.memoryMB,
          threshold: this.thresholds.maxMemoryMB,
          message: `High memory usage: ${usage.memoryMB}MB (threshold: ${this.thresholds.maxMemoryMB}MB)`,
          timestamp: usage.timestamp
        });
        this.setAlertCooldown(alertKey, now);
      }
    }

    // Check CPU usage
    if (usage.cpuPercent > this.thresholds.maxCpuPercent) {
      const alertKey = 'cpu';
      if (!this.isInCooldown(alertKey, now)) {
        const level = usage.cpuPercent > this.thresholds.maxCpuPercent * 1.2 ? 'critical' : 'warning';
        alerts.push({
          type: 'cpu',
          level,
          current: usage.cpuPercent,
          threshold: this.thresholds.maxCpuPercent,
          message: `High CPU usage: ${usage.cpuPercent.toFixed(1)}% (threshold: ${this.thresholds.maxCpuPercent}%)`,
          timestamp: usage.timestamp
        });
        this.setAlertCooldown(alertKey, now);
      }
    }

    // Check disk usage
    if (usage.diskUsagePercent > this.thresholds.maxDiskUsagePercent) {
      const alertKey = 'disk';
      if (!this.isInCooldown(alertKey, now)) {
        const level = usage.diskUsagePercent > 95 ? 'critical' : 'warning';
        alerts.push({
          type: 'disk',
          level,
          current: usage.diskUsagePercent,
          threshold: this.thresholds.maxDiskUsagePercent,
          message: `High disk usage: ${usage.diskUsagePercent}% (threshold: ${this.thresholds.maxDiskUsagePercent}%)`,
          timestamp: usage.timestamp
        });
        this.setAlertCooldown(alertKey, now);
      }
    }

    // Check concurrent jobs
    if (usage.activeJobs > this.thresholds.maxConcurrentJobs) {
      const alertKey = 'jobs';
      if (!this.isInCooldown(alertKey, now)) {
        alerts.push({
          type: 'jobs',
          level: 'warning',
          current: usage.activeJobs,
          threshold: this.thresholds.maxConcurrentJobs,
          message: `High concurrent jobs: ${usage.activeJobs} (threshold: ${this.thresholds.maxConcurrentJobs})`,
          timestamp: usage.timestamp
        });
        this.setAlertCooldown(alertKey, now);
      }
    }

    return alerts;
  }

  private isInCooldown(alertKey: string, now: number): boolean {
    const lastAlert = this.alertCooldown.get(alertKey);
    return lastAlert ? (now - lastAlert) < this.alertCooldownMs : false;
  }

  private setAlertCooldown(alertKey: string, now: number): void {
    this.alertCooldown.set(alertKey, now);
  }

  private addToHistory(usage: ResourceUsage): void {
    this.usageHistory.push(usage);
    
    // Trim history to max size
    if (this.usageHistory.length > this.maxHistorySize) {
      this.usageHistory = this.usageHistory.slice(-this.maxHistorySize);
    }
  }

  getUsageHistory(): ResourceUsage[] {
    return [...this.usageHistory];
  }

  getAverageUsage(windowMinutes: number = 5): Partial<ResourceUsage> | null {
    const cutoff = new Date(Date.now() - (windowMinutes * 60 * 1000));
    const recentUsage = this.usageHistory.filter(u => u.timestamp >= cutoff);
    
    if (recentUsage.length === 0) {
      return null;
    }

    const avg = recentUsage.reduce(
      (acc, usage) => ({
        memoryMB: acc.memoryMB + usage.memoryMB,
        cpuPercent: acc.cpuPercent + usage.cpuPercent,
        diskUsagePercent: acc.diskUsagePercent + usage.diskUsagePercent,
        activeJobs: acc.activeJobs + usage.activeJobs
      }),
      { memoryMB: 0, cpuPercent: 0, diskUsagePercent: 0, activeJobs: 0 }
    );

    const count = recentUsage.length;
    return {
      memoryMB: Math.round(avg.memoryMB / count),
      cpuPercent: Math.round((avg.cpuPercent / count) * 10) / 10,
      diskUsagePercent: Math.round(avg.diskUsagePercent / count),
      activeJobs: Math.round(avg.activeJobs / count)
    };
  }

  canAcceptNewJob(): boolean {
    if (this.usageHistory.length === 0) {
      return true; // No data yet, allow job
    }

    const latest = this.usageHistory[this.usageHistory.length - 1];
    
    // Check if we're at or above thresholds
    return (
      latest.memoryMB < this.thresholds.maxMemoryMB &&
      latest.cpuPercent < this.thresholds.maxCpuPercent &&
      latest.diskUsagePercent < this.thresholds.maxDiskUsagePercent &&
      latest.activeJobs < this.thresholds.maxConcurrentJobs
    );
  }

  startMonitoring(intervalMs: number = 30000): void {
    if (this.monitoringInterval) {
      return; // Already monitoring
    }

    logger.info('Starting resource monitoring', {
      interval: intervalMs,
      thresholds: this.thresholds
    });

    this.monitoringInterval = setInterval(async () => {
      try {
        const usage = await this.getCurrentUsage();
        this.addToHistory(usage);
        
        const alerts = this.checkThresholds(usage);
        
        for (const alert of alerts) {
          this.emit('alert', alert);
          
          if (alert.level === 'critical') {
            logger.error('Critical resource alert:', alert);
          } else {
            logger.warn('Resource alert:', alert);
          }
        }
        
        // Emit usage update
        this.emit('usage', usage);
        
      } catch (error) {
        logger.error('Resource monitoring error:', error);
      }
    }, intervalMs);
  }

  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
      logger.info('Resource monitoring stopped');
    }
  }

  updateThresholds(newThresholds: Partial<ResourceThresholds>): void {
    this.thresholds = { ...this.thresholds, ...newThresholds };
    logger.info('Resource thresholds updated:', this.thresholds);
  }

  generateReport(): string {
    const latest = this.usageHistory[this.usageHistory.length - 1];
    const average = this.getAverageUsage(5);
    
    if (!latest) {
      return 'No resource usage data available';
    }

    const report = [
      '# Resource Usage Report',
      `Generated: ${new Date().toISOString()}`,
      '',
      '## Current Usage',
      `Memory: ${latest.memoryMB}MB (threshold: ${this.thresholds.maxMemoryMB}MB)`,
      `CPU: ${latest.cpuPercent.toFixed(1)}% (threshold: ${this.thresholds.maxCpuPercent}%)`,
      `Disk: ${latest.diskUsagePercent}% (threshold: ${this.thresholds.maxDiskUsagePercent}%)`,
      `Active Jobs: ${latest.activeJobs} (threshold: ${this.thresholds.maxConcurrentJobs})`,
      ''
    ];

    if (average) {
      report.push('## 5-Minute Average');
      report.push(`Memory: ${average.memoryMB}MB`);
      report.push(`CPU: ${average.cpuPercent?.toFixed(1)}%`);
      report.push(`Disk: ${average.diskUsagePercent}%`);
      report.push(`Active Jobs: ${average.activeJobs}`);
      report.push('');
    }

    report.push(`## Status`);
    report.push(`Can accept new jobs: ${this.canAcceptNewJob() ? 'Yes' : 'No'}`);
    report.push(`History entries: ${this.usageHistory.length}`);

    return report.join('\n');
  }
}

// Export singleton instance
export const resourceMonitor = new ResourceMonitor();