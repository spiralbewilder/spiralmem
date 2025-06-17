#!/usr/bin/env node

/**
 * Video Processing Demo
 * Tests video validation, metadata extraction, and processing pipeline
 */

import { VideoProcessor, VideoValidator, MetadataExtractor, AudioExtractor } from '../core/video/index.js';
import { logger } from '../utils/logger.js';

async function main() {
  try {
    console.log('🎬 Video Processing Pipeline Demo');
    console.log('=================================\n');

    // Initialize video processor
    console.log('🔧 Initializing video processor...');
    const processor = new VideoProcessor();

    // Check system readiness
    console.log('🔍 Checking system requirements...');
    const systemCheck = await processor.checkSystemReadiness();
    console.log('System Status:', {
      ready: systemCheck.ready,
      ffmpeg: systemCheck.ffmpeg,
      ffprobe: systemCheck.ffprobe,
      whisper: systemCheck.whisper,
      versions: systemCheck.versions,
      issues: systemCheck.issues
    });
    console.log('');

    if (!systemCheck.ready) {
      console.log('⚠️  System not fully ready for video processing');
      console.log('Install FFmpeg to enable full functionality:');
      console.log('  - Ubuntu/Debian: sudo apt install ffmpeg');
      console.log('  - macOS: brew install ffmpeg');
      console.log('  - Windows: Download from https://ffmpeg.org/');
      console.log('');
    }

    // Test video validation with dummy files
    console.log('📋 Testing video validation...');
    
    const testFiles = [
      'test-video.mp4',
      'invalid-file.txt',
      'missing-file.avi'
    ];

    for (const testFile of testFiles) {
      console.log(`Validating: ${testFile}`);
      try {
        const basicInfo = await VideoValidator.getBasicFileInfo(testFile);
        console.log(`  File info:`, {
          fileName: basicInfo.fileName,
          extension: basicInfo.fileExtension,
          size: VideoValidator.formatFileSize(basicInfo.fileSize),
          valid: basicInfo.isValid,
          errors: basicInfo.errors,
          warnings: basicInfo.warnings
        });
      } catch (error) {
        console.log(`  Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
    console.log('');

    // Test format support
    console.log('🎯 Testing format support...');
    const formats = ['video.mp4', 'video.avi', 'video.mov', 'video.mkv', 'video.webm', 'document.pdf', 'image.jpg'];
    
    for (const format of formats) {
      const supported = VideoValidator.isSupportedFormat(format);
      console.log(`  ${format}: ${supported ? '✅ Supported' : '❌ Not supported'}`);
    }
    console.log('');

    // Test FFmpeg availability
    if (systemCheck.ffprobe) {
      console.log('🎥 Testing FFmpeg metadata extraction...');
      try {
        const ffmpegCheck = await MetadataExtractor.checkFFmpegAvailability();
        console.log('FFmpeg Status:', ffmpegCheck);
        console.log('');
      } catch (error) {
        console.log(`FFmpeg test failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }

      // Test audio processing capabilities
      console.log('🔊 Testing audio processing capabilities...');
      try {
        const audioExtractor = new AudioExtractor();
        const audioSupport = await audioExtractor.checkAudioProcessingSupport();
        console.log('Audio Support:', {
          supported: audioSupport.supported,
          codecs: audioSupport.codecs.slice(0, 5), // Show first 5
          formats: audioSupport.formats.slice(0, 5),
          issues: audioSupport.issues
        });
        console.log('');
      } catch (error) {
        console.log(`Audio processing test failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    // Test validation options
    console.log('⚙️  Testing validation options...');
    const validationOptions = {
      maxFileSize: 100 * 1024 * 1024, // 100MB
      allowedFormats: ['mp4', 'avi', 'mov'],
      minDuration: 5,
      maxDuration: 3600,
      checkCorruption: true
    };
    
    console.log('Validation options:', validationOptions);
    console.log('');

    // Test processing metrics
    console.log('📊 Testing processing metrics...');
    const metrics = processor.getProcessingMetrics();
    console.log('Current metrics:', {
      summary: metrics.summary,
      trends: metrics.trends.slice(0, 3),
      resourceUsage: metrics.resourceUsage
    });
    console.log('');

    // Test audio extraction settings
    console.log('🎧 Testing audio extraction settings...');
    const optimalSettings = AudioExtractor.getOptimalTranscriptionSettings();
    console.log('Optimal transcription settings:', optimalSettings);
    console.log('');

    // Simulate processing workflow (without actual files)
    console.log('🔄 Testing processing workflow...');
    console.log('Processing steps that would be executed:');
    console.log('  1. File validation (format, size, accessibility)');
    console.log('  2. Metadata extraction (duration, resolution, codecs)');
    console.log('  3. Audio extraction (for transcription pipeline)');
    console.log('  4. Quality assessment (bitrate, fps, resolution)');
    console.log('  5. Asset generation (thumbnails, frames - not implemented)');
    console.log('  6. Database storage (integration pending)');
    console.log('');

    // Test batch processing simulation
    console.log('📦 Testing batch processing simulation...');
    const simulatedFiles = [
      'video1.mp4',
      'video2.avi', 
      'video3.mov',
      'invalid.txt'
    ];

    console.log(`Simulating batch processing of ${simulatedFiles.length} files:`);
    for (let i = 0; i < simulatedFiles.length; i++) {
      const file = simulatedFiles[i];
      const isValid = VideoValidator.isSupportedFormat(file);
      console.log(`  ${i + 1}. ${file}: ${isValid ? '✅ Would process' : '❌ Would skip'}`);
    }
    console.log('');

    // Performance monitoring test
    console.log('⚡ Testing performance monitoring...');
    const perfMetrics = processor.getProcessingMetrics();
    console.log('Performance summary:', {
      totalOperations: perfMetrics.summary.totalOperations,
      averageResponseTime: perfMetrics.summary.averageResponseTime,
      errorRate: perfMetrics.summary.errorRate
    });
    console.log('');

    // File size formatting test
    console.log('📏 Testing file size formatting...');
    const fileSizes = [1024, 1048576, 1073741824, 5368709120];
    fileSizes.forEach(size => {
      console.log(`  ${size} bytes = ${VideoValidator.formatFileSize(size)}`);
    });
    console.log('');

    console.log('🎉 Video Processing Demo Completed!');
    console.log('====================================');
    console.log('');
    console.log('Next steps for full implementation:');
    console.log('  1. Install FFmpeg for metadata and audio extraction');
    console.log('  2. Add real video files for testing');
    console.log('  3. Integrate Whisper for transcription');
    console.log('  4. Implement thumbnail generation');
    console.log('  5. Implement frame extraction');
    console.log('  6. Create processing queue system');
    console.log('  7. Connect to database storage');

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