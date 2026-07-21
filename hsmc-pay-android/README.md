# HSMC Pay — Android Tap-to-Pay

Native Android app enabling **true tap-to-pay** via NFC HCE (Host Card Emulation). Customer installs → sets a spending budget → taps phone at any NFC-enabled POS → payment auto-processed with no manual confirmation.

## Architecture

```
HSMC Pay Android APK
├── MainActivity — app entry point
├── HCE Service — HostApduService for NFC card emulation
├── Wallet Module — stores private key (encrypted), signs transactions (EIP-712)
├── Budget Manager — pre-authorized spending limit
├── Transaction History — local SQLite + AsyncStorage
├── Settings — budget, wallet, network selector
└── UI — glassmorphism dark theme matching HSMC platform
```

## Flow

```
Customer taps phone at POS
       │
       ▼
Android OS routes APDU to HCEService.kt
       │
       ▼
HCEService emits event to React Native JS layer
       │
       ▼
HCEService.ts parses payment request:
  - Check budget (BudgetService)
  - Sign authorization (WalletService)
  - Record transaction (TransactionStore)
       │
       ▼
Signed response returned to HCEService.kt
       │
       ▼
APDU response sent to POS reader
```

## Prerequisites

- **Node.js** 18+
- **Android Studio** with Android SDK 34+
- **JDK** 17
- **React Native CLI** (`npx react-native`)
- **Android device** with NFC HCE support (Android 4.4+ / API 19+)

## Install & Build

```bash
# Clone repo
cd hsmc-pay-android

# Install dependencies
npm install

# Run on connected device/emulator
npx react-native run-android

# Metro bundler (if not auto-started)
npx react-native start
```

## Release APK

```bash
cd android

# Set keystore environment variables
export HSMC_KEYSTORE_PASSWORD="your_password"
export HSMC_KEY_ALIAS="hsmcpay"
export HSMC_KEY_PASSWORD="your_password"

# Build release
./gradlew assembleRelease

# APK output
# android/app/build/outputs/apk/release/app-release.apk
```

## Install on Device

```bash
adb install android/app/build/outputs/apk/release/app-release.apk
```

## Key Files

| File | Purpose |
|------|---------|
| `App.tsx` | Main app with bottom tab navigation |
| `src/screens/WalletScreen.tsx` | Wallet balance, budget bar, quick actions |
| `src/screens/PayScreen.tsx` | Tap-to-pay interface with NFC readiness |
| `src/screens/HistoryScreen.tsx` | Transaction history list |
| `src/screens/SettingsScreen.tsx` | Wallet, budget, network settings |
| `src/services/HCEService.ts` | NFC HCE event handling & payment logic |
| `src/services/WalletService.ts` | Wallet creation, import, EIP-712 signing |
| `src/services/BudgetService.ts` | Budget management with AsyncStorage |
| `src/services/TransactionStore.ts` | Local transaction history |
| `android/.../HCEService.kt` | Native Android HostApduService |
| `android/.../HCEBridgeModule.kt` | React Native ↔ Android bridge |

## Theme

Glassmorphism dark theme matching the HSMC platform:
- Background: `#080a0f`
- Accent: `#00e676` (green)
- Glass panels: `rgba(255,255,255,0.07)` with subtle borders

## Security

⚠️ **Prototype Note**: In this prototype, the private key is stored using basic encryption in AsyncStorage. For production:
- Use **Android Keystore** for hardware-backed key storage
- Integrate `react-native-keychain` for biometric-protected access
- Implement proper key derivation (PBKDF2/Argon2)

## Network

- **Testnet**: Polygon Amoy (chainId: 80002)
- **Mainnet**: Polygon Mainnet (chainId: 137)

## License

Proprietary — HSMC Platform
