# HSMC Platform — systemd Deployment (Alternative to PM2)

If you prefer systemd over PM2 for process management, follow this guide.

## Prerequisites

- Ubuntu 22.04+ VPS
- Bun installed (`curl -fsSL https://bun.sh/install | bash`)
- Repo cloned to `/opt/hsmc` and built (`bun install && bun run build`)

## 1. Create the systemd Service

```bash
sudo tee /etc/systemd/system/hsmc.service << 'EOF'
[Unit]
Description=HSMC AI Hedge Fund Platform
After=network-online.target
Wants=network-online.target
Documentation=https://github.com/bnboxr/AI-agents

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/hsmc
Environment="NODE_ENV=production"
EnvironmentFile=/opt/hsmc/.env
ExecStart=/home/ubuntu/.bun/bin/bun run preload.ts serve.ts
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=hsmc

# Security hardening (optional, adjust as needed)
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=/opt/hsmc
PrivateTmp=yes

[Install]
WantedBy=multi-user.target
EOF
```

> **Important**: Replace `ubuntu` with your actual username (check with `whoami`), and verify the Bun path (`which bun`).

## 2. Place your `.env` File

```bash
cat > /opt/hsmc/.env << 'ENVEOF'
BITUNIX_API_KEY=your_key_here
BITUNIX_SECRET_KEY=your_secret_here
OPENAI_API_KEY=your_key_here
DEEPSEEK_API_KEY=your_key_here
GROK_API_KEY=your_key_here
GEMINI_API_KEY=your_key_here
STARTING_CAPITAL=10000
ENVEOF
```

## 3. Enable & Start

```bash
sudo systemctl daemon-reload
sudo systemctl enable hsmc
sudo systemctl start hsmc
```

## 4. Verify

```bash
sudo systemctl status hsmc
curl -I http://localhost:3000
```

## Everyday Commands

| Command                          | What it does              |
| -------------------------------- | ------------------------- |
| `sudo systemctl status hsmc`     | Check if running          |
| `sudo systemctl restart hsmc`    | Restart after code/config change |
| `sudo systemctl stop hsmc`       | Stop the service          |
| `sudo journalctl -u hsmc -f`     | Follow logs (live)        |
| `sudo journalctl -u hsmc -n 100` | Last 100 log lines        |
| `sudo journalctl -u hsmc --since "1 hour ago"` | Logs from last hour |

## Updating to Latest Code

```bash
cd /opt/hsmc
git pull origin main
bun install --frozen-lockfile
bun run build
sudo systemctl restart hsmc
```

## Troubleshooting

### Service fails to start

```bash
# Check full journal with timestamps
sudo journalctl -u hsmc -n 50 --no-pager

# Common causes:
# - .env missing or missing keys → check with cat /opt/hsmc/.env
# - Bun binary not found   → `which bun` and update ExecStart path
# - Port 3000 already used → `sudo ss -tlnp | grep 3000`
```

### Permission errors

If the service can't read files, make sure the user in the service file owns the directory:

```bash
sudo chown -R ubuntu:ubuntu /opt/hsmc
```

### Build OOM (out of memory)

The build step may need more memory on small VPS. Add swap:

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
# Persist across reboots:
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```
