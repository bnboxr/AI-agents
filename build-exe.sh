#!/bin/bash
# Build standalone Windows .exe using Bun's compile feature
# This runs on Linux and cross-compiles to Windows x64.
# Requires: bun >= 1.1

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "🔨 Building HSMC standalone Windows executable..."
echo "================================================="

# Ensure dependencies are installed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    bun install
fi

# Build the project first (needed for dist/)
echo "📦 Building project..."
bun run build

# Compile the server entry point into a standalone .exe
echo "🔨 Compiling Windows .exe..."
bun build --compile --target=bun-windows-x64 ./serve.ts --outfile hsmc-server.exe

echo ""
echo "✅ Windows .exe built: hsmc-server.exe"
echo "   Copy hsmc-server.exe to any Windows machine."
echo "   It bundles the Bun runtime — no install needed on target."
echo ""
echo "   Usage on Windows:"
echo "     hsmc-server.exe"
echo "     (Opens http://localhost:3000 in browser)"
