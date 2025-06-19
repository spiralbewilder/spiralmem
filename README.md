# Spiralmem: Local Video Memory System

Transform videos into searchable, organized memories using AI transcription - all running locally on your machine.

## Quick Install

**One command installation:**

```bash
# Unix/Linux/macOS
curl -fsSL https://raw.githubusercontent.com/spiralbewilder/spiralmem/master/install.sh | bash

# Windows (PowerShell)
iwr -useb https://raw.githubusercontent.com/spiralbewilder/spiralmem/master/install.ps1 | iex
```

## What It Does

- **Process Videos**: Automatically extract audio and generate searchable transcripts
- **YouTube Channels**: Download and process entire YouTube channels with smart filtering
- **Local AI**: All processing happens on your machine - complete privacy
- **Fast Search**: Find any content across all your videos instantly
- **Organized**: Group videos into spaces for better organization

## Quick Start

```bash
# Initialize system
spiralmem init

# Process a video file
spiralmem add-video /path/to/video.mp4

# Process YouTube videos
spiralmem add-video https://youtu.be/your-video-url

# Process entire YouTube channels
spiralmem add-channel "https://www.youtube.com/@TechLead" --max-videos 5

# Search your content
spiralmem search "bitcoin"

# View stats
spiralmem stats
```

## Key Features

- **🔒 Complete Privacy**: All AI processing local, no cloud dependencies
- **🎥 Video Processing**: Extract audio, generate transcripts with Whisper
- **📺 YouTube Integration**: Process channels with smart duration filtering
- **🔍 Fast Search**: Keyword search across all video content
- **🗂️ Smart Organization**: Space-based memory organization
- **⚡ Performance**: Optimized channel discovery (71s → 4s)

## System Requirements

- **Node.js** 18+ 
- **Python** 3.8+ with pip
- **FFmpeg** 4.0+

The installer handles all dependencies automatically.

## Core Commands

```bash
# System
spiralmem init                    # Initialize system
spiralmem check                   # Health check  
spiralmem stats                   # Show statistics

# Videos
spiralmem add-video <path>        # Process local video
spiralmem add-video <youtube-url> # Process YouTube video

# Channels  
spiralmem add-channel <url>       # Process YouTube channel
spiralmem add-channel <url> --max-videos 3 --max-duration 1800

# Search
spiralmem search "query"          # Search all content
spiralmem semantic-search "query" # AI-powered search

# Organization
spiralmem spaces                  # List spaces
spiralmem create-space <name>     # Create new space
```

## Performance

Based on real-world testing:
- **Channel Discovery**: ~4 seconds (optimized from 71s)
- **Video Processing**: ~20 seconds per 5-minute video
- **Search**: <2ms across thousands of videos
- **Audio Extraction**: ~3 seconds per video
- **Transcription**: ~30 seconds per 5-minute video

## Architecture

- **Runtime**: Node.js + TypeScript
- **Database**: SQLite with optimized indexing
- **AI**: Local Whisper for transcription
- **Video**: FFmpeg for processing
- **Search**: Full-text + planned semantic search

## Status: Production Ready ✅

- ✅ Complete video processing pipeline
- ✅ YouTube channel processing with filtering
- ✅ Fast search across all content
- ✅ Cross-platform compatibility
- ✅ Error handling and recovery
- ✅ MCP integration for AI assistants

## Documentation

- **[Getting Started](GETTING_STARTED.md)**: Step-by-step setup guide
- **[System Design](SYSTEM_DESIGN_SPECIFICATION.md)**: Technical architecture
- **[Configuration](CONFIGURATION.md)**: Advanced configuration options

## Recent Updates

**✨ Channel Processing Pipeline Complete**
- Fast YouTube channel discovery and filtering
- Automatic video download and transcription
- Smart duration constraints and content filtering
- Full search integration for channel content

## License

MIT License - see LICENSE file for details

---

**Need help?** Check the [Getting Started guide](GETTING_STARTED.md) or run `spiralmem --help`