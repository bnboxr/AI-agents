import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';
import { ethers } from 'ethers';

const WALLET_KEY = 'hsmc_wallet_address';
const KEYCHAIN_SERVICE = 'HSMC_WALLET';

async function storePrivateKey(address: string, privateKey: string): Promise<void> {
  await Keychain.setInternetCredentials(KEYCHAIN_SERVICE, address, privateKey, {
    accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_CURRENT_SET_OR_DEVICE_PASSCODE,
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    securityLevel: Keychain.SECURITY_LEVEL.SECURE_HARDWARE,
    storage: Keychain.STORAGE_TYPE.AES,
  });
}

async function getPrivateKey(address: string): Promise<string | null> {
  const credentials = await Keychain.getInternetCredentials(KEYCHAIN_SERVICE);
  if (!credentials || credentials.username !== address) return null;
  return credentials.password;
}

async function removePrivateKey(address: string): Promise<void> {
  const credentials = await Keychain.getInternetCredentials(KEYCHAIN_SERVICE);
  if (credentials && credentials.username === address) {
    await Keychain.resetInternetCredentials(KEYCHAIN_SERVICE);
  }
}

export async function createWallet(): Promise<{ address: string; mnemonic: string }> {
  const wallet = ethers.Wallet.createRandom();
  await storePrivateKey(wallet.address, wallet.privateKey);
  await AsyncStorage.setItem(WALLET_KEY, wallet.address);
  return { address: wallet.address, mnemonic: wallet.mnemonic!.phrase };
}

export async function importWallet(mnemonic: string): Promise<{ address: string }> {
  const wallet = ethers.Wallet.fromPhrase(mnemonic);
  await storePrivateKey(wallet.address, wallet.privateKey);
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
    await AsyncStorage.removeItem(WALLET_KEY);
  }
}

export async function getWalletAddress(): Promise<string | null> {
  return AsyncStorage.getItem(WALLET_KEY);
}
