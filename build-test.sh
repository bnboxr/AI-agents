#!/bin/bash
cd /home/team/shared/site
# Kill any existing vite processes
pkill -9 -f "vite" 2>/dev/null
sleep 1
# Try building
bun run build 2>&1
echo "BUILD_EXIT_CODE=$?"
