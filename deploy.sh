#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
# HSMC Platform — VPS Deployment Script
# Run on Ubuntu 22.04+ VPS
# ═══════════════════════════════════════════════════════════════════════
set -euo pipefail

echo "🚀 HSMC Platform — Deploying..."

# ── 1. System dependencies ──────────────────────────────────────────
echo "📦 Installing system packages..."
sudo apt-get update -qq
sudo apt-get install -y -qq git curl unzip build-essential 2>&1 | tail -1

# ── 2. Install Bun ───────────────────────────────────────────────────
if ! command -v bun &>/dev/null; then
  echo "🥟 Installing Bun..."
  curl -fsSL https://bun.sh/install | bash
  # Make bun available in this session
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
else
  echo "🥟 Bun already installed: $(bun --version)"
fi

# ── 3. Clone or update repo ──────────────────────────────────────────
REPO_DIR="/opt/hsmc"
if [ -d "$REPO_DIR/.git" ]; then
  echo "📥 Updating existing repo..."
  cd "$REPO_DIR"
  git fetch origin
  git reset --hard origin/main
else
  echo "📥 Cloning repository..."
  sudo mkdir -p "$REPO_DIR"
  sudo chown "$USER:$USER" "$REPO_DIR"
  git clone https://github.com/bnboxr/AI-agents.git "$REPO_DIR"
  cd "$REPO_DIR"
  git checkout main
fi

# ── 4. Create .env (user must fill this) ─────────────────────────────
if [ ! -f .env ]; then
  cat > .env << 'ENVEOF'
# ═══ HSMC Environment Variables ═══
# Fill in your keys below, then restart: pm2 restart hsmc

# Exchange API (Bitunix for perpetuals)
BITUNIX_API_KEY=your_key_here
BITUNIX_SECRET_KEY=your_secret_here

# LLM Providers (at least one required for AI agents)
OPENAI_API_KEY=your_key_here
DEEPSEEK_API_KEY=your_key_here
GROK_API_KEY=your_key_here
GEMINI_API_KEY=your_key_here

# Optional
STARTING_CAPITAL=10000
PAPER_BALANCES={"BTC":0.5,"ETH":5,"USDT":10000}
COPY_TRADE_WALLETS=
RESERVOIR_API_KEY=
ENVEOF
  echo "⚠️  .env created — EDIT IT with your API keys before starting!"
else
  echo "✅ .env already exists, skipping..."
fi

# ── 5. Install dependencies & build ──────────────────────────────────
echo "📦 Installing dependencies..."
bun install --frozen-lockfile

echo "🔨 Building..."
bun run build

# ── 6. Install PM2 & start ───────────────────────────────────────────
if ! command -v pm2 &>/dev/null; then
  echo "🔄 Installing PM2..."
  bun add -g pm2
fi

# Ensure Bun binary path resolution in PM2 (use full path)
BUN_PATH="$(which bun)"

if pm2 list 2>/dev/null | grep -q "hsmc"; then
  echo "🔄 Restarting existing hsmc process..."
  pm2 restart hsmc
else
  echo "🟢 Starting hsmc..."
  pm2 start --name hsmc \
    --interpreter "$BUN_PATH" \
    -- preload.ts serve.ts
fi

pm2 save
pm2 startup systemd -u "$USER" --hp "$HOME" 2>/dev/null || true

# ── 7. Done ──────────────────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════════"
echo "  ✅ HSMC Platform deployed!"
echo "  Visit: http://$(hostname -I 2>/dev/null | awk '{print $1}' || echo 'YOUR_VPS_IP'):3000"
echo ""
echo "  Useful commands:"
echo "    pm2 logs hsmc       — View logs"
echo "    pm2 restart hsmc    — Restart"
echo "    pm2 stop hsmc       — Stop"
echo "══════════════════════════════════════════════"
