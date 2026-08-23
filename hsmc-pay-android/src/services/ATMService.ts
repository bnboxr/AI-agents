// ATMService.ts — ATM locator using OpenStreetMap Nominatim API (free, no key)
// Handles nearby ATM search, transaction logging, and fee calculation

import AsyncStorage from '@react-native-async-storage/async-storage';

const ATM_HISTORY_KEY = '@hsmc_atm_transactions';
const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';

export interface ATM {
  id: string;
  name: string;
  bank: string;
  address: string;
  lat: number;
  lng: number;
  distance: number; // km
  supportsWithdraw: boolean;
  supportsDeposit: boolean;
  fee: string; // e.g. "1.5%"
  hours: string; // e.g. "24/7" or "6:00-22:00"
}

export interface ATMTransaction {
  id: string;
  type: 'withdraw' | 'deposit';
  fiatAmount: number;
  cryptoAmount: number;
  token: string;
  atmName: string;
  bank: string;
  address: string;
  date: number;
  status: 'completed' | 'pending' | 'failed';
  fee: number;
  txId?: string;
}

function generateId(): string {
  return `atm_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

// ─── ATM Finder using OpenStreetMap Nominatim API ────────────────────

export async function findNearbyATMs(
  lat: number,
  lng: number,
  radius: number = 5,
): Promise<ATM[]> {
  try {
    const bboxLat = radius / 111.0;
    const bboxLng = radius / (111.0 * Math.cos((lat * Math.PI) / 180));
    const viewbox = `${lng - bboxLng},${lat - bboxLat},${lng + bboxLng},${lat + bboxLat}`;

    const url =
      `${NOMINATIM_BASE}/search?` +
      `q=ATM|bank+ATM|bancomat&` +
      `format=json&` +
      `limit=25&` +
      `viewbox=${viewbox}&` +
      `bounded=1&` +
      `addressdetails=1`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'HSMCPay/1.0 (Android)',
        'Accept': 'application/json',
      },
    });

    const data = await response.json();

    if (!Array.isArray(data)) return [];

    const atms: ATM[] = data
      .filter((place: any) => {
        const type = (place.type || '').toLowerCase();
        const cat = (place.category || '').toLowerCase();
        return (
          type === 'atm' ||
          type === 'bank' ||
          cat === 'atm' ||
          cat === 'bank' ||
          (place.name || '').toLowerCase().includes('atm') ||
          (place.name || '').toLowerCase().includes('bank')
        );
      })
      .map((place: any, index: number) => {
        const placeLat = parseFloat(place.lat);
        const placeLng = parseFloat(place.lon);
        const dist = haversineDistance(lat, lng, placeLat, placeLng);
        const address = place.address || {};
        const bankName =
          address.bank || address.name || place.name || 'Unknown Bank';

        return {
          id: `atm_${index}_${place.place_id || Math.random().toString(36).substr(2, 6)}`,
          name: place.name || `${bankName} ATM`,
          bank: bankName,
          address: [
            address.road || address.street || '',
            address.city || address.town || address.village || '',
            address.country || '',
          ]
            .filter(Boolean)
            .join(', '),
          lat: placeLat,
          lng: placeLng,
          distance: Math.round(dist * 100) / 100,
          // Locator metadata is conservative-by-default: we know an ATM is
          // present, but fee/hours/deposit support are unknown without live
          // data, so surfaces are displayed in the UI, not fabricated.
          supportsWithdraw: true,
          supportsDeposit: false,
          fee: 'see ATM',
          hours: 'see ATM',
        };
      })
      .sort((a: ATM, b: ATM) => a.distance - b.distance);

    return atms;
  } catch (error) {
    console.error('Error fetching ATMs:', error);
    // No fabricated fallback data: report that no ATMs could be loaded.
    return [];
  }
}

// ─── Haversine distance calculation ──────────────────────────────────

function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// ─── Fee Calculator ──────────────────────────────────────────────────

export function estimateATMFee(
  amount: number,
  cryptoToFiat: boolean,
): { fee: number; total: number } {
  const baseFee = 1.5; // base ATM fee in fiat
  const percentageFee = amount * 0.015; // 1.5% conversion fee
  const cryptoPremium = cryptoToFiat ? amount * 0.005 : amount * 0.003; // additional crypto premium
  const fee = baseFee + percentageFee + cryptoPremium;
  const total = cryptoToFiat ? amount - fee : amount + fee;
  return {
    fee: Math.round(fee * 100) / 100,
    total: Math.round(total * 100) / 100,
  };
}

// ─── ATM Transaction Logging ─────────────────────────────────────────

export async function logATMTransaction(
  tx: Omit<ATMTransaction, 'id'>,
): Promise<ATMTransaction> {
  const fullTx: ATMTransaction = {
    ...tx,
    id: generateId(),
  };

  try {
    const existing = await getATMHistory();
    existing.unshift(fullTx);
    const trimmed = existing.slice(0, 500);
    await AsyncStorage.setItem(ATM_HISTORY_KEY, JSON.stringify(trimmed));
  } catch (e) {
    console.error('Error logging ATM transaction:', e);
  }

  return fullTx;
}

export async function getATMHistory(): Promise<ATMTransaction[]> {
  try {
    const raw = await AsyncStorage.getItem(ATM_HISTORY_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function getATMFilteredHistory(
  type?: 'withdraw' | 'deposit',
): Promise<ATMTransaction[]> {
  const all = await getATMHistory();
  if (type) {
    return all.filter((tx) => tx.type === type);
  }
  return all;
}

export async function clearATMHistory(): Promise<void> {
  await AsyncStorage.removeItem(ATM_HISTORY_KEY);
}