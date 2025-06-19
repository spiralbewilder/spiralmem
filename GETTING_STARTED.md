# Getting Started with Spiralmem

Quick setup guide to get Spiralmem running on your machine.

## Install

**One command - all platforms:**

```bash
# Unix/Linux/macOS
curl -fsSL https://raw.githubusercontent.com/spiralbewilder/spiralmem/master/install.sh | bash

# Windows (PowerShell as Administrator)
iwr -useb https://raw.githubusercontent.com/spiralbewilder/spiralmem/master/install.ps1 | iex
```

The installer:
- Checks system requirements
- Installs missing dependencies (Node.js, Python, FFmpeg)
- Downloads and builds Spiralmem
- Adds `spiralmem` command to your PATH

## Verify Installation

```bash
spiralmem check
```

Should show all green checkmarks ✅.

## First Steps

### 1. Initialize System
```bash
spiralmem init
```

### 2. Process Your First Video

**Local video file:**
```bash
spiralmem add-video /path/to/your/video.mp4
```

**YouTube video:**
```bash
spiralmem add-video https://youtu.be/dQw4w9WgXcQ
```

**YouTube channel:**
```bash
spiralmem add-channel "https://www.youtube.com/@TechLead" --max-videos 3
```

### 3. Search Content
```bash
spiralmem search "keyword"
```

### 4. View System Status
```bash
spiralmem stats
```

## Key Commands

### Processing
- `spiralmem add-video <path>` - Process local video
- `spiralmem add-video <youtube-url>` - Process YouTube video  
- `spiralmem add-channel <url>` - Process YouTube channel

### Channel Options
- `--max-videos 5` - Limit number of videos
- `--max-duration 1800` - Max duration in seconds (30 minutes)
- `--min-duration 60` - Min duration in seconds
- `--include-shorts` - Include YouTube Shorts

### Search & Organization
- `spiralmem search "query"` - Search all content
- `spiralmem spaces` - List spaces
- `spiralmem create-space name` - Create new space

### System
- `spiralmem init` - Initialize system
- `spiralmem check` - Health check
- `spiralmem stats` - Show statistics

## Examples

**Process a tech channel (short videos only):**
```bash
spiralmem add-channel "https://www.youtube.com/@fireship" --max-videos 5 --max-duration 600
```

**Process a podcast channel:**
```bash
spiralmem add-channel "https://www.youtube.com/@lexfridman" --max-videos 2 --max-duration 7200
```

**Search for specific topics:**
```bash
spiralmem search "artificial intelligence"
spiralmem search "javascript"
```

## Configuration (Optional)

Spiralmem works without configuration. For advanced options:

```bash
# Navigate to install directory
cd ~/.spiralmem

# Create config from template
cp .env.example .env

# Edit if needed
nano .env
```

Available options:
- `YOUTUBE_API_KEY` - For advanced YouTube features (optional)
- `SPIRALMEM_LOG_LEVEL` - Logging verbosity (info, debug, error)

## Troubleshooting

**Installation Issues:**
```bash
# Check system dependencies
spiralmem check

# View detailed logs
spiralmem --verbose check
```

**Processing Issues:**
- Ensure FFmpeg is installed: `ffmpeg -version`
- Check Python packages: `pip list | grep whisper`
- View logs: `tail -f ~/.spiralmem/logs/spiralmem.log`

**Performance:**
- Processing time depends on video length and hardware
- Channel discovery takes ~4 seconds
- Video transcription takes ~30 seconds per 5-minute video

## Next Steps

1. **Process your video library** - Start with shorter videos for faster results
2. **Try channel processing** - Find channels with content under 30 minutes
3. **Explore search** - Search across all your processed content
4. **Organize with spaces** - Create topic-based spaces for better organization

## Need Help?

- Run `spiralmem --help` for command reference
- Check system status: `spiralmem check`
- View logs: `~/.spiralmem/logs/spiralmem.log`
- Report issues on GitHub