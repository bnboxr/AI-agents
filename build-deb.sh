#!/bin/bash
# Creates a .deb package for Debian/Ubuntu
# Requires: dpkg-deb

set -e

VERSION="1.0.0"
DEB_DIR="/tmp/hsmc-deb"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Clean previous build
rm -rf "$DEB_DIR"
mkdir -p "$DEB_DIR/DEBIAN"
mkdir -p "$DEB_DIR/opt/hsmc"
mkdir -p "$DEB_DIR/usr/share/applications"
mkdir -p "$DEB_DIR/usr/share/icons/hicolor/512x512/apps"

# Copy project files (exclude build artifacts and git)
echo "📦 Copying project files..."
rsync -a --exclude='.git' --exclude='node_modules' --exclude='dist' \
      --exclude='.vercel' --exclude='*.deb' --exclude='*.exe' \
      "$SCRIPT_DIR/" "$DEB_DIR/opt/hsmc/"

# Copy icon
if [ -f "$SCRIPT_DIR/public/icon-512.png" ]; then
    cp "$SCRIPT_DIR/public/icon-512.png" "$DEB_DIR/usr/share/icons/hicolor/512x512/apps/hsmc.png"
fi

# Desktop entry
cat > "$DEB_DIR/usr/share/applications/hsmc.desktop" << EOF
[Desktop Entry]
Name=HSMC Platform
Comment=AI Hedge Fund OS — Multi-chain DeFi Platform
Exec=bun run --cwd=/opt/hsmc dev
Icon=hsmc
Terminal=false
Type=Application
Categories=Finance;Development;
EOF

# Control file
cat > "$DEB_DIR/DEBIAN/control" << EOF
Package: hsmc-platform
Version: $VERSION
Section: finance
Priority: optional
Architecture: all
Depends: curl, git
Maintainer: HSMC Team <team@hsmc.dev>
Description: AI Hedge Fund OS — Multi-chain DeFi Platform
 Autonomous trading platform with 29 AI agents, POS crypto terminal,
 multi-chain wallet support, and AI-powered market analysis.
EOF

# Post-install script
cat > "$DEB_DIR/DEBIAN/postinst" << 'EOF'
#!/bin/bash
set -e

echo "🚀 HSMC Platform Post-Install"
echo "=============================="

# Install Bun if missing
if ! command -v bun &>/dev/null; then
    echo "📦 Installing Bun..."
    curl -fsSL https://bun.sh/install | bash
    export PATH="$HOME/.bun/bin:$PATH"
    # Also symlink for system-wide access
    if [ -f "$HOME/.bun/bin/bun" ]; then
        ln -sf "$HOME/.bun/bin/bun" /usr/local/bin/bun 2>/dev/null || true
    fi
fi

cd /opt/hsmc

# Install dependencies
echo "📦 Installing dependencies..."
bun install

# Create .env from example
if [ ! -f .env ]; then
    cp .env.example .env
    echo "⚠️  Created .env from .env.example — EDIT WITH YOUR API KEYS!"
    echo "   nano /opt/hsmc/.env"
fi

# Build for production
echo "🔨 Building..."
bun run build 2>/dev/null || echo "⚠️  Build skipped (dev mode available)"

echo ""
echo "✅ HSMC installed successfully!"
echo "   Start dev:  cd /opt/hsmc && bun run dev"
echo "   Start prod: cd /opt/hsmc && bun run start"
echo "   Open:       http://localhost:3000"
echo ""
EOF
chmod +x "$DEB_DIR/DEBIAN/postinst"

# Pre-remove script
cat > "$DEB_DIR/DEBIAN/prerm" << 'EOF'
#!/bin/bash
echo "Removing HSMC Platform..."
# Stop any running HSMC processes
pkill -f "bun run.*hsmc" 2>/dev/null || true
pkill -f "bun.*serve.ts" 2>/dev/null || true
EOF
chmod +x "$DEB_DIR/DEBIAN/prerm"

# Build the .deb
echo "🔨 Building .deb package..."
dpkg-deb --build "$DEB_DIR" "hsmc-platform_${VERSION}_all.deb"

echo ""
echo "✅ .deb built: hsmc-platform_${VERSION}_all.deb"
echo "   Install: sudo dpkg -i hsmc-platform_${VERSION}_all.deb"
