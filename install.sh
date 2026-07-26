#!/bin/bash
set -e

echo "🚀 HSMC Platform Installer"
echo "=========================="

# Detect OS
OS=$(uname -s)

# 1. Install Bun if missing
if ! command -v bun &>/dev/null; then
    echo "📦 Installing Bun..."
    curl -fsSL https://bun.sh/install | bash
    export PATH="$HOME/.bun/bin:$PATH"
fi

# 2. Clone/update repo
REPO_DIR="$HOME/hsmc-platform"
if [ -d "$REPO_DIR" ]; then
    echo "🔄 Updating..."
    cd "$REPO_DIR" && git pull
else
    echo "📥 Downloading..."
    git clone https://github.com/bnboxr/AI-agents.git "$REPO_DIR"
    cd "$REPO_DIR"
fi

# 3. Install dependencies
echo "📦 Installing dependencies..."
bun install

# 4. Create .env from example if not exists
if [ ! -f .env ]; then
    cp .env.example .env
    echo "⚠️  Created .env from .env.example — EDIT WITH YOUR API KEYS!"
    echo "   nano .env"
fi

# 5. Create desktop shortcut
mkdir -p "$HOME/.local/share/applications"
cat > "$HOME/.local/share/applications/hsmc.desktop" << EOF
[Desktop Entry]
Name=HSMC Platform
Comment=AI Hedge Fund OS — Multi-chain DeFi Platform
Exec=bun run --cwd=$REPO_DIR dev
Icon=$REPO_DIR/public/icon-512.png
Terminal=false
Type=Application
Categories=Finance;Development;
EOF

# 6. Start
echo ""
echo "✅ Installation complete!"
echo "   Start: cd $REPO_DIR && bun run dev"
echo "   Open:  http://localhost:3000"
echo ""
bun run dev
