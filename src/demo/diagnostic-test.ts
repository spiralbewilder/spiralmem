#!/usr/bin/env node

import fs from 'fs/promises';
import { VideoValidator } from '../core/video/index.js';

async function main() {
  const videoPath = './temp/proof-test/video/proof_video.mp4';
  
  console.log('🔍 Diagnostic Test');
  console.log('==================');
  
  // Test 1: File existence and stats
  try {
    const stats = await fs.stat(videoPath);
    console.log('✅ File exists:', {
      size: stats.size,
      isFile: stats.isFile(),
      readable: true
    });
  } catch (error) {
    console.error('❌ File access error:', error instanceof Error ? error.message : 'Unknown error');
    return;
  }
  
  // Test 2: Basic file info
  try {
    console.log('🔍 Getting basic file info...');
    const basicInfo = await VideoValidator.getBasicFileInfo(videoPath);
    console.log('✅ Basic file info:', {
      fileName: basicInfo.fileName,
      fileExtension: basicInfo.fileExtension,
      fileSize: VideoValidator.formatFileSize(basicInfo.fileSize),
      isValid: basicInfo.isValid,
      errors: basicInfo.errors,
      warnings: basicInfo.warnings
    });
  } catch (error) {
    console.error('❌ Basic info error:', error instanceof Error ? error.message : 'Unknown error');
    console.error('Stack:', error instanceof Error ? error.stack : 'No stack');
  }
  
  // Test 3: Format check
  try {
    console.log('🔍 Checking format support...');
    const isSupported = VideoValidator.isSupportedFormat(videoPath);
    console.log('✅ Format supported:', isSupported);
  } catch (error) {
    console.error('❌ Format check error:', error instanceof Error ? error.message : 'Unknown error');
  }
  
  // Test 4: Full validation
  try {
    console.log('🔍 Running full validation...');
    const validationResult = await VideoValidator.validateVideoFile(videoPath);
    console.log('✅ Full validation result:', {
      isValid: validationResult.isValid,
      errors: validationResult.errors,
      warnings: validationResult.warnings,
      fileInfo: {
        fileName: validationResult.fileInfo.fileName,
        fileSize: VideoValidator.formatFileSize(validationResult.fileInfo.fileSize),
        isValid: validationResult.fileInfo.isValid
      }
    });
  } catch (error) {
    console.error('❌ Full validation error:', error instanceof Error ? error.message : 'Unknown error');
    console.error('Stack:', error instanceof Error ? error.stack : 'No stack');
  }
}

main().catch(console.error);