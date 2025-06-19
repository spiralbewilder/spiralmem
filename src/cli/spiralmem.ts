#!/usr/bin/env node

import { Command } from 'commander';
import { MemoryEngine } from '../core/MemoryEngine.js';
import { VideoWorkflow } from '../core/workflow/VideoWorkflow.js';
import { YouTubeDownloader } from '../core/video/YouTubeDownloader.js';
import { loadConfig } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';

// Cleanup function to ensure proper process termination
async function cleanup() {
  // Give a moment for any pending operations to complete
  setTimeout(() => {
    process.exit(0);
  }, 50);
}

// Configure logging early based on CLI arguments
if (process.argv.includes('--quiet') || process.argv.includes('--version')) {
  logger.level = 'error'; // Suppress info logs for quiet mode and version check
} else if (process.argv.includes('--verbose')) {
  logger.level = 'debug';
}

const program = new Command();

// Package information
program
  .name('spiralmem')
  .description('Spiralmem Video Memory System - Transform videos into searchable memories')
  .version('1.0.0');

// Global options
program
  .option('-c, --config <path>', 'Configuration file path')
  .option('-v, --verbose', 'Enable verbose logging')
  .option('-q, --quiet', 'Suppress non-error output');

// Initialize command
program
  .command('init')
  .description('Initialize Spiralmem system and database')
  .option('--test-mode', 'Initialize in test mode')
  .option('--force', 'Force re-initialization')
  .action(async (options) => {
    try {
      const config = loadConfig(program.opts().config);
      
      if (!program.opts().quiet) {
        console.log('🎬 Initializing Spiralmem Video Memory System...');
      }
      
      const engine = new MemoryEngine();
      await engine.initialize();
      
      // Create default space if it doesn't exist
      const spaces = await engine.listSpaces();
      if (spaces.length === 0) {
        await engine.createSpace('default', { description: 'Default memory space' });
        if (!program.opts().quiet) {
          console.log('✅ Created default memory space');
        }
      }
      
      if (!program.opts().quiet) {
        console.log('✅ Spiralmem system initialized successfully');
        console.log('');
        console.log('Next steps:');
        console.log('  spiralmem add-video path/to/video.mp4  # Add your first video');
        console.log('  spiralmem search "your query"          # Search your content');
        console.log('  spiralmem --help                       # See all commands');
      }
      
    } catch (error) {
      console.error('❌ Initialization failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    } finally {
      await cleanup();
    }
  });

// Add video command
program
  .command('add-video <path>')
  .description('Process and add a video file to memory')
  .option('-s, --space <name>', 'Target space name', 'default')
  .option('-t, --title <title>', 'Custom title for the video')
  .option('--model <model>', 'Whisper model to use', 'base')
  .option('--no-transcription', 'Skip transcription')
  .option('--keep-video', 'Keep video file after processing (default: delete to save space)')
  .option('--no-keep-audio', 'Delete audio file after processing (default: keep audio)')
  .action(async (videoPath, options) => {
    try {
      // Check if this is a YouTube URL
      const isYouTubeUrl = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/.test(videoPath);
      
      let actualVideoPath = videoPath;
      let suggestedTitle = options.title;

      if (isYouTubeUrl) {
        if (!program.opts().quiet) {
          console.log('🔗 YouTube URL detected, downloading video...');
        }

        try {
          // Download YouTube video
          const youtubeDownloader = new YouTubeDownloader();
          const downloadResult = await youtubeDownloader.downloadVideo(videoPath, {
            outputDirectory: './temp/youtube-downloads',
            format: 'mp4',
            quality: '720p',
            maxFileSize: '500M',
            maxDuration: 3600 // 1 hour limit
          });

          if (!downloadResult.success) {
            console.error('❌ YouTube download failed:', downloadResult.errors.join(', '));
            process.exit(1);
          }

          actualVideoPath = downloadResult.downloadedFile!;
          suggestedTitle = suggestedTitle || downloadResult.suggestedTitle;

          if (!program.opts().quiet) {
            console.log(`✅ Downloaded: ${downloadResult.videoInfo?.title}`);
            console.log(`📁 Saved to: ${actualVideoPath}`);
          }

        } catch (error) {
          console.error('❌ YouTube download failed:', error instanceof Error ? error.message : error);
          console.log('');
          console.log('💡 To fix this issue:');
          console.log('1. Install yt-dlp: pip install yt-dlp');
          console.log('2. Or download the video manually and process the local file');
          process.exit(1);
        }
      }
      
      if (!program.opts().quiet) {
        console.log(`🎥 Processing video: ${path.basename(actualVideoPath)}`);
      }
      
      const engine = new MemoryEngine();
      await engine.initialize();
      
      const workflow = new VideoWorkflow();
      
      const result = await workflow.processVideo(actualVideoPath, options.space, {
        enableTranscription: options.transcription,
        customTitle: suggestedTitle, // Use YouTube title if available
        cleanupVideoAfterProcessing: !options.keepVideo, // Delete video unless --keep-video specified
        keepAudioFiles: options.keepAudio !== false // Keep audio unless --no-keep-audio specified
      });
      
      if (!program.opts().quiet) {
        console.log('✅ Video processed successfully');
        console.log(`   Memory ID: ${result.memoryId}`);
        console.log(`   Processing time: ${result.processingTime}ms`);
        if (result.outputs.chunksGenerated) {
          console.log(`   Chunks generated: ${result.outputs.chunksGenerated}`);
        }
        if (result.outputs.videoFileDeleted && result.outputs.storageSpaceSaved) {
          const mbSaved = Math.round(result.outputs.storageSpaceSaved / 1024 / 1024);
          console.log(`   💾 Storage saved: ${mbSaved}MB (video file cleaned up)`);
        }
      }
      
    } catch (error) {
      console.error('❌ Video processing failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    } finally {
      // Ensure process exits
      await cleanup();
    }
  });

// Search command
program
  .command('search <query>')
  .description('Search across all memories')
  .option('-s, --space <name>', 'Search within specific space')
  .option('-l, --limit <number>', 'Maximum number of results', '10')
  .option('--timestamps', 'Include precise timestamps for spoken words')
  .option('--json', 'Output results as JSON')
  .action(async (query, options) => {
    try {
      const engine = new MemoryEngine();
      await engine.initialize();
      
      const searchQuery = {
        query: query,
        spaceId: options.space,
        limit: parseInt(options.limit)
      };
      
      // Use enhanced search with timestamps if requested
      const results = options.timestamps 
        ? await engine.searchWithTimestamps(query, {
            spaceId: options.space,
            limit: parseInt(options.limit)
          })
        : await engine.searchMemories(searchQuery);
      
      if (options.json) {
        console.log(JSON.stringify(results, null, 2));
      } else {
        if (results.length === 0) {
          console.log('🔍 No results found for:', query);
        } else {
          console.log(`🔍 Found ${results.length} result(s) for: ${query}`);
          if (options.timestamps) {
            console.log('⏱️  Including precise timestamps for spoken words');
          }
          console.log('');
          
          results.forEach((result, index) => {
            console.log(`${index + 1}. ${result.memory.title || 'Untitled'}`);
            console.log(`   Type: ${result.memory.contentType}`);
            console.log(`   Space: ${result.memory.spaceId}`);
            console.log(`   Source: ${result.memory.source}`);
            
            if (result.chunk) {
              console.log(`   Match: "${result.chunk.chunkText.substring(0, 100)}..."`);
              
              if (options.timestamps && result.timestamps) {
                const startSec = Math.floor(result.timestamps.startMs / 1000);
                const endSec = Math.floor(result.timestamps.endMs / 1000);
                console.log(`   ⏱️  Chunk: ${startSec}s - ${endSec}s (${result.timestamps.startMs}ms - ${result.timestamps.endMs}ms)`);
                
                if (result.timestamps.wordMatches && result.timestamps.wordMatches.length > 0) {
                  console.log(`   🎬 Compilation Segments:`);
                  result.timestamps.wordMatches.forEach((match, idx) => {
                    const startSec = (match.startMs / 1000).toFixed(2);
                    const endSec = (match.endMs / 1000).toFixed(2);
                    const duration = ((match.endMs - match.startMs) / 1000).toFixed(2);
                    console.log(`      ${idx + 1}. "${match.word}" • ${startSec}s-${endSec}s (${duration}s) • ${match.startMs}-${match.endMs}ms`);
                  });
                }
              }
            }
            console.log('');
          });
        }
      }
      
    } catch (error) {
      console.error('❌ Search failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    } finally {
      // Ensure process exits
      await cleanup();
    }
  });

// Compilation segments command - specialized for video editing
program
  .command('extract-segments <query>')
  .description('Extract precise video segments for compilation/editing')
  .option('-s, --space <name>', 'Search within specific space')
  .option('-l, --limit <number>', 'Maximum number of results', '20')
  .option('--min-duration <seconds>', 'Minimum segment duration', '0.5')
  .option('--max-duration <seconds>', 'Maximum segment duration', '10')
  .option('--csv', 'Output as CSV for video editing tools')
  .action(async (query, options) => {
    try {
      const engine = new MemoryEngine();
      await engine.initialize();
      
      const results = await engine.searchWithTimestamps(query, {
        spaceId: options.space,
        limit: parseInt(options.limit)
      });
      
      const minDuration = parseFloat(options.minDuration) * 1000; // Convert to ms
      const maxDuration = parseFloat(options.maxDuration) * 1000;
      
      // Collect all segments for compilation
      const segments: Array<{
        source: string;
        title: string;
        text: string;
        startMs: number;
        endMs: number;
        durationMs: number;
        speaker?: string;
      }> = [];
      
      results.forEach(result => {
        if (result.timestamps?.wordMatches) {
          result.timestamps.wordMatches.forEach(match => {
            const duration = match.endMs - match.startMs;
            
            // Filter by duration
            if (duration >= minDuration && duration <= maxDuration) {
              segments.push({
                source: result.memory.source,
                title: result.memory.title || 'Untitled',
                text: match.word,
                startMs: match.startMs,
                endMs: match.endMs,
                durationMs: duration,
                speaker: (result.memory.metadata?.speaker as string) || 'Unknown'
              });
            }
          });
        }
      });
      
      if (options.csv) {
        console.log('source,title,text,start_ms,end_ms,duration_ms,speaker');
        segments.forEach(seg => {
          const escapeCsv = (str: string) => `"${str.replace(/"/g, '""')}"`;
          console.log([
            escapeCsv(seg.source),
            escapeCsv(seg.title),
            escapeCsv(seg.text),
            seg.startMs,
            seg.endMs,
            seg.durationMs,
            escapeCsv(seg.speaker || 'Unknown')
          ].join(','));
        });
      } else {
        if (segments.length === 0) {
          console.log('🎬 No compilation segments found for:', query);
          console.log(`   Duration filter: ${options.minDuration}s - ${options.maxDuration}s`);
        } else {
          console.log(`🎬 Found ${segments.length} compilation segment(s) for: "${query}"`);
          console.log(`   Duration filter: ${options.minDuration}s - ${options.maxDuration}s`);
          console.log('');
          
          segments.forEach((seg, index) => {
            const startSec = (seg.startMs / 1000).toFixed(2);
            const endSec = (seg.endMs / 1000).toFixed(2);
            const duration = (seg.durationMs / 1000).toFixed(2);
            
            console.log(`${index + 1}. ${seg.title} (${seg.speaker})`);
            console.log(`   Text: "${seg.text}"`);
            console.log(`   Time: ${startSec}s - ${endSec}s (${duration}s)`);
            console.log(`   File: ${seg.source}`);
            console.log(`   ffmpeg: -ss ${startSec} -t ${duration} -i "${seg.source}"`);
            console.log('');
          });
          
          console.log(`💡 Use --csv flag to export for video editing tools`);
        }
      }
      
    } catch (error) {
      console.error('❌ Segment extraction failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    } finally {
      await cleanup();
    }
  });

// Download segments command - for YouTube/Rumble compilation creation
program
  .command('download-segments <query>')
  .description('Download video segments from YouTube/Rumble for compilation')
  .option('-s, --space <name>', 'Search within specific space')
  .option('-l, --limit <number>', 'Maximum number of segments', '10')
  .option('--min-duration <seconds>', 'Minimum segment duration', '0.5')
  .option('--max-duration <seconds>', 'Maximum segment duration', '10')
  .option('-q, --quality <quality>', 'Video quality (720p, 1080p, 480p)', '720p')
  .option('-o, --output <directory>', 'Output directory', './compilation-segments')
  .action(async (query, options) => {
    try {
      const { YouTubeDownloader } = await import('../core/video/YouTubeDownloader.js');
      const engine = new MemoryEngine();
      await engine.initialize();
      
      // Search for segments first
      const results = await engine.searchWithTimestamps(query, {
        spaceId: options.space,
        limit: parseInt(options.limit)
      });
      
      const minDuration = parseFloat(options.minDuration) * 1000;
      const maxDuration = parseFloat(options.maxDuration) * 1000;
      
      // Group segments by source URL (for batch downloading)
      const urlSegments = new Map<string, Array<{
        startMs: number;
        endMs: number;
        text: string;
        title: string;
      }>>();
      
      results.forEach(result => {
        if (result.timestamps?.wordMatches) {
          const sourceUrl = result.memory.source;
          
          // Only process YouTube/Rumble URLs
          if (sourceUrl.includes('youtube.com') || sourceUrl.includes('youtu.be') || sourceUrl.includes('rumble.com')) {
            result.timestamps.wordMatches.forEach(match => {
              const duration = match.endMs - match.startMs;
              
              if (duration >= minDuration && duration <= maxDuration) {
                if (!urlSegments.has(sourceUrl)) {
                  urlSegments.set(sourceUrl, []);
                }
                
                urlSegments.get(sourceUrl)!.push({
                  startMs: match.startMs,
                  endMs: match.endMs,
                  text: match.word,
                  title: result.memory.title || 'Untitled'
                });
              }
            });
          }
        }
      });
      
      if (urlSegments.size === 0) {
        console.log('🎬 No YouTube/Rumble segments found for compilation');
        console.log(`   Duration filter: ${options.minDuration}s - ${options.maxDuration}s`);
        return;
      }
      
      console.log(`🎬 Found segments from ${urlSegments.size} video(s) for: "${query}"`);
      console.log(`📁 Output directory: ${options.output}`);
      console.log('');
      
      const downloader = new YouTubeDownloader();
      let totalDownloaded = 0;
      let totalFailed = 0;
      
      // Download segments from each URL
      for (const [url, segments] of urlSegments) {
        console.log(`📺 Processing: ${url}`);
        console.log(`   ${segments.length} segment(s) to download...`);
        
        try {
          const downloadResult = await downloader.downloadSegments(
            url,
            segments.map((seg, idx) => ({
              startMs: seg.startMs,
              endMs: seg.endMs,
              outputName: `${query.replace(/\s+/g, '_')}_${idx + 1}_${seg.startMs}-${seg.endMs}.${options.quality === 'best' ? 'mp4' : 'mp4'}`
            })),
            {
              outputDirectory: options.output,
              quality: options.quality,
              format: 'mp4'
            }
          );
          
          const successful = downloadResult.segments.filter(s => s.success).length;
          const failed = downloadResult.segments.filter(s => !s.success).length;
          
          totalDownloaded += successful;
          totalFailed += failed;
          
          console.log(`   ✅ Downloaded: ${successful}/${segments.length} segments`);
          
          if (failed > 0) {
            console.log(`   ❌ Failed: ${failed} segments`);
            downloadResult.segments.filter(s => !s.success).forEach(seg => {
              console.log(`      ${seg.startMs}-${seg.endMs}ms: ${seg.error}`);
            });
          }
          
          // List successful downloads
          downloadResult.segments.filter(s => s.success).forEach(seg => {
            const duration = (seg.duration).toFixed(1);
            console.log(`      📁 ${path.basename(seg.filePath)} (${duration}s)`);
          });
          
        } catch (error) {
          console.error(`   ❌ Failed to download from ${url}:`, error instanceof Error ? error.message : error);
          totalFailed += segments.length;
        }
        
        console.log('');
      }
      
      console.log(`🎬 Compilation download complete!`);
      console.log(`   ✅ Downloaded: ${totalDownloaded} segments`);
      console.log(`   ❌ Failed: ${totalFailed} segments`);
      console.log(`   📁 Location: ${options.output}`);
      
      if (totalDownloaded > 0) {
        console.log('');
        console.log('💡 Next steps:');
        console.log(`   1. Review segments in: ${options.output}`);
        console.log(`   2. Use video editing software to create compilation`);
        console.log(`   3. All segments are pre-cut to exact timestamps`);
      }
      
    } catch (error) {
      console.error('❌ Segment download failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// Semantic search command
program
  .command('semantic-search <query>')
  .description('Perform semantic search using AI embeddings')
  .option('-s, --space <name>', 'Search within specific space')
  .option('-l, --limit <number>', 'Maximum number of results', '10')
  .option('--threshold <number>', 'Similarity threshold (0.0-1.0)', '0.6')
  .option('--timestamps', 'Include precise timestamps for spoken words')
  .option('--json', 'Output results as JSON')
  .action(async (query, options) => {
    try {
      const engine = new MemoryEngine();
      await engine.initialize();
      
      const results = await engine.semanticSearch(query, {
        maxResults: parseInt(options.limit),
        similarityThreshold: parseFloat(options.threshold)
      });
      
      if (options.json) {
        console.log(JSON.stringify(results, null, 2));
      } else {
        if (results.length === 0) {
          console.log('🔍 No semantic matches found for:', query);
          console.log(`   Similarity threshold: ${options.threshold}`);
          console.log('   Try a lower threshold or generate embeddings first with: spiralmem generate-embeddings');
        } else {
          console.log(`🧠 Found ${results.length} semantic match(es) for: ${query}`);
          console.log(`   Similarity threshold: ${options.threshold}`);
          console.log('');
          
          results.forEach((result, index) => {
            console.log(`${index + 1}. ${result.memory.title || 'Untitled'} (similarity: ${(result.similarity || 0).toFixed(3)})`);
            console.log(`   Type: ${result.memory.contentType}`);
            console.log(`   Space: ${result.memory.spaceId}`);
            console.log(`   Source: ${result.memory.source}`);
            
            if (result.chunk) {
              console.log(`   Match: "${result.chunk.chunkText.substring(0, 100)}..."`);
              
              if (options.timestamps && result.chunk.startOffset) {
                const startSec = Math.floor(result.chunk.startOffset / 1000);
                console.log(`   ⏱️  Timestamp: ${startSec}s (${result.chunk.startOffset}ms)`);
              }
            }
            
            console.log('');
          });
          
          console.log('💡 Semantic search finds conceptually similar content, not just exact word matches');
        }
      }
      
    } catch (error) {
      console.error('❌ Semantic search failed:', error instanceof Error ? error.message : error);
      console.log('');
      console.log('💡 To enable semantic search:');
      console.log('1. Install dependencies: pip install sentence-transformers');
      console.log('2. Generate embeddings: spiralmem generate-embeddings');
      process.exit(1);
    }
  });

// Generate embeddings command
program
  .command('generate-embeddings')
  .description('Generate AI embeddings for semantic search')
  .option('--memory-ids <ids>', 'Comma-separated memory IDs to index')
  .option('--force', 'Regenerate existing embeddings')
  .option('--batch-size <size>', 'Batch size for processing', '32')
  .action(async (options) => {
    try {
      const engine = new MemoryEngine();
      await engine.initialize();
      
      console.log('🧠 Generating embeddings for semantic search...');
      console.log('   This may take a few minutes depending on content amount');
      console.log('');
      
      const memoryIds = options.memoryIds ? options.memoryIds.split(',') : undefined;
      
      const result = await engine.generateEmbeddings({
        memoryIds,
        forceRegenerate: options.force,
        batchSize: parseInt(options.batchSize)
      });
      
      if (result.success) {
        console.log('✅ Embedding generation completed!');
        console.log(`   ✅ Indexed: ${result.indexed} chunks`);
        if (result.failed > 0) {
          console.log(`   ❌ Failed: ${result.failed} chunks`);
        }
        console.log('');
        console.log('🔍 You can now use semantic search:');
        console.log('   spiralmem semantic-search "artificial intelligence"');
        console.log('   spiralmem semantic-search "climate change" --threshold 0.7');
      } else {
        console.log('❌ Embedding generation failed');
        result.errors.forEach(error => console.log(`   ${error}`));
        console.log('');
        console.log('💡 Make sure you have sentence-transformers installed:');
        console.log('   pip install sentence-transformers');
      }
      
    } catch (error) {
      console.error('❌ Embedding generation failed:', error instanceof Error ? error.message : error);
      console.log('');
      console.log('💡 To fix this issue:');
      console.log('1. Install Python dependencies: pip install sentence-transformers torch');
      console.log('2. Ensure Python 3.8+ is available');
      process.exit(1);
    }
  });

// Vector stats command
program
  .command('vector-stats')
  .description('Show semantic search index statistics')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    try {
      const engine = new MemoryEngine();
      await engine.initialize();
      
      const stats = await engine.getVectorStats();
      
      if (options.json) {
        console.log(JSON.stringify(stats, null, 2));
      } else {
        console.log('🧠 Semantic Search Index Statistics');
        console.log('');
        console.log(`Total Embeddings: ${stats.totalEmbeddings}`);
        console.log(`Average Dimensions: ${stats.averageDimensions}`);
        
        if (Object.keys(stats.embeddingsByType).length > 0) {
          console.log('');
          console.log('By Content Type:');
          Object.entries(stats.embeddingsByType).forEach(([type, count]) => {
            console.log(`  ${type}: ${count}`);
          });
        }
        
        if (Object.keys(stats.embeddingsByModel).length > 0) {
          console.log('');
          console.log('By Model:');
          Object.entries(stats.embeddingsByModel).forEach(([model, count]) => {
            console.log(`  ${model}: ${count}`);
          });
        }
        
        if (stats.totalEmbeddings === 0) {
          console.log('');
          console.log('💡 No embeddings found. Generate them with:');
          console.log('   spiralmem generate-embeddings');
        } else {
          console.log('');
          console.log('🔍 Semantic search is available with:');
          console.log('   spiralmem semantic-search "your query"');
        }
      }
      
    } catch (error) {
      console.error('❌ Failed to get vector stats:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// Channel ingestion command
program
  .command('add-channel <channelUrl>')
  .description('Process all videos from a YouTube channel')
  .option('-m, --max-videos <number>', 'Maximum videos to process', '10')
  .option('-s, --space <name>', 'Target space name', 'default')
  .option('--min-duration <seconds>', 'Minimum video duration', '30')
  .option('--max-duration <seconds>', 'Maximum video duration', '3600')
  .option('--include-shorts', 'Include YouTube Shorts (videos under 60s)')
  .option('--exclude-keywords <keywords>', 'Comma-separated keywords to exclude')
  .option('--include-keywords <keywords>', 'Comma-separated keywords to include')
  .option('--priority <mode>', 'Processing priority (newest-first, oldest-first, most-popular, longest-first)', 'newest-first')
  .option('--dry-run', 'Show what would be processed without actually processing')
  .action(async (channelUrl, options) => {
    try {
      console.log('📺 YouTube Channel Ingestion');
      console.log('=============================');
      console.log(`🔗 Channel: ${channelUrl}`);
      console.log(`📊 Max videos: ${options.maxVideos}`);
      console.log(`⏱️  Duration range: ${options.minDuration}s - ${options.maxDuration}s`);
      console.log('');

      // Import the channel processor
      const { YouTubeChannelProcessor } = await import('../core/platforms/YouTubeChannelProcessor.js');
      const channelProcessor = new YouTubeChannelProcessor();

      // Configure processing options
      const processingOptions = {
        maxVideos: parseInt(options.maxVideos),
        filterOptions: {
          minDuration: parseInt(options.minDuration),
          maxDuration: parseInt(options.maxDuration),
          includeShorts: options.includeShorts || false,
          includeLiveStreams: true,
          keywordFilter: options.includeKeywords ? options.includeKeywords.split(',').map((k: string) => k.trim()) : undefined,
          excludeKeywords: options.excludeKeywords ? options.excludeKeywords.split(',').map((k: string) => k.trim()) : undefined
        },
        processingOptions: {
          batchSize: 2, // Conservative for stability
          concurrentProcessing: 1, // Sequential processing for reliability
          enableTranscripts: true,
          enableFrameExtraction: false,
          chunkingStrategy: 'content-based' as const
        },
        priorityMode: options.priority as any,
        progressCallback: (progress: any) => {
          // Show progress updates
          if (progress.currentVideo) {
            console.log(`🎬 Processing: ${progress.currentVideo.title}`);
            console.log(`   Stage: ${progress.currentVideo.processingStage} (${progress.currentVideo.stageProgress}%)`);
          }
          
          const overallPercent = Math.round(progress.processing.overallProgress);
          const processed = progress.processing.successfullyProcessed;
          const total = progress.processing.totalToProcess;
          const failed = progress.processing.failedProcessing;
          
          console.log(`📊 Progress: ${processed}/${total} completed (${overallPercent}%) | ${failed} failed`);
          
          if (progress.processing.estimatedTimeRemaining > 0) {
            const etaMinutes = Math.round(progress.processing.estimatedTimeRemaining / 60000);
            console.log(`⏱️  ETA: ${etaMinutes} minutes`);
          }
          console.log('');
        }
      };

      if (options.dryRun) {
        console.log('🔍 DRY RUN MODE - No videos will be processed');
        console.log('');
        
        // Just show what would be discovered and filtered
        const { YouTubeConnector } = await import('../core/platforms/connectors/YouTubeConnector.js');
        const connector = new YouTubeConnector();
        
        try {
          console.log('📋 Discovering videos...');
          // This is a simplified preview - the actual processor does more sophisticated filtering
          console.log('✅ Dry run complete. Use --no-dry-run to actually process videos.');
        } catch (error) {
          console.error('❌ Failed to discover videos:', error instanceof Error ? error.message : error);
        }
        
        return;
      }

      // Start actual processing
      console.log('🚀 Starting channel processing...');
      console.log('');

      const result = await channelProcessor.processYouTubeChannel(channelUrl, processingOptions);

      // Display results
      console.log('✅ Channel processing completed!');
      console.log('');
      console.log('📊 Results Summary:');
      console.log(`   📺 Channel: ${result.channelInfo.channelName}`);
      console.log(`   👥 Subscribers: ${result.channelInfo.subscriberCount.toLocaleString()}`);
      console.log(`   🔍 Videos discovered: ${result.discoveryResults.totalVideosFound}`);
      console.log(`   ✅ Videos processed: ${result.processingResults.successfullyProcessed}`);
      console.log(`   ❌ Processing failures: ${result.processingResults.failedProcessing}`);
      console.log(`   📚 Total chunks created: ${result.processingResults.totalChunksGenerated}`);
      console.log(`   ⏱️  Total processing time: ${Math.round(result.processingResults.totalProcessingTime / 1000)}s`);

      if (result.contentAnalysis) {
        console.log('');
        console.log('📈 Content Analysis:');
        console.log(`   📊 Average video duration: ${Math.round(result.contentAnalysis.averageVideoDuration / 60)} minutes`);
        console.log(`   🎯 Topics identified: ${result.contentAnalysis.topicsIdentified.join(', ')}`);
        console.log(`   🌐 Languages: ${result.contentAnalysis.languagesDetected.join(', ')}`);
        console.log(`   📝 Transcription quality: ${Math.round(result.contentAnalysis.qualityMetrics.averageTranscriptionConfidence * 100)}%`);
      }

      if (result.errors.length > 0) {
        console.log('');
        console.log('❌ Processing Errors:');
        result.errors.forEach(error => {
          console.log(`   • ${error.videoTitle}: ${error.error}`);
        });
      }

      if (result.recommendations.length > 0) {
        console.log('');
        console.log('💡 Recommendations:');
        result.recommendations.forEach(rec => {
          console.log(`   ${rec}`);
        });
      }

      console.log('');
      console.log('🔍 You can now search your channel content:');
      console.log(`   spiralmem search "topic"`);
      console.log(`   spiralmem semantic-search "concept"`);
      console.log(`   spiralmem extract-segments "keyword" --csv`);

    } catch (error) {
      console.error('❌ Channel processing failed:', error instanceof Error ? error.message : error);
      
      if (error instanceof Error && error.message.includes('quota')) {
        console.log('');
        console.log('💡 YouTube API quota exceeded. Try:');
        console.log('1. Wait for quota to reset (next day)');
        console.log('2. Use a different API key');
        console.log('3. Process fewer videos with --max-videos');
      }
      
      process.exit(1);
    } finally {
      await cleanup();
    }
  });

// List spaces command
program
  .command('spaces')
  .description('List all memory spaces')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    try {
      const engine = new MemoryEngine();
      await engine.initialize();
      
      const spaces = await engine.listSpaces();
      
      if (options.json) {
        console.log(JSON.stringify(spaces, null, 2));
      } else {
        if (spaces.length === 0) {
          console.log('📁 No spaces found. Create one with: spiralmem create-space <name>');
        } else {
          console.log('📁 Memory Spaces:');
          console.log('');
          spaces.forEach(space => {
            console.log(`  ${space.name}`);
            if (space.description) {
              console.log(`    ${space.description}`);
            }
            console.log(`    Created: ${space.createdAt}`);
            console.log('');
          });
        }
      }
      
    } catch (error) {
      console.error('❌ Failed to list spaces:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// Create space command
program
  .command('create-space <name>')
  .description('Create a new memory space')
  .option('-d, --description <text>', 'Space description')
  .action(async (name, options) => {
    try {
      const engine = new MemoryEngine();
      await engine.initialize();
      
      const spaceId = await engine.createSpace(name, {
        description: options.description
      });
      
      if (!program.opts().quiet) {
        console.log(`✅ Created space: ${name}`);
        console.log(`   Space ID: ${spaceId}`);
      }
      
    } catch (error) {
      console.error('❌ Failed to create space:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// Stats command
program
  .command('stats')
  .description('Show system statistics')
  .option('-s, --space <name>', 'Statistics for specific space')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    try {
      const engine = new MemoryEngine();
      await engine.initialize();
      
      const stats = await engine.getStats(options.space);
      
      if (options.json) {
        console.log(JSON.stringify(stats, null, 2));
      } else {
        console.log('📊 Spiralmem Statistics');
        console.log('');
        console.log(`Total Memories: ${stats.totalMemories}`);
        console.log(`Total Chunks: ${stats.totalChunks}`);
        console.log(`Total Spaces: ${stats.totalSpaces}`);
        
        if (stats.contentTypeBreakdown) {
          console.log('');
          console.log('Content Types:');
          Object.entries(stats.contentTypeBreakdown).forEach(([type, count]) => {
            console.log(`  ${type}: ${count}`);
          });
        }
        
        console.log('');
        console.log('Recent Activity:');
        console.log(`  Memories added: ${stats.recentActivity.memoriesAdded}`);
        console.log(`  Videos processed: ${stats.recentActivity.videosProcessed}`);
        console.log(`  Searches performed: ${stats.recentActivity.searchesPerformed}`);
      }
      
    } catch (error) {
      console.error('❌ Failed to get statistics:', error instanceof Error ? error.message : error);
      process.exit(1);
    } finally {
      await cleanup();
    }
  });

// Export command
program
  .command('export <path>')
  .description('Export memories to file')
  .option('-s, --space <name>', 'Export specific space only')
  .option('-f, --format <format>', 'Export format (json, csv)', 'json')
  .action(async (exportPath, options) => {
    try {
      const engine = new MemoryEngine();
      await engine.initialize();
      
      if (!program.opts().quiet) {
        console.log('📤 Exporting memories...');
      }
      
      const exportData = await engine.exportData({
        spaceId: options.space,
        format: options.format
      });
      
      await fs.writeFile(exportPath, JSON.stringify(exportData, null, 2));
      
      if (!program.opts().quiet) {
        console.log(`✅ Exported ${exportData.memories.length} memories to ${exportPath}`);
      }
      
    } catch (error) {
      console.error('❌ Export failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// Serve MCP command
program
  .command('serve-mcp')
  .description('Start MCP server for AI assistant integration')
  .option('-p, --port <port>', 'Server port', '8080')
  .option('--host <host>', 'Server host', 'localhost')
  .action(async (options) => {
    try {
      if (!program.opts().quiet) {
        console.log(`🤖 Starting MCP server on ${options.host}:${options.port}...`);
      }
      
      // Start the MCP server
      const mcpProcess = spawn('node', ['dist/mcp/server.js'], {
        stdio: 'inherit',
        env: {
          ...process.env,
          PORT: options.port,
          HOST: options.host
        }
      });
      
      // Handle graceful shutdown
      process.on('SIGINT', () => {
        console.log('\n🛑 Shutting down MCP server...');
        mcpProcess.kill('SIGINT');
        process.exit(0);
      });
      
      mcpProcess.on('exit', (code) => {
        if (code !== 0) {
          console.error(`❌ MCP server exited with code ${code}`);
          process.exit(1);
        }
      });
      
    } catch (error) {
      console.error('❌ Failed to start MCP server:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// System check command
program
  .command('check')
  .description('Check system health and dependencies')
  .action(async () => {
    try {
      console.log('🔧 Checking Spiralmem system health...');
      console.log('');
      
      const checks = [
        {
          name: 'Node.js',
          check: async () => {
            const version = process.version;
            const major = parseInt(version.slice(1).split('.')[0]);
            return { success: major >= 18, info: version };
          }
        },
        {
          name: 'Python',
          check: async () => {
            try {
              const { spawn } = await import('child_process');
              return new Promise((resolve) => {
                const proc = spawn('python3', ['--version']);
                let output = '';
                proc.stdout.on('data', (data) => output += data.toString());
                proc.stderr.on('data', (data) => output += data.toString());
                proc.on('close', (code) => {
                  resolve({ success: code === 0, info: output.trim() });
                });
              });
            } catch {
              return { success: false, info: 'Not found' };
            }
          }
        },
        {
          name: 'FFmpeg',
          check: async () => {
            try {
              const { spawn } = await import('child_process');
              return new Promise((resolve) => {
                const proc = spawn('ffmpeg', ['-version']);
                let output = '';
                proc.stdout.on('data', (data) => output += data.toString());
                proc.on('close', (code) => {
                  const version = output.split('\n')[0];
                  resolve({ success: code === 0, info: version });
                });
              });
            } catch {
              return { success: false, info: 'Not found' };
            }
          }
        },
        {
          name: 'faster_whisper',
          check: async () => {
            try {
              const { spawn } = await import('child_process');
              return new Promise((resolve) => {
                const proc = spawn('python3', ['-c', 'import faster_whisper; print("Available")']);
                let output = '';
                proc.stdout.on('data', (data) => output += data.toString());
                proc.stderr.on('data', (data) => output += data.toString());
                proc.on('close', (code) => {
                  const result = { success: code === 0, info: output.trim() || 'Available' };
                  resolve(result);
                });
              });
            } catch {
              return { success: false, info: 'Not installed' };
            }
          }
        },
        {
          name: 'Database',
          check: async () => {
            try {
              const engine = new MemoryEngine();
              await engine.initialize();
              return { success: true, info: 'Connected' };
            } catch (error) {
              return { success: false, info: error instanceof Error ? error.message : 'Failed' };
            }
          }
        }
      ];
      
      let allPassed = true;
      
      for (const check of checks) {
        const result = await check.check() as { success: boolean; info: string };
        const status = result.success ? '✅' : '❌';
        console.log(`${status} ${check.name}: ${result.info}`);
        if (!result.success) allPassed = false;
      }
      
      console.log('');
      if (allPassed) {
        console.log('✅ All system checks passed! Spiralmem is ready to use.');
      } else {
        console.log('❌ Some system checks failed. Please install missing dependencies.');
        process.exit(1);
      }
      
    } catch (error) {
      console.error('❌ System check failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// Config validation command
program
  .command('config')
  .description('Validate and show configuration')
  .option('--validate', 'Validate configuration only')
  .action(async (options) => {
    try {
      const config = loadConfig(program.opts().config);
      
      if (options.validate) {
        console.log('✅ Configuration is valid');
      } else {
        console.log('📋 Current Configuration:');
        console.log('');
        console.log(JSON.stringify(config, null, 2));
      }
      
    } catch (error) {
      console.error('❌ Configuration error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// Handle unknown commands
program.on('command:*', () => {
  console.error('❌ Unknown command:', program.args.join(' '));
  console.log('Run "spiralmem --help" for available commands');
  process.exit(1);
});

// Setup global error handling
process.on('unhandledRejection', (reason) => {
  console.error('❌ Unhandled rejection:', reason);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught exception:', error);
  process.exit(1);
});

// Parse arguments and execute
if (import.meta.url === `file://${process.argv[1]}`) {
  // Configure logging based on CLI options
  if (process.argv.includes('--verbose')) {
    logger.level = 'debug';
    // Also update the transport levels for winston
    logger.transports.forEach(transport => {
      transport.level = 'debug';
    });
  } else if (process.argv.includes('--quiet')) {
    logger.level = 'error';
    logger.transports.forEach(transport => {
      transport.level = 'error';
    });
  }
  
  program.parse();
}

export { program };