#!/bin/bash
set -e
VERSION="1.0.0"
DEB_NAME="hsmc-platform_${VERSION}_all"
DEB_ROOT="/tmp/${DEB_NAME}"
rm -rf "$DEB_ROOT"
mkdir -p "$DEB_ROOT/DEBIAN"
mkdir -p "$DEB_ROOT/opt/hsmc-platform"
mkdir -p "$DEB_ROOT/usr/share/applications"
mkdir -p "$DEB_ROOT/usr/share/icons/hicolor/256x256/apps"

# Copy project (exclude node_modules, .git, dist)
rsync -av --exclude 'node_modules' --exclude '.git' --exclude 'dist' --exclude 'hsmc-pay-android' . "$DEB_ROOT/opt/hsmc-platform/"

# Control file
cat > "$DEB_ROOT/DEBIAN/control" << EOF
Package: hsmc-platform
Version: $VERSION
Section: finance
Priority: optional
Architecture: all
Depends: curl, git, unzip
Maintainer: HSMC <team@hsmc.dev>
Description: HSMC Platform — AI Hedge Fund OS
 Multi-chain DeFi platform with 29 AI agents, POS crypto terminal,
 multi-chain wallet, and autonomous trading.
EOF

# Post-install — runs during dpkg -i
cat > "$DEB_ROOT/DEBIAN/postinst" << 'POSTINST'
#!/bin/bash
set -e
echo "🚀 Setting up HSMC Platform..."

# Install Bun
if ! command -v bun &>/dev/null; then
    echo "📦 Installing Bun..."
    curl -fsSL https://bun.sh/install | bash
    export BUN_INSTALL="$HOME/.bun"
    export PATH="$BUN_INSTALL/bin:$PATH"
fi

# Install deps
cd /opt/hsmc-platform
bun install

# Create .env from example
if [ ! -f .env ]; then
    cp .env.example .env
    echo "⚠️  Created .env — edit with: nano /opt/hsmc-platform/.env"
fi

# Desktop entry
cat > /usr/share/applications/hsmc-platform.desktop << 'DESKTOP'
[Desktop Entry]
Name=HSMC Platform
Comment=AI Hedge Fund OS
Exec=bun run --cwd=/opt/hsmc-platform dev
Icon=hsmc-platform
Terminal=false
Type=Application
Categories=Finance;
DESKTOP

echo "✅ HSMC Platform installed!"
echo "   Start: cd /opt/hsmc-platform && bun run dev"
echo "   Or launch from applications menu"
POSTINST
chmod +x "$DEB_ROOT/DEBIAN/postinst"

# Pre-remove cleanup
cat > "$DEB_ROOT/DEBIAN/prerm" << 'PRERM'
#!/bin/bash
echo "Removing HSMC Platform..."
rm -f /usr/share/applications/hsmc-platform.desktop
PRERM
chmod +x "$DEB_ROOT/DEBIAN/prerm"

# Build .deb
dpkg-deb --build "$DEB_ROOT" "$DEB_NAME.deb"
echo "✅ Built: $DEB_NAME.deb"
echo "   Install: sudo dpkg -i $DEB_NAME.deb"
