// WalletScreen.tsx — Wallet overview with balance, budget bar, quick actions
//
// Import Wallet and Change Budget use inline TextInput modals instead of the
// iOS-only Alert.prompt, so they work identically on Android.

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import * as WalletService from '../services/WalletService';
import * as BudgetService from '../services/BudgetService';
import { Colors, Spacing, FontSizes, BorderRadius } from '../theme/colors';

export default function WalletScreen() {
  const [address, setAddress] = useState<string | null>(null);
  const [budget, setBudget] = useState<{
    limit: number;
    spent: number;
    period: 'daily' | 'weekly' | 'monthly';
    remaining: number;
  }>({ limit: 0, spent: 0, period: 'monthly', remaining: 0 });
  const [loading, setLoading] = useState(true);

  // Import wallet modal
  const [showImport, setShowImport] = useState(false);
  const [importInput, setImportInput] = useState('');

  // Change budget modal
  const [showBudget, setShowBudget] = useState(false);
  const [budgetInput, setBudgetInput] = useState('');

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

  const handleImportSubmit = async () => {
    const input = importInput.trim();
    if (!input) {
      Alert.alert('Import Wallet', 'Enter a private key or mnemonic phrase.');
      return;
    }
    try {
      const result = await WalletService.importWallet(input);
      setAddress(result.address);
      setShowImport(false);
      setImportInput('');
      Alert.alert('Wallet Imported', `Address: ${result.address}`);
    } catch (e: any) {
      Alert.alert('Import Failed', e.message);
    }
    loadData();
  };

  const handleBudgetSubmit = async () => {
    const limit = parseFloat(budgetInput || '');
    if (isNaN(limit) || limit <= 0) {
      Alert.alert('Invalid', 'Enter a valid amount');
      return;
    }
    await BudgetService.setBudget(limit);
    setShowBudget(false);
    loadData();
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
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {/* Header */}
        <Text style={styles.sectionTitle}>Wallet</Text>

        {/* Account Card */}
        <View style={styles.glassCard}>
          <Text style={styles.label}>Wallet Account</Text>
          {address ? (
            <>
              <Text style={styles.walletAddressFull}>{address}</Text>
              <Text style={styles.subLabel}>
                On-chain balance requires an RPC connection to display.
              </Text>
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
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => {
                setImportInput('');
                setShowImport(true);
              }}
            >
              <Text style={styles.secondaryButtonText}>Import Wallet</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => {
                setBudgetInput(budget.limit.toString());
                setShowBudget(true);
              }}
            >
              <Text style={styles.secondaryButtonText}>Change Budget</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => {
                setImportInput('');
                setShowImport(true);
              }}
            >
              <Text style={styles.secondaryButtonText}>Add Wallet</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      {/* Import Wallet Modal */}
      <Modal visible={showImport} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitle}>Import Wallet</Text>
            <Text style={styles.modalSubtitle}>Enter private key or mnemonic phrase</Text>
            <TextInput
              style={styles.modalInput}
              value={importInput}
              onChangeText={setImportInput}
              placeholder="0x... or your 12/24-word phrase"
              placeholderTextColor={Colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              multiline={false}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setShowImport(false)}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalSaveBtn} onPress={handleImportSubmit}>
                <Text style={styles.modalSaveText}>Import</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Change Budget Modal */}
      <Modal visible={showBudget} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitle}>Set Budget</Text>
            <Text style={styles.modalSubtitle}>Enter monthly spending limit (USD)</Text>
            <TextInput
              style={styles.modalInput}
              value={budgetInput}
              onChangeText={setBudgetInput}
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor={Colors.textMuted}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setShowBudget(false)}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalSaveBtn} onPress={handleBudgetSubmit}>
                <Text style={styles.modalSaveText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
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
  walletAddressFull: {
    color: Colors.text,
    fontSize: FontSizes.md,
    fontFamily: 'monospace',
    marginBottom: Spacing.xs,
  },
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

  // Modals
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    padding: Spacing.xl,
  },
  modalContainer: {
    backgroundColor: Colors.background,
    borderRadius: BorderRadius.xl,
    borderWidth: 1,
    borderColor: Colors.glassBorder,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  modalTitle: { color: Colors.text, fontSize: FontSizes.xl, fontWeight: '700', textAlign: 'center' },
  modalSubtitle: { color: Colors.textSecondary, fontSize: FontSizes.sm, textAlign: 'center' },
  modalInput: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.glassBorder,
    color: Colors.text,
    fontSize: FontSizes.md,
    padding: Spacing.md,
    textAlign: 'center',
  },
  modalActions: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginTop: Spacing.sm,
  },
  modalCancelBtn: {
    flex: 1,
    backgroundColor: Colors.glass,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.md,
    alignItems: 'center',
  },
  modalCancelText: { color: Colors.text, fontSize: FontSizes.md },
  modalSaveBtn: {
    flex: 1,
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.md,
    alignItems: 'center',
  },
  modalSaveText: { color: Colors.background, fontSize: FontSizes.md, fontWeight: '700' },
});
