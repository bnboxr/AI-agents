// HistoryScreen.tsx — Transaction history list

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  TouchableOpacity,
  Alert,
} from 'react-native';
import * as TransactionStore from '../services/TransactionStore';
import type { Transaction } from '../services/TransactionStore';
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

export default function HistoryScreen() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState({ totalApproved: 0, totalDeclined: 0, count: 0 });

  const loadData = useCallback(async () => {
    const txns = await TransactionStore.getTransactions(50);
    setTransactions(txns);
    const s = await TransactionStore.getSpendingStats();
    setStats(s);
  }, []);

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

  const renderItem = ({ item }: { item: Transaction }) => (
    <View style={styles.txnCard}>
      <View style={styles.txnLeft}>
        <Text style={styles.txnMerchant}>{item.merchant}</Text>
        <Text style={styles.txnDate}>{formatDate(item.date)}</Text>
        <Text style={styles.txnToken}>{item.token}</Text>
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
    </View>
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

      {/* Header with clear */}
      <View style={styles.header}>
        <Text style={styles.title}>Transactions</Text>
        {transactions.length > 0 && (
          <TouchableOpacity onPress={handleClear}>
            <Text style={styles.clearText}>Clear All</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* List */}
      {transactions.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>📋</Text>
          <Text style={styles.emptyTitle}>No Transactions</Text>
          <Text style={styles.emptySubtext}>
            Payments made via NFC tap will appear here
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background, padding: Spacing.lg },
  statsRow: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.lg },
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
    marginBottom: Spacing.md,
  },
  title: { color: Colors.text, fontSize: FontSizes.xl, fontWeight: '700' },
  clearText: { color: Colors.danger, fontSize: FontSizes.sm },
  listContent: { paddingBottom: Spacing.xxl },
  txnCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: Colors.glass,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.glassBorder,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  txnLeft: { flex: 1, gap: 2 },
  txnRight: { alignItems: 'flex-end', gap: Spacing.sm },
  txnMerchant: { color: Colors.text, fontSize: FontSizes.md, fontWeight: '600' },
  txnDate: { color: Colors.textMuted, fontSize: FontSizes.xs },
  txnToken: { color: Colors.textSecondary, fontSize: FontSizes.xs, fontFamily: 'monospace' },
  txnAmount: { fontSize: FontSizes.lg, fontWeight: '700' },
  amountPositive: { color: Colors.primary },
  amountNegative: { color: Colors.danger },
  badgeBase: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.sm,
  },
  badgeText: { fontSize: FontSizes.xs, fontWeight: '700' },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.md,
  },
  emptyIcon: { fontSize: 48 },
  emptyTitle: { color: Colors.text, fontSize: FontSizes.xl, fontWeight: '700' },
  emptySubtext: { color: Colors.textSecondary, fontSize: FontSizes.md, textAlign: 'center' },
});
