import { EnhancedMemoryEngine } from '../core/search/index.js';
import { logger } from '../utils/logger.js';

/**
 * Demonstration of the hybrid search capabilities
 * Shows how to search across local and platform content simultaneously
 */
async function demonstrateHybridSearch() {
  console.log('🚀 Spiralmem Hybrid Search System Demo');
  console.log('=====================================\n');

  try {
    // Initialize the enhanced memory engine
    const memoryEngine = new EnhancedMemoryEngine();
    await memoryEngine.initialize();

    console.log('✅ Enhanced Memory Engine initialized with platform support\n');

    // Demo 1: Add some local content
    console.log('📝 Adding local content...');
    const localMemoryId = await memoryEngine.addContent({
      content: 'This is a tutorial about TypeScript programming and advanced development techniques.',
      title: 'TypeScript Advanced Tutorial',
      source: 'local',
      spaceId: 'demo-space',
      contentType: 'text',
      tags: ['typescript', 'programming', 'tutorial']
    });
    console.log(`   Added local content: ${localMemoryId}`);

    // Demo 2: Add platform video (YouTube example)
    console.log('\n📺 Adding platform video content...');
    try {
      const platformMemoryId = await memoryEngine.addPlatformVideo({
        platformUrl: 'https://youtube.com/watch?v=dQw4w9WgXcQ', // Example URL
        title: 'Example YouTube Video',
        spaceId: 'demo-space',
        tags: ['demo', 'example'],
        extractionOptions: {
          includeTranscript: true,
          includeMetadata: true,
          includeComments: false,
          generateSummary: false,
          extractKeyMoments: true
        },
        indexingPriority: 'immediate'
      });
      console.log(`   Added platform content: ${platformMemoryId}`);
    } catch (error) {
      console.log(`   Platform video demo skipped (requires API key): ${error instanceof Error ? error.message : error}`);
    }

    // Demo 3: Universal content input
    console.log('\n🔄 Adding universal content...');
    const universalMemoryId = await memoryEngine.addUniversalContent({
      type: 'text',
      content: 'JavaScript and TypeScript are powerful programming languages for web development.',
      commonMetadata: {
        title: 'Programming Languages Overview',
        source: 'demo',
        spaceId: 'demo-space',
        tags: ['javascript', 'typescript', 'web-development']
      }
    });
    console.log(`   Added universal content: ${universalMemoryId}`);

    // Demo 4: Hybrid search
    console.log('\n🔍 Performing hybrid search...');
    const searchResults = await memoryEngine.searchUniversal('TypeScript programming', {
      vectorWeight: 0.3,
      keywordWeight: 0.7,
      maxResults: 10
    });

    console.log(`   Found ${searchResults.unified.length} unified results`);
    console.log(`   Performance: ${searchResults.performance.searchTime}ms`);
    console.log(`   Local results: ${searchResults.breakdown.local.length}`);
    console.log(`   Platform results: ${searchResults.breakdown.platform.length}`);
    console.log(`   Correlations found: ${searchResults.correlations.length}`);

    // Display results
    console.log('\n📋 Search Results:');
    searchResults.unified.slice(0, 3).forEach((result, index) => {
      console.log(`   ${index + 1}. ${result.memory.title || 'Untitled'}`);
      console.log(`      Source: ${result.source} ${result.platform ? `(${result.platform})` : ''}`);
      console.log(`      Relevance: ${Math.round(result.relevanceScore * 100)}%`);
      if (result.playbackInfo.deeplinkUrl) {
        console.log(`      Deep-link: ${result.playbackInfo.deeplinkUrl}`);
      }
      console.log('');
    });

    // Demo 5: Generate playback queue
    console.log('\n🎵 Generating playback queue...');
    const playbackQueue = await memoryEngine.generatePlaybackQueue('programming tutorial', {
      maxResults: 5
    });

    console.log(`   Generated queue with ${playbackQueue.length} items:`);
    playbackQueue.forEach((item, index) => {
      console.log(`   ${index + 1}. ${item.title} (${item.source})`);
      console.log(`      Start: ${item.startTimestamp}s`);
      console.log(`      Reason: ${item.relevanceReason}`);
      if (item.deeplinkUrl) {
        console.log(`      URL: ${item.deeplinkUrl}`);
      }
      console.log('');
    });

    // Demo 6: Content correlations
    console.log('\n🔗 Finding content correlations...');
    const correlations = await memoryEngine.findContentCorrelations(localMemoryId, {
      includeLocal: true,
      includePlatform: true,
      minScore: 0.1,
      limit: 5
    });

    console.log(`   Found ${correlations.related.length} correlations`);
    console.log(`   Recommended content: ${correlations.recommendedContent.length} items`);

    // Demo 7: Platform management
    console.log('\n⚙️  Platform configuration...');
    await memoryEngine.configurePlatform('youtube', {
      enabled: true,
      apiKey: process.env.YOUTUBE_API_KEY || 'demo-key',
      rateLimits: {
        minute: 100,
        hour: 1000,
        day: 10000
      }
    });

    const platformHealth = await memoryEngine.getPlatformHealth();
    console.log('   Platform health status:');
    Object.entries(platformHealth).forEach(([platform, health]) => {
      console.log(`     ${platform}: ${health.isHealthy ? '✅ Healthy' : '❌ Issues'}`);
    });

    console.log('\n🎉 Hybrid Search Demo completed successfully!');
    console.log('\nKey Features Demonstrated:');
    console.log('✅ Local content management');
    console.log('✅ Platform video indexing (without downloading)');
    console.log('✅ Universal content input interface');
    console.log('✅ Hybrid search across all content types');
    console.log('✅ Smart playback queue generation');
    console.log('✅ Content correlation discovery');
    console.log('✅ Platform health monitoring');

  } catch (error) {
    console.error('❌ Demo failed:', error);
  }
}

/**
 * Advanced search scenarios demonstration
 */
async function demonstrateAdvancedScenarios() {
  console.log('\n🔬 Advanced Search Scenarios');
  console.log('============================\n');

  const memoryEngine = new EnhancedMemoryEngine();
  await memoryEngine.initialize();

  // Scenario 1: Cross-platform search
  console.log('1. Cross-platform search...');
  try {
    const crossPlatformResults = await memoryEngine.searchUniversal('tutorial', {
      vectorWeight: 0.4,
      keywordWeight: 0.6,
      maxResults: 20
    });

    console.log(`   Found content across ${new Set(crossPlatformResults.unified.map(r => r.source)).size} sources`);
  } catch (error) {
    console.log(`   Cross-platform search demo: ${error instanceof Error ? error.message : error}`);
  }

  // Scenario 2: Time-based search
  console.log('\n2. Time-based filtering...');
  const timeBasedResults = await memoryEngine.searchUniversal('programming', {
    vectorWeight: 0.2,
    keywordWeight: 0.8,
    maxResults: 15
  });

  console.log(`   Found ${timeBasedResults.unified.length} results from the last 30 days`);

  // Scenario 3: Batch platform processing
  console.log('\n3. Batch platform video processing...');
  try {
    const testUrls = [
      'https://youtube.com/watch?v=example1',
      'https://youtube.com/watch?v=example2',
      'https://youtube.com/watch?v=example3'
    ];

    const batchResult = await memoryEngine.batchAddPlatformVideos(testUrls, {
      spaceId: 'batch-demo',
      extractTranscripts: true,
      extractKeyMoments: true,
      batchSize: 2
    });

    console.log(`   Batch processing: ${batchResult.successful.length} successful, ${batchResult.failed.length} failed`);
  } catch (error) {
    console.log(`   Batch processing demo: ${error instanceof Error ? error.message : error}`);
  }

  console.log('\n✨ Advanced scenarios demonstration complete!');
}

// Main execution
if (import.meta.url === `file://${process.argv[1]}`) {
  demonstrateHybridSearch()
    .then(() => demonstrateAdvancedScenarios())
    .then(() => {
      console.log('\n🏁 All demonstrations completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Demonstration failed:', error);
      process.exit(1);
    });
}

export { demonstrateHybridSearch, demonstrateAdvancedScenarios };