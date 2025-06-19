import { logger } from '../../utils/logger.js';

export interface PerformanceMetric {
  name: string;
  value: number;
  unit: 'ms' | 'bytes' | 'count' | 'percent' | 'rate';
  timestamp: Date;
  tags?: Record<string, string>;
}

export interface PerformanceSnapshot {
  timestamp: Date;
  platform: string;
  operation: string;
  duration: number;
  memoryUsage: {
    used: number;
    total: number;
    heap: number;
  };
  apiCalls: {
    successful: number;
    failed: number;
    rateLimit: number;
  };
  throughput: {
    requestsPerSecond: number;
    dataProcessed: number;
  };
  errors: {
    count: number;
    rate: number;
  };
}

export interface PerformanceAlert {
  id: string;
  type: 'warning' | 'critical';
  message: string;
  metric: string;
  threshold: number;
  actual: number;
  timestamp: Date;
  platform: string;
}

export interface PerformanceTrend {
  metric: string;
  direction: 'improving' | 'degrading' | 'stable';
  changePercent: number;
  timeRange: string;
  significance: 'low' | 'medium' | 'high';
}

/**
 * Performance monitoring and analytics system for platform operations
 * Tracks metrics, detects issues, and provides optimization insights
 */
export class PerformanceMonitor {
  private metrics: PerformanceMetric[] = [];
  private snapshots: PerformanceSnapshot[] = [];
  private alerts: PerformanceAlert[] = [];
  private thresholds: Map<string, { warning: number; critical: number }> = new Map();
  private operationTimers: Map<string, number> = new Map();
  
  constructor() {
    this.initializeThresholds();
    this.startCleanupInterval();
  }

  /**
   * Start timing an operation
   */
  startOperation(operationId: string): void {
    this.operationTimers.set(operationId, Date.now());
  }

  /**
   * End timing an operation and record metrics
   */
  endOperation(operationId: string, platform: string, success: boolean = true): number {
    const startTime = this.operationTimers.get(operationId);
    if (!startTime) {
      logger.warn(`No start time found for operation: ${operationId}`);
      return 0;
    }

    const duration = Date.now() - startTime;
    this.operationTimers.delete(operationId);

    // Record the metric
    this.recordMetric({
      name: `operation.${operationId}.duration`,
      value: duration,
      unit: 'ms',
      timestamp: new Date(),
      tags: { platform, success: success.toString() }
    });

    return duration;
  }

  /**
   * Record a performance metric
   */
  recordMetric(metric: PerformanceMetric): void {
    this.metrics.push(metric);
    this.checkThresholds(metric);
    
    // Keep only recent metrics
    if (this.metrics.length > 10000) {
      this.metrics = this.metrics.slice(-5000);
    }
  }

  /**
   * Take a performance snapshot
   */
  takeSnapshot(platform: string, operation: string): PerformanceSnapshot {
    const now = new Date();
    const memUsage = process.memoryUsage();
    
    // Calculate recent metrics (last 5 minutes)
    const fiveMinutesAgo = new Date(now.getTime() - 300000);
    const recentMetrics = this.metrics.filter(m => m.timestamp >= fiveMinutesAgo);
    
    const apiSuccessful = recentMetrics.filter(m => 
      m.name.includes('api.call') && m.tags?.success === 'true'
    ).length;
    
    const apiFailed = recentMetrics.filter(m => 
      m.name.includes('api.call') && m.tags?.success === 'false'
    ).length;
    
    const rateLimit = recentMetrics.filter(m => 
      m.name.includes('rate.limit')
    ).length;

    const errorCount = recentMetrics.filter(m => 
      m.name.includes('error')
    ).length;

    const snapshot: PerformanceSnapshot = {
      timestamp: now,
      platform,
      operation,
      duration: 0, // Will be set by caller
      memoryUsage: {
        used: memUsage.heapUsed,
        total: memUsage.heapTotal,
        heap: memUsage.heapUsed / memUsage.heapTotal * 100
      },
      apiCalls: {
        successful: apiSuccessful,
        failed: apiFailed,
        rateLimit
      },
      throughput: {
        requestsPerSecond: (apiSuccessful + apiFailed) / 300, // 5 minutes
        dataProcessed: this.calculateDataProcessed(recentMetrics)
      },
      errors: {
        count: errorCount,
        rate: errorCount / Math.max(apiSuccessful + apiFailed, 1) * 100
      }
    };

    this.snapshots.push(snapshot);
    
    // Keep only recent snapshots
    if (this.snapshots.length > 1000) {
      this.snapshots = this.snapshots.slice(-500);
    }

    return snapshot;
  }

  /**
   * Get performance analytics
   */
  getAnalytics(timeRange: number = 3600000): {
    summary: {
      totalOperations: number;
      averageResponseTime: number;
      errorRate: number;
      throughput: number;
    };
    trends: PerformanceTrend[];
    alerts: PerformanceAlert[];
    topSlowOperations: Array<{ operation: string; avgDuration: number; count: number }>;
    resourceUsage: {
      memoryTrend: 'increasing' | 'decreasing' | 'stable';
      peakMemory: number;
      currentMemory: number;
    };
  } {
    const cutoff = new Date(Date.now() - timeRange);
    const recentMetrics = this.metrics.filter(m => m.timestamp >= cutoff);
    const recentSnapshots = this.snapshots.filter(s => s.timestamp >= cutoff);

    // Calculate summary
    const operationMetrics = recentMetrics.filter(m => m.name.includes('operation') && m.name.includes('duration'));
    const totalOperations = operationMetrics.length;
    const averageResponseTime = totalOperations > 0 
      ? operationMetrics.reduce((sum, m) => sum + m.value, 0) / totalOperations 
      : 0;

    const errorMetrics = recentMetrics.filter(m => m.name.includes('error'));
    const errorRate = totalOperations > 0 ? (errorMetrics.length / totalOperations) * 100 : 0;

    const throughput = recentSnapshots.length > 0
      ? recentSnapshots.reduce((sum, s) => sum + s.throughput.requestsPerSecond, 0) / recentSnapshots.length
      : 0;

    // Calculate trends
    const trends = this.calculateTrends(recentMetrics);

    // Get recent alerts
    const recentAlerts = this.alerts.filter(a => a.timestamp >= cutoff);

    // Find slow operations
    const operationGroups = new Map<string, number[]>();
    operationMetrics.forEach(m => {
      const opName = m.name.split('.')[1];
      if (!operationGroups.has(opName)) {
        operationGroups.set(opName, []);
      }
      operationGroups.get(opName)!.push(m.value);
    });

    const topSlowOperations = Array.from(operationGroups.entries())
      .map(([operation, durations]) => ({
        operation,
        avgDuration: durations.reduce((sum, d) => sum + d, 0) / durations.length,
        count: durations.length
      }))
      .sort((a, b) => b.avgDuration - a.avgDuration)
      .slice(0, 5);

    // Calculate resource usage
    const memoryValues = recentSnapshots.map(s => s.memoryUsage.used);
    const memoryTrend = this.calculateMemoryTrend(memoryValues);
    const peakMemory = Math.max(...memoryValues, 0);
    const currentMemory = memoryValues[memoryValues.length - 1] || 0;

    return {
      summary: {
        totalOperations,
        averageResponseTime,
        errorRate,
        throughput
      },
      trends,
      alerts: recentAlerts,
      topSlowOperations,
      resourceUsage: {
        memoryTrend,
        peakMemory,
        currentMemory
      }
    };
  }

  /**
   * Get real-time performance status
   */
  getRealtimeStatus(): {
    status: 'healthy' | 'warning' | 'critical';
    activeAlerts: number;
    currentThroughput: number;
    memoryUsage: number;
    lastUpdate: Date;
  } {
    const now = new Date();
    const recentAlerts = this.alerts.filter(a => now.getTime() - a.timestamp.getTime() < 300000); // 5 minutes
    const criticalAlerts = recentAlerts.filter(a => a.type === 'critical');
    const warningAlerts = recentAlerts.filter(a => a.type === 'warning');

    let status: 'healthy' | 'warning' | 'critical' = 'healthy';
    if (criticalAlerts.length > 0) {
      status = 'critical';
    } else if (warningAlerts.length > 0) {
      status = 'warning';
    }

    const recentSnapshots = this.snapshots.filter(s => now.getTime() - s.timestamp.getTime() < 60000); // 1 minute
    const currentThroughput = recentSnapshots.length > 0 
      ? recentSnapshots[recentSnapshots.length - 1].throughput.requestsPerSecond 
      : 0;

    const memUsage = process.memoryUsage();
    const memoryUsage = (memUsage.heapUsed / memUsage.heapTotal) * 100;

    return {
      status,
      activeAlerts: recentAlerts.length,
      currentThroughput,
      memoryUsage,
      lastUpdate: now
    };
  }

  // Private helper methods

  private initializeThresholds(): void {
    // General response time thresholds (for API calls, search, etc.)
    this.thresholds.set('response_time', { warning: 5000, critical: 15000 }); // 5s warning, 15s critical
    
    // Video processing specific thresholds (longer operations)
    this.thresholds.set('video_processing', { warning: 45000, critical: 120000 }); // 45s warning, 2min critical
    this.thresholds.set('audio_extraction', { warning: 20000, critical: 45000 }); // 20s warning, 45s critical
    this.thresholds.set('transcription', { warning: 30000, critical: 90000 }); // 30s warning, 90s critical
    this.thresholds.set('content_processing', { warning: 5000, critical: 15000 }); // 5s warning, 15s critical
    
    // System resource thresholds
    this.thresholds.set('error_rate', { warning: 5, critical: 10 });
    this.thresholds.set('memory_usage', { warning: 80, critical: 95 });
    this.thresholds.set('throughput', { warning: 1, critical: 0.5 });
  }

  private checkThresholds(metric: PerformanceMetric): void {
    const thresholdKey = this.getThresholdKey(metric.name);
    const threshold = this.thresholds.get(thresholdKey);
    
    if (!threshold) return;

    if (metric.value >= threshold.critical) {
      this.createAlert('critical', metric, threshold.critical);
    } else if (metric.value >= threshold.warning) {
      this.createAlert('warning', metric, threshold.warning);
    }
  }

  private getThresholdKey(metricName: string): string {
    // Video processing specific metrics
    if (metricName.includes('video.workflow') || metricName.includes('processVideo')) return 'video_processing';
    if (metricName.includes('audio.extraction') || metricName.includes('extractAudio')) return 'audio_extraction';
    if (metricName.includes('transcription') || metricName.includes('transcribe')) return 'transcription';
    if (metricName.includes('content.processing') || metricName.includes('content-processing')) return 'content_processing';
    
    // General metrics
    if (metricName.includes('duration')) return 'response_time';
    if (metricName.includes('error')) return 'error_rate';
    if (metricName.includes('memory')) return 'memory_usage';
    if (metricName.includes('throughput')) return 'throughput';
    
    return 'response_time'; // Default to general response time for unknown duration metrics
  }

  private createAlert(type: 'warning' | 'critical', metric: PerformanceMetric, threshold: number): void {
    const alert: PerformanceAlert = {
      id: `${metric.name}-${Date.now()}`,
      type,
      message: `${metric.name} exceeded ${type} threshold`,
      metric: metric.name,
      threshold,
      actual: metric.value,
      timestamp: new Date(),
      platform: metric.tags?.platform || 'unknown'
    };

    this.alerts.push(alert);
    logger.warn(`Performance alert: ${alert.message}`, alert);

    // Keep only recent alerts
    if (this.alerts.length > 100) {
      this.alerts = this.alerts.slice(-50);
    }
  }

  private calculateDataProcessed(metrics: PerformanceMetric[]): number {
    return metrics
      .filter(m => m.name.includes('data.processed'))
      .reduce((sum, m) => sum + m.value, 0);
  }

  private calculateTrends(metrics: PerformanceMetric[]): PerformanceTrend[] {
    const trends: PerformanceTrend[] = [];
    const metricGroups = new Map<string, PerformanceMetric[]>();

    // Group metrics by name
    metrics.forEach(m => {
      if (!metricGroups.has(m.name)) {
        metricGroups.set(m.name, []);
      }
      metricGroups.get(m.name)!.push(m);
    });

    // Calculate trend for each metric
    metricGroups.forEach((metricList, name) => {
      if (metricList.length < 2) return;

      metricList.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      const firstHalf = metricList.slice(0, Math.floor(metricList.length / 2));
      const secondHalf = metricList.slice(Math.floor(metricList.length / 2));

      const firstAvg = firstHalf.reduce((sum, m) => sum + m.value, 0) / firstHalf.length;
      const secondAvg = secondHalf.reduce((sum, m) => sum + m.value, 0) / secondHalf.length;

      const changePercent = ((secondAvg - firstAvg) / firstAvg) * 100;
      let direction: 'improving' | 'degrading' | 'stable' = 'stable';
      
      if (Math.abs(changePercent) > 5) {
        direction = changePercent > 0 ? 'degrading' : 'improving';
        if (name.includes('throughput')) {
          direction = changePercent > 0 ? 'improving' : 'degrading';
        }
      }

      trends.push({
        metric: name,
        direction,
        changePercent: Math.abs(changePercent),
        timeRange: '1h',
        significance: Math.abs(changePercent) > 20 ? 'high' : Math.abs(changePercent) > 10 ? 'medium' : 'low'
      });
    });

    return trends;
  }

  private calculateMemoryTrend(values: number[]): 'increasing' | 'decreasing' | 'stable' {
    if (values.length < 2) return 'stable';

    const firstHalf = values.slice(0, Math.floor(values.length / 2));
    const secondHalf = values.slice(Math.floor(values.length / 2));

    const firstAvg = firstHalf.reduce((sum, v) => sum + v, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((sum, v) => sum + v, 0) / secondHalf.length;

    const changePercent = ((secondAvg - firstAvg) / firstAvg) * 100;

    if (changePercent > 5) return 'increasing';
    if (changePercent < -5) return 'decreasing';
    return 'stable';
  }

  private startCleanupInterval(): void {
    // Clean up old data every hour
    setInterval(() => {
      const cutoff = new Date(Date.now() - 86400000); // 24 hours
      this.metrics = this.metrics.filter(m => m.timestamp >= cutoff);
      this.snapshots = this.snapshots.filter(s => s.timestamp >= cutoff);
      this.alerts = this.alerts.filter(a => a.timestamp >= cutoff);
    }, 3600000); // 1 hour
  }

  /**
   * Export performance data for analysis
   */
  exportData(): {
    metrics: PerformanceMetric[];
    snapshots: PerformanceSnapshot[];
    alerts: PerformanceAlert[];
    summary: {
      summary: {
        totalOperations: number;
        averageResponseTime: number;
        errorRate: number;
        throughput: number;
      };
      trends: PerformanceTrend[];
      alerts: PerformanceAlert[];
      topSlowOperations: Array<{ operation: string; avgDuration: number; count: number }>;
      resourceUsage: {
        memoryTrend: 'increasing' | 'decreasing' | 'stable';
        peakMemory: number;
        currentMemory: number;
      };
    };
  } {
    return {
      metrics: this.metrics,
      snapshots: this.snapshots,
      alerts: this.alerts,
      summary: this.getAnalytics()
    };
  }

  /**
   * Reset all performance data
   */
  reset(): void {
    this.metrics = [];
    this.snapshots = [];
    this.alerts = [];
    this.operationTimers.clear();
  }
}