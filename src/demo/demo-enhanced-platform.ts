#!/usr/bin/env node

/**
 * Enhanced Platform Integration Demo
 * Demonstrates the improved error handling and recovery mechanisms
 */

import { YouTubeConnector } from '../core/platforms/connectors/YouTubeConnector.js';
import { YouTubeAdvancedConnector } from '../core/platforms/connectors/YouTubeAdvanced.js';
import { HybridSearchEngine } from '../core/search/HybridSearchEngine.js';
import { DatabaseConnection } from '../core/database/connection.js';
import { logger } from '../utils/logger.js';

async function main() {
  try {
    console.log('🚀 Enhanced Platform Integration Demo');
    console.log('=====================================\n');

    // Initialize database
    console.log('📊 Initializing database...');
    const dbConnection = DatabaseConnection.getInstance();
    const db = await dbConnection.initialize();
    console.log('✅ Database ready\n');

    // Initialize YouTube connector
    console.log('🎥 Initializing YouTube connector...');
    const youtubeConnector = new YouTubeConnector({
      apiKey: process.env.YOUTUBE_API_KEY
    });

    // Test health check with error analytics
    console.log('🏥 Running health check...');
    const health = await youtubeConnector.healthCheck();
    console.log('Health Status:', {
      platform: health.platform,
      isHealthy: health.isHealthy,
      errorAnalytics: health.errorAnalytics
    });
    console.log('');

    // Test error prevention analysis
    console.log('🛡️  Testing error prevention analysis...');
    const prevention = await youtubeConnector.getErrorPrevention('extractMetadata');
    console.log('Prevention Analysis:', {
      risks: prevention.risks,
      shouldProceed: prevention.shouldProceed,
      recommendations: prevention.recommendations
    });
    console.log('');

    // Test metadata extraction with error handling
    console.log('📋 Testing enhanced metadata extraction...');
    try {
      const testUrls = [
        'https://youtube.com/watch?v=dQw4w9WgXcQ', // Valid video
        'https://youtube.com/watch?v=invalid123',   // Invalid video ID
        'https://youtube.com/watch?v=test123456'    // Another test
      ];

      for (const url of testUrls) {
        console.log(`Processing: ${url}`);
        try {
          const metadata = await youtubeConnector.extractMetadata(url);
          console.log(`✅ Success: ${metadata.title}`);
        } catch (error) {
          console.log(`❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }
    } catch (error) {
      console.log(`Error during metadata extraction: ${error}`);
    }
    console.log('');

    // Test advanced YouTube features
    console.log('🚀 Testing advanced YouTube features...');
    const advancedConnector = new YouTubeAdvancedConnector({
      apiKey: process.env.YOUTUBE_API_KEY
    });

    try {
      // Test playlist processing with error recovery
      const playlistUrl = 'https://youtube.com/playlist?list=PLrAXtmRdnEQy4Qf2O5Hv8xC1kKDT3XkV';
      console.log(`Processing playlist: ${playlistUrl}`);
      
      const playlistResult = await advancedConnector.processPlaylist(playlistUrl, {
        includeMetadata: true,
        maxVideos: 5
      });
      
      console.log(`✅ Playlist processed: ${playlistResult.successful.length} videos, ${playlistResult.failed.length} failed`);
      
      if (playlistResult.rateLimitHit) {
        console.log('⚠️  Rate limit encountered during processing');
      }
    } catch (error) {
      console.log(`Playlist processing error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
    console.log('');

    // Test performance monitoring
    console.log('📊 Testing performance monitoring...');
    try {
      const metrics = await advancedConnector.getPerformanceMetrics();
      console.log('Performance Metrics:', {
        quotaUsage: metrics.quotaUsage,
        responseTime: metrics.responseTime,
        errorRate: metrics.errorRate,
        cacheEfficiency: metrics.cacheEfficiency
      });
      
      console.log('Platform Analytics:', {
        summary: metrics.platformMetrics.summary,
        trends: metrics.platformMetrics.trends.slice(0, 3), // Show first 3 trends
        activeAlerts: metrics.realtimeStatus.activeAlerts,
        currentStatus: metrics.realtimeStatus.status
      });

      // Test real-time status
      const realtimeStatus = youtubeConnector.getPerformanceStatus();
      console.log('Real-time Status:', realtimeStatus);

      // Take a performance snapshot
      const snapshot = youtubeConnector.takePerformanceSnapshot('demo-test');
      console.log('Performance Snapshot:', {
        memoryUsage: snapshot.memoryUsage,
        apiCalls: snapshot.apiCalls,
        throughput: snapshot.throughput
      });

    } catch (error) {
      console.log(`Performance monitoring error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
    console.log('');

    // Test error analytics
    console.log('📈 Error Analytics Summary...');
    const analytics = youtubeConnector.getErrorAnalytics();
    console.log('Error Analytics:', {
      totalErrors: analytics.totalErrors,
      errorsByType: analytics.errorsByType,
      errorsByPlatform: analytics.errorsByPlatform,
      recoverySuccessRate: analytics.recoverySuccessRate,
      recommendations: analytics.recommendations
    });
    console.log('');

    // Test hybrid search system
    console.log('🔍 Testing hybrid search system...');
    try {
      const searchEngine = new HybridSearchEngine();
      
      // Perform hybrid search (no need to index content in demo)
      console.log('Performing hybrid search...');
      const searchResults = await searchEngine.search('programming tutorial', {
        vectorWeight: 0.3,
        keywordWeight: 0.7,
        maxResults: 10
      });

      console.log(`✅ Search completed: ${searchResults.results.length} results found`);
      console.log(`Keyword: ${searchResults.metrics.keywordResults}, Vector: ${searchResults.metrics.vectorResults}`);
      console.log('Search Performance:', `${searchResults.metrics.totalTime}ms`);
      
      if (searchResults.results.length > 0) {
        console.log(`Top result: ${searchResults.results[0].content.substring(0, 100)}...`);
      }

    } catch (error) {
      console.log(`Hybrid search error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
    console.log('');

    // Export error data for analysis
    console.log('💾 Exporting error data...');
    const errorData = youtubeConnector.exportErrorData();
    console.log(`Exported data: ${errorData.errors.length} errors, ${errorData.patterns.length} patterns`);
    console.log('');

    // Cleanup
    console.log('🧹 Cleaning up...');
    youtubeConnector.cleanupErrorHistory();
    console.log('✅ Cleanup completed');

    console.log('\n🎉 Enhanced Platform Demo Completed Successfully!');
    console.log('==========================================');

  } catch (error) {
    console.error('❌ Demo failed:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Demo interrupted - cleaning up...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n👋 Demo terminated - cleaning up...');
  process.exit(0);
});

// Run the demo
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}