// WalletScreen.tsx — Wallet overview with balance, budget bar, quick actions

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import * as WalletService from '../services/WalletService';
import * as BudgetService from '../services/BudgetService';
import { Colors, Spacing, FontSizes, BorderRadius } from '../theme/colors';

export default function WalletScreen() {
  const [address, setAddress] = useState<string | null>(null);
  const [budget, setBudget] = useState({ limit: 0, spent: 0, period: 'monthly' as const, remaining: 0 });
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const addr = await WalletService.getWalletAddress();
      setAddress(addr);

      const b = await BudgetService.getBudget();
      setBudget({
        limit: b.limit,
        spent: b.spent,
        period: b.period,
        remaining: Math.max(0, b.limit - b.spent),
      });
    } catch (e) {
      console.error('Error loading wallet data:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCreateWallet = async () => {
    try {
      const result = await WalletService.createWallet();
      setAddress(result.address);
      Alert.alert('Wallet Created', `Address: ${result.address.slice(0, 10)}...\n\nMnemonic: ${result.mnemonic.slice(0, 30)}...\n\n⚠️ Save your mnemonic phrase securely!`);
    } catch (e: any) {
      Alert.alert('Error', e.message);
    }
    loadData();
  };

  const handleImportWallet = () => {
    Alert.prompt(
      'Import Wallet',
      'Enter private key or mnemonic phrase:',
      async (input) => {
        if (!input) return;
        try {
          const result = await WalletService.importWallet(input);
          setAddress(result.address);
          Alert.alert('Wallet Imported', `Address: ${result.address}`);
        } catch (e: any) {
          Alert.alert('Import Failed', e.message);
        }
        loadData();
      },
      'plain-text'
    );
  };

  const handleChangeBudget = () => {
    Alert.prompt(
      'Set Budget',
      'Enter monthly spending limit (USD):',
      async (input) => {
        const limit = parseFloat(input || '');
        if (isNaN(limit) || limit <= 0) {
          Alert.alert('Invalid', 'Enter a valid amount');
          return;
        }
        await BudgetService.setBudget(limit);
        loadData();
      },
      'plain-text',
      budget.limit.toString()
    );
  };

  const spentPercent = budget.limit > 0 ? Math.min(budget.spent / budget.limit, 1) : 0;

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header */}
      <Text style={styles.sectionTitle}>Wallet</Text>

      {/* Balance Card */}
      <View style={styles.glassCard}>
        <Text style={styles.label}>Available Balance</Text>
        {address ? (
          <>
            <Text style={styles.balanceAmount}>$500.00</Text>
            <Text style={styles.walletAddress}>
              {address.slice(0, 6)}...{address.slice(-4)}
            </Text>
            <Text style={styles.subLabel}>USDC · Polygon Network</Text>
          </>
        ) : (
          <Text style={styles.noWallet}>No wallet configured</Text>
        )}
      </View>

      {/* Budget Bar */}
      <View style={styles.glassCard}>
        <View style={styles.budgetHeader}>
          <Text style={styles.label}>Spending Budget</Text>
          <Text style={styles.budgetAmount}>
            ${budget.spent.toFixed(2)} / ${budget.limit.toFixed(2)}
          </Text>
        </View>
        <View style={styles.progressBarBg}>
          <View style={[styles.progressBarFill, { width: `${spentPercent * 100}%` as any }]} />
        </View>
        <Text style={styles.subLabel}>
          ${budget.remaining.toFixed(2)} remaining · {budget.period}
        </Text>
      </View>

      {/* Quick Actions */}
      {!address ? (
        <View style={styles.actionRow}>
          <TouchableOpacity style={styles.primaryButton} onPress={handleCreateWallet}>
            <Text style={styles.primaryButtonText}>Create Wallet</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryButton} onPress={handleImportWallet}>
            <Text style={styles.secondaryButtonText}>Import Wallet</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.actionRow}>
          <TouchableOpacity style={styles.secondaryButton} onPress={handleChangeBudget}>
            <Text style={styles.secondaryButtonText}>Change Budget</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryButton} onPress={handleImportWallet}>
            <Text style={styles.secondaryButtonText}>Add Wallet</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, gap: Spacing.md },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background },
  sectionTitle: { color: Colors.text, fontSize: FontSizes.xxl, fontWeight: '700', marginBottom: Spacing.sm },
  glassCard: {
    backgroundColor: Colors.glass,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.glassBorder,
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  label: { color: Colors.textSecondary, fontSize: FontSizes.sm, textTransform: 'uppercase', letterSpacing: 1 },
  balanceAmount: { color: Colors.primary, fontSize: FontSizes.hero, fontWeight: '700' },
  walletAddress: { color: Colors.textSecondary, fontSize: FontSizes.md, fontFamily: 'monospace' },
  subLabel: { color: Colors.textMuted, fontSize: FontSizes.xs },
  noWallet: { color: Colors.textMuted, fontSize: FontSizes.lg, fontStyle: 'italic', paddingVertical: Spacing.md },
  budgetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  budgetAmount: { color: Colors.text, fontSize: FontSizes.md, fontWeight: '600' },
  progressBarBg: {
    height: 8,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.round,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.round,
  },
  actionRow: { flexDirection: 'row', gap: Spacing.md, marginTop: Spacing.sm },
  primaryButton: {
    flex: 1,
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.md,
    alignItems: 'center',
  },
  primaryButtonText: { color: Colors.background, fontSize: FontSizes.md, fontWeight: '700' },
  secondaryButton: {
    flex: 1,
    backgroundColor: Colors.glass,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.glassBorder,
    paddingVertical: Spacing.md,
    alignItems: 'center',
  },
  secondaryButtonText: { color: Colors.text, fontSize: FontSizes.md, fontWeight: '600' },
});
