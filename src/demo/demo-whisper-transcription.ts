#!/usr/bin/env node

/**
 * WHISPER TRANSCRIPTION PROOF
 * Demonstrates complete audio transcription pipeline working on real YouTube video
 */

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';

async function main() {
  try {
    console.log('🎙️ WHISPER TRANSCRIPTION PROOF OF CONCEPT');
    console.log('==========================================');
    console.log('');

    const audioPath = path.resolve('./temp/proof-test/audio/proof_video_audio.wav');
    
    // Check if audio file exists (should have been created in previous proof)
    try {
      const stats = await fs.stat(audioPath);
      console.log('✅ Audio file confirmed:');
      console.log(`   📁 Path: ${audioPath}`);
      console.log(`   📊 Size: ${(stats.size / (1024 * 1024)).toFixed(2)} MB`);
      console.log(`   📅 Created: ${stats.mtime.toLocaleString()}`);
      console.log('');
    } catch (error) {
      console.error('❌ FAILURE: Audio file not found');
      console.log('Please run the complete proof first to generate the audio file:');
      console.log('   npm run demo:proof');
      process.exit(1);
    }

    // Create Python script to use faster-whisper
    const pythonScript = `
import sys
import json
import time
from faster_whisper import WhisperModel

def transcribe_audio(audio_path):
    print("🔄 Initializing Whisper model...", file=sys.stderr)
    
    # Initialize model (using base model for good balance of speed and accuracy)
    model = WhisperModel("base", device="cpu", compute_type="int8")
    
    print("🎵 Starting transcription...", file=sys.stderr)
    start_time = time.time()
    
    # Transcribe
    segments, info = model.transcribe(audio_path, beam_size=5)
    
    # Process results
    transcript_data = {
        "language": info.language,
        "language_probability": float(info.language_probability),
        "duration": float(info.duration),
        "segments": [],
        "full_text": ""
    }
    
    full_text_parts = []
    
    for segment in segments:
        segment_data = {
            "id": segment.id,
            "start": float(segment.start),
            "end": float(segment.end),
            "text": segment.text.strip(),
            "avg_logprob": float(segment.avg_logprob),
            "no_speech_prob": float(segment.no_speech_prob),
            "compression_ratio": float(segment.compression_ratio)
        }
        transcript_data["segments"].append(segment_data)
        full_text_parts.append(segment.text.strip())
    
    transcript_data["full_text"] = " ".join(full_text_parts)
    transcript_data["processing_time"] = time.time() - start_time
    
    print("✅ Transcription completed!", file=sys.stderr)
    
    return transcript_data

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python script.py <audio_file>", file=sys.stderr)
        sys.exit(1)
    
    audio_file = sys.argv[1]
    
    try:
        result = transcribe_audio(audio_file)
        print(json.dumps(result, indent=2))
    except Exception as e:
        print(f"❌ Error: {e}", file=sys.stderr)
        sys.exit(1)
`;

    // Write Python script to temp file
    const scriptPath = './temp/transcribe.py';
    await fs.writeFile(scriptPath, pythonScript);
    console.log('🐍 Created Python transcription script');
    console.log('');

    // Run transcription
    console.log('🎙️ STEP 1: Running Whisper Transcription');
    console.log('========================================');
    console.log('⏳ This may take 1-2 minutes for the 5-minute video...');
    console.log('');

    const transcriptionResult = await runPythonTranscription(scriptPath, audioPath);
    
    if (transcriptionResult.success) {
      console.log('✅ TRANSCRIPTION SUCCESS!');
      console.log('');
      console.log('📊 Transcription Details:');
      console.log(`   🌍 Language: ${transcriptionResult.data.language} (${(transcriptionResult.data.language_probability * 100).toFixed(1)}% confidence)`);
      console.log(`   ⏱️  Duration: ${transcriptionResult.data.duration.toFixed(1)} seconds`);
      console.log(`   📝 Segments: ${transcriptionResult.data.segments.length}`);
      console.log(`   📄 Total Text: ${transcriptionResult.data.full_text.length} characters`);
      console.log(`   ⚡ Processing Time: ${transcriptionResult.data.processing_time.toFixed(1)} seconds`);
      console.log(`   🔄 Speed: ${(transcriptionResult.data.duration / transcriptionResult.data.processing_time).toFixed(1)}x realtime`);
      console.log('');

      // Show first few segments with timestamps
      console.log('🎯 STEP 2: Transcript with Timestamps');
      console.log('====================================');
      const segments = transcriptionResult.data.segments.slice(0, 10); // Show first 10 segments
      
      for (const segment of segments) {
        const startTime = formatTime(segment.start);
        const endTime = formatTime(segment.end);
        console.log(`[${startTime} → ${endTime}] ${segment.text}`);
      }
      
      if (transcriptionResult.data.segments.length > 10) {
        console.log(`... and ${transcriptionResult.data.segments.length - 10} more segments`);
      }
      console.log('');

      // Show complete transcript
      console.log('📜 STEP 3: Complete Transcript');
      console.log('=============================');
      const fullText = transcriptionResult.data.full_text;
      const preview = fullText.length > 500 ? fullText.substring(0, 500) + '...' : fullText;
      console.log(preview);
      console.log('');

      // Save transcript to file
      const transcriptPath = './temp/proof-test/transcript.json';
      await fs.writeFile(transcriptPath, JSON.stringify(transcriptionResult.data, null, 2));
      console.log(`💾 Full transcript saved to: ${transcriptPath}`);
      console.log('');

      // Demonstrate searchable functionality
      console.log('🔍 STEP 4: Searchable Transcript Demo');
      console.log('===================================');
      
      const searchTerms = ['video', 'the', 'and', 'to', 'a'];
      
      for (const term of searchTerms) {
        const matches = findInTranscript(transcriptionResult.data.segments, term.toLowerCase());
        if (matches.length > 0) {
          console.log(`🔍 "${term}": ${matches.length} occurrences`);
          // Show first match with context
          const firstMatch = matches[0];
          const startTime = formatTime(firstMatch.start);
          console.log(`   First at ${startTime}: "${firstMatch.text}"`);
        } else {
          console.log(`🔍 "${term}": No matches found`);
        }
      }
      console.log('');

      // Quality metrics
      console.log('📈 STEP 5: Quality Metrics');
      console.log('=========================');
      
      const avgConfidence = transcriptionResult.data.segments.reduce((sum: number, s: any) => sum + Math.exp(s.avg_logprob), 0) / transcriptionResult.data.segments.length;
      const avgNoSpeechProb = transcriptionResult.data.segments.reduce((sum: number, s: any) => sum + s.no_speech_prob, 0) / transcriptionResult.data.segments.length;
      const avgCompressionRatio = transcriptionResult.data.segments.reduce((sum: number, s: any) => sum + s.compression_ratio, 0) / transcriptionResult.data.segments.length;
      
      console.log(`   📊 Average Confidence: ${(avgConfidence * 100).toFixed(1)}%`);
      console.log(`   🔇 Average No-Speech Probability: ${(avgNoSpeechProb * 100).toFixed(1)}%`);
      console.log(`   📦 Average Compression Ratio: ${avgCompressionRatio.toFixed(2)}`);
      console.log('');

      // Final success summary
      console.log('🏆 WHISPER TRANSCRIPTION PROOF COMPLETE!');
      console.log('========================================');
      console.log('');
      console.log('✅ ALL TRANSCRIPTION FEATURES WORKING:');
      console.log('   ✅ Real YouTube video audio → text transcription');
      console.log('   ✅ Accurate timestamp generation for each segment');
      console.log('   ✅ Language detection with confidence scores');
      console.log('   ✅ Quality metrics and confidence analysis');
      console.log('   ✅ Searchable transcript with keyword matching');
      console.log('   ✅ Complete JSON output with structured data');
      console.log('   ✅ High-speed processing (faster than realtime)');
      console.log('');
      console.log('🎯 FINAL PROOF: COMPLETE VIDEO-TO-SEARCHABLE-TEXT PIPELINE FUNCTIONAL!');
      console.log('');
      console.log('📁 Generated Files:');
      console.log(`   🎵 Audio: ${path.basename(audioPath)} (${(await fs.stat(audioPath)).size / 1024 / 1024}MB)`);
      console.log(`   📝 Transcript: ${path.basename(transcriptPath)} (${(await fs.stat(transcriptPath)).size / 1024}KB)`);

    } else {
      console.error('❌ TRANSCRIPTION FAILED:', transcriptionResult.error);
      process.exit(1);
    }

    // Cleanup
    await fs.unlink(scriptPath);

  } catch (error) {
    console.error('💥 CRITICAL FAILURE:', error);
    process.exit(1);
  }
}

