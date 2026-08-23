// VirtualCardService.ts — Virtual card management
//
// IMPORTANT (owner decision): HSMC Pay has NO real card-issuer pipeline. There
// is no card network (Visa/Mastercard) issuing PANs on the app's behalf, so a
// card can never be genuinely issued on device. This module therefore REFUSES
// card creation with a clear error instead of fabricating a random PAN/expiry/
// CVV — emitting a made-up PAN would be indistinguishable from a real card in
// the HCE/EMV path and is forbidden.
//
// Consequences:
//   * createVirtualCard() always fails with a readable error. No card is ever
//     created, so getCards() returns [].
//   * The HCE tap path (HCEService.ts / HCEService.kt) must refuse a
//     standard-EMV (Visa/Mastercard) tap cleanly, because there is no issued
//     card behind it. Only the HSMC native (EIP-712 wallet) payment path is
//     real.
//
// The management helpers (freeze/unfreeze/delete/top-up/spend) operate on the
// persisted card list so that the moment a genuine issuer is integrated, the
// storage + management layer is already correct — but with no issuable cards
// they remain inert.

import AsyncStorage from '@react-native-async-storage/async-storage';

const CARDS_KEY = '@hsmc_virtual_cards';

export interface VirtualCard {
  id: string;
  /** Masked PAN (e.g. ****1234). Only ever set for a genuinely issued card. */
  pan: string;
  expiryMonth: number;
  expiryYear: number;
  /** Stored encrypted in production; never a generated value. */
  cvv: string;
  type: 'visa' | 'mastercard';
  balance: number; // in USD
  frozen: boolean;
  label: string;
  createdAt: number;
  autoTopup: boolean;
  topupThreshold: number; // top up when balance falls below this
  topupAmount: number; // amount to top up
}

/**
 * Create a virtual card.
 *
 * There is no card issuer configured for HSMC Pay, so this deliberately fails.
 * A card must be issued by a real card network / issuer before a PAN can
 * legitimately exist; generating one locally would be counterfeit and is
 * never done.
 */
export async function createVirtualCard(
  _type: 'visa' | 'mastercard',
  _label: string,
  _autoTopup: boolean = true,
  _topupThreshold: number = 50,
  _topupAmount: number = 200,
): Promise<VirtualCard> {
  throw new Error(
    'Virtual card issuing is not available. HSMC Pay has no card issuer ' +
      'configured — connect a real card issuer, or pay directly from your ' +
      'wallet via the HSMC tap-to-pay path.',
  );
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
    maskedPAN: card.pan,
    expiryMonth: card.expiryMonth,
    expiryYear: card.expiryYear,
    cvv: card.cvv,
    type: card.type,
    balance: card.balance,
    frozen: card.frozen,
  };
}

/**
 * The tap-to-pay default card for standard-EMV terminals.
 *
 * Because no card can be genuinely issued (see class comment), there is never
 * a default card: returns null and the HCE path declines the EMV tap cleanly.
 */
export async function getDefaultCard(): Promise<VirtualCard | null> {
  const cards = await getCards();
  return cards.find((c) => !c.frozen) || null;
}

/** Card data for EMV emulation. No issued card exists — always null. */
export async function getCardForEMV(_id: string): Promise<VirtualCard | null> {
  return null;
}
