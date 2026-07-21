# HSMC Desktop NFC Bridge

WebSocket service that enables NFC tap-to-pay on desktop (Windows, Linux, macOS) using a USB NFC reader (ACR122U or compatible).

## Architecture

```
┌──────────────────┐     WebSocket      ┌──────────────────┐
│  HSMC POS Web    │ ◄──────────────► │  NFC Bridge       │
│  (localhost:3000) │   ws://9876       │  (localhost:9876) │
└──────────────────┘                    └────────┬─────────┘
                                                 │ USB
                                          ┌──────▼──────┐
                                          │ ACR122U NFC  │
                                          │    Reader    │
                                          └──────────────┘
```

## Supported Readers

- **ACR122U** (ACS) — primary tested device
- ACR1252U
- ACR1222L
- SCL3711
- Any PC/SC-compatible NFC reader

## Prerequisites

### All Platforms
- Node.js 18+ installed

### Windows
1. Install the ACS driver from [ACS Driver Download](https://www.acs.com.hk/en/driver/3/acr122u-usb-nfc-reader/)
2. No additional system dependencies needed — the driver provides PC/SC support
3. Plug in the reader via USB

### macOS
1. No driver needed — macOS includes built-in PC/SC (pcsc-lite) support
2. Plug in the reader via USB
3. If `nfc-pcsc` reports issues, install pcsc-lite: `brew install pcsc-lite`

### Linux (Ubuntu/Debian)
```bash
sudo apt-get update
sudo apt-get install -y pcscd pcsc-tools libpcsclite-dev libnfc6 libnfc-dev
sudo systemctl enable pcscd
sudo systemctl start pcscd

# Add udev rules for ACR122U
echo 'SUBSYSTEM=="usb", ATTRS{idVendor}=="072f", ATTRS{idProduct}=="2200", MODE="0666"' | sudo tee /etc/udev/rules.d/99-acr122u.rules
sudo udevadm control --reload-rules
sudo udevadm trigger

# Replug the reader after setting up
```

### Linux (Fedora/RHEL)
```bash
sudo dnf install -y pcsc-lite pcsc-lite-devel pcsc-tools libnfc libnfc-devel
sudo systemctl enable pcscd
sudo systemctl start pcscd
```

## Installation

```bash
cd nfc-bridge
bash install.sh
```

Or manually:

```bash
cd nfc-bridge
npm install
```

## Usage

```bash
npm start
```

You should see:
```
[NFC-Bridge] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[NFC-Bridge] HSMC Desktop NFC Bridge v1.0.0
[NFC-Bridge] WebSocket server listening on ws://127.0.0.1:9876
[NFC-Bridge] Status endpoint: http://127.0.0.1:9876/status
[NFC-Bridge] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

When a reader is plugged in:
```
[NFC-Bridge] Reader detected: ACS ACR122U PICC Interface
```

## Status Endpoint

```
GET http://localhost:9876/status
```

Response:
```json
{
  "connected": true,
  "reader": "ACS ACR122U PICC Interface",
  "clients": 1,
  "uptime": 42,
  "version": "1.0.0"
}
```

## WebSocket Protocol

### Server → Client Messages

| Type | Description |
|------|-------------|
| `status` | Sent on connect with reader connection state |
| `reader-connected` | A reader was detected |
| `reader-disconnected` | The reader was removed |
| `reader-error` | Reader encountered an error |
| `nfc-tag` | An NFC tag was tapped on the reader |
| `nfc-tag-removed` | The tag was removed from the reader |
| `pong` | Response to ping |

### NFC Tag Message Format

```json
{
  "type": "nfc-tag",
  "uid": "04a1b2c3d4e5f6",
  "timestamp": 1721577634567,
  "ndefMessage": [
    {
      "tnf": 1,
      "type": "U",
      "payload": "https://example.com/pay?session=abc123"
    }
  ]
}
```

### Client → Server Messages

| Type | Response |
|------|----------|
| `ping` | Server replies with `pong` |
| `status-request` | Server replies with current `status` |

## Troubleshooting

### "No reader detected" on Linux
```bash
# Check if pcscd is running
sudo systemctl status pcscd

# List connected readers
pcsc_scan

# Check USB devices
lsusb | grep -i acr
```

### Reader not found on macOS
```bash
# Check if reader is visible
pcsctest
```

### Permission denied on Linux
Ensure udev rules are set correctly and the user is in the `plugdev` group:
```bash
sudo usermod -a -G plugdev $USER
# Log out and log back in
```

### nfc-pcsc module error
```bash
# Rebuild native modules
npm rebuild nfc-pcsc
```

## Integration with HSMC POS

The HSMC POS Terminal (`/pos`) automatically detects the desktop NFC bridge:

1. On page load, it calls `GET http://localhost:9876/status`
2. If `connected: true`, a green "Desktop NFC Reader Connected" indicator appears
3. When a payment session is active, NFC tags are read via WebSocket
4. Payment is auto-processed when a valid tag is detected
