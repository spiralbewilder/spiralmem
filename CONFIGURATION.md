# Spiralmem Configuration Guide

This guide explains how to configure Spiralmem for your specific needs. **Good news**: Most users don't need any configuration!

## 🚀 Quick Start (No Configuration Needed)

Spiralmem works perfectly out-of-the-box:
- ✅ Local video processing
- ✅ YouTube URL downloads  
- ✅ Transcription and search
- ✅ AI assistant integration
- ✅ All features available immediately

**You can start using Spiralmem right away without any setup!**

## ⚙️ Optional Configuration

### When You Might Want to Configure

**Customize file locations:**
- Change where videos and database are stored
- Use a different temporary directory

**Advanced YouTube features:**
- Channel management with quotas
- Batch video operations with API limits
- Official YouTube Data API integration

**Development or debugging:**
- Adjust logging levels
- Modify performance thresholds

### Environment File Setup

**Step 1: Create your configuration file**
```bash
# Navigate to your spiralmem installation
cd ~/.spiralmem  # or your installation directory

# Copy the template to create your personal config
cp .env.example .env
```

**Step 2: Edit configuration (optional)**
```bash
# Edit with your preferred editor
nano .env
# or: code .env, vim .env, etc.
```

## 📋 Configuration Options

### Core Settings

```bash
# Database location (optional - defaults work great)
SPIRALMEM_DB_PATH=./data/spiralmem.db

# Logging level (optional - 'info' recommended)
# Options: error, warn, info, debug
SPIRALMEM_LOG_LEVEL=info

# MCP Server for AI assistants (optional - enabled by default)
SPIRALMEM_MCP_ENABLED=true

# API Server (optional - disabled by default)
SPIRALMEM_API_ENABLED=false
SPIRALMEM_API_PORT=3000
```

### YouTube Configuration

```bash
# YouTube Data API v3 Key (optional - most users don't need this)
YOUTUBE_API_KEY=your_youtube_api_key_here
```

**About the YouTube API Key:**

**🔧 You DON'T need this for:**
- Downloading YouTube videos (uses yt-dlp)
- Processing YouTube content
- Basic YouTube functionality
- Personal use of Spiralmem

**🔑 You DO need this for:**
- YouTube channel management features
- Bulk operations with official quotas
- Advanced YouTube Data API integration
- Commercial applications

**How to get a YouTube API key:**
1. Visit [Google Cloud Console](https://console.developers.google.com/apis/credentials)
2. Create a new project or select an existing one
3. Enable the YouTube Data API v3
4. Create credentials (API key)
5. Optionally restrict the key to YouTube Data API

## 🛡️ Security Best Practices

### Environment File Security

**✅ What Spiralmem does automatically:**
- Excludes `.env` from version control
- Keeps your configuration private
- Stores all data locally
- Never transmits API keys

**✅ What you should do:**
- Never share your `.env` file
- Keep API keys private
- Use minimal permissions for API keys
- Regenerate compromised keys

**❌ What to avoid:**
- Committing `.env` to git repositories
- Sharing API keys in chat/email
- Using API keys with excessive permissions

### File Permissions

Your `.env` file should be readable only by you:
```bash
# Set proper permissions (Unix/Linux/macOS)
chmod 600 .env

# Verify permissions
ls -la .env
# Should show: -rw------- (owner read/write only)
```

## 🔧 Advanced Configuration

### Custom Installation Paths

You can change where Spiralmem stores data:

```bash
# Custom database location
SPIRALMEM_DB_PATH=/path/to/your/custom/database.db

# Note: Make sure the directory exists and is writable
mkdir -p /path/to/your/custom/
```

### Development Settings

For developers or troubleshooting:

```bash
# Enable debug logging
SPIRALMEM_LOG_LEVEL=debug

# Enable API server for development
SPIRALMEM_API_ENABLED=true
SPIRALMEM_API_PORT=3000
```

## 📊 Configuration Examples

### Minimal Configuration (Most Users)
```bash
# .env file - minimal setup
SPIRALMEM_LOG_LEVEL=info
SPIRALMEM_MCP_ENABLED=true
```

### Power User Configuration
```bash
# .env file - advanced setup
SPIRALMEM_DB_PATH=/media/storage/spiralmem/database.db
SPIRALMEM_LOG_LEVEL=debug
SPIRALMEM_MCP_ENABLED=true
SPIRALMEM_API_ENABLED=true
SPIRALMEM_API_PORT=3000
YOUTUBE_API_KEY=your_actual_api_key_here
```

### Privacy-Focused Configuration
```bash
# .env file - maximum privacy
SPIRALMEM_LOG_LEVEL=error
SPIRALMEM_MCP_ENABLED=false
SPIRALMEM_API_ENABLED=false
# No YouTube API key - uses only yt-dlp
```

## 🎯 Quick Troubleshooting

**Configuration not taking effect?**
1. Restart Spiralmem after editing `.env`
2. Check file permissions (`chmod 600 .env`)
3. Verify file location (should be in installation directory)

**API key not working?**
1. Verify the key is correct (no extra spaces)
2. Check API is enabled in Google Cloud Console
3. Ensure quota hasn't been exceeded

**File permission errors?**
1. Check directory write permissions
2. Ensure database directory exists
3. Verify user has access to custom paths

## 📞 Getting Help

**Configuration issues?**
- Check the [Getting Started Guide](GETTING_STARTED.md)
- Review [Troubleshooting](README.md#troubleshooting)
- Most users don't need any configuration!

**Remember**: Spiralmem is designed to work perfectly without any configuration. Only customize if you have specific needs!