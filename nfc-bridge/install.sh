#!/bin/bash
#
# HSMC Desktop NFC Bridge Installer
# Installs dependencies for the NFC bridge service.
#

set -e

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  HSMC Desktop NFC Bridge — Installer"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is required. Install from https://nodejs.org"
    exit 1
fi

echo "✅ Node.js $(node --version)"

# Install npm dependencies
echo ""
echo "📦 Installing npm dependencies..."
cd "$(dirname "$0")"
npm install

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Installation complete!"
echo ""
echo "  To start:  npm start"
echo ""
echo "  Requirements:"
echo "    - ACR122U USB NFC reader (or compatible)"
echo "    - PC/SC driver (see README.md for OS-specific setup)"
echo "    - USB port"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
