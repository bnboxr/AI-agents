// WalletService.ts — Manages the user's crypto wallet
//
// Security posture (applies to the private key AND the recovery mnemonic):
//   - Stored in the OS credential vault via react-native-keychain with
//     STORAGE_TYPE.AES (AES-256-GCM), SECURITY_LEVEL.SECURE_HARDWARE,
//     ACCESS_CONTROL.BIOMETRY_CURRENT_SET_OR_DEVICE_PASSCODE and
//     ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY.
//     Every read (signing, export, recovery-phrase retrieval) therefore goes
//     through the device biometric / passcode gate.
//   - Never persisted in AsyncStorage or plaintext; never logged.
//   - Single-wallet assumption: exactly one credential is stored per keychain
//     service, keyed by the wallet address in the username field, and every
//     read cross-checks username === address before returning material.
//
// Payment authorization (signPayment) uses EIP-712 typed-data signing. The
// scheme is described in the PAYMENT_EIP712 section below so the verifying
// side (POS terminal / settlement contract) can reconstruct the exact domain
// and struct. See signPayment() for the verifier contract.

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';
import { ethers } from 'ethers';

const WALLET_KEY = 'hsmc_wallet_address';
const KEYCHAIN_SERVICE = 'HSMC_WALLET';
const MNEMONIC_KEYCHAIN_SERVICE = 'HSMC_WALLET_MNEMONIC';

// ─── Keychain storage (private key + mnemonic) ──────────────────────────

async function storePrivateKey(address: string, privateKey: string): Promise<void> {
  await Keychain.setInternetCredentials(KEYCHAIN_SERVICE, address, privateKey, {
    accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_CURRENT_SET_OR_DEVICE_PASSCODE,
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    securityLevel: Keychain.SECURITY_LEVEL.SECURE_HARDWARE,
    storage: Keychain.STORAGE_TYPE.AES,
  });
}

/**
 * Persist the BIP-39 recovery phrase with the same protection as the private
 * key (AES-256-GCM + hardware-backed key + biometric/passcode gate).
 * The mnemonic is only ever written here — never to AsyncStorage or logs.
 */
async function storeMnemonic(address: string, mnemonic: string): Promise<void> {
  await Keychain.setInternetCredentials(MNEMONIC_KEYCHAIN_SERVICE, address, mnemonic, {
    accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_CURRENT_SET_OR_DEVICE_PASSCODE,
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    securityLevel: Keychain.SECURITY_LEVEL.SECURE_HARDWARE,
    storage: Keychain.STORAGE_TYPE.AES,
  });
}

async function getPrivateKey(address: string): Promise<string | null> {
  const credentials = await Keychain.getInternetCredentials(KEYCHAIN_SERVICE);
  // The app is single-wallet: one credential per service. The username
  // cross-check guards against a credential belonging to a different address.
  if (!credentials || credentials.username !== address) return null;
  return credentials.password;
}

async function getStoredMnemonic(address: string): Promise<string | null> {
  const credentials = await Keychain.getInternetCredentials(MNEMONIC_KEYCHAIN_SERVICE);
  if (!credentials || credentials.username !== address) return null;
  return credentials.password;
}

async function removePrivateKey(address: string): Promise<void> {
  const credentials = await Keychain.getInternetCredentials(KEYCHAIN_SERVICE);
  if (credentials && credentials.username === address) {
    await Keychain.resetInternetCredentials(KEYCHAIN_SERVICE);
  }
}

async function removeMnemonic(address: string): Promise<void> {
  const credentials = await Keychain.getInternetCredentials(MNEMONIC_KEYCHAIN_SERVICE);
  if (credentials && credentials.username === address) {
    await Keychain.resetInternetCredentials(MNEMONIC_KEYCHAIN_SERVICE);
  }
}

// ─── Wallet lifecycle ───────────────────────────────────────────────────

export async function createWallet(): Promise<{ address: string; mnemonic: string }> {
  const wallet = ethers.Wallet.createRandom();
  const mnemonic = wallet.mnemonic!.phrase;
  await storePrivateKey(wallet.address, wallet.privateKey);
  await storeMnemonic(wallet.address, mnemonic);
  await AsyncStorage.setItem(WALLET_KEY, wallet.address);
  return { address: wallet.address, mnemonic };
}

/**
 * Import a wallet from either a private key (0x-prefixed hex) or a BIP-39
 * mnemonic phrase, matching the UI ("Enter private key or mnemonic phrase").
 * When the input is a mnemonic, the normalized phrase is persisted encrypted
 * so getMnemonic() can retrieve it later. A private-key import has no
 * recovery phrase on this device — getMnemonic() will return null for it.
 */
export async function importWallet(privateKeyOrMnemonic: string): Promise<{ address: string }> {
  const input = (privateKeyOrMnemonic || '').trim();
  if (!input) throw new Error('Enter a private key or mnemonic phrase');

  let wallet: ethers.BaseWallet;
  let mnemonic: string | null = null;

  if (input.startsWith('0x') || /^[0-9a-fA-F]{64}$/.test(input)) {
    // Private key path — throws a clear error for invalid input.
    wallet = new ethers.Wallet(input);
  } else {
    // Mnemonic path — validates word list + checksum, throws on bad phrases.
    // fromPhrase returns an HDNodeWallet; keep the normalized phrase so
    // getMnemonic() can retrieve it later.
    const hdWallet = ethers.Wallet.fromPhrase(input);
    mnemonic = hdWallet.mnemonic?.phrase ?? null;
    wallet = hdWallet;
  }

  await storePrivateKey(wallet.address, wallet.privateKey);
  if (mnemonic) {
    await storeMnemonic(wallet.address, mnemonic);
  }
  await AsyncStorage.setItem(WALLET_KEY, wallet.address);
  return { address: wallet.address };
}

export async function loadWallet(): Promise<ethers.Wallet | null> {
  const address = await AsyncStorage.getItem(WALLET_KEY);
  if (!address) return null;
  const privateKey = await getPrivateKey(address);
  if (!privateKey) return null;
  return new ethers.Wallet(privateKey);
}

export async function deleteWallet(): Promise<void> {
  const address = await AsyncStorage.getItem(WALLET_KEY);
  if (address) {
    await removePrivateKey(address);
    await removeMnemonic(address); // wipe the recovery phrase too
    await AsyncStorage.removeItem(WALLET_KEY);
  }
}

export async function getWalletAddress(): Promise<string | null> {
  return AsyncStorage.getItem(WALLET_KEY);
}

// ─── Sensitive reveal operations ────────────────────────────────────────

/**
 * Return the wallet's BIP-39 recovery phrase from secure storage.
 *
 * The phrase is persisted encrypted (AES-256-GCM, hardware-backed, biometric
 * / passcode access control) at create/import time. Reading it re-requires
 * the biometric gate. Returns null when no wallet exists or the wallet was
 * imported from a private key (no phrase exists on this device).
 */
export async function getMnemonic(): Promise<string | null> {
  const address = await AsyncStorage.getItem(WALLET_KEY);
  if (!address) return null;
  return getStoredMnemonic(address);
}

/**
 * Export the wallet private key.
 *
 * The key is read from Keychain (biometric/passcode-gated on every read).
 * Never logged, never persisted outside Keychain.
 */
export async function exportPrivateKey(): Promise<string> {
  const address = await AsyncStorage.getItem(WALLET_KEY);
  if (!address) throw new Error('No wallet configured');
  const privateKey = await getPrivateKey(address);
  if (!privateKey) throw new Error('Wallet private key is unavailable');
  return privateKey;
}

// ─── Biometric enrollment & authentication ───────────────────────────────
//
// Unlock uses the device's hardware-backed biometric / passcode gate. A small
// probe secret is stored in the OS Keystore with biometric access control;
// reading it back forces the real biometric prompt and only resolves on a
// successful authentication. The wallet's private key / mnemonic themselves
// are stored with the same access control, so every sensitive read is already
// gated by the device biometric.

const BIOMETRIC_PROBE_SERVICE = 'HSMC_BIOMETRIC_PROBE';

/**
 * Enable biometric unlock. Stores a probe secret under hardware-backed
 * biometric access control. Once present, authenticateWithBiometrics() can
 * drive the device prompt. Safe to call repeatedly.
 */
export async function enableBiometricUnlock(): Promise<void> {
  await Keychain.setGenericPassword('hsmc-pay', 'enabled', {
    service: BIOMETRIC_PROBE_SERVICE,
    accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_CURRENT_SET_OR_DEVICE_PASSCODE,
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    securityLevel: Keychain.SECURITY_LEVEL.SECURE_HARDWARE,
    storage: Keychain.STORAGE_TYPE.AES,
  });
}

/** Remove the biometric probe (disables biometric unlock). */
export async function disableBiometricUnlock(): Promise<void> {
  try {
    await Keychain.resetGenericPassword({ service: BIOMETRIC_PROBE_SERVICE });
  } catch {
    // Nothing to clear — treat as clean.
  }
}

/**
 * Authenticate the user with the device biometrics / passcode.
 *
 * Reads the probe secret: on a device where it was created under biometric
 * access control this triggers the system biometric dialog and only returns
 * the secret after a successful match. Returns true when the user
 * authenticated, false when they cancelled / were not recognized, and throws
 * only on a genuine keystore failure (which callers surface as an error, not
 * a silent bypass).
 */
export async function authenticateWithBiometrics(
  promptTitle: string,
): Promise<boolean> {
  try {
    const credentials = await Keychain.getGenericPassword({
      service: BIOMETRIC_PROBE_SERVICE,
      authenticationPrompt: { title: promptTitle },
      accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_CURRENT_SET_OR_DEVICE_PASSCODE,
    });
    return credentials !== false;
  } catch {
    // Cancel / not recognized is a normal negative result, not a bypass.
    return false;
  }
}

