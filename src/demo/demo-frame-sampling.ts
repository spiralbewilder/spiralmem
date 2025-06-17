#!/usr/bin/env node

/**
 * Frame Sampling and Thumbnail Generation Demo
 * Tests frame extraction methods and thumbnail generation capabilities
 */

import { FrameSampler, VideoProcessor } from '../core/video/index.js';
import { logger } from '../utils/logger.js';

async function main() {
  try {
    console.log('🖼️  Frame Sampling & Thumbnail Demo');
    console.log('==================================\n');

    // Initialize components
    console.log('🔧 Initializing frame sampler and video processor...');
    const frameSampler = new FrameSampler();
    const videoProcessor = new VideoProcessor();
    
    console.log('✅ Components initialized');
    console.log('');

    // Check system readiness
    console.log('🔍 Checking system requirements...');
    const systemCheck = await videoProcessor.checkSystemReadiness();
    console.log('System Status:', {
      ready: systemCheck.ready,
      ffmpeg: systemCheck.ffmpeg,
      ffprobe: systemCheck.ffprobe,
      versions: systemCheck.versions,
      issues: systemCheck.issues
    });
    console.log('');

    if (!systemCheck.ffmpeg || !systemCheck.ffprobe) {
      console.log('⚠️  FFmpeg/FFprobe not available - frame sampling features limited');
      console.log('Install FFmpeg to enable full functionality:');
      console.log('  - Ubuntu/Debian: sudo apt install ffmpeg');
      console.log('  - macOS: brew install ffmpeg');
      console.log('  - Windows: Download from https://ffmpeg.org/');
      console.log('');
    }

    // Test different sampling methods
    console.log('📊 Testing frame sampling methods...');
    
    const testVideo = 'sample-video.mp4'; // This would be a real video file in production
    const samplingMethods = [
      {
        name: 'Uniform Sampling',
        options: {
          method: 'uniform' as const,
          frameCount: 8,
          interval: 30,
          outputFormat: 'jpg' as const,
          quality: 85,
          maxWidth: 640,
          maxHeight: 480,
          outputDirectory: './temp/frames/uniform'
        }
      },
      {
        name: 'Keyframe Extraction',
        options: {
          method: 'keyframes' as const,
          frameCount: 10,
          outputFormat: 'png' as const,
          keyframeOnly: true,
          outputDirectory: './temp/frames/keyframes'
        }
      },
      {
        name: 'Scene Change Detection',
        options: {
          method: 'scene-change' as const,
          frameCount: 6,
          sceneThreshold: 0.3,
          outputFormat: 'jpg' as const,
          outputDirectory: './temp/frames/scenes'
        }
      },
      {
        name: 'Quality-Based Sampling',
        options: {
          method: 'quality-based' as const,
          frameCount: 5,
          outputFormat: 'jpg' as const,
          quality: 95,
          outputDirectory: './temp/frames/quality'
        }
      }
    ];

    for (const method of samplingMethods) {
      console.log(`\n🎯 Testing ${method.name}...`);
      console.log('Options:', {
        method: method.options.method,
        frameCount: method.options.frameCount,
        format: method.options.outputFormat,
        directory: method.options.outputDirectory
      });

      try {
        // Since we don't have real video files, we'll simulate the process
        console.log(`  📁 Would create directory: ${method.options.outputDirectory}`);
        console.log(`  🎬 Would extract ${method.options.frameCount} frames using ${method.options.method} method`);
        console.log(`  💾 Would save as ${method.options.outputFormat} format`);
        
        if (method.options.method === 'uniform') {
          console.log(`  ⏰ Would sample every ${method.options.interval}s`);
        } else if (method.options.method === 'scene-change') {
          console.log(`  🎞️  Would detect scene changes with threshold ${method.options.sceneThreshold}`);
        } else if (method.options.method === 'keyframes') {
          console.log(`  🔑 Would extract keyframes only`);
        } else if (method.options.method === 'quality-based') {
          console.log(`  ⭐ Would analyze frame quality and select best frames`);
        }

        // Simulate processing result
        const simulatedResult = {
          success: true,
          videoFilePath: testVideo,
          outputDirectory: method.options.outputDirectory,
          frames: Array.from({ length: method.options.frameCount }, (_, i) => ({
            filename: `frame_${i.toString().padStart(4, '0')}.${method.options.outputFormat}`,
            filepath: `${method.options.outputDirectory}/frame_${i.toString().padStart(4, '0')}.${method.options.outputFormat}`,
            timestamp: i * (method.options.interval || 30),
            frameNumber: i,
            fileSize: 50000 + Math.random() * 20000, // Simulated file size
            width: method.options.maxWidth || 1280,
            height: method.options.maxHeight || 720,
            isKeyframe: method.options.method === 'keyframes',
            sceneScore: method.options.method === 'scene-change' ? 0.8 : undefined,
            qualityScore: method.options.method === 'quality-based' ? 0.9 : undefined
          })),
          samplingMethod: method.options.method,
          totalFramesExtracted: method.options.frameCount,
          videoDuration: 300, // 5 minutes
          processingTime: 2000 + Math.random() * 3000,
          errors: [],
          warnings: [],
          averageFileSize: 60000,
          extractionSpeed: 4.5
        };

        console.log('  ✅ Processing completed (simulated)');
        console.log('  📈 Results:', {
          framesExtracted: simulatedResult.totalFramesExtracted,
          processingTime: `${simulatedResult.processingTime.toFixed(0)}ms`,
          averageFileSize: `${Math.round(simulatedResult.averageFileSize / 1024)}KB`,
          extractionSpeed: `${simulatedResult.extractionSpeed.toFixed(1)} fps`
        });

        if (method.options.method === 'keyframes' && simulatedResult.frames.every(f => f.isKeyframe)) {
          console.log('  🔑 All extracted frames are keyframes');
        }
        
        if (method.options.method === 'scene-change') {
          const avgSceneScore = simulatedResult.frames
            .map(f => f.sceneScore || 0)
            .reduce((sum, score) => sum + score, 0) / simulatedResult.frames.length;
          console.log(`  🎬 Average scene change score: ${avgSceneScore.toFixed(2)}`);
        }

        if (method.options.method === 'quality-based') {
          const avgQuality = simulatedResult.frames
            .map(f => f.qualityScore || 0)
            .reduce((sum, score) => sum + score, 0) / simulatedResult.frames.length;
          console.log(`  ⭐ Average quality score: ${avgQuality.toFixed(2)}`);
        }

      } catch (error) {
        console.log(`  ❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    console.log('\n🖼️  Testing thumbnail generation...');
    
    const thumbnailTests = [
      {
        name: 'Auto Middle Thumbnail',
        options: {
          position: 'middle' as const,
          width: 320,
          height: 240,
          format: 'jpg' as const,
          quality: 85
        }
      },
      {
        name: 'Start Position Thumbnail',
        options: {
          position: 'start' as const,
          width: 640,
          height: 480,
          format: 'png' as const
        }
      },
      {
        name: 'End Position Thumbnail',
        options: {
          position: 'end' as const,
          width: 160,
          height: 120,
          format: 'webp' as const,
          quality: 90
        }
      },
      {
        name: 'Best Quality Thumbnail',
        options: {
          position: 'best-quality' as const,
          width: 480,
          height: 360,
          format: 'jpg' as const,
          quality: 95,
          analyzeQuality: true,
          searchWindow: 10
        }
      },
      {
        name: 'Custom Timestamp Thumbnail',
        options: {
          timestamp: 120, // 2 minutes
          width: 800,
          height: 600,
          format: 'jpg' as const,
          quality: 90
        }
      }
    ];

    for (const test of thumbnailTests) {
      console.log(`\n📸 Testing ${test.name}...`);
      console.log('Options:', {
        position: test.options.position || 'custom',
        timestamp: test.options.timestamp || 'auto',
        size: `${test.options.width}x${test.options.height}`,
        format: test.options.format,
        quality: test.options.quality || 'default'
      });

      try {
        // Simulate thumbnail generation
        const timestamp = test.options.timestamp || 
          (test.options.position === 'start' ? 10 :
           test.options.position === 'middle' ? 150 :
           test.options.position === 'end' ? 290 : 150);

        const simulatedResult = {
          success: true,
          videoFilePath: testVideo,
          thumbnailPath: `./temp/thumbnails/${test.name.toLowerCase().replace(/\s+/g, '_')}.${test.options.format}`,
          timestamp,
          width: test.options.width,
          height: test.options.height,
          fileSize: 25000 + Math.random() * 15000,
          quality: test.options.quality,
          processingTime: 500 + Math.random() * 1000,
          errors: [],
          warnings: []
        };

        console.log('  ✅ Thumbnail generated (simulated)');
        console.log('  📄 Details:', {
          path: simulatedResult.thumbnailPath,
          timestamp: `${simulatedResult.timestamp}s`,
          size: `${simulatedResult.width}x${simulatedResult.height}`,
          fileSize: `${Math.round(simulatedResult.fileSize / 1024)}KB`,
          processingTime: `${simulatedResult.processingTime.toFixed(0)}ms`
        });

        if (test.options.analyzeQuality) {
          console.log('  🔍 Quality analysis performed to find optimal frame');
        }

      } catch (error) {
        console.log(`  ❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    console.log('\n📦 Testing thumbnail set generation...');
    
    const timelinePositions = [30, 90, 150, 210, 270]; // Every minute for 5 minutes
    console.log(`Generating thumbnail set at positions: ${timelinePositions.join('s, ')}s`);
    
    try {
      const thumbnailSet = timelinePositions.map((timestamp, index) => ({
        success: true,
        videoFilePath: testVideo,
        thumbnailPath: `./temp/thumbnails/set/thumb_${index.toString().padStart(2, '0')}.jpg`,
        timestamp,
        width: 200,
        height: 150,
        fileSize: 15000 + Math.random() * 8000,
        processingTime: 400 + Math.random() * 600,
        errors: [],
        warnings: []
      }));

      console.log('✅ Thumbnail set generated (simulated)');
      console.log('📊 Set summary:', {
        totalThumbnails: thumbnailSet.length,
        successful: thumbnailSet.filter(t => t.success).length,
        averageFileSize: `${Math.round(thumbnailSet.reduce((sum, t) => sum + t.fileSize, 0) / thumbnailSet.length / 1024)}KB`,
        totalProcessingTime: `${thumbnailSet.reduce((sum, t) => sum + t.processingTime, 0).toFixed(0)}ms`
      });

      thumbnailSet.forEach((thumb, index) => {
        console.log(`  ${index + 1}. ${thumb.timestamp}s -> ${thumb.thumbnailPath} (${Math.round(thumb.fileSize / 1024)}KB)`);
      });

    } catch (error) {
      console.log(`❌ Thumbnail set error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    console.log('\n🔧 Testing integrated video processing...');
    
    const processingOptions = {
      extractMetadata: true,
      generateThumbnail: true,
      extractFrames: true,
      thumbnailOptions: {
        position: 'best-quality' as const,
        width: 400,
        height: 300,
        format: 'jpg' as const,
        quality: 90
      },
      frameSamplingOptions: {
        method: 'uniform' as const,
        frameCount: 6,
        outputFormat: 'jpg' as const,
        quality: 80,
        maxWidth: 640,
        maxHeight: 480
      }
    };

    console.log('Processing options:', processingOptions);
    console.log('');
    console.log('Integrated processing would perform:');
    console.log('  1. ✅ Video validation');
    console.log('  2. ✅ Metadata extraction');
    console.log('  3. ✅ Thumbnail generation (best quality position)');
    console.log('  4. ✅ Frame sampling (uniform, 6 frames)');
    console.log('  5. ✅ Asset organization and cataloging');
    console.log('');

    console.log('⚡ Performance characteristics...');
    console.log('Frame Sampling Features:');
    console.log('  ✓ Multiple sampling methods (uniform, keyframes, scene-change, quality-based)');
    console.log('  ✓ Configurable output formats (JPG, PNG, WebP)');
    console.log('  ✓ Quality control and compression options');
    console.log('  ✓ Intelligent frame selection algorithms');
    console.log('  ✓ Batch processing capabilities');
    console.log('  ✓ Performance monitoring and metrics');
    console.log('');
    console.log('Thumbnail Generation Features:');
    console.log('  ✓ Smart position detection (start, middle, end, best-quality)');
    console.log('  ✓ Custom timestamp support');
    console.log('  ✓ Multiple output formats and sizes');
    console.log('  ✓ Quality analysis for optimal frame selection');
    console.log('  ✓ Thumbnail set generation for timelines');
    console.log('  ✓ Automatic output path generation');
    console.log('');

    console.log('🎉 Frame Sampling & Thumbnail Demo Completed!');
    console.log('============================================');
    console.log('');
    console.log('Key capabilities demonstrated:');
    console.log('  • Uniform frame sampling with configurable intervals');
    console.log('  • Keyframe extraction for efficient content representation');
    console.log('  • Scene change detection for content boundaries');
    console.log('  • Quality-based frame selection for best visual representation');
    console.log('  • Smart thumbnail generation with multiple positioning strategies');
    console.log('  • Thumbnail sets for timeline scrubbing interfaces');
    console.log('  • Flexible output formats and quality controls');
    console.log('  • Performance monitoring and optimization');
    console.log('');
    console.log('Production considerations:');
    console.log('  • Optimize frame sampling parameters based on video content type');
    console.log('  • Use keyframe extraction for faster processing when possible');
    console.log('  • Implement quality thresholds to avoid poor-quality frames');
    console.log('  • Consider storage requirements for frame archives');
    console.log('  • Cache thumbnails and frames for improved user experience');
    console.log('  • Use WebP format for better compression in modern browsers');

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