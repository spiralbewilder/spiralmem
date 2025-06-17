#!/bin/bash
set -e

echo "🚀 spiralmem Installation & Test Script"
echo "======================================"

# Phase 1: Dependency checks
echo "📋 Phase 1: Checking dependencies..."
command -v node >/dev/null 2>&1 || { echo "❌ Node.js required"; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "❌ npm required"; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "❌ Python 3 required"; exit 1; }
command -v ffmpeg >/dev/null 2>&1 || { echo "❌ FFmpeg required"; exit 1; }
echo "✅ All dependencies found"

# Phase 2: Installation
echo "📦 Phase 2: Installing..."
npm install
npm run build
echo "✅ Installation complete"

# Phase 3: Component tests
echo "🧪 Phase 3: Component tests..."
npx tsx src/demo/diagnostic-test.ts
echo "✅ Component tests passed"

# Phase 4: Full pipeline test
echo "🎯 Phase 4: Full pipeline test..."
npm run demo:proof
echo "✅ Full pipeline test passed"

# Phase 5: Transcription test
echo "🎙️ Phase 5: Transcription test..."
npx tsx src/demo/demo-whisper-transcription.ts
echo "✅ Transcription test passed"

echo "🏆 ALL TESTS PASSED - spiralmem is ready!"