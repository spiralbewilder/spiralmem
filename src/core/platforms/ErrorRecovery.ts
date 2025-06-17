import { logger } from '../../utils/logger.js';

export interface ErrorContext {
  operation: string;
  platform: string;
  resourceId?: string;
  timestamp: Date;
  userAction?: string;
  systemState?: Record<string, any>;
}

export interface RecoveryAction {
  type: 'retry' | 'fallback' | 'skip' | 'manual' | 'cache';
  description: string;
  execute: () => Promise<any>;
  maxAttempts?: number;
  delay?: number;
}

export interface ErrorPattern {
  name: string;
  matcher: (error: Error, context: ErrorContext) => boolean;
  severity: 'low' | 'medium' | 'high' | 'critical';
  recoveryActions: RecoveryAction[];
  preventionTips?: string[];
}

/**
 * Advanced error handling and recovery system for platform operations
 * Provides intelligent error classification, recovery strategies, and prevention
 */
export class ErrorRecoveryManager {
  private errorHistory: Array<{ error: Error; context: ErrorContext; recoveryUsed?: string }> = [];
  private errorPatterns: ErrorPattern[] = [];
  private recoveryCache = new Map<string, any>();

  constructor() {
    this.initializeErrorPatterns();
  }

  /**
   * Handle error with intelligent recovery
   */
  async handleError(error: Error, context: ErrorContext): Promise<{
    recovered: boolean;
    result?: any;
    actionTaken: string;
    shouldRetry: boolean;
  }> {
    // Log the error
    this.logError(error, context);
    
    // Add to history
    this.errorHistory.push({ error, context });
    
    // Find matching pattern
    const pattern = this.findMatchingPattern(error, context);
    
    if (!pattern) {
      return {
        recovered: false,
        actionTaken: 'No recovery pattern found',
        shouldRetry: false
      };
    }

    // Try recovery actions in order
    for (const action of pattern.recoveryActions) {
      try {
        const result = await this.executeRecoveryAction(action, error, context);
        
        if (result.success) {
          this.logRecovery(error, context, action.type);
          return {
            recovered: true,
            result: result.data,
            actionTaken: action.description,
            shouldRetry: action.type === 'retry'
          };
        }
      } catch (recoveryError) {
        logger.warn(`Recovery action ${action.type} failed:`, recoveryError);
      }
    }

    // All recovery actions failed
    return {
      recovered: false,
      actionTaken: 'All recovery actions failed',
      shouldRetry: false
    };
  }

  /**
   * Get error analytics and insights
   */
  getErrorAnalytics(): {
    totalErrors: number;
    errorsByType: Record<string, number>;
    errorsByPlatform: Record<string, number>;
    recoverySuccessRate: number;
    commonPatterns: Array<{ pattern: string; count: number; successRate: number }>;
    recommendations: string[];
  } {
    const total = this.errorHistory.length;
    const errorsByType: Record<string, number> = {};
    const errorsByPlatform: Record<string, number> = {};
    let recoveredCount = 0;

    this.errorHistory.forEach(({ error, context, recoveryUsed }) => {
      // Count by error type
      const errorType = error.constructor.name;
      errorsByType[errorType] = (errorsByType[errorType] || 0) + 1;

      // Count by platform
      errorsByPlatform[context.platform] = (errorsByPlatform[context.platform] || 0) + 1;

      // Count recoveries
      if (recoveryUsed) {
        recoveredCount++;
      }
    });

    const recommendations = this.generateRecommendations();

    return {
      totalErrors: total,
      errorsByType,
      errorsByPlatform,
      recoverySuccessRate: total > 0 ? (recoveredCount / total) * 100 : 0,
      commonPatterns: this.getCommonPatterns(),
      recommendations
    };
  }

  /**
   * Preemptive error prevention
   */
  async preventErrors(operation: string, platform: string): Promise<{
    risks: Array<{ risk: string; severity: 'low' | 'medium' | 'high'; mitigation: string }>;
    recommendations: string[];
    shouldProceed: boolean;
  }> {
    const risks: Array<{ risk: string; severity: 'low' | 'medium' | 'high'; mitigation: string }> = [];
    const recommendations: string[] = [];

    // Check historical errors for this operation/platform
    const relevantErrors = this.errorHistory.filter(({ context }) => 
      context.operation === operation && context.platform === platform
    );

    if (relevantErrors.length > 0) {
      const recentErrors = relevantErrors.filter(({ context }) => 
        Date.now() - context.timestamp.getTime() < 3600000 // Last hour
      );

      if (recentErrors.length > 3) {
        risks.push({
          risk: 'High error rate in recent operations',
          severity: 'high',
          mitigation: 'Wait before retrying or check platform status'
        });
      }
    }

    // Check for rate limiting risks
    if (platform === 'youtube') {
      risks.push({
        risk: 'Potential rate limiting',
        severity: 'medium',
        mitigation: 'Implement delays between requests'
      });
    }

    // Generate recommendations
    if (risks.length > 0) {
      recommendations.push('Consider using fallback methods');
      recommendations.push('Implement exponential backoff');
      recommendations.push('Check platform status before proceeding');
    }

    const highRisks = risks.filter(r => r.severity === 'high').length;
    const shouldProceed = highRisks === 0;

    return { risks, recommendations, shouldProceed };
  }

  // Private methods

  private initializeErrorPatterns(): void {
    this.errorPatterns = [
      // Rate limiting errors
      {
        name: 'Rate Limit Exceeded',
        matcher: (error) => error.message.includes('rate limit') || error.message.includes('429'),
        severity: 'medium',
        recoveryActions: [
          {
            type: 'retry',
            description: 'Wait and retry with exponential backoff',
            execute: () => this.exponentialBackoff(1000),
            maxAttempts: 3,
            delay: 1000
          },
          {
            type: 'cache',
            description: 'Use cached data if available',
            execute: () => this.tryCache()
          }
        ],
        preventionTips: [
          'Implement request throttling',
          'Monitor API quota usage',
          'Use batch requests when possible'
        ]
      },

      // Authentication errors
      {
        name: 'Authentication Failed',
        matcher: (error) => error.message.includes('401') || error.message.includes('authentication'),
        severity: 'high',
        recoveryActions: [
          {
            type: 'manual',
            description: 'API key needs to be refreshed',
            execute: () => Promise.resolve({ success: false, data: null })
          }
        ],
        preventionTips: [
          'Verify API key is valid',
          'Check API key permissions',
          'Monitor key expiration'
        ]
      },

      // Network errors
      {
        name: 'Network Error',
        matcher: (error) => error.message.includes('fetch') || error.message.includes('network'),
        severity: 'medium',
        recoveryActions: [
          {
            type: 'retry',
            description: 'Retry with exponential backoff',
            execute: () => this.exponentialBackoff(2000),
            maxAttempts: 5,
            delay: 2000
          },
          {
            type: 'fallback',
            description: 'Use alternative endpoint',
            execute: () => this.tryFallbackEndpoint()
          }
        ],
        preventionTips: [
          'Implement connection pooling',
          'Add network timeout handling',
          'Use CDN endpoints when available'
        ]
      },

      // Resource not found
      {
        name: 'Resource Not Found',
        matcher: (error) => error.message.includes('404') || error.message.includes('not found'),
        severity: 'low',
        recoveryActions: [
          {
            type: 'skip',
            description: 'Skip this resource and continue',
            execute: () => Promise.resolve({ success: true, data: null })
          },
          {
            type: 'fallback',
            description: 'Try alternative resource identifier',
            execute: () => this.tryAlternativeId()
          }
        ],
        preventionTips: [
          'Validate resource IDs before requests',
          'Handle deleted content gracefully',
          'Implement resource existence checks'
        ]
      },

      // Quota exceeded
      {
        name: 'Quota Exceeded',
        matcher: (error) => error.message.includes('quota') || error.message.includes('limit exceeded'),
        severity: 'high',
        recoveryActions: [
          {
            type: 'cache',
            description: 'Use cached data for remainder of day',
            execute: () => this.tryCache()
          },
          {
            type: 'manual',
            description: 'Wait until quota resets',
            execute: () => Promise.resolve({ success: false, data: null })
          }
        ],
        preventionTips: [
          'Monitor daily quota usage',
          'Implement quota-aware request scheduling',
          'Cache responses to reduce API calls'
        ]
      },

      // Parsing errors
      {
        name: 'Data Parsing Error',
        matcher: (error) => error.message.includes('JSON') || error.message.includes('parse'),
        severity: 'medium',
        recoveryActions: [
          {
            type: 'retry',
            description: 'Retry request once',
            execute: () => this.exponentialBackoff(500),
            maxAttempts: 1
          },
          {
            type: 'fallback',
            description: 'Use simplified data extraction',
            execute: () => this.trySimplifiedParsing()
          }
        ],
        preventionTips: [
          'Validate API response format',
          'Implement robust JSON parsing',
          'Handle malformed responses gracefully'
        ]
      }
    ];
  }

  private findMatchingPattern(error: Error, context: ErrorContext): ErrorPattern | null {
    return this.errorPatterns.find(pattern => pattern.matcher(error, context)) || null;
  }

  private async executeRecoveryAction(
    action: RecoveryAction, 
    error: Error, 
    context: ErrorContext
  ): Promise<{ success: boolean; data?: any }> {
    try {
      const result = await action.execute();
      return { success: true, data: result };
    } catch (recoveryError) {
      return { success: false };
    }
  }

  private async exponentialBackoff(baseDelay: number): Promise<{ success: boolean }> {
    await new Promise(resolve => setTimeout(resolve, baseDelay));
    return { success: true };
  }

  private async tryCache(): Promise<{ success: boolean; data?: any }> {
    // Try to find cached data
    // This would integrate with actual cache implementation
    return { success: false };
  }

  private async tryFallbackEndpoint(): Promise<{ success: boolean; data?: any }> {
    // Try alternative API endpoint
    return { success: false };
  }

  private async tryAlternativeId(): Promise<{ success: boolean; data?: any }> {
    // Try alternative resource identification
    return { success: false };
  }

  private async trySimplifiedParsing(): Promise<{ success: boolean; data?: any }> {
    // Try simplified data extraction
    return { success: false };
  }

  private logError(error: Error, context: ErrorContext): void {
    logger.error(`Platform error in ${context.platform}:${context.operation}`, {
      error: error.message,
      context,
      stack: error.stack
    });
  }

  private logRecovery(error: Error, context: ErrorContext, recoveryType: string): void {
    logger.info(`Error recovered using ${recoveryType}`, {
      originalError: error.message,
      context,
      recoveryType
    });

    // Update history
    const lastEntry = this.errorHistory[this.errorHistory.length - 1];
    if (lastEntry) {
      lastEntry.recoveryUsed = recoveryType;
    }
  }

  private getCommonPatterns(): Array<{ pattern: string; count: number; successRate: number }> {
    const patternStats = new Map<string, { count: number; recovered: number }>();

    this.errorHistory.forEach(({ error, recoveryUsed }) => {
      const pattern = this.findMatchingPattern(error, { 
        operation: '', 
        platform: '', 
        timestamp: new Date() 
      })?.name || 'Unknown';

      const stats = patternStats.get(pattern) || { count: 0, recovered: 0 };
      stats.count++;
      if (recoveryUsed) stats.recovered++;
      patternStats.set(pattern, stats);
    });

    return Array.from(patternStats.entries()).map(([pattern, stats]) => ({
      pattern,
      count: stats.count,
      successRate: stats.count > 0 ? (stats.recovered / stats.count) * 100 : 0
    }));
  }

  private generateRecommendations(this: ErrorRecoveryManager): string[] {
    const recommendations: string[] = [];
    
    // Calculate analytics inline to avoid recursion
    const total = this.errorHistory.length;
    let recoveredCount = 0;
    const errorsByType: Record<string, number> = {};

    this.errorHistory.forEach(({ error, recoveryUsed }) => {
      const errorType = error.constructor.name;
      errorsByType[errorType] = (errorsByType[errorType] || 0) + 1;
      if (recoveryUsed) recoveredCount++;
    });

    const recoverySuccessRate = total > 0 ? (recoveredCount / total) * 100 : 0;

    if (recoverySuccessRate < 50) {
      recommendations.push('Improve error handling strategies');
    }

    if (errorsByType['Error'] > total * 0.3) {
      recommendations.push('Add more specific error types');
    }

    if (total > 100) {
      recommendations.push('Consider implementing circuit breaker pattern');
    }

    return recommendations;
  }

  /**
   * Clear old error history to prevent memory issues
   */
  public cleanupHistory(maxAge: number = 24 * 60 * 60 * 1000): void {
    const cutoff = Date.now() - maxAge;
    this.errorHistory = this.errorHistory.filter(
      ({ context }) => context.timestamp.getTime() > cutoff
    );
  }

  /**
   * Export error data for analysis
   */
  public exportErrorData(): {
    errors: Array<{
      type: string;
      message: string;
      platform: string;
      operation: string;
      timestamp: string;
      recovered: boolean;
    }>;
    patterns: ErrorPattern[];
    analytics: {
      totalErrors: number;
      errorsByType: Record<string, number>;
      errorsByPlatform: Record<string, number>;
      recoverySuccessRate: number;
      commonPatterns: Array<{ pattern: string; count: number; successRate: number }>;
      recommendations: string[];
    };
  } {
    return {
      errors: this.errorHistory.map(({ error, context, recoveryUsed }) => ({
        type: error.constructor.name,
        message: error.message,
        platform: context.platform,
        operation: context.operation,
        timestamp: context.timestamp.toISOString(),
        recovered: !!recoveryUsed
      })),
      patterns: this.errorPatterns,
      analytics: this.getErrorAnalytics()
    };
  }
}