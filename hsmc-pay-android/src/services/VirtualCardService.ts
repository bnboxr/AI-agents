// VirtualCardService.ts — Virtual card management backed by crypto balance
// Allows creation of virtual Visa/Mastercard cards that can be used
// on standard POS terminals via HCE EMV emulation.

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as WalletService from './WalletService';

const CARDS_KEY = '@hsmc_virtual_cards';
const TOPUP_THRESHOLD_KEY = '@hsmc_topup_threshold';

export interface VirtualCard {
  id: string;
  pan: string;         // masked: ****1234
  expiryMonth: number;
  expiryYear: number;
  cvv: string;         // stored encrypted in production
  type: 'visa' | 'mastercard';
  balance: number;     // in USD
  frozen: boolean;
  label: string;
  createdAt: number;
  autoTopup: boolean;
  topupThreshold: number;  // top up when balance falls below this
  topupAmount: number;     // amount to top up
}

function generateCardId(): string {
  return `card_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

function generatePAN(prefix: string): string {
  // Generate a VISA/MC-like PAN for emulation
  let pan = prefix;
  for (let i = 0; i < 12; i++) {
    pan += Math.floor(Math.random() * 10).toString();
  }
  // Simple Luhn check digit
  const digits = pan.split('').map(Number);
  let sum = 0;
  let double = true;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits[i];
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  const checkDigit = (10 - (sum % 10)) % 10;
  return pan + checkDigit.toString();
}

function generateCVV(): string {
  return Math.floor(Math.random() * 900 + 100).toString();
}

function maskPAN(pan: string): string {
  return `****${pan.slice(-4)}`;
}

export async function createVirtualCard(
  type: 'visa' | 'mastercard',
  label: string,
  autoTopup: boolean = true,
  topupThreshold: number = 50,
  topupAmount: number = 200,
): Promise<VirtualCard> {
  const prefix = type === 'visa' ? '4' : '5';
  const fullPAN = generatePAN(prefix);
  const now = new Date();

  const card: VirtualCard = {
    id: generateCardId(),
    pan: fullPAN,
    expiryMonth: now.getMonth() + 1,
    expiryYear: now.getFullYear() + 4,
    cvv: generateCVV(),
    type,
    balance: 0,
    frozen: false,
    label,
    createdAt: Date.now(),
    autoTopup,
    topupThreshold,
    topupAmount,
  };

  const cards = await getCards();
  cards.push(card);
  await AsyncStorage.setItem(CARDS_KEY, JSON.stringify(cards));

  // Initial topup if auto-topup enabled
  if (autoTopup) {
    await topUpCard(card.id, topupAmount);
  }

  return card;
}

export async function getCards(): Promise<VirtualCard[]> {
  try {
    const raw = await AsyncStorage.getItem(CARDS_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function getCardById(id: string): Promise<VirtualCard | null> {
  const cards = await getCards();
  return cards.find((c) => c.id === id) || null;
}

export async function freezeCard(id: string): Promise<void> {
  const cards = await getCards();
  const card = cards.find((c) => c.id === id);
  if (!card) throw new Error('Card not found');
  card.frozen = true;
  await AsyncStorage.setItem(CARDS_KEY, JSON.stringify(cards));
}

export async function unfreezeCard(id: string): Promise<void> {
  const cards = await getCards();
  const card = cards.find((c) => c.id === id);
  if (!card) throw new Error('Card not found');
  card.frozen = false;
  await AsyncStorage.setItem(CARDS_KEY, JSON.stringify(cards));
}

export async function deleteCard(id: string): Promise<void> {
  const cards = await getCards();
  const filtered = cards.filter((c) => c.id !== id);
  await AsyncStorage.setItem(CARDS_KEY, JSON.stringify(filtered));
}

export async function topUpCard(id: string, amount: number): Promise<VirtualCard> {
  const cards = await getCards();
  const card = cards.find((c) => c.id === id);
  if (!card) throw new Error('Card not found');

  // In production: check crypto wallet balance and deduct
  const walletAddress = await WalletService.getWalletAddress();
  if (!walletAddress) throw new Error('No wallet configured');

  card.balance += amount;
  await AsyncStorage.setItem(CARDS_KEY, JSON.stringify(cards));
  return card;
}

export async function spendFromCard(id: string, amount: number): Promise<VirtualCard> {
  const cards = await getCards();
  const card = cards.find((c) => c.id === id);
  if (!card) throw new Error('Card not found');
  if (card.frozen) throw new Error('Card is frozen');
  if (card.balance < amount) throw new Error('Insufficient card balance');

  card.balance -= amount;
  await AsyncStorage.setItem(CARDS_KEY, JSON.stringify(cards));

  // Auto-topup if below threshold
  if (card.autoTopup && card.balance < card.topupThreshold) {
    await topUpCard(id, card.topupAmount);
  }

  return card;
}

export async function getCardDetailsForDisplay(id: string): Promise<{
  maskedPAN: string;
  expiryMonth: number;
  expiryYear: number;
  cvv: string;
  type: string;
  balance: number;
  frozen: boolean;
} | null> {
  const card = await getCardById(id);
  if (!card) return null;
  return {
    maskedPAN: maskPAN(card.pan),
    expiryMonth: card.expiryMonth,
    expiryYear: card.expiryYear,
    cvv: card.cvv,
    type: card.type,
    balance: card.balance,
    frozen: card.frozen,
  };
}

export async function getDefaultCard(): Promise<VirtualCard | null> {
  const cards = await getCards();
  return cards.find((c) => !c.frozen) || null;
}

// Get card data for EMV emulation (full PAN, not masked)
export async function getCardForEMV(id: string): Promise<VirtualCard | null> {
  return getCardById(id);
}
