# HSMC Pay — Android Tap-to-Pay

Native Android app enabling **true tap-to-pay** via NFC HCE (Host Card Emulation).
The customer sets a spending budget, taps their phone at an HSMC NFC POS
terminal, authorizes with device biometrics, and the payment is signed by their
own Polygon wallet key (EIP-712) on-device.

## Architecture

```
HSMC Pay Android APK
├── MainActivity — app entry point
├── HCE Service — HostApduService for NFC card emulation (HSMC AID)
├── Wallet Module — private key + mnemonic in the OS Keystore (AES-256-GCM,
│                   hardware-backed, biometric/passcode gated), EIP-712 signing
├── LockScreen — PIN + hardware biometric unlock
├── Budget Manager — pre-authorized spending limit
├── Transaction History — local AsyncStorage
├── Notifications — real local push (react-native-push-notification)
└── UI — glassmorphism dark theme matching the HSMC platform
```

## Flow

```
Customer taps phone at an HSMC POS terminal
       │
       ▼
Android OS routes APDU to HCEService.kt (HSMC AID F0010203040506)
       │
       ▼
HCEService emits the payment request to the React Native JS layer
       │
       ▼
HCEService.ts validates + signs the payment (WalletService.signPayment, EIP-712)
       │
       ▼
Signed (or declined) response returned to HCEService.kt
       │
       ▼
APDU response sent to the POS reader
```

Standard-EMV (Visa/Mastercard) taps are **refused cleanly**: HSMC Pay has no
card issuer, so no card data is ever fabricated.

## Prerequisites (owner's machine)

- **Node.js** 18+
- **JDK 17** (Android Gradle Plugin 8.2 requires JDK 17)
- **Android SDK** platform 34 + **build-tools 34.0.0**
  - The Gradle build reads the SDK location from `android/local.properties`
    (`sdk.dir=...`). This file is **not in the repo** — Android Studio creates
    it for you on first open; alternatively create it manually:
    `echo "sdk.dir=/path/to/Android/Sdk" > android/local.properties`
- The Gradle **wrapper is committed** (`android/gradlew`, `android/gradlew.bat`,
  `android/gradle/wrapper/gradle-wrapper.jar`) — you do **not** need to install
  Gradle separately; `./gradlew` downloads Gradle 8.6 on first run.

## Install & Build (debug)

```bash
cd hsmc-pay-android

npm install

# Debug build (uses the committed debug.keystore, no secrets needed)
cd android
./gradlew assembleDebug
```

`android/app/debug.keystore` is committed (standard `androiddebugkey` /
`android` password) so a fresh clone's debug build works immediately.

## Release APK (exact owner path)

The **release keystore is yours and is never committed** (it is gitignored as
`*.keystore`). Generate it once, keep it backed up — you need it for every
future release, and its private key can't be recovered if lost.

```bash
cd hsmc-pay-android/android/app

# 1) Generate YOUR release keystore (do this ONCE; keep it safe)
keytool -genkeypair -v -storetype PKCS12 \
  -keystore release.keystore \
  -alias hsmcpay \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass <your_keystore_password> \
  -keypass <your_key_password> \
  -dname "CN=HSMC Pay,O=HSMC,C=US"
```

> **PKCS12 quirk:** with a PKCS12 keystore, the store password and key password
> must match. Use the **same** value for both, and set the two env vars below to
> that same value for simplicity, or use a JKS store if you prefer distinct
> keystore/key passwords.

```bash
# 2) Point the build at your keystore credentials (env vars, NOT committed)
export HSMC_KEYSTORE_PASSWORD="<your_keystore_password>"
export HSMC_KEY_ALIAS="hsmcpay"
export HSMC_KEY_PASSWORD="<your_key_password>"

# 3) Build the release APK
cd ..                      # back in android/
./gradlew assembleRelease
```

The signed release APK is written to:

```
android/app/build/outputs/apk/release/app-release.apk
```

Install it on a device:

```bash
adb install android/app/build/outputs/apk/release/app-release.apk
```

> If you chose a key alias other than `hsmcpay`, set `HSMC_KEY_ALIAS` to match.
> If the build fails with a signing error, the most common cause is a mismatch
> between these three env vars and the keystore you generated — double-check
> the password/alias against `keytool -list -keystore release.keystore`.

## Install on Device

```bash
adb install android/app/build/outputs/apk/release/app-release.apk
```

## Key Files

| File | Purpose |
|------|---------|
| `App.tsx` | Main app: LockScreen + bottom tab navigation, notification init |
| `src/screens/LockScreen.tsx` | PIN + device biometric unlock |
| `src/screens/PayScreen.tsx` | Tap-to-pay interface with NFC readiness |
| `src/screens/HistoryScreen.tsx` | Transaction history list |
| `src/screens/SettingsScreen.tsx` | Wallet, budget, biometric, notification settings |
| `src/services/HCEService.ts` | NFC HCE event handling & payment logic |
| `src/services/WalletService.ts` | Wallet create/import, secure storage, biometrics, EIP-712 signing |
| `src/services/NotificationService.ts` | Real local push notifications |
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

- **Key storage**: the wallet private key and BIP-39 mnemonic are stored only in
  the OS credential vault via `react-native-keychain` using AES-256-GCM with a
  hardware-backed key (`SECURITY_LEVEL.SECURE_HARDWARE`), access-controlled to
  the current biometric set or device passcode, and wiped if the device is
  never unlocked. Never in AsyncStorage, never logged.
- **Biometric unlock**: enforced by the device; preferences like the PIN are
  local, and sensitive reads always re-trigger the biometric/passcode gate.
- **Payments**: signed on-device with the user's own key (EIP-712 typed
  payload bound to amount, token, POS settlement contract, single-use
  sessionId and a timestamp). Untrusted POS input is validated before signing.
- **No card data fabrication**: HSMC Pay has no card issuer, so no PAN/expiry/
  CVV is generated; standard-EMV taps are refused cleanly.

## Network

- **Testnet**: Polygon Amoy (chainId: 80002)
- **Mainnet**: Polygon Mainnet (chainId: 137)

## License

Proprietary — HSMC Platform
