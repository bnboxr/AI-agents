#!/bin/bash
set -e
echo "🔨 Building Windows installer..."

# First, add auto-setup logic to the entry point
# When running as .exe for first time, detect missing deps and auto-install

# Build the server
cd /home/team/shared/site
bun run build 2>/dev/null || true
bun build --compile --target=bun-windows-x64 ./serve.ts --outfile hsmc-platform.exe

echo "✅ Built: hsmc-platform.exe"
echo "   Double-click on Windows to run"
