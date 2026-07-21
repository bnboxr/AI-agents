// TransactionStore.ts — Local transaction history using AsyncStorage
// Enhanced: categories, location, payment method, receipt, CSV export

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const TRANSACTIONS_KEY = '@hsmc_transactions';

export type TransactionCategory = 'food' | 'shopping' | 'transport' | 'entertainment' | 'utilities' | 'health' | 'travel' | 'other';
export type PaymentMethod = 'crypto' | 'virtual_card' | 'unknown';

export interface TransactionLocation {
  lat?: number;
  lng?: number;
  name?: string;
}

export interface Transaction {
  id: string;
  amount: number;
  token: string;
  merchant: string;
  date: number;
  status: 'approved' | 'declined' | 'insufficient';
  txId?: string;
  // Enhanced fields
  category?: TransactionCategory;
  paymentMethod?: PaymentMethod;
  location?: TransactionLocation;
  receiptNote?: string;
  merchantIcon?: string;  // emoji or URL
}

function generateId(): string {
  return `txn_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

// Auto-categorize based on merchant name keywords
function autoCategorize(merchant: string): TransactionCategory {
  const lower = merchant.toLowerCase();
  if (/restaurant|cafe|coffee|food|pizza|burger|sushi|dining|grill/i.test(lower)) return 'food';
  if (/shop|store|mall|market|amazon|walmart|target|costco/i.test(lower)) return 'shopping';
  if (/uber|lyft|taxi|transit|metro|bus|train|parking|gas|fuel/i.test(lower)) return 'transport';
  if (/cinema|movie|theater|netflix|spotify|game|concert|arcade/i.test(lower)) return 'entertainment';
  if (/electric|water|gas|internet|phone|utility|bill/i.test(lower)) return 'utilities';
  if (/pharmacy|hospital|doctor|clinic|health|dentist/i.test(lower)) return 'health';
  if (/airline|hotel|airbnb|booking|flight|vacation/i.test(lower)) return 'travel';
  return 'other';
}

// Auto-detect merchant icon/emoji
function autoMerchantIcon(merchant: string, category: TransactionCategory): string {
  const emojiMap: Record<TransactionCategory, string> = {
    food: '🍽️',
    shopping: '🛍️',
    transport: '🚗',
    entertainment: '🎬',
    utilities: '💡',
    health: '🏥',
    travel: '✈️',
    other: '💳',
  };
  return emojiMap[category];
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
  // Auto-categorize if no category provided
  const category = tx.category || autoCategorize(tx.merchant);
  const merchantIcon = tx.merchantIcon || autoMerchantIcon(tx.merchant, category);

  const fullTx: Transaction = {
    ...tx,
    id: generateId(),
    category,
    merchantIcon,
    paymentMethod: tx.paymentMethod || 'crypto',
  };

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

export async function getSpendingStats(): Promise<{
  totalApproved: number;
  totalDeclined: number;
  count: number;
}> {
  const txns = await getTransactions(1000);
  let totalApproved = 0;
  let totalDeclined = 0;
  for (const t of txns) {
    if (t.status === 'approved') totalApproved += t.amount;
    else totalDeclined += t.amount;
  }
  return { totalApproved, totalDeclined, count: txns.length };
}

// ─── Filtering ─────────────────────────────────────────────────────

export interface TransactionFilters {
  dateFrom?: number;
  dateTo?: number;
  categories?: TransactionCategory[];
  statuses?: Array<Transaction['status']>;
  paymentMethods?: PaymentMethod[];
  searchText?: string;
  minAmount?: number;
  maxAmount?: number;
}

export async function getFilteredTransactions(
  filters: TransactionFilters,
  limit = 200,
): Promise<Transaction[]> {
  const all = await getTransactions(1000);

  let filtered = all;

  if (filters.dateFrom) {
    filtered = filtered.filter((t) => t.date >= filters.dateFrom!);
  }
  if (filters.dateTo) {
    filtered = filtered.filter((t) => t.date <= filters.dateTo!);
  }
  if (filters.categories && filters.categories.length > 0) {
    filtered = filtered.filter((t) => filters.categories!.includes(t.category || 'other'));
  }
  if (filters.statuses && filters.statuses.length > 0) {
    filtered = filtered.filter((t) => filters.statuses!.includes(t.status));
  }
  if (filters.paymentMethods && filters.paymentMethods.length > 0) {
    filtered = filtered.filter(
      (t) => filters.paymentMethods!.includes(t.paymentMethod || 'crypto'),
    );
  }
  if (filters.searchText) {
    const search = filters.searchText.toLowerCase();
    filtered = filtered.filter(
      (t) =>
        t.merchant.toLowerCase().includes(search) ||
        t.token.toLowerCase().includes(search) ||
        (t.txId && t.txId.toLowerCase().includes(search)),
    );
  }
  if (filters.minAmount !== undefined) {
    filtered = filtered.filter((t) => t.amount >= filters.minAmount!);
  }
  if (filters.maxAmount !== undefined) {
    filtered = filtered.filter((t) => t.amount <= filters.maxAmount!);
  }

  return filtered.slice(0, limit);
}

// ─── CSV Export ─────────────────────────────────────────────────────

function escapeCSV(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export async function exportToCSV(filters?: TransactionFilters): Promise<string> {
  const txns = filters ? await getFilteredTransactions(filters) : await getTransactions(1000);

  const headers = [
    'Date',
    'Merchant',
    'Category',
    'Amount (USD)',
    'Token',
    'Status',
    'Payment Method',
    'Transaction ID',
  ];

  const rows = txns.map((t) => [
    new Date(t.date).toISOString(),
    t.merchant,
    t.category || 'other',
    t.amount.toFixed(2),
    t.token,
    t.status,
    t.paymentMethod || 'crypto',
    t.txId || t.id,
  ]);

  const csvContent = [headers, ...rows].map((row) => row.map(escapeCSV).join(',')).join('\n');
  return csvContent;
}

// ─── Category Spending Breakdown ────────────────────────────────────

export async function getCategoryBreakdown(): Promise<
  { category: TransactionCategory; total: number; count: number; icon: string }[]
> {
  const txns = await getTransactions(1000);
  const approved = txns.filter((t) => t.status === 'approved');

  const breakdown: Record<string, { total: number; count: number }> = {};

  for (const t of approved) {
    const cat = t.category || 'other';
    if (!breakdown[cat]) {
      breakdown[cat] = { total: 0, count: 0 };
    }
    breakdown[cat].total += t.amount;
    breakdown[cat].count++;
  }

  const iconMap: Record<string, string> = {
    food: '🍽️',
    shopping: '🛍️',
    transport: '🚗',
    entertainment: '🎬',
    utilities: '💡',
    health: '🏥',
    travel: '✈️',
    other: '💳',
  };

  return Object.entries(breakdown)
    .map(([category, data]) => ({
      category: category as TransactionCategory,
      ...data,
      icon: iconMap[category] || '💳',
    }))
    .sort((a, b) => b.total - a.total);
}