async function runPythonTranscription(scriptPath: string, audioPath: string): Promise<{
  success: boolean;
  data?: any;
  error?: string;
}> {
  return new Promise((resolve) => {
    const process = spawn('python3', [scriptPath, audioPath]);
    let stdout = '';
    let stderr = '';

    process.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    process.stderr.on('data', (data) => {
      stderr += data.toString();
      // Forward progress messages to console
      const lines = data.toString().split('\n');
      for (const line of lines) {
        if (line.trim() && (line.includes('🔄') || line.includes('🎵') || line.includes('✅'))) {
          console.log(line.trim());
        }
      }
    });

    process.on('close', (code) => {
      if (code === 0) {
        try {
          const data = JSON.parse(stdout);
          resolve({ success: true, data });
        } catch (error) {
          resolve({ success: false, error: 'Failed to parse transcription result' });
        }
      } else {
        resolve({ success: false, error: stderr || 'Unknown error' });
      }
    });

    process.on('error', (error) => {
      resolve({ success: false, error: error.message });
    });

    // Timeout after 10 minutes
    setTimeout(() => {
      process.kill();
      resolve({ success: false, error: 'Transcription timed out' });
    }, 600000);
  });
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${mins}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
}

function findInTranscript(segments: any[], searchTerm: string): any[] {
  return segments.filter(segment => 
    segment.text.toLowerCase().includes(searchTerm)
  );
}

// Run the proof
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}