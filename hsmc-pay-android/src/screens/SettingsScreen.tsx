// SettingsScreen.tsx — Enhanced settings: security (PIN/biometric),
// notifications per type, virtual cards management, connected apps,
// default payment method

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Switch,
  Modal,
  TextInput,
} from 'react-native';
import Slider from '@react-native-community/slider';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import * as WalletService from '../services/WalletService';
import * as BudgetService from '../services/BudgetService';
import * as TransactionStore from '../services/TransactionStore';
import * as VirtualCardService from '../services/VirtualCardService';
import * as NotificationService from '../services/NotificationService';
import type { VirtualCard } from '../services/VirtualCardService';
import type { NotificationPreferences } from '../services/NotificationService';
import { Colors, Spacing, FontSizes, BorderRadius } from '../theme/colors';

type Network = 'polygon-amoy' | 'polygon-mainnet';
type DefaultPaymentMethod = 'crypto' | 'virtual_card';

const BIOMETRIC_ENABLED_KEY = '@hsmc_biometric_enabled';
const DEFAULT_PAYMENT_KEY = '@hsmc_default_payment';
const PIN_KEY = '@hsmc_pin';

export default function SettingsScreen() {
  const [address, setAddress] = useState<string | null>(null);
  const [budget, setBudget] = useState(500);
  const [network, setNetwork] = useState<Network>('polygon-amoy');
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [autoConfirm, setAutoConfirm] = useState(true);

  // Enhanced settings
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [defaultPaymentMethod, setDefaultPaymentMethod] = useState<DefaultPaymentMethod>('crypto');
  const [notifPrefs, setNotifPrefs] = useState<NotificationPreferences | null>(null);
  const [virtualCards, setVirtualCards] = useState<VirtualCard[]>([]);

  // Modal states
  const [showChangePIN, setShowChangePIN] = useState(false);
  const [showCreateCard, setShowCreateCard] = useState(false);
  const [showCardDetails, setShowCardDetails] = useState<VirtualCard | null>(null);
  const [showNotifSettings, setShowNotifSettings] = useState(false);

  // Form state
  const [newPin, setNewPin] = useState('');
  const [newCardLabel, setNewCardLabel] = useState('');
  const [newCardType, setNewCardType] = useState<'visa' | 'mastercard'>('visa');
  const [newCardAutoTopup, setNewCardAutoTopup] = useState(true);

  const loadSettings = useCallback(async () => {
    const addr = await WalletService.getWalletAddress();
    setAddress(addr);

    const b = await BudgetService.getBudget();
    setBudget(b.limit);

    // Load enhanced settings
    const bioEnabled = await AsyncStorage.getItem(BIOMETRIC_ENABLED_KEY);
    setBiometricEnabled(bioEnabled === 'true');

    const defPay = await AsyncStorage.getItem(DEFAULT_PAYMENT_KEY);
    setDefaultPaymentMethod((defPay as DefaultPaymentMethod) || 'crypto');

    const prefs = await NotificationService.getPreferences();
    setNotifPrefs(prefs);

    const cards = await VirtualCardService.getCards();
    setVirtualCards(cards);
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
        [{ text: 'I Understand', style: 'destructive' }],
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
      ],
    );
  };

  const handleBudgetChange = async (value: number) => {
    setBudget(value);
    await BudgetService.setBudget(value);
  };

  // ─── Security ───────────────────────────────────────────────────

  const handleToggleBiometric = async (value: boolean) => {
    setBiometricEnabled(value);
    await AsyncStorage.setItem(BIOMETRIC_ENABLED_KEY, value.toString());

    if (value) {
      Alert.alert(
        'Biometric Enabled',
        'You can now use fingerprint/Face ID to unlock HSMC Pay.',
      );
    }
  };

  const handleChangePIN = () => {
    setNewPin('');
    setShowChangePIN(true);
  };

  const handleSaveNewPIN = async () => {
    if (newPin.length !== 6 || !/^\d{6}$/.test(newPin)) {
      Alert.alert('Invalid PIN', 'PIN must be exactly 6 digits.');
      return;
    }
    await AsyncStorage.setItem(PIN_KEY, newPin);
    setShowChangePIN(false);
    setNewPin('');
    Alert.alert('PIN Updated', 'Your security PIN has been changed.');
  };

  // ─── Default Payment Method ─────────────────────────────────────

  const handleDefaultPaymentChange = async (method: DefaultPaymentMethod) => {
    setDefaultPaymentMethod(method);
    await AsyncStorage.setItem(DEFAULT_PAYMENT_KEY, method);
  };

  // ─── Virtual Cards ──────────────────────────────────────────────

  const handleCreateCard = async () => {
    if (!newCardLabel.trim()) {
      Alert.alert('Required', 'Enter a label for your card.');
      return;
    }
    try {
      await VirtualCardService.createVirtualCard(
        newCardType,
        newCardLabel.trim(),
        newCardAutoTopup,
      );
      setShowCreateCard(false);
      setNewCardLabel('');
      const cards = await VirtualCardService.getCards();
      setVirtualCards(cards);
      Alert.alert('Card Created', `Virtual ${newCardType.toUpperCase()} card created successfully.`);
    } catch (e: any) {
      Alert.alert('Error', e.message);
    }
  };

  const handleFreezeCard = async (card: VirtualCard) => {
    try {
      if (card.frozen) {
        await VirtualCardService.unfreezeCard(card.id);
        await NotificationService.notifyCardUnfrozen(`****${card.pan.slice(-4)}`);
      } else {
        await VirtualCardService.freezeCard(card.id);
        await NotificationService.notifyCardFrozen(`****${card.pan.slice(-4)}`);
      }
      const cards = await VirtualCardService.getCards();
      setVirtualCards(cards);
    } catch (e: any) {
      Alert.alert('Error', e.message);
    }
  };

  const handleDeleteCard = (card: VirtualCard) => {
    Alert.alert(
      'Delete Card',
      `Delete virtual card ****${card.pan.slice(-4)}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await VirtualCardService.deleteCard(card.id);
            const cards = await VirtualCardService.getCards();
            setVirtualCards(cards);
          },
        },
      ],
    );
  };

  const handleViewCardDetails = async (card: VirtualCard) => {
    const details = await VirtualCardService.getCardDetailsForDisplay(card.id);
    if (details) {
      setShowCardDetails(card);
    }
  };

  // ─── Notifications ──────────────────────────────────────────────

  const handleNotifToggle = async (key: keyof NotificationPreferences, value: boolean) => {
    if (!notifPrefs) return;
    await NotificationService.updatePreferences({ [key]: value });
    setNotifPrefs((prev) => (prev ? { ...prev, [key]: value } : null));
  };

  // ─── Connected Apps ─────────────────────────────────────────────

  const connectedApps = [
    { name: 'HSMC POS Terminal', status: 'connected', icon: 'store' },
    { name: 'HSMC Web Dashboard', status: 'connected', icon: 'monitor-dashboard' },
  ];

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

      {/* Security Section */}
      <View style={styles.section}>
        <Text style={styles.sectionHeader}>Security</Text>
        <View style={styles.glassCard}>
          <TouchableOpacity style={styles.settingRow} onPress={handleChangePIN}>
            <View style={styles.settingRowLeft}>
              <Icon name="lock" size={20} color={Colors.textSecondary} />
              <Text style={styles.settingLabel}>Change PIN</Text>
            </View>
            <Icon name="chevron-right" size={20} color={Colors.textMuted} />
          </TouchableOpacity>

          <View style={styles.divider} />

          <View style={styles.settingRow}>
            <View style={styles.settingRowLeft}>
              <Icon name="fingerprint" size={20} color={Colors.textSecondary} />
              <Text style={styles.settingLabel}>Fingerprint / Face ID</Text>
            </View>
            <Switch
              value={biometricEnabled}
              onValueChange={handleToggleBiometric}
              trackColor={{ false: Colors.glassStrong, true: Colors.primaryDim }}
              thumbColor={biometricEnabled ? Colors.primary : Colors.textMuted}
            />
          </View>

          <View style={styles.divider} />

          <TouchableOpacity style={styles.settingRow} onPress={handleExportKey}>
            <View style={styles.settingRowLeft}>
              <Icon name="key" size={20} color={Colors.danger} />
              <Text style={styles.settingLabelDanger}>Export Private Key</Text>
            </View>
            <Icon name="chevron-right" size={20} color={Colors.textMuted} />
          </TouchableOpacity>

          <View style={styles.divider} />

          <TouchableOpacity style={styles.settingRow} onPress={handleDeleteWallet}>
            <View style={styles.settingRowLeft}>
              <Icon name="delete" size={20} color={Colors.danger} />
              <Text style={styles.settingLabelDanger}>Delete Wallet</Text>
            </View>
            <Icon name="chevron-right" size={20} color={Colors.textMuted} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Default Payment Method */}
      <View style={styles.section}>
        <Text style={styles.sectionHeader}>Default Payment Method</Text>
        <View style={styles.glassCard}>
          <TouchableOpacity
            style={[
              styles.methodOption,
              defaultPaymentMethod === 'crypto' && styles.methodOptionActive,
            ]}
            onPress={() => handleDefaultPaymentChange('crypto')}
          >
            <Icon name="currency-btc" size={20} color={defaultPaymentMethod === 'crypto' ? Colors.primary : Colors.textMuted} />
            <View style={styles.methodInfo}>
              <Text style={styles.methodLabel}>Crypto (USDC)</Text>
              <Text style={styles.methodHint}>Direct wallet payments via HCE</Text>
            </View>
            {defaultPaymentMethod === 'crypto' && (
              <Icon name="check-circle" size={20} color={Colors.primary} />
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.methodOption,
              defaultPaymentMethod === 'virtual_card' && styles.methodOptionActive,
            ]}
            onPress={() => handleDefaultPaymentChange('virtual_card')}
          >
            <Icon name="credit-card" size={20} color={defaultPaymentMethod === 'virtual_card' ? Colors.primary : Colors.textMuted} />
            <View style={styles.methodInfo}>
              <Text style={styles.methodLabel}>Virtual Card</Text>
              <Text style={styles.methodHint}>EMV card emulation for standard POS</Text>
            </View>
            {defaultPaymentMethod === 'virtual_card' && (
              <Icon name="check-circle" size={20} color={Colors.primary} />
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* Virtual Cards */}
      <View style={styles.section}>
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionHeader}>Virtual Cards</Text>
          <TouchableOpacity onPress={() => setShowCreateCard(true)}>
            <Icon name="plus-circle" size={22} color={Colors.primary} />
          </TouchableOpacity>
        </View>
        <View style={styles.glassCard}>
          {virtualCards.length === 0 ? (
            <Text style={styles.noCardsText}>
              No virtual cards yet. Create one to pay at standard POS terminals.
            </Text>
          ) : (
            virtualCards.map((card) => (
              <View key={card.id}>
                <TouchableOpacity
                  style={styles.cardItem}
                  onPress={() => handleViewCardDetails(card)}
                >
                  <View style={styles.cardIcon}>
                    <Icon
                      name={card.type === 'visa' ? 'credit-card' : 'credit-card-outline'}
                      size={24}
                      color={card.type === 'visa' ? '#1a73e8' : '#ff6f00'}
                    />
                  </View>
                  <View style={styles.cardInfo}>
                    <Text style={styles.cardLabel}>
                      {card.label} ····{card.pan.slice(-4)}
                    </Text>
                    <Text style={styles.cardSubtext}>
                      ${card.balance.toFixed(2)} · {card.type.toUpperCase()} · Exp{' '}
                      {card.expiryMonth.toString().padStart(2, '0')}/{card.expiryYear}
                    </Text>
                  </View>
                  <View style={styles.cardActions}>
                    <TouchableOpacity onPress={() => handleFreezeCard(card)}>
                      <Icon
                        name={card.frozen ? 'lock' : 'lock-open-outline'}
                        size={20}
                        color={card.frozen ? Colors.danger : Colors.textMuted}
                      />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => handleDeleteCard(card)}>
                      <Icon name="delete-outline" size={20} color={Colors.danger} />
                    </TouchableOpacity>
                  </View>
                </TouchableOpacity>
              </View>
            ))
          )}
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
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionHeader}>Notifications</Text>
          <TouchableOpacity onPress={() => setShowNotifSettings(true)}>
            <Icon name="tune" size={20} color={Colors.textSecondary} />
          </TouchableOpacity>
        </View>
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
          {notifPrefs && (
            <>
              <View style={styles.notifSummary}>
                <Text style={styles.notifSummaryText}>
                  {notifPrefs.paymentConfirmations ? '✅' : '❌'} Payments ·{' '}
                  {notifPrefs.budgetAlerts ? '✅' : '❌'} Budget ·{' '}
                  {notifPrefs.cardFrozenAlerts ? '✅' : '❌'} Cards ·{' '}
                  {notifPrefs.securityAlerts ? '✅' : '❌'} Security
                </Text>
              </View>
              <TouchableOpacity onPress={() => setShowNotifSettings(true)}>
                <Text style={styles.configureText}>Configure notification types</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>

      {/* Connected Apps */}
      <View style={styles.section}>
        <Text style={styles.sectionHeader}>Connected Apps</Text>
        <View style={styles.glassCard}>
          {connectedApps.map((app, i) => (
            <View key={app.name}>
              <View style={styles.settingRow}>
                <View style={styles.settingRowLeft}>
                  <Icon name={app.icon} size={20} color={Colors.textSecondary} />
                  <View>
                    <Text style={styles.settingLabel}>{app.name}</Text>
                    <Text style={styles.connectedStatus}>
                      🟢 {app.status}
                    </Text>
                  </View>
                </View>
              </View>
              {i < connectedApps.length - 1 && <View style={styles.divider} />}
            </View>
          ))}
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
            Virtual Card support enables payments at standard Visa/Mastercard POS terminals.
          </Text>
        </View>
      </View>

      {/* ─── Modals ──────────────────────────────────────────────── */}

      {/* Change PIN Modal */}
      <Modal visible={showChangePIN} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitle}>Change PIN</Text>
            <Text style={styles.modalSubtitle}>Enter a new 6-digit PIN</Text>
            <TextInput
              style={styles.modalInput}
              value={newPin}
              onChangeText={setNewPin}
              keyboardType="number-pad"
              maxLength={6}
              secureTextEntry
              placeholder="••••••"
              placeholderTextColor={Colors.textMuted}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => {
                  setShowChangePIN(false);
                  setNewPin('');
                }}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalSaveBtn} onPress={handleSaveNewPIN}>
                <Text style={styles.modalSaveText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Create Card Modal */}
      <Modal visible={showCreateCard} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitle}>Create Virtual Card</Text>
            <TextInput
              style={styles.modalInput}
              value={newCardLabel}
              onChangeText={setNewCardLabel}
              placeholder="Card label (e.g. Shopping)"
              placeholderTextColor={Colors.textMuted}
            />
            <View style={styles.cardTypeSelector}>
              <TouchableOpacity
                style={[
                  styles.cardTypeBtn,
                  newCardType === 'visa' && styles.cardTypeBtnActive,
                ]}
                onPress={() => setNewCardType('visa')}
              >
                <Text style={newCardType === 'visa' ? styles.cardTypeTextActive : styles.cardTypeText}>
                  VISA
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.cardTypeBtn,
                  newCardType === 'mastercard' && styles.cardTypeBtnActive,
                ]}
                onPress={() => setNewCardType('mastercard')}
              >
                <Text style={newCardType === 'mastercard' ? styles.cardTypeTextActive : styles.cardTypeText}>
                  Mastercard
                </Text>
              </TouchableOpacity>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Auto Top-Up</Text>
              <Switch
                value={newCardAutoTopup}
                onValueChange={setNewCardAutoTopup}
                trackColor={{ false: Colors.glassStrong, true: Colors.primaryDim }}
                thumbColor={newCardAutoTopup ? Colors.primary : Colors.textMuted}
              />
            </View>
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setShowCreateCard(false)}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalSaveBtn} onPress={handleCreateCard}>
                <Text style={styles.modalSaveText}>Create</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Card Details Modal */}
      <Modal visible={!!showCardDetails} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            {showCardDetails && (
              <>
                <Text style={styles.modalTitle}>Card Details</Text>
                <View style={styles.cardDetailRow}>
                  <Text style={styles.cardDetailLabel}>Card Number</Text>
                  <Text style={styles.cardDetailValue} selectable>
                    ****{showCardDetails.pan.slice(-4)}
                  </Text>
                </View>
                <View style={styles.cardDetailRow}>
                  <Text style={styles.cardDetailLabel}>Expiry</Text>
                  <Text style={styles.cardDetailValue}>
                    {showCardDetails.expiryMonth.toString().padStart(2, '0')}/
                    {showCardDetails.expiryYear}
                  </Text>
                </View>
                <View style={styles.cardDetailRow}>
                  <Text style={styles.cardDetailLabel}>CVV</Text>
                  <Text style={styles.cardDetailValue}>{showCardDetails.cvv}</Text>
                </View>
                <View style={styles.cardDetailRow}>
                  <Text style={styles.cardDetailLabel}>Balance</Text>
                  <Text style={styles.cardDetailValue}>
                    ${showCardDetails.balance.toFixed(2)}
                  </Text>
                </View>
                <View style={styles.cardDetailRow}>
                  <Text style={styles.cardDetailLabel}>Status</Text>
                  <Text
                    style={[
                      styles.cardDetailValue,
                      { color: showCardDetails.frozen ? Colors.danger : Colors.primary },
                    ]}
                  >
                    {showCardDetails.frozen ? '🔒 Frozen' : '🟢 Active'}
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.modalCloseBtn}
                  onPress={() => setShowCardDetails(null)}
                >
                  <Text style={styles.modalCloseText}>Close</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* Notification Settings Modal */}
      <Modal visible={showNotifSettings} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitle}>Notification Settings</Text>
            {notifPrefs && (
              <>
                {([
                  { key: 'paymentConfirmations' as const, label: 'Payment Confirmations', icon: 'cash-check' },
                  { key: 'budgetAlerts' as const, label: 'Budget Alerts', icon: 'chart-pie' },
                  { key: 'cardFrozenAlerts' as const, label: 'Card Status Alerts', icon: 'credit-card-lock' },
                  { key: 'securityAlerts' as const, label: 'Security Alerts', icon: 'shield-alert' },
                  { key: 'promotionalOffers' as const, label: 'Promotional Offers', icon: 'tag' },
                ] as const).map(({ key, label, icon }) => (
                  <View key={key} style={styles.settingRow}>
                    <View style={styles.settingRowLeft}>
                      <Icon name={icon} size={20} color={Colors.textSecondary} />
                      <Text style={styles.settingLabel}>{label}</Text>
                    </View>
                    <Switch
                      value={notifPrefs[key]}
                      onValueChange={(v) => handleNotifToggle(key, v)}
                      trackColor={{ false: Colors.glassStrong, true: Colors.primaryDim }}
                      thumbColor={notifPrefs[key] ? Colors.primary : Colors.textMuted}
                    />
                  </View>
                ))}
                <View style={styles.divider} />
                <View style={styles.settingRow}>
                  <View style={styles.settingRowLeft}>
                    <Icon name="weather-night" size={20} color={Colors.textSecondary} />
                    <Text style={styles.settingLabel}>Quiet Hours</Text>
                  </View>
                  <Switch
                    value={notifPrefs.quietHoursEnabled}
                    onValueChange={(v) => handleNotifToggle('quietHoursEnabled', v)}
                    trackColor={{ false: Colors.glassStrong, true: Colors.primaryDim }}
                    thumbColor={notifPrefs.quietHoursEnabled ? Colors.primary : Colors.textMuted}
                  />
                </View>
              </>
            )}
            <TouchableOpacity
              style={styles.modalCloseBtn}
              onPress={() => setShowNotifSettings(false)}
            >
              <Text style={styles.modalCloseText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
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
  aboutText: { color: Colors.textMuted, fontSize: FontSizes.sm, lineHeight: 20 },

  // Setting rows
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.xs,
  },
  settingRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    flex: 1,
  },
  settingLabel: { color: Colors.text, fontSize: FontSizes.md },
  settingLabelDanger: { color: Colors.danger, fontSize: FontSizes.md },
  divider: { height: 1, backgroundColor: Colors.glassBorder, marginVertical: Spacing.xs },

  // Payment methods
  methodOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    gap: Spacing.md,
  },
  methodOptionActive: {
    backgroundColor: 'rgba(0, 230, 118, 0.08)',
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  methodInfo: { flex: 1 },
  methodLabel: { color: Colors.text, fontSize: FontSizes.md, fontWeight: '600' },
  methodHint: { color: Colors.textMuted, fontSize: FontSizes.xs, marginTop: 2 },

  // Virtual Cards
  noCardsText: { color: Colors.textMuted, fontSize: FontSizes.sm, fontStyle: 'italic', textAlign: 'center' },
  cardItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.sm,
    gap: Spacing.md,
  },
  cardIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardInfo: { flex: 1 },
  cardLabel: { color: Colors.text, fontSize: FontSizes.md, fontWeight: '600' },
  cardSubtext: { color: Colors.textMuted, fontSize: FontSizes.xs, marginTop: 2 },
  cardActions: {
    flexDirection: 'row',
    gap: Spacing.md,
  },

  // Notification summary
  notifSummary: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.sm,
    padding: Spacing.sm,
  },
  notifSummaryText: { color: Colors.textSecondary, fontSize: FontSizes.xs },
  configureText: { color: Colors.primary, fontSize: FontSizes.xs },

  // Connected apps
  connectedStatus: { color: Colors.primary, fontSize: FontSizes.xs },

  // ─── Modals ─────────────────────────────────────────────────────
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
    fontSize: FontSizes.lg,
    padding: Spacing.md,
    textAlign: 'center',
    letterSpacing: 4,
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
  modalCloseBtn: {
    backgroundColor: Colors.glass,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    marginTop: Spacing.sm,
  },
  modalCloseText: { color: Colors.text, fontSize: FontSizes.md },

  // Card type selector
  cardTypeSelector: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  cardTypeBtn: {
    flex: 1,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.glassBorder,
    alignItems: 'center',
  },
  cardTypeBtnActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryDim,
  },
  cardTypeText: { color: Colors.textSecondary, fontSize: FontSizes.md, fontWeight: '700' },
  cardTypeTextActive: { color: Colors.primary, fontSize: FontSizes.md, fontWeight: '700' },

  // Card detail modal
  cardDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.xs,
  },
  cardDetailLabel: { color: Colors.textSecondary, fontSize: FontSizes.sm },
  cardDetailValue: { color: Colors.text, fontSize: FontSizes.md, fontWeight: '600' },
});
