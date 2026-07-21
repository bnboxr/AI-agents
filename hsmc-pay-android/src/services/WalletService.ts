// WalletService.ts — Manages the user's crypto wallet
// Uses ethers.js for wallet operations and AsyncStorage for encrypted key storage

import { ethers } from 'ethers';
import AsyncStorage from '@react-native-async-storage/async-storage';

const WALLET_KEY = '@hsmc_wallet';
const WALLET_ADDRESS_KEY = '@hsmc_wallet_address';
const ENCRYPTION_SALT = 'hsmc_pay_v1_salt_2024';

// In a production app, the private key would be stored in Android Keystore.
// This implementation uses AsyncStorage with basic encryption for the prototype.
// For production: integrate react-native-keychain or Android Keystore native module.

function simpleEncrypt(data: string, salt: string): string {
  // Basic XOR encryption — prototype only
  // Production must use Android Keystore / react-native-keychain
  const salted = salt + data;
  let result = '';
  for (let i = 0; i < salted.length; i++) {
    result += String.fromCharCode(salted.charCodeAt(i) ^ salt.charCodeAt(i % salt.length));
  }
  return Buffer.from(result).toString('base64');
}

function simpleDecrypt(encrypted: string, salt: string): string {
  const decoded = Buffer.from(encrypted, 'base64').toString();
  let result = '';
  for (let i = 0; i < decoded.length; i++) {
    result += String.fromCharCode(decoded.charCodeAt(i) ^ salt.charCodeAt(i % salt.length));
  }
  return result.slice(salt.length);
}

export async function createWallet(): Promise<{ address: string; mnemonic: string }> {
  const wallet = ethers.Wallet.createRandom();
  const mnemonic = wallet.mnemonic!.phrase;
  const privateKey = wallet.privateKey;

  const encrypted = simpleEncrypt(privateKey, ENCRYPTION_SALT);
  await AsyncStorage.setItem(WALLET_KEY, encrypted);
  await AsyncStorage.setItem(WALLET_ADDRESS_KEY, wallet.address);

  return { address: wallet.address, mnemonic };
}

export async function importWallet(privateKeyOrMnemonic: string): Promise<{ address: string }> {
  let wallet: ethers.Wallet;

  try {
    // Try as private key first
    wallet = new ethers.Wallet(privateKeyOrMnemonic);
  } catch {
    // Try as mnemonic
    wallet = ethers.Wallet.fromPhrase(privateKeyOrMnemonic);
  }

  const encrypted = simpleEncrypt(wallet.privateKey, ENCRYPTION_SALT);
  await AsyncStorage.setItem(WALLET_KEY, encrypted);
  await AsyncStorage.setItem(WALLET_ADDRESS_KEY, wallet.address);

  return { address: wallet.address };
}

async function getWallet(): Promise<ethers.Wallet | null> {
  const encrypted = await AsyncStorage.getItem(WALLET_KEY);
  if (!encrypted) return null;

  const privateKey = simpleDecrypt(encrypted, ENCRYPTION_SALT);
  return new ethers.Wallet(privateKey);
}

export async function getWalletAddress(): Promise<string | null> {
  return AsyncStorage.getItem(WALLET_ADDRESS_KEY);
}

export async function signPayment(payload: {
  amount: string;
  token: string;
  contractAddress: string;
  sessionId: string;
}): Promise<{ signature: string; walletAddress: string }> {
  const wallet = await getWallet();
  if (!wallet) throw new Error('No wallet configured');

  // Create EIP-712 typed data for the payment authorization
  const domain = {
    name: 'HSMC Pay',
    version: '1',
    chainId: 80002, // Polygon Amoy testnet
    verifyingContract: payload.contractAddress,
  };

  const types = {
    Payment: [
      { name: 'amount', type: 'uint256' },
      { name: 'token', type: 'address' },
      { name: 'sessionId', type: 'string' },
      { name: 'timestamp', type: 'uint256' },
    ],
  };

  const value = {
    amount: payload.amount,
    token: payload.token,
    sessionId: payload.sessionId,
    timestamp: Math.floor(Date.now() / 1000),
  };

  const signature = await wallet.signTypedData(domain, types, value);
  return { signature, walletAddress: wallet.address };
}

export async function getBalance(): Promise<{ matic: string; usdc: string; usdt: string }> {
  // Returns placeholder balances — real implementation queries blockchain
  return {
    matic: '0.00',
    usdc: '0.00',
    usdt: '0.00',
  };
}

export async function exportPrivateKey(): Promise<string> {
  const wallet = await getWallet();
  if (!wallet) throw new Error('No wallet configured');
  return wallet.privateKey;
}

export async function getMnemonic(): Promise<string | null> {
  const wallet = await getWallet();
  return wallet?.mnemonic?.phrase || null;
}

export async function deleteWallet(): Promise<void> {
  await AsyncStorage.removeItem(WALLET_KEY);
  await AsyncStorage.removeItem(WALLET_ADDRESS_KEY);
}
