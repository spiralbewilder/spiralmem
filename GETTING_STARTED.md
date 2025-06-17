# Getting Started with Spiralmem

Welcome to Spiralmem! This guide will walk you through your first steps with the local video memory system.

## Installation

### One-Command Install (Recommended)
```bash
curl -fsSL https://raw.githubusercontent.com/spiralbewilder/spiralmem/master/install.sh | sh
```

The installer will:
- ✅ Check your system requirements
- ✅ Install missing dependencies (Node.js, Python, FFmpeg)
- ✅ Download and set up Spiralmem
- ✅ Verify everything is working
- ✅ Add `spiralmem` command to your PATH

### Manual Install
If you prefer to install manually, see the detailed instructions in the [README](README.md#-manual-installation).

## First Steps

### 1. Verify Installation
```bash
spiralmem check
```

You should see all green checkmarks ✅. If not, the command will tell you what's missing.

### 2. Initialize the System
```bash
spiralmem init
```

This creates:
- Database (`~/.local/share/spiralmem/data/spiralmem.db`)
- Configuration (`~/.config/spiralmem/config.yaml`)
- Temp directories for processing
- Default memory space

### 3. Add Your First Video

```bash
# Add a video file
spiralmem add-video /path/to/your/video.mp4

# Add with custom title
spiralmem add-video /path/to/video.mp4 --title "My Important Meeting"

# Add to specific space
spiralmem add-video /path/to/video.mp4 --space "work-meetings"
```

**What happens during video processing:**
1. ✅ File validation (format, size, accessibility)
2. ✅ Metadata extraction (duration, resolution, etc.)
3. ✅ Audio extraction using FFmpeg
4. ✅ Speech-to-text transcription with faster_whisper
5. ✅ Content chunking for search
6. ✅ Database storage with full-text search indexing

**Processing time**: ~20 seconds for a 5-minute video.

### 4. Search Your Content

```bash
# Basic search
spiralmem search "machine learning"

# Search in specific space
spiralmem search "budget" --space "work-meetings"

# Limit results
spiralmem search "project" --limit 5

# JSON output (for scripts)
spiralmem search "data" --json
```

### 5. Organize with Spaces

```bash
# List all spaces
spiralmem spaces

# Create new space
spiralmem create-space "personal-videos" --description "Personal video collection"

# Create work space
spiralmem create-space "work-meetings" --description "Work meeting recordings"

# Move video to specific space (during add)
spiralmem add-video meeting.mp4 --space "work-meetings"
```

## Working with AI Assistants

### Start MCP Server
```bash
spiralmem serve-mcp
```

This starts a Model Context Protocol server that Claude and other AI assistants can connect to.

**Available MCP Tools:**
- Search across all your video transcripts
- Get system statistics
- List spaces and content
- Export data in various formats

### Connect Claude
1. Start the MCP server: `spiralmem serve-mcp`
2. In Claude, connect to `http://localhost:8080`
3. Claude can now search your video library!

**Example Claude interactions:**
- "Search my videos for discussions about machine learning"
- "What did I say about the quarterly budget in my meeting videos?"
- "Find all videos where I mentioned 'project timeline'"

## Common Workflows

### Meeting Recordings
```bash
# Create a space for meetings
spiralmem create-space "meetings" --description "Meeting recordings"

# Add meeting video
spiralmem add-video zoom-meeting-2024-01-15.mp4 \
  --space "meetings" \
  --title "Q1 Planning Meeting"

# Search for specific topics discussed
spiralmem search "action items" --space "meetings"
spiralmem search "budget allocation" --space "meetings"
```

### Learning Content
```bash
# Create learning space
spiralmem create-space "learning" --description "Educational videos"

# Add educational videos
spiralmem add-video machine-learning-course-01.mp4 --space "learning"
spiralmem add-video python-tutorial-advanced.mp4 --space "learning"

# Search across all learning content
spiralmem search "neural networks" --space "learning"
spiralmem search "data preprocessing" --space "learning"
```

### Personal Video Library
```bash
# Create personal space
spiralmem create-space "personal" --description "Personal videos"

# Add family videos, travel vlogs, etc.
spiralmem add-video family-vacation-2024.mp4 --space "personal"
spiralmem add-video cooking-recipe-pasta.mp4 --space "personal"

# Search personal content
spiralmem search "beach" --space "personal"
spiralmem search "recipe ingredients" --space "personal"
```

## Advanced Features

### System Monitoring
```bash
# Check system health
spiralmem check

# View detailed statistics
spiralmem stats

# View configuration
spiralmem config
```

### Data Management
```bash
# Export all data
spiralmem export backup.json

# Export specific space
spiralmem export work-backup.json --space "work-meetings"

# Export as CSV
spiralmem export data.csv --format csv
```

### Configuration Customization

Edit `~/.config/spiralmem/config.yaml` to customize:

```yaml
video:
  processing:
    maxFileSize: "10GB"        # Increase file size limit
  whisper:
    model: "medium"            # Use better transcription model

performance:
  processing:
    maxConcurrentJobs: 4       # Process more videos simultaneously

logging:
  level: "debug"               # More detailed logs
```

## Troubleshooting

### Video Won't Process
```bash
# Check if file is supported
spiralmem add-video problematic-file.mov

# Common issues:
# - File too large (check config.yaml maxFileSize)
# - Unsupported format (supported: mp4, avi, mov, mkv, webm)
# - File corrupted or inaccessible
# - Insufficient disk space
```

### Transcription Failed
```bash
# Check faster_whisper installation
python3 -c "import faster_whisper; print('OK')"

# Reinstall if needed
pip3 install --upgrade faster_whisper

# Check system resources
spiralmem check
```

### Search Returns No Results
```bash
# Verify video was processed successfully
spiralmem stats

# Check if content is in expected space
spiralmem spaces

# Try broader search terms
spiralmem search "the"  # Should return many results if content exists
```

### Performance Issues
```bash
# Check system health
spiralmem check

# View resource usage
spiralmem stats

# Common solutions:
# - Increase memory limits in config.yaml
# - Reduce maxConcurrentJobs
# - Clean up temp files
# - Check disk space
```

## Getting Help

### Built-in Help
```bash
spiralmem --help           # Main help
spiralmem add-video --help # Command-specific help
spiralmem search --help    # Search options
```

### Log Files
```bash
# View recent logs
tail -f ~/.local/share/spiralmem/logs/spiralmem.log

# Search logs for errors
grep ERROR ~/.local/share/spiralmem/logs/spiralmem.log
```

### System Information
```bash
# Comprehensive system check
spiralmem check

# Detailed system status
spiralmem stats --json | jq .
```

## Next Steps

- Read the [System Architecture](SYSTEM_DESIGN_SPECIFICATION.md) for technical details
- Check the [Roadmap](NEXT_STEPS_ROADMAP.md) for upcoming features
- Explore the [Installer Design](INSTALLER_DESIGN.md) for deployment options

Happy video memory building! 🎬✨