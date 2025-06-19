#\!/bin/bash
ffmpeg -f lavfi -i testsrc=duration=3:size=320x240:rate=1 -f lavfi -i sine=frequency=1000:duration=3 -c:v libx264 -t 3 -pix_fmt yuv420p -c:a aac test_video.mp4 -y
