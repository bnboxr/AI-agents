// SettingsScreen.tsx — App settings, wallet management, network config

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Switch,
} from 'react-native';
import Slider from '@react-native-community/slider';
import * as WalletService from '../services/WalletService';
import * as BudgetService from '../services/BudgetService';
import * as TransactionStore from '../services/TransactionStore';
import { Colors, Spacing, FontSizes, BorderRadius } from '../theme/colors';

type Network = 'polygon-amoy' | 'polygon-mainnet';

export default function SettingsScreen() {
  const [address, setAddress] = useState<string | null>(null);
  const [budget, setBudget] = useState(500);
  const [network, setNetwork] = useState<Network>('polygon-amoy');
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [autoConfirm, setAutoConfirm] = useState(true);

  const loadSettings = useCallback(async () => {
    const addr = await WalletService.getWalletAddress();
    setAddress(addr);

    const b = await BudgetService.getBudget();
    setBudget(b.limit);
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const handleExportKey = async () => {
    try {
      const key = await WalletService.exportPrivateKey();
      Alert.alert(
        '⚠️ Private Key',
        `${key.slice(0, 20)}...\n\nWARNING: Never share this key with anyone. Anyone with this key can access your funds.`,
        [{ text: 'I Understand', style: 'destructive' }]
      );
    } catch (e: any) {
      Alert.alert('Error', e.message);
    }
  };

  const handleDeleteWallet = () => {
    Alert.alert(
      'Delete Wallet',
      'This will remove your wallet from this device. Make sure you have your private key or mnemonic backed up.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await WalletService.deleteWallet();
            await TransactionStore.clearHistory();
            setAddress(null);
            Alert.alert('Deleted', 'Wallet removed from device');
          },
        },
      ]
    );
  };

  const handleBudgetChange = async (value: number) => {
    setBudget(value);
    await BudgetService.setBudget(value);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.sectionTitle}>Settings</Text>

      {/* Wallet Section */}
      <View style={styles.section}>
        <Text style={styles.sectionHeader}>Wallet</Text>
        <View style={styles.glassCard}>
          <View style={styles.row}>
            <Text style={styles.label}>Address</Text>
            <Text style={styles.value} selectable>
              {address ? `${address.slice(0, 10)}...${address.slice(-6)}` : 'Not configured'}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Network</Text>
            <TouchableOpacity
              style={styles.networkToggle}
              onPress={() =>
                setNetwork((n) => (n === 'polygon-amoy' ? 'polygon-mainnet' : 'polygon-amoy'))
              }
            >
              <Text
                style={[
                  styles.networkOption,
                  network === 'polygon-amoy' && styles.networkActive,
                ]}
              >
                Amoy
              </Text>
              <Text
                style={[
                  styles.networkOption,
                  network === 'polygon-mainnet' && styles.networkActive,
                ]}
              >
                Mainnet
              </Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.networkWarning}>
            {network === 'polygon-mainnet'
              ? '⚠️ Mainnet uses real funds. Ensure you understand the risks.'
              : '🟢 Testnet — safe for development and testing.'}
          </Text>
        </View>
      </View>

      {/* Budget Section */}
      <View style={styles.section}>
        <Text style={styles.sectionHeader}>Spending Budget</Text>
        <View style={styles.glassCard}>
          <View style={styles.row}>
            <Text style={styles.label}>Monthly Limit</Text>
            <Text style={styles.budgetValue}>${budget.toFixed(0)}</Text>
          </View>
          <Slider
            style={styles.slider}
            minimumValue={10}
            maximumValue={5000}
            step={10}
            value={budget}
            onValueChange={setBudget}
            onSlidingComplete={handleBudgetChange}
            minimumTrackTintColor={Colors.primary}
            maximumTrackTintColor={Colors.glassStrong}
            thumbTintColor={Colors.primary}
          />
          <View style={styles.sliderLabels}>
            <Text style={styles.sliderLabel}>$10</Text>
            <Text style={styles.sliderLabel}>$5,000</Text>
          </View>
        </View>
      </View>

      {/* Payment Preferences */}
      <View style={styles.section}>
        <Text style={styles.sectionHeader}>Payment</Text>
        <View style={styles.glassCard}>
          <View style={styles.row}>
            <Text style={styles.label}>Auto-confirm payments</Text>
            <Switch
              value={autoConfirm}
              onValueChange={setAutoConfirm}
              trackColor={{ false: Colors.glassStrong, true: Colors.primaryDim }}
              thumbColor={autoConfirm ? Colors.primary : Colors.textMuted}
            />
          </View>
          <Text style={styles.settingHint}>
            When enabled, payments within your budget are automatically approved at POS
            without manual confirmation.
          </Text>
        </View>
      </View>

      {/* Notifications */}
      <View style={styles.section}>
        <Text style={styles.sectionHeader}>Notifications</Text>
        <View style={styles.glassCard}>
          <View style={styles.row}>
            <Text style={styles.label}>Push notifications</Text>
            <Switch
              value={notificationsEnabled}
              onValueChange={setNotificationsEnabled}
              trackColor={{ false: Colors.glassStrong, true: Colors.primaryDim }}
              thumbColor={notificationsEnabled ? Colors.primary : Colors.textMuted}
            />
          </View>
        </View>
      </View>

      {/* Security */}
      <View style={styles.section}>
        <Text style={styles.sectionHeader}>Security</Text>
        <View style={styles.glassCard}>
          <TouchableOpacity style={styles.actionButton} onPress={handleExportKey}>
            <Text style={styles.actionTextDanger}>Export Private Key</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionButton} onPress={handleDeleteWallet}>
            <Text style={styles.actionTextDanger}>Delete Wallet</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* About */}
      <View style={styles.section}>
        <Text style={styles.sectionHeader}>About</Text>
        <View style={styles.glassCard}>
          <View style={styles.row}>
            <Text style={styles.label}>Version</Text>
            <Text style={styles.value}>1.0.0</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Platform</Text>
            <Text style={styles.value}>HSMC Pay Android</Text>
          </View>
          <Text style={styles.aboutText}>
            HSMC Pay enables crypto tap-to-pay via NFC HCE on Android devices. Payments are
            settled on Polygon with auto-conversion from any supported token.
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, gap: Spacing.lg, paddingBottom: Spacing.xxl * 2 },
  sectionTitle: { color: Colors.text, fontSize: FontSizes.xxl, fontWeight: '700' },
  section: { gap: Spacing.sm },
  sectionHeader: {
    color: Colors.textSecondary,
    fontSize: FontSizes.xs,
    textTransform: 'uppercase',
    letterSpacing: 2,
    marginLeft: Spacing.xs,
  },
  glassCard: {
    backgroundColor: Colors.glass,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.glassBorder,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  label: { color: Colors.textSecondary, fontSize: FontSizes.md },
  value: { color: Colors.text, fontSize: FontSizes.md, fontFamily: 'monospace', maxWidth: '60%' },
  budgetValue: { color: Colors.primary, fontSize: FontSizes.xl, fontWeight: '700' },
  slider: { width: '100%', height: 40 },
  sliderLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: -Spacing.sm,
  },
  sliderLabel: { color: Colors.textMuted, fontSize: FontSizes.xs },
  networkToggle: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.sm,
    padding: 2,
  },
  networkOption: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.sm - 2,
    color: Colors.textMuted,
    fontSize: FontSizes.sm,
    fontWeight: '600',
  },
  networkActive: {
    backgroundColor: Colors.primary,
    color: Colors.background,
  },
  networkWarning: { color: Colors.warning, fontSize: FontSizes.xs },
  settingHint: { color: Colors.textMuted, fontSize: FontSizes.xs, lineHeight: 16 },
  actionButton: {
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.glassBorder,
  },
  actionTextDanger: { color: Colors.danger, fontSize: FontSizes.md, fontWeight: '600' },
  aboutText: { color: Colors.textMuted, fontSize: FontSizes.sm, lineHeight: 20 },
});