/** Whether biometric unlock has been enrolled on this device. */
export async function isBiometricEnrolled(): Promise<boolean> {
  try {
    const credentials = await Keychain.getGenericPassword({
      service: BIOMETRIC_PROBE_SERVICE,
    });
    return credentials !== false;
  } catch {
    return false;
  }
}

// ─── Payment authorization (EIP-712) ────────────────────────────────────
//
// PAYMENT SCHEME (verifier contract — keep both sides in sync):
//
//   Domain:
//     name:             'HSMC Pay'
//     version:          '1'
//     chainId:          80002  (Polygon Amoy) — MUST equal the chain id of
//                        the chain where the POS settlement contract
//                        (verifyingContract) is deployed. The POS terminal
//                        service defaults to Polygon Amoy (chainId 80002);
//                        if the settlement contract is ever deployed to
//                        Polygon mainnet, change PAYMENT_CHAIN_ID to 137 on
//                        BOTH the phone and the verifier in the same release.
//     verifyingContract: contractAddress from the POS payment request
//
//   Primary type:
//     Payment(uint256 amount, address token, string sessionId, uint256 timestamp)
//
//   The signed payload binds the payment authorization to a specific POS
//   session: exact amount (token smallest units), token contract, POS
//   settlement contract (domain), sessionId and a UNIX timestamp.
//
//   HOW TO VERIFY (terminal / backend):
//     1. Rebuild the domain + Payment struct above with the same values.
//     2. signer = ethers.verifyTypedData(domain, types, value, signature)
//        (or ecrecover of the EIP-712 digest) — compare to the payer address
//        returned in the payment response.
//     3. Enforce timestamp freshness (reject if |now - timestamp| > 300s).
//     4. Enforce sessionId single-use (reject if already seen).
//
//   Replay protection: timestamp + single-use sessionId. The signature itself
//   is deterministic for identical input; freshness/single-use checks are the
//   verifier's responsibility.
export const PAYMENT_CHAIN_ID = 80002; // Polygon Amoy (see note above)
export const PAYMENT_DOMAIN_NAME = 'HSMC Pay';
export const PAYMENT_DOMAIN_VERSION = '1';
export const PAYMENT_TIMESTAMP_MAX_AGE_SECONDS = 300;

export const PAYMENT_TYPES: Record<string, Array<{ name: string; type: string }>> = {
  Payment: [
    { name: 'amount', type: 'uint256' },
    { name: 'token', type: 'address' },
    { name: 'sessionId', type: 'string' },
    { name: 'timestamp', type: 'uint256' },
  ],
};

export interface SignPaymentParams {
  /** Token amount in the token's smallest unit (decimal string, e.g. wei). */
  amount: string;
  /** ERC-20 token contract address. */
  token: string;
  /** HSMC POS settlement contract address (the EIP-712 verifyingContract). */
  contractAddress: string;
  /** POS payment session id — single-use, replay-protected. */
  sessionId: string;
}

/**
 * Validate hostile input received from the NFC reader before signing.
 * The payment request originates from an untrusted POS reader, so every field
 * is strictly checked. Failures surface as errors (never a fallback value).
 */
function validateSignPaymentParams(params: SignPaymentParams): void {
  if (!params || typeof params !== 'object') {
    throw new Error('Invalid payment parameters');
  }
  if (typeof params.amount !== 'string' || !/^\d+$/.test(params.amount)) {
    throw new Error(
      "Invalid payment amount: expected a non-negative integer in the token's smallest unit",
    );
  }
  if (typeof params.token !== 'string' || !ethers.isAddress(params.token)) {
    throw new Error('Invalid token address');
  }
  if (typeof params.contractAddress !== 'string' || !ethers.isAddress(params.contractAddress)) {
    throw new Error('Invalid contract address');
  }
  if (
    typeof params.sessionId !== 'string' ||
    params.sessionId.trim().length === 0 ||
    params.sessionId.length > 256
  ) {
    throw new Error('Invalid sessionId');
  }
}

/**
 * Sign a POS payment authorization (EIP-712 typed data) with the wallet key.
 *
 * Returns only the signature; the wallet address travels separately in the
 * HCE payment response so the terminal can verify signer === payer.
 */
export async function signPayment(params: SignPaymentParams): Promise<{ signature: string }> {
  const wallet = await loadWallet();
  if (!wallet) throw new Error('No wallet configured');
  validateSignPaymentParams(params);

  const domain = {
    name: PAYMENT_DOMAIN_NAME,
    version: PAYMENT_DOMAIN_VERSION,
    chainId: PAYMENT_CHAIN_ID,
    verifyingContract: params.contractAddress,
  };

  const value = {
    amount: params.amount,
    token: params.token,
    sessionId: params.sessionId,
    timestamp: Math.floor(Date.now() / 1000),
  };

  const signature = await wallet.signTypedData(domain, PAYMENT_TYPES, value);
  return { signature };
}
