// TransactionStore.ts — Local transaction history using AsyncStorage

import AsyncStorage from '@react-native-async-storage/async-storage';

const TRANSACTIONS_KEY = '@hsmc_transactions';

export interface Transaction {
  id: string;
  amount: number;
  token: string;
  merchant: string;
  date: number;
  status: 'approved' | 'declined' | 'insufficient';
  txId?: string;
}

function generateId(): string {
  return `txn_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

export async function getTransactions(limit = 50): Promise<Transaction[]> {
  try {
    const raw = await AsyncStorage.getItem(TRANSACTIONS_KEY);
    if (!raw) return [];
    const txns: Transaction[] = JSON.parse(raw);
    return txns.slice(0, limit);
  } catch {
    return [];
  }
}

export async function addTransaction(tx: Omit<Transaction, 'id'>): Promise<Transaction> {
  const fullTx: Transaction = { ...tx, id: generateId() };
  const existing = await getTransactions(1000);
  existing.unshift(fullTx);
  // Keep only last 1000 transactions
  const trimmed = existing.slice(0, 1000);
  await AsyncStorage.setItem(TRANSACTIONS_KEY, JSON.stringify(trimmed));
  return fullTx;
}

export async function getTransactionById(id: string): Promise<Transaction | null> {
  const txns = await getTransactions(1000);
  return txns.find((t) => t.id === id) || null;
}

export async function clearHistory(): Promise<void> {
  await AsyncStorage.removeItem(TRANSACTIONS_KEY);
}

export async function getSpendingStats(): Promise<{ totalApproved: number; totalDeclined: number; count: number }> {
  const txns = await getTransactions(1000);
  let totalApproved = 0;
  let totalDeclined = 0;
  for (const t of txns) {
    if (t.status === 'approved') totalApproved += t.amount;
    else totalDeclined += t.amount;
  }
  return { totalApproved, totalDeclined, count: txns.length };
}
