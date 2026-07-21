// HistoryScreen.tsx — Enhanced transaction history with filtering,
// categories, receipt view with TXID, map location, and CSV export

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  TouchableOpacity,
  Alert,
  Modal,
  ScrollView,
  Share,
  Platform,
} from 'react-native';
import * as TransactionStore from '../services/TransactionStore';
import type {
  Transaction,
  TransactionCategory,
  TransactionFilters,
  PaymentMethod,
} from '../services/TransactionStore';
import { Colors, Spacing, FontSizes, BorderRadius } from '../theme/colors';

function formatDate(timestamp: number): string {
  const d = new Date(timestamp);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatFullDate(timestamp: number): string {
  const d = new Date(timestamp);
  return d.toLocaleString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatAmount(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

function StatusBadge({ status }: { status: Transaction['status'] }) {
  const config = {
    approved: { bg: Colors.primaryDim, text: Colors.primary, label: 'Approved' },
    declined: { bg: 'rgba(255,23,68,0.15)', text: Colors.danger, label: 'Declined' },
    insufficient: { bg: 'rgba(255,171,0,0.15)', text: Colors.warning, label: 'Budget' },
  };

  const s = config[status];
  return (
    <View style={[styles.badgeBase, { backgroundColor: s.bg }]}>
      <Text style={[styles.badgeText, { color: s.text }]}>{s.label}</Text>
    </View>
  );
}

// ─── Filter chip component ─────────────────────────────────────────

function FilterChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.filterChip, active && styles.filterChipActive]}
      onPress={onPress}
    >
      <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

// ─── Category icon map ─────────────────────────────────────────────

const CATEGORY_ICONS: Record<TransactionCategory, string> = {
  food: '🍽️',
  shopping: '🛍️',
  transport: '🚗',
  entertainment: '🎬',
  utilities: '💡',
  health: '🏥',
  travel: '✈️',
  other: '💳',
};

const CATEGORY_LABELS: Record<TransactionCategory, string> = {
  food: 'Food',
  shopping: 'Shopping',
  transport: 'Transport',
  entertainment: 'Entertainment',
  utilities: 'Utilities',
  health: 'Health',
  travel: 'Travel',
  other: 'Other',
};

export default function HistoryScreen() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState({ totalApproved: 0, totalDeclined: 0, count: 0 });

  // Filter state
  const [showFilters, setShowFilters] = useState(false);
  const [activeFilters, setActiveFilters] = useState<TransactionFilters>({});
  const [selectedCategories, setSelectedCategories] = useState<TransactionCategory[]>([]);
  const [selectedStatuses, setSelectedStatuses] = useState<Array<Transaction['status']>>([]);
  const [selectedPaymentMethods, setSelectedPaymentMethods] = useState<PaymentMethod[]>([]);
  const [searchText, setSearchText] = useState('');

  // Receipt modal
  const [selectedTxn, setSelectedTxn] = useState<Transaction | null>(null);
  const [showReceipt, setShowReceipt] = useState(false);

  // Category breakdown
  const [categoryBreakdown, setCategoryBreakdown] = useState<
    { category: TransactionCategory; total: number; count: number; icon: string }[]
  >([]);

  const loadData = useCallback(async () => {
    const filters: TransactionFilters = {
      ...activeFilters,
      categories: selectedCategories.length > 0 ? selectedCategories : undefined,
      statuses: selectedStatuses.length > 0 ? selectedStatuses : undefined,
      paymentMethods: selectedPaymentMethods.length > 0 ? selectedPaymentMethods : undefined,
      searchText: searchText || undefined,
    };

    const txns = await TransactionStore.getFilteredTransactions(filters, 100);
    setTransactions(txns);

    const s = await TransactionStore.getSpendingStats();
    setStats(s);

    const breakdown = await TransactionStore.getCategoryBreakdown();
    setCategoryBreakdown(breakdown);
  }, [activeFilters, selectedCategories, selectedStatuses, selectedPaymentMethods, searchText]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const handleClear = () => {
    Alert.alert('Clear History', 'Delete all transaction history?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: async () => {
          await TransactionStore.clearHistory();
          loadData();
        },
      },
    ]);
  };

  const handleExportCSV = async () => {
    try {
      const filters: TransactionFilters = {
        ...activeFilters,
        categories: selectedCategories.length > 0 ? selectedCategories : undefined,
        statuses: selectedStatuses.length > 0 ? selectedStatuses : undefined,
        paymentMethods: selectedPaymentMethods.length > 0 ? selectedPaymentMethods : undefined,
      };
      const csv = await TransactionStore.exportToCSV(filters);
      await Share.share({
        message: csv,
        title: 'HSMC Pay Transactions',
      });
    } catch (e: any) {
      Alert.alert('Export Error', e.message);
    }
  };

  const handleTxnPress = (txn: Transaction) => {
    setSelectedTxn(txn);
    setShowReceipt(true);
  };

  const toggleCategory = (cat: TransactionCategory) => {
    setSelectedCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat],
    );
  };

  const toggleStatus = (status: Transaction['status']) => {
    setSelectedStatuses((prev) =>
      prev.includes(status) ? prev.filter((s) => s !== status) : [...prev, status],
    );
  };

  const togglePaymentMethod = (pm: PaymentMethod) => {
    setSelectedPaymentMethods((prev) =>
      prev.includes(pm) ? prev.filter((p) => p !== pm) : [...prev, pm],
    );
  };

  const clearFilters = () => {
    setSelectedCategories([]);
    setSelectedStatuses([]);
    setSelectedPaymentMethods([]);
    setSearchText('');
    setShowFilters(false);
  };

  const hasActiveFilters =
    selectedCategories.length > 0 ||
    selectedStatuses.length > 0 ||
    selectedPaymentMethods.length > 0 ||
    !!searchText;

  const renderItem = ({ item }: { item: Transaction }) => (
    <TouchableOpacity style={styles.txnCard} onPress={() => handleTxnPress(item)}>
      <View style={styles.txnIconContainer}>
        <Text style={styles.txnIcon}>{item.merchantIcon || CATEGORY_ICONS[item.category || 'other']}</Text>
      </View>
      <View style={styles.txnLeft}>
        <Text style={styles.txnMerchant}>{item.merchant}</Text>
        <View style={styles.txnMetaRow}>
          <Text style={styles.txnCategory}>{CATEGORY_LABELS[item.category || 'other']}</Text>
          <Text style={styles.txnDot}>·</Text>
          <Text style={styles.txnDate}>{formatDate(item.date)}</Text>
        </View>
        {item.paymentMethod && (
          <Text style={styles.txnPaymentMethod}>
            {item.paymentMethod === 'crypto' ? '🔗 Crypto' : '💳 Card'}
          </Text>
        )}
      </View>
      <View style={styles.txnRight}>
        <Text
          style={[
            styles.txnAmount,
            item.status === 'approved' ? styles.amountPositive : styles.amountNegative,
          ]}
        >
          {item.status === 'approved' ? '-' : ''}{formatAmount(item.amount)}
        </Text>
        <StatusBadge status={item.status} />
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      {/* Stats Summary */}
      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>${stats.totalApproved.toFixed(2)}</Text>
          <Text style={styles.statLabel}>Spent</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>${stats.totalDeclined.toFixed(2)}</Text>
          <Text style={styles.statLabel}>Declined</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{stats.count}</Text>
          <Text style={styles.statLabel}>Total</Text>
        </View>
      </View>

      {/* Header with filter + export */}
      <View style={styles.header}>
        <Text style={styles.title}>Transactions</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={() => setShowFilters(!showFilters)}>
            <Text style={[styles.actionText, hasActiveFilters && styles.actionTextActive]}>
              Filter
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleExportCSV}>
            <Text style={styles.actionText}>Export</Text>
          </TouchableOpacity>
          {transactions.length > 0 && (
            <TouchableOpacity onPress={handleClear}>
              <Text style={styles.clearText}>Clear</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Filter panel */}
      {showFilters && (
        <View style={styles.filterPanel}>
          <Text style={styles.filterSectionTitle}>Category</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow}>
            {(Object.keys(CATEGORY_LABELS) as TransactionCategory[]).map((cat) => (
              <FilterChip
                key={cat}
                label={`${CATEGORY_ICONS[cat]} ${CATEGORY_LABELS[cat]}`}
                active={selectedCategories.includes(cat)}
                onPress={() => toggleCategory(cat)}
              />
            ))}
          </ScrollView>

          <Text style={styles.filterSectionTitle}>Status</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow}>
            {(['approved', 'declined', 'insufficient'] as Array<Transaction['status']>).map(
              (status) => (
                <FilterChip
                  key={status}
                  label={status.charAt(0).toUpperCase() + status.slice(1)}
                  active={selectedStatuses.includes(status)}
                  onPress={() => toggleStatus(status)}
                />
              ),
            )}
          </ScrollView>

          <Text style={styles.filterSectionTitle}>Payment Method</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow}>
            {(['crypto', 'virtual_card', 'unknown'] as PaymentMethod[]).map((pm) => (
              <FilterChip
                key={pm}
                label={pm === 'crypto' ? 'Crypto' : pm === 'virtual_card' ? 'Card' : 'Unknown'}
                active={selectedPaymentMethods.includes(pm)}
                onPress={() => togglePaymentMethod(pm)}
              />
            ))}
          </ScrollView>

          {hasActiveFilters && (
            <TouchableOpacity style={styles.clearFiltersBtn} onPress={clearFilters}>
              <Text style={styles.clearFiltersText}>Clear All Filters</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Category breakdown */}
      {categoryBreakdown.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.breakdownRow}>
          {categoryBreakdown.map((b) => (
            <View key={b.category} style={styles.breakdownChip}>
              <Text style={styles.breakdownIcon}>{b.icon}</Text>
              <Text style={styles.breakdownAmount}>${b.total.toFixed(0)}</Text>
              <Text style={styles.breakdownLabel}>{b.count} txns</Text>
            </View>
          ))}
        </ScrollView>
      )}

      {/* List */}
      {transactions.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>📋</Text>
          <Text style={styles.emptyTitle}>No Transactions</Text>
          <Text style={styles.emptySubtext}>
            {hasActiveFilters
              ? 'No transactions match your filters. Try adjusting them.'
              : 'Payments made via NFC tap will appear here'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={transactions}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={Colors.primary}
              colors={[Colors.primary]}
            />
          }
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Receipt Modal */}
      <Modal visible={showReceipt} transparent animationType="slide">
        <View style={styles.receiptOverlay}>
          <View style={styles.receiptContainer}>
            {selectedTxn && (
              <ScrollView>
                {/* Receipt header */}
                <View style={styles.receiptHeader}>
                  <Text style={styles.receiptIcon}>
                    {selectedTxn.merchantIcon || CATEGORY_ICONS[selectedTxn.category || 'other']}
                  </Text>
                  <Text style={styles.receiptTitle}>Transaction Receipt</Text>
                </View>

                {/* Status */}
                <View
                  style={[
                    styles.receiptStatus,
                    selectedTxn.status === 'approved'
                      ? styles.receiptStatusApproved
                      : styles.receiptStatusDeclined,
                  ]}
                >
                  <Text style={styles.receiptStatusText}>
                    {selectedTxn.status === 'approved'
                      ? '✅ Payment Approved'
                      : selectedTxn.status === 'declined'
                        ? '❌ Payment Declined'
                        : '⚠️ Insufficient Budget'}
                  </Text>
                </View>

                {/* Details */}
                <View style={styles.receiptSection}>
                  <View style={styles.receiptRow}>
                    <Text style={styles.receiptLabel}>Amount</Text>
                    <Text style={styles.receiptValue}>
                      ${selectedTxn.amount.toFixed(2)}
                    </Text>
                  </View>
                  <View style={styles.receiptDivider} />
                  <View style={styles.receiptRow}>
                    <Text style={styles.receiptLabel}>Merchant</Text>
                    <Text style={styles.receiptValue}>{selectedTxn.merchant}</Text>
                  </View>
                  <View style={styles.receiptDivider} />
                  <View style={styles.receiptRow}>
                    <Text style={styles.receiptLabel}>Category</Text>
                    <Text style={styles.receiptValue}>
                      {CATEGORY_LABELS[selectedTxn.category || 'other']}
                    </Text>
                  </View>
                  <View style={styles.receiptDivider} />
                  <View style={styles.receiptRow}>
                    <Text style={styles.receiptLabel}>Date</Text>
                    <Text style={styles.receiptValue}>{formatFullDate(selectedTxn.date)}</Text>
                  </View>
                  <View style={styles.receiptDivider} />
                  <View style={styles.receiptRow}>
                    <Text style={styles.receiptLabel}>Token</Text>
                    <Text style={styles.receiptValue}>{selectedTxn.token}</Text>
                  </View>
                  <View style={styles.receiptDivider} />
                  <View style={styles.receiptRow}>
                    <Text style={styles.receiptLabel}>Payment Method</Text>
                    <Text style={styles.receiptValue}>
                      {selectedTxn.paymentMethod === 'crypto' ? 'Crypto (Direct)' : 'Virtual Card'}
                    </Text>
                  </View>
                  <View style={styles.receiptDivider} />
                  <View style={styles.receiptRow}>
                    <Text style={styles.receiptLabel}>Transaction ID</Text>
                    <Text style={styles.receiptValueMono} selectable>
                      {selectedTxn.txId || selectedTxn.id}
                    </Text>
                  </View>
                </View>

                {/* Location info if available */}
                {selectedTxn.location && (
                  <View style={styles.receiptSection}>
                    <Text style={styles.receiptSectionTitle}>📍 Location</Text>
                    {selectedTxn.location.name && (
                      <Text style={styles.receiptValue}>{selectedTxn.location.name}</Text>
                    )}
                    {selectedTxn.location.lat && selectedTxn.location.lng && (
                      <Text style={styles.receiptValueMono}>
                        {selectedTxn.location.lat.toFixed(6)},{' '}
                        {selectedTxn.location.lng.toFixed(6)}
                      </Text>
                    )}
                  </View>
                )}

                {/* Receipt note */}
                {selectedTxn.receiptNote && (
                  <View style={styles.receiptSection}>
                    <Text style={styles.receiptSectionTitle}>📝 Note</Text>
                    <Text style={styles.receiptValue}>{selectedTxn.receiptNote}</Text>
                  </View>
                )}

                <TouchableOpacity
                  style={styles.receiptCloseBtn}
                  onPress={() => setShowReceipt(false)}
                >
                  <Text style={styles.receiptCloseText}>Close</Text>
                </TouchableOpacity>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background, padding: Spacing.lg },
  statsRow: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.md },
  statCard: {
    flex: 1,
    backgroundColor: Colors.glass,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.glassBorder,
    padding: Spacing.md,
    alignItems: 'center',
  },
  statValue: { color: Colors.primary, fontSize: FontSizes.lg, fontWeight: '700' },
  statLabel: { color: Colors.textMuted, fontSize: FontSizes.xs, marginTop: 2 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  title: { color: Colors.text, fontSize: FontSizes.xl, fontWeight: '700' },
  headerActions: { flexDirection: 'row', gap: Spacing.md, alignItems: 'center' },
  actionText: { color: Colors.textSecondary, fontSize: FontSizes.sm },
  actionTextActive: { color: Colors.primary, fontWeight: '700' },
  clearText: { color: Colors.danger, fontSize: FontSizes.sm },

  // Filter panel
  filterPanel: {
    backgroundColor: Colors.glass,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.glassBorder,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    gap: Spacing.sm,
  },
  filterSectionTitle: {
    color: Colors.textSecondary,
    fontSize: FontSizes.xs,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: Spacing.xs,
  },
  filterRow: { flexDirection: 'row', marginBottom: Spacing.xs },
  filterChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.round,
    marginRight: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.glassBorder,
  },
  filterChipActive: {
    backgroundColor: Colors.primaryDim,
    borderColor: Colors.primary,
  },
  filterChipText: { color: Colors.textSecondary, fontSize: FontSizes.xs },
  filterChipTextActive: { color: Colors.primary, fontWeight: '600' },
  clearFiltersBtn: { alignSelf: 'center', paddingVertical: Spacing.xs },
  clearFiltersText: { color: Colors.warning, fontSize: FontSizes.xs },

  // Category breakdown
  breakdownRow: { marginBottom: Spacing.md, paddingBottom: Spacing.xs },
  breakdownChip: {
    backgroundColor: Colors.glass,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.glassBorder,
    padding: Spacing.sm,
    marginRight: Spacing.sm,
    alignItems: 'center',
    minWidth: 80,
  },
  breakdownIcon: { fontSize: 20 },
  breakdownAmount: { color: Colors.text, fontSize: FontSizes.sm, fontWeight: '700' },
  breakdownLabel: { color: Colors.textMuted, fontSize: FontSizes.xs },

  // Transaction list
  listContent: { paddingBottom: Spacing.xxl },
  txnCard: {
    flexDirection: 'row',
    backgroundColor: Colors.glass,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.glassBorder,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    alignItems: 'center',
  },
  txnIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: Spacing.md,
  },
  txnIcon: { fontSize: 20 },
  txnLeft: { flex: 1, gap: 2 },
  txnRight: { alignItems: 'flex-end', gap: Spacing.sm },
  txnMerchant: { color: Colors.text, fontSize: FontSizes.md, fontWeight: '600' },
  txnMetaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  txnCategory: { color: Colors.textSecondary, fontSize: FontSizes.xs },
  txnDot: { color: Colors.textMuted, fontSize: FontSizes.xs },
  txnDate: { color: Colors.textMuted, fontSize: FontSizes.xs },
  txnPaymentMethod: { color: Colors.textMuted, fontSize: FontSizes.xs },
  txnAmount: { fontSize: FontSizes.lg, fontWeight: '700' },
  amountPositive: { color: Colors.primary },
  amountNegative: { color: Colors.danger },
  badgeBase: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.sm,
  },
  badgeText: { fontSize: FontSizes.xs, fontWeight: '700' },

  // Empty state
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.md,
  },
  emptyIcon: { fontSize: 48 },
  emptyTitle: { color: Colors.text, fontSize: FontSizes.xl, fontWeight: '700' },
  emptySubtext: { color: Colors.textSecondary, fontSize: FontSizes.md, textAlign: 'center' },

  // Receipt Modal
  receiptOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    padding: Spacing.lg,
  },
  receiptContainer: {
    backgroundColor: Colors.background,
    borderRadius: BorderRadius.xl,
    borderWidth: 1,
    borderColor: Colors.glassBorder,
    maxHeight: '80%',
    padding: Spacing.lg,
  },
  receiptHeader: { alignItems: 'center', marginBottom: Spacing.lg },
  receiptIcon: { fontSize: 48, marginBottom: Spacing.sm },
  receiptTitle: { color: Colors.text, fontSize: FontSizes.xl, fontWeight: '700' },
  receiptStatus: {
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.md,
    alignItems: 'center',
  },
  receiptStatusApproved: { backgroundColor: Colors.primaryDim },
  receiptStatusDeclined: { backgroundColor: 'rgba(255,23,68,0.15)' },
  receiptStatusText: { color: Colors.text, fontSize: FontSizes.md, fontWeight: '700' },
  receiptSection: {
    backgroundColor: Colors.glass,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.glassBorder,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    gap: Spacing.sm,
  },
  receiptSectionTitle: {
    color: Colors.textSecondary,
    fontSize: FontSizes.xs,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: Spacing.xs,
  },
  receiptRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  receiptDivider: {
    height: 1,
    backgroundColor: Colors.glassBorder,
    marginVertical: Spacing.xs,
  },
  receiptLabel: { color: Colors.textSecondary, fontSize: FontSizes.sm },
  receiptValue: { color: Colors.text, fontSize: FontSizes.sm, fontWeight: '600', maxWidth: '55%', textAlign: 'right' },
  receiptValueMono: {
    color: Colors.text,
    fontSize: FontSizes.xs,
    fontFamily: 'monospace',
    maxWidth: '60%',
    textAlign: 'right',
  },
  receiptCloseBtn: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.md,
    alignItems: 'center',
  },
  receiptCloseText: { color: Colors.background, fontSize: FontSizes.md, fontWeight: '700' },
});
