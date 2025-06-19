#!/bin/bash

# Channel processing script for spiralmem
# Usage: ./process-channel.sh <channel_url> [max_videos]

set -e

CHANNEL_URL="$1"
MAX_VIDEOS="${2:-10}"
SPIRALMEM_CMD="node /home/sgg/.spiralmem/dist/cli/spiralmem.js"

if [ -z "$CHANNEL_URL" ]; then
    echo "Usage: $0 <channel_url> [max_videos]"
    echo "Example: $0 https://www.youtube.com/@wassupwithlordbuckly1218 5"
    exit 1
fi

echo "🎬 Processing channel: $CHANNEL_URL"
echo "📺 Maximum videos to process: $MAX_VIDEOS"
echo ""

# Get list of videos from channel (under 1 hour to avoid timeout)
echo "🔍 Getting video list..."
VIDEO_LIST=$(yt-dlp --flat-playlist --dump-json "$CHANNEL_URL" 2>/dev/null | \
    head -n "$MAX_VIDEOS" | \
    grep -E '"duration": [0-9]+' | \
    awk -F'"' '/"url":/ {url=$4} /"title":/ {title=$4} /"duration":/ {duration=$4; if(duration < 3600) print url "\t" title "\t" duration}' | \
    head -n "$MAX_VIDEOS")

if [ -z "$VIDEO_LIST" ]; then
    echo "❌ No suitable videos found in channel"
    exit 1
fi

echo "📋 Found videos to process:"
echo "$VIDEO_LIST" | while IFS=$'\t' read -r url title duration; do
    minutes=$((duration / 60))
    seconds=$((duration % 60))
    echo "  • $title (${minutes}:$(printf "%02d" $seconds))"
done
echo ""

# Process each video
processed=0
failed=0

echo "$VIDEO_LIST" | while IFS=$'\t' read -r url title duration; do
    echo "🎬 Processing: $title"
    
    if $SPIRALMEM_CMD add-video "$url" --title "$title" --quiet 2>/dev/null; then
        echo "✅ Successfully processed: $title"
        ((processed++))
    else
        echo "❌ Failed to process: $title"
        ((failed++))
    fi
    echo ""
done

echo "📊 Channel processing completed!"
echo "✅ Processed: $processed videos"
echo "❌ Failed: $failed videos"
echo ""
echo "🔍 You can now search with:"
echo "  spiralmem search \"your query\""
echo "  spiralmem semantic-search \"your query\""