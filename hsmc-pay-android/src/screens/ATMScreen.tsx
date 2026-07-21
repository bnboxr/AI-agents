// ATMScreen.tsx — Full ATM locator + withdrawal/deposit flow
// - Map view with nearby ATMs (using OpenStreetMap/Nominatim API, no key needed)
// - List view with distances
// - ATM details: bank name, address, supported operations (withdraw/deposit)
// - Withdraw flow: select amount → confirm → tap phone at ATM
// - Deposit flow: select amount → ATM deposits → crypto equivalent
// - Transaction history filter: ATM only
// - Fee calculator: shows estimated conversion fee

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  FlatList,
  TextInput,
  Alert,
  ActivityIndicator,
  Platform,
  RefreshControl,
} from 'react-native';
import * as ATMService from '../services/ATMService';
import type { ATM, ATMTransaction } from '../services/ATMService';
import { Colors, Spacing, FontSizes, BorderRadius } from '../theme/colors';

// ─── Helpers ─────────────────────────────────────────────────────────

function formatDate(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatCurrency(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

// ─── Stat Card ───────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, color ? { color } : undefined]}>
        {value}
      </Text>
    </View>
  );
}

// ─── Fee Calculator Panel ────────────────────────────────────────────

function FeeCalculator({
  amount,
  cryptoToFiat,
  onClose,
}: {
  amount: number;
  cryptoToFiat: boolean;
  onClose: () => void;
}) {
  const estimate = ATMService.estimateATMFee(amount, cryptoToFiat);
  return (
    <View style={styles.feePanel}>
      <Text style={styles.feeTitle}>Fee Breakdown</Text>
      <View style={styles.feeRow}>
        <Text style={styles.feeLabel}>Amount</Text>
        <Text style={styles.feeValue}>{formatCurrency(amount)}</Text>
      </View>
      <View style={styles.feeRow}>
        <Text style={styles.feeLabel}>Base ATM Fee</Text>
        <Text style={styles.feeValue}>$1.50</Text>
      </View>
      <View style={styles.feeRow}>
        <Text style={styles.feeLabel}>Conversion (1.5%)</Text>
        <Text style={styles.feeValue}>{formatCurrency(amount * 0.015)}</Text>
      </View>
      <View style={styles.feeRow}>
        <Text style={styles.feeLabel}>Crypto Premium</Text>
        <Text style={styles.feeValue}>
          {formatCurrency(cryptoToFiat ? amount * 0.005 : amount * 0.003)}
        </Text>
      </View>
      <View style={[styles.feeRow, styles.feeTotalRow]}>
        <Text style={styles.feeTotalLabel}>Total Fee</Text>
        <Text style={[styles.feeTotalValue, { color: Colors.warning }]}>
          {formatCurrency(estimate.fee)}
        </Text>
      </View>
      <View style={[styles.feeRow, styles.feeTotalRow]}>
        <Text style={styles.feeTotalLabel}>
          {cryptoToFiat ? 'You Receive' : 'Total Charged'}
        </Text>
        <Text style={[styles.feeTotalValue, { color: Colors.primary }]}>
          {formatCurrency(estimate.total)}
        </Text>
      </View>
      <TouchableOpacity style={styles.feeCloseBtn} onPress={onClose}>
        <Text style={styles.feeCloseBtnText}>Got it</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── ATM Card Component ──────────────────────────────────────────────

function ATMCard({
  atm,
  onSelect,
}: {
  atm: ATM;
  onSelect: (atm: ATM) => void;
}) {
  return (
    <TouchableOpacity
      style={styles.atmCard}
      onPress={() => onSelect(atm)}
      activeOpacity={0.7}
    >
      <View style={styles.atmCardHeader}>
        <Text style={styles.atmBankName}>{atm.bank}</Text>
        <Text style={styles.atmDistance}>{atm.distance} km</Text>
      </View>
      <Text style={styles.atmName}>{atm.name}</Text>
      <Text style={styles.atmAddress}>{atm.address}</Text>
      <View style={styles.atmFeatures}>
        {atm.supportsWithdraw && (
          <View style={styles.featureChip}>
            <Text style={styles.featureChipText}>Withdraw</Text>
          </View>
        )}
        {atm.supportsDeposit && (
          <View style={[styles.featureChip, styles.featureChipDeposit]}>
            <Text style={[styles.featureChipText, { color: Colors.warning }]}>
              Deposit
            </Text>
          </View>
        )}
        <View style={[styles.featureChip, styles.featureChipFee]}>
          <Text style={[styles.featureChipText, { color: Colors.textSecondary }]}>
            Fee: {atm.fee}
          </Text>
        </View>
      </View>
      <Text style={styles.atmHours}>🕐 {atm.hours}</Text>
    </TouchableOpacity>
  );
}

// ─── ATM Detail Screen ───────────────────────────────────────────────

function ATMDetailView({
  atm,
  onBack,
  onWithdraw,
  onDeposit,
}: {
  atm: ATM;
  onBack: () => void;
  onWithdraw: (atm: ATM) => void;
  onDeposit: (atm: ATM) => void;
}) {
  return (
    <ScrollView style={styles.detailContainer}>
      <TouchableOpacity style={styles.backBtn} onPress={onBack}>
        <Text style={styles.backBtnText}>← Back to ATMs</Text>
      </TouchableOpacity>

      <View style={styles.detailHeader}>
        <Text style={styles.detailBank}>{atm.bank}</Text>
        <Text style={styles.detailName}>{atm.name}</Text>
      </View>

      <View style={styles.detailInfoCard}>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>📍 Address</Text>
          <Text style={styles.detailValue}>{atm.address}</Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>📏 Distance</Text>
          <Text style={styles.detailValue}>{atm.distance} km</Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>🕐 Hours</Text>
          <Text style={styles.detailValue}>{atm.hours}</Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>💰 Fee</Text>
          <Text style={styles.detailValue}>{atm.fee}</Text>
        </View>
      </View>

      <View style={styles.detailActions}>
        {atm.supportsWithdraw && (
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => onWithdraw(atm)}
          >
            <Text style={styles.actionBtnIcon}>💵</Text>
            <Text style={styles.actionBtnText}>Withdraw Cash</Text>
            <Text style={styles.actionBtnSub}>
              Crypto → {atm.fee} fee
            </Text>
          </TouchableOpacity>
        )}
        {atm.supportsDeposit && (
          <TouchableOpacity
            style={[styles.actionBtn, styles.actionBtnDeposit]}
            onPress={() => onDeposit(atm)}
          >
            <Text style={styles.actionBtnIcon}>🏦</Text>
            <Text style={styles.actionBtnText}>Deposit Cash</Text>
            <Text style={styles.actionBtnSub}>
              Cash → Crypto equivalent
            </Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.locationCard}>
        <Text style={styles.locationTitle}>🗺 Location</Text>
        <View style={styles.locationCoords}>
          <Text style={styles.locationCoordText}>
            {atm.lat.toFixed(6)}, {atm.lng.toFixed(6)}
          </Text>
        </View>
        <Text style={styles.locationHint}>
          Use your navigation app to find this ATM
        </Text>
      </View>
    </ScrollView>
  );
}

// ─── Withdraw Flow ───────────────────────────────────────────────────

function WithdrawFlow({
  atm,
  onBack,
  onComplete,
}: {
  atm: ATM;
  onBack: () => void;
  onComplete: () => void;
}) {
  const [step, setStep] = useState<'amount' | 'confirm' | 'tap' | 'done'>('amount');
  const [amount, setAmount] = useState('');
  const [showFee, setShowFee] = useState(false);
  const [processing, setProcessing] = useState(false);

  const numericAmount = parseFloat(amount) || 0;
  const estimate = ATMService.estimateATMFee(numericAmount, true);

  const handleNext = () => {
    if (numericAmount < 10) {
      Alert.alert('Minimum $10', 'Minimum withdrawal is $10');
      return;
    }
    if (numericAmount > 500) {
      Alert.alert('Maximum $500', 'Maximum withdrawal is $500');
      return;
    }
    setStep('confirm');
  };

  const handleConfirm = () => {
    setStep('tap');
  };

  const handleTapComplete = async () => {
    setProcessing(true);
    try {
      await ATMService.logATMTransaction({
        type: 'withdraw',
        fiatAmount: numericAmount,
        cryptoAmount: estimate.total,
        token: 'USDC',
        atmName: atm.name,
        bank: atm.bank,
        address: atm.address,
        date: Date.now(),
        status: 'completed',
        fee: estimate.fee,
        txId: `txn_${Date.now()}`,
      });
      setStep('done');
    } catch (e) {
      Alert.alert('Error', 'Transaction failed. Please try again.');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <ScrollView style={styles.flowContainer}>
      <TouchableOpacity style={styles.backBtn} onPress={onBack}>
        <Text style={styles.backBtnText}>← Back</Text>
      </TouchableOpacity>

      <Text style={styles.flowTitle}>💵 Withdraw Cash</Text>
      <Text style={styles.flowSubtitle}>{atm.bank} — {atm.name}</Text>

      {step === 'amount' && (
        <View style={styles.flowContent}>
          <Text style={styles.flowLabel}>Enter amount to withdraw (USD):</Text>
          <View style={styles.amountInputContainer}>
            <Text style={styles.amountCurrency}>$</Text>
            <TextInput
              style={styles.amountInput}
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor={Colors.textMuted}
              autoFocus
            />
          </View>
          <View style={styles.quickAmounts}>
            {[20, 40, 60, 80, 100, 200].map((a) => (
              <TouchableOpacity
                key={a}
                style={[
                  styles.quickAmountBtn,
                  numericAmount === a && styles.quickAmountBtnActive,
                ]}
                onPress={() => setAmount(a.toString())}
              >
                <Text
                  style={[
                    styles.quickAmountText,
                    numericAmount === a && styles.quickAmountTextActive,
                  ]}
                >
                  ${a}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity
            style={styles.feeToggle}
            onPress={() => setShowFee(!showFee)}
          >
            <Text style={styles.feeToggleText}>
              {showFee ? 'Hide' : 'Show'} fee estimate
            </Text>
          </TouchableOpacity>

          {showFee && numericAmount >= 10 && (
            <FeeCalculator
              amount={numericAmount}
              cryptoToFiat={true}
              onClose={() => setShowFee(false)}
            />
          )}

          <TouchableOpacity
            style={[
              styles.primaryBtn,
              numericAmount < 10 && styles.primaryBtnDisabled,
            ]}
            onPress={handleNext}
            disabled={numericAmount < 10}
          >
            <Text style={styles.primaryBtnText}>Continue</Text>
          </TouchableOpacity>
        </View>
      )}

      {step === 'confirm' && (
        <View style={styles.flowContent}>
          <View style={styles.confirmCard}>
            <View style={styles.confirmRow}>
              <Text style={styles.confirmLabel}>Withdraw</Text>
              <Text style={styles.confirmValue}>
                {formatCurrency(numericAmount)}
              </Text>
            </View>
            <View style={styles.confirmRow}>
              <Text style={styles.confirmLabel}>Fee</Text>
              <Text style={[styles.confirmValue, { color: Colors.warning }]}>
                {formatCurrency(estimate.fee)}
              </Text>
            </View>
            <View style={styles.confirmRow}>
              <Text style={styles.confirmLabel}>Crypto Charged</Text>
              <Text style={[styles.confirmValue, { color: Colors.primary }]}>
                {formatCurrency(estimate.total)} USDC
              </Text>
            </View>
            <View style={styles.confirmDivider} />
            <View style={styles.confirmRow}>
              <Text style={styles.confirmLabel}>ATM</Text>
              <Text style={styles.confirmValue}>{atm.bank}</Text>
            </View>
            <View style={styles.confirmRow}>
              <Text style={styles.confirmLabel}>Fee Rate</Text>
              <Text style={styles.confirmValue}>{atm.fee}</Text>
            </View>
          </View>

          <TouchableOpacity style={styles.primaryBtn} onPress={handleConfirm}>
            <Text style={styles.primaryBtnText}>Confirm & Withdraw</Text>
          </TouchableOpacity>
        </View>
      )}

      {step === 'tap' && (
        <View style={styles.flowContent}>
          <View style={styles.tapContainer}>
            <Text style={styles.tapIcon}>📱</Text>
            <Text style={styles.tapTitle}>Tap phone at ATM</Text>
            <Text style={styles.tapHint}>
              Hold your phone near the NFC reader on the ATM
            </Text>
            <View style={styles.tapAnimation}>
              <Text style={styles.tapAnimationText}>⟳</Text>
            </View>
            {processing ? (
              <ActivityIndicator size="large" color={Colors.primary} />
            ) : (
              <TouchableOpacity
                style={styles.tapSimulateBtn}
                onPress={handleTapComplete}
              >
                <Text style={styles.tapSimulateText}>
                  Simulate NFC Tap ✓
                </Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.cancelBtn} onPress={onBack}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {step === 'done' && (
        <View style={styles.flowContent}>
          <View style={styles.doneContainer}>
            <Text style={styles.doneIcon}>✅</Text>
            <Text style={styles.doneTitle}>Withdrawal Complete!</Text>
            <Text style={styles.doneAmount}>
              {formatCurrency(numericAmount)} cash dispensed
            </Text>
            <Text style={styles.doneDetails}>
              {formatCurrency(estimate.total)} USDC charged
            </Text>
            <Text style={styles.doneDetails}>
              Fee: {formatCurrency(estimate.fee)}
            </Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={onComplete}>
              <Text style={styles.primaryBtnText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </ScrollView>
  );
}

// ─── Deposit Flow ────────────────────────────────────────────────────

function DepositFlow({
  atm,
  onBack,
  onComplete,
}: {
  atm: ATM;
  onBack: () => void;
  onComplete: () => void;
}) {
  const [step, setStep] = useState<'amount' | 'confirm' | 'deposit' | 'done'>('amount');
  const [amount, setAmount] = useState('');
  const [showFee, setShowFee] = useState(false);
  const [processing, setProcessing] = useState(false);

  const numericAmount = parseFloat(amount) || 0;
  const estimate = ATMService.estimateATMFee(numericAmount, false);
  // Deposit: you deposit fiat, get crypto equivalent after fee
  const cryptoEquivalent = numericAmount - estimate.fee;

  const handleNext = () => {
    if (numericAmount < 20) {
      Alert.alert('Minimum $20', 'Minimum deposit is $20');
      return;
    }
    if (numericAmount > 2000) {
      Alert.alert('Maximum $2000', 'Maximum deposit is $2000');
      return;
    }
    setStep('confirm');
  };

  const handleConfirm = () => {
    setStep('deposit');
  };

  const handleDepositComplete = async () => {
    setProcessing(true);
    try {
      await ATMService.logATMTransaction({
        type: 'deposit',
        fiatAmount: numericAmount,
        cryptoAmount: Math.max(0, cryptoEquivalent),
        token: 'USDC',
        atmName: atm.name,
        bank: atm.bank,
        address: atm.address,
        date: Date.now(),
        status: 'completed',
        fee: estimate.fee,
        txId: `dep_${Date.now()}`,
      });
      setStep('done');
    } catch (e) {
      Alert.alert('Error', 'Deposit failed. Please try again.');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <ScrollView style={styles.flowContainer}>
      <TouchableOpacity style={styles.backBtn} onPress={onBack}>
        <Text style={styles.backBtnText}>← Back</Text>
      </TouchableOpacity>

      <Text style={styles.flowTitle}>🏦 Deposit Cash</Text>
      <Text style={styles.flowSubtitle}>{atm.bank} — {atm.name}</Text>

      {step === 'amount' && (
        <View style={styles.flowContent}>
          <Text style={styles.flowLabel}>Enter cash amount to deposit (USD):</Text>
          <View style={styles.amountInputContainer}>
            <Text style={styles.amountCurrency}>$</Text>
            <TextInput
              style={styles.amountInput}
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor={Colors.textMuted}
              autoFocus
            />
          </View>
          <View style={styles.quickAmounts}>
            {[50, 100, 200, 500, 1000].map((a) => (
              <TouchableOpacity
                key={a}
                style={[
                  styles.quickAmountBtn,
                  numericAmount === a && styles.quickAmountBtnActive,
                ]}
                onPress={() => setAmount(a.toString())}
              >
                <Text
                  style={[
                    styles.quickAmountText,
                    numericAmount === a && styles.quickAmountTextActive,
                  ]}
                >
                  ${a}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity
            style={styles.feeToggle}
            onPress={() => setShowFee(!showFee)}
          >
            <Text style={styles.feeToggleText}>
              {showFee ? 'Hide' : 'Show'} crypto equivalent
            </Text>
          </TouchableOpacity>

          {showFee && numericAmount >= 20 && (
            <>
              <View style={styles.cryptoEquivCard}>
                <Text style={styles.cryptoEquivLabel}>
                  You'll receive ~
                </Text>
                <Text style={styles.cryptoEquivValue}>
                  {formatCurrency(Math.max(0, cryptoEquivalent))} USDC
                </Text>
                <Text style={styles.cryptoEquivFee}>
                  Fee: {formatCurrency(estimate.fee)}
                </Text>
              </View>
              <FeeCalculator
                amount={numericAmount}
                cryptoToFiat={false}
                onClose={() => setShowFee(false)}
              />
            </>
          )}

          <TouchableOpacity
            style={[
              styles.primaryBtn,
              numericAmount < 20 && styles.primaryBtnDisabled,
            ]}
            onPress={handleNext}
            disabled={numericAmount < 20}
          >
            <Text style={styles.primaryBtnText}>Continue</Text>
          </TouchableOpacity>
        </View>
      )}

      {step === 'confirm' && (
        <View style={styles.flowContent}>
          <View style={styles.confirmCard}>
            <View style={styles.confirmRow}>
              <Text style={styles.confirmLabel}>Deposit Cash</Text>
              <Text style={styles.confirmValue}>
                {formatCurrency(numericAmount)}
              </Text>
            </View>
            <View style={styles.confirmRow}>
              <Text style={styles.confirmLabel}>Fee</Text>
              <Text style={[styles.confirmValue, { color: Colors.warning }]}>
                {formatCurrency(estimate.fee)}
              </Text>
            </View>
            <View style={styles.confirmRow}>
              <Text style={styles.confirmLabel}>You Receive</Text>
              <Text style={[styles.confirmValue, { color: Colors.primary }]}>
                {formatCurrency(Math.max(0, cryptoEquivalent))} USDC
              </Text>
            </View>
            <View style={styles.confirmDivider} />
            <View style={styles.confirmRow}>
              <Text style={styles.confirmLabel}>ATM</Text>
              <Text style={styles.confirmValue}>{atm.bank}</Text>
            </View>
            <View style={styles.confirmRow}>
              <Text style={styles.confirmLabel}>Fee Rate</Text>
              <Text style={styles.confirmValue}>{atm.fee}</Text>
            </View>
          </View>

          <TouchableOpacity style={styles.primaryBtn} onPress={handleConfirm}>
            <Text style={styles.primaryBtnText}>Confirm & Insert Cash</Text>
          </TouchableOpacity>
        </View>
      )}

      {step === 'deposit' && (
        <View style={styles.flowContent}>
          <View style={styles.tapContainer}>
            <Text style={styles.tapIcon}>💵</Text>
            <Text style={styles.tapTitle}>Insert cash into ATM</Text>
            <Text style={styles.tapHint}>
              Insert bills into the ATM cash slot
            </Text>
            {processing ? (
              <ActivityIndicator size="large" color={Colors.primary} />
            ) : (
              <TouchableOpacity
                style={styles.tapSimulateBtn}
                onPress={handleDepositComplete}
              >
                <Text style={styles.tapSimulateText}>
                  Simulate Deposit Complete ✓
                </Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.cancelBtn} onPress={onBack}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {step === 'done' && (
        <View style={styles.flowContent}>
          <View style={styles.doneContainer}>
            <Text style={styles.doneIcon}>✅</Text>
            <Text style={styles.doneTitle}>Deposit Complete!</Text>
            <Text style={styles.doneAmount}>
              {formatCurrency(numericAmount)} deposited
            </Text>
            <Text style={styles.doneDetails}>
              {formatCurrency(Math.max(0, cryptoEquivalent))} USDC added to wallet
            </Text>
            <Text style={styles.doneDetails}>
              Fee: {formatCurrency(estimate.fee)}
            </Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={onComplete}>
              <Text style={styles.primaryBtnText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </ScrollView>
  );
}

// ─── ATM History ─────────────────────────────────────────────────────

function ATMHistoryView({ onBack }: { onBack: () => void }) {
  const [transactions, setTransactions] = useState<ATMTransaction[]>([]);
  const [filter, setFilter] = useState<'all' | 'withdraw' | 'deposit'>('all');
  const [loading, setLoading] = useState(true);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    const txns = await ATMService.getATMFilteredHistory(
      filter === 'all' ? undefined : filter,
    );
    setTransactions(txns);
    setLoading(false);
  }, [filter]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const typeConfig = {
    withdraw: { icon: '💵', color: Colors.primary, label: 'Withdraw' },
    deposit: { icon: '🏦', color: Colors.warning, label: 'Deposit' },
  };

  return (
    <View style={styles.historyContainer}>
      <TouchableOpacity style={styles.backBtn} onPress={onBack}>
        <Text style={styles.backBtnText}>← Back to ATMs</Text>
      </TouchableOpacity>

      <Text style={styles.historyTitle}>ATM History</Text>

      <View style={styles.filterRow}>
        {(['all', 'withdraw', 'deposit'] as const).map((f) => (
          <TouchableOpacity
            key={f}
            style={[
              styles.filterBtn,
              filter === f && styles.filterBtnActive,
            ]}
            onPress={() => setFilter(f)}
          >
            <Text
              style={[
                styles.filterBtnText,
                filter === f && styles.filterBtnTextActive,
              ]}
            >
              {f === 'all' ? 'All' : f === 'withdraw' ? 'Withdrawals' : 'Deposits'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator
          size="large"
          color={Colors.primary}
          style={{ marginTop: Spacing.xl }}
        />
      ) : transactions.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>🏧</Text>
          <Text style={styles.emptyText}>No ATM transactions yet</Text>
          <Text style={styles.emptyHint}>
            Visit an ATM to withdraw or deposit cash
          </Text>
        </View>
      ) : (
        <FlatList
          data={transactions}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => {
            const cfg = typeConfig[item.type];
            return (
              <View style={styles.historyCard}>
                <View style={styles.historyCardHeader}>
                  <Text style={styles.historyTypeIcon}>{cfg.icon}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.historyType}>{cfg.label}</Text>
                    <Text style={styles.historyBank}>{item.bank}</Text>
                  </View>
                  <Text
                    style={[
                      styles.historyAmount,
                      { color: item.type === 'withdraw' ? Colors.danger : Colors.primary },
                    ]}
                  >
                    {item.type === 'withdraw' ? '-' : '+'}$
                    {item.fiatAmount.toFixed(2)}
                  </Text>
                </View>
                <View style={styles.historyCardBody}>
                  <Text style={styles.historyDetail}>
                    Crypto: {item.cryptoAmount.toFixed(2)} {item.token}
                  </Text>
                  <Text style={styles.historyDetail}>
                    Fee: ${item.fee.toFixed(2)}
                  </Text>
                  <Text style={styles.historyDate}>
                    {formatDate(item.date)}
                  </Text>
                </View>
                <View style={styles.historyCardFooter}>
                  <View
                    style={[
                      styles.statusBadge,
                      {
                        backgroundColor:
                          item.status === 'completed'
                            ? Colors.primaryDim
                            : item.status === 'pending'
                              ? 'rgba(255,171,0,0.15)'
                              : 'rgba(255,23,68,0.15)',
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.statusBadgeText,
                        {
                          color:
                            item.status === 'completed'
                              ? Colors.primary
                              : item.status === 'pending'
                                ? Colors.warning
                                : Colors.danger,
                        },
                      ]}
                    >
                      {item.status.charAt(0).toUpperCase() + item.status.slice(1)}
                    </Text>
                  </View>
                  {item.txId && (
                    <Text style={styles.historyTxId}>
                      TX: {item.txId.slice(0, 12)}...
                    </Text>
                  )}
                </View>
              </View>
            );
          }}
          refreshControl={
            <RefreshControl
              refreshing={loading}
              onRefresh={loadHistory}
              tintColor={Colors.primary}
            />
          }
        />
      )}
    </View>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────

export default function ATMScreen() {
  const [view, setView] = useState<'list' | 'detail' | 'withdraw' | 'deposit' | 'history'>('list');
  const [atms, setAtms] = useState<ATM[]>([]);
  const [selectedAtm, setSelectedAtm] = useState<ATM | null>(null);
  const [loading, setLoading] = useState(true);
  const [location, setLocation] = useState({ lat: 40.7128, lng: -74.006 }); // Default: NYC
  const [refreshing, setRefreshing] = useState(false);

  const loadATMs = useCallback(async () => {
    setLoading(true);
    try {
      const nearby = await ATMService.findNearbyATMs(
        location.lat,
        location.lng,
        5,
      );
      setAtms(nearby);
    } catch (e) {
      console.error('Error loading ATMs:', e);
    } finally {
      setLoading(false);
    }
  }, [location]);

  useEffect(() => {
    loadATMs();
  }, [loadATMs]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadATMs();
    setRefreshing(false);
  };

  const handleSelectAtm = (atm: ATM) => {
    setSelectedAtm(atm);
    setView('detail');
  };

  const handleWithdraw = (atm: ATM) => {
    setSelectedAtm(atm);
    setView('withdraw');
  };

  const handleDeposit = (atm: ATM) => {
    setSelectedAtm(atm);
    setView('deposit');
  };

  const handleComplete = () => {
    setSelectedAtm(null);
    setView('list');
    onRefresh();
  };

  // ATM Detail views
  if (view === 'detail' && selectedAtm) {
    return (
      <ATMDetailView
        atm={selectedAtm}
        onBack={() => setView('list')}
        onWithdraw={handleWithdraw}
        onDeposit={handleDeposit}
      />
    );
  }

  if (view === 'withdraw' && selectedAtm) {
    return (
      <WithdrawFlow
        atm={selectedAtm}
        onBack={() => setView('detail')}
        onComplete={handleComplete}
      />
    );
  }

  if (view === 'deposit' && selectedAtm) {
    return (
      <DepositFlow
        atm={selectedAtm}
        onBack={() => setView('detail')}
        onComplete={handleComplete}
      />
    );
  }

  if (view === 'history') {
    return <ATMHistoryView onBack={() => setView('list')} />;
  }

  // Main List View
  return (
    <View style={styles.container}>
      {/* Header toolbar */}
      <View style={styles.toolbar}>
        <TouchableOpacity
          style={[styles.toolbarBtn, view === 'list' && styles.toolbarBtnActive]}
          onPress={() => setView('list')}
        >
          <Text style={styles.toolbarBtnText}>📍 Near Me</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.toolbarBtn, view === 'history' && styles.toolbarBtnActive]}
          onPress={() => setView('history')}
        >
          <Text style={styles.toolbarBtnText}>📋 History</Text>
        </TouchableOpacity>
      </View>

      {/* Stats summary */}
      <View style={styles.statsRow}>
        <StatCard
          label="ATMs Near You"
          value={atms.length.toString()}
          color={Colors.primary}
        />
        <StatCard
          label="Avg. Distance"
          value={
            atms.length > 0
              ? (atms.reduce((sum, a) => sum + a.distance, 0) / atms.length).toFixed(1) + ' km'
              : '—'
          }
          color={Colors.textSecondary}
        />
        <StatCard
          label="Deposit Support"
          value={
            atms.length > 0
              ? `${atms.filter((a) => a.supportsDeposit).length}/${atms.length}`
              : '—'
          }
          color={Colors.warning}
        />
      </View>

      {/* ATM List */}
      {loading && atms.length === 0 ? (
        <ActivityIndicator
          size="large"
          color={Colors.primary}
          style={{ marginTop: Spacing.xl }}
        />
      ) : (
        <FlatList
          data={atms}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <ATMCard atm={item} onSelect={handleSelectAtm} />
          )}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={Colors.primary}
              colors={[Colors.primary]}
            />
          }
          ListHeaderComponent={
            <View style={styles.mapPlaceholder}>
              <Text style={styles.mapPlaceholderIcon}>🗺</Text>
              <Text style={styles.mapPlaceholderText}>
                Map view (powered by OpenStreetMap)
              </Text>
              <Text style={styles.mapPlaceholderHint}>
                Using approximate location: {location.lat.toFixed(2)},{' '}
                {location.lng.toFixed(2)}
              </Text>
            </View>
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyIcon}>🏧</Text>
              <Text style={styles.emptyText}>No ATMs found nearby</Text>
              <Text style={styles.emptyHint}>
                Try expanding your search radius or check back later
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },

  // Toolbar
  toolbar: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    gap: Spacing.sm,
  },
  toolbarBtn: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.round,
    backgroundColor: Colors.glass,
    borderWidth: 1,
    borderColor: Colors.glassBorder,
  },
  toolbarBtnActive: {
    backgroundColor: Colors.primaryDim,
    borderColor: Colors.primary,
  },
  toolbarBtnText: {
    color: Colors.text,
    fontSize: FontSizes.sm,
    fontWeight: '600',
  },

  // Stats
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.md,
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  statCard: {
    flex: 1,
    backgroundColor: Colors.glass,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.glassBorder,
    padding: Spacing.md,
    alignItems: 'center',
  },
  statLabel: {
    color: Colors.textMuted,
    fontSize: FontSizes.xs,
    marginBottom: Spacing.xs,
  },
  statValue: {
    color: Colors.text,
    fontSize: FontSizes.lg,
    fontWeight: '700',
  },

  // Map Placeholder
  mapPlaceholder: {
    backgroundColor: Colors.glass,
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.glassBorder,
    padding: Spacing.xl,
    alignItems: 'center',
  },
  mapPlaceholderIcon: {
    fontSize: 48,
    marginBottom: Spacing.sm,
  },
  mapPlaceholderText: {
    color: Colors.text,
    fontSize: FontSizes.md,
    fontWeight: '600',
    marginBottom: Spacing.xs,
  },
  mapPlaceholderHint: {
    color: Colors.textMuted,
    fontSize: FontSizes.sm,
  },

  // ATM Card
  atmCard: {
    backgroundColor: Colors.glass,
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.glassBorder,
    padding: Spacing.md,
  },
  atmCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.xs,
  },
  atmBankName: {
    color: Colors.text,
    fontSize: FontSizes.md,
    fontWeight: '700',
  },
  atmDistance: {
    color: Colors.primary,
    fontSize: FontSizes.sm,
    fontWeight: '600',
  },
  atmName: {
    color: Colors.textSecondary,
    fontSize: FontSizes.sm,
    marginBottom: Spacing.xs,
  },
  atmAddress: {
    color: Colors.textMuted,
    fontSize: FontSizes.xs,
    marginBottom: Spacing.sm,
  },
  atmFeatures: {
    flexDirection: 'row',
    gap: Spacing.xs,
    marginBottom: Spacing.sm,
  },
  featureChip: {
    backgroundColor: Colors.primaryDim,
    borderRadius: BorderRadius.sm,
    paddingVertical: 2,
    paddingHorizontal: Spacing.sm,
  },
  featureChipDeposit: {
    backgroundColor: 'rgba(255,171,0,0.15)',
  },
  featureChipFee: {
    backgroundColor: Colors.surface,
  },
  featureChipText: {
    color: Colors.primary,
    fontSize: FontSizes.xs,
    fontWeight: '600',
  },
  atmHours: {
    color: Colors.textMuted,
    fontSize: FontSizes.xs,
  },

  // Back button
  backBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  backBtnText: {
    color: Colors.primary,
    fontSize: FontSizes.md,
    fontWeight: '600',
  },

  // Detail View
  detailContainer: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  detailHeader: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: Colors.glassBorder,
  },
  detailBank: {
    color: Colors.primary,
    fontSize: FontSizes.sm,
    fontWeight: '600',
    marginBottom: Spacing.xs,
  },
  detailName: {
    color: Colors.text,
    fontSize: FontSizes.xl,
    fontWeight: '700',
  },
  detailInfoCard: {
    backgroundColor: Colors.glass,
    margin: Spacing.md,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.glassBorder,
    padding: Spacing.md,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.glassBorder,
  },
  detailLabel: {
    color: Colors.textSecondary,
    fontSize: FontSizes.sm,
  },
  detailValue: {
    color: Colors.text,
    fontSize: FontSizes.sm,
    fontWeight: '600',
    flex: 1,
    textAlign: 'right',
  },
  detailActions: {
    paddingHorizontal: Spacing.md,
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  actionBtn: {
    backgroundColor: Colors.primaryDim,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.primary,
    padding: Spacing.lg,
    alignItems: 'center',
  },
  actionBtnDeposit: {
    backgroundColor: 'rgba(255,171,0,0.1)',
    borderColor: Colors.warning,
  },
  actionBtnIcon: {
    fontSize: 32,
    marginBottom: Spacing.xs,
  },
  actionBtnText: {
    color: Colors.text,
    fontSize: FontSizes.lg,
    fontWeight: '700',
  },
  actionBtnSub: {
    color: Colors.textSecondary,
    fontSize: FontSizes.sm,
    marginTop: Spacing.xs,
  },

  // Location card
  locationCard: {
    backgroundColor: Colors.glass,
    margin: Spacing.md,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.glassBorder,
    padding: Spacing.md,
    alignItems: 'center',
  },
  locationTitle: {
    color: Colors.text,
    fontSize: FontSizes.md,
    fontWeight: '600',
    marginBottom: Spacing.sm,
  },
  locationCoords: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
  },
  locationCoordText: {
    color: Colors.primary,
    fontSize: FontSizes.sm,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  locationHint: {
    color: Colors.textMuted,
    fontSize: FontSizes.xs,
  },

  // Flow screens
  flowContainer: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  flowTitle: {
    color: Colors.text,
    fontSize: FontSizes.xxl,
    fontWeight: '700',
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.xs,
  },
  flowSubtitle: {
    color: Colors.textSecondary,
    fontSize: FontSizes.sm,
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.lg,
  },
  flowContent: {
    paddingHorizontal: Spacing.md,
  },
  flowLabel: {
    color: Colors.textSecondary,
    fontSize: FontSizes.md,
    marginBottom: Spacing.md,
  },

  // Amount input
  amountInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.inputBg,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.inputBorder,
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
  },
  amountCurrency: {
    color: Colors.text,
    fontSize: FontSizes.xxl,
    fontWeight: '700',
    marginRight: Spacing.sm,
  },
  amountInput: {
    flex: 1,
    color: Colors.text,
    fontSize: FontSizes.xxl,
    fontWeight: '700',
    paddingVertical: Spacing.lg,
  },

  // Quick amounts
  quickAmounts: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  quickAmountBtn: {
    backgroundColor: Colors.glass,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.glassBorder,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  quickAmountBtnActive: {
    backgroundColor: Colors.primaryDim,
    borderColor: Colors.primary,
  },
  quickAmountText: {
    color: Colors.text,
    fontSize: FontSizes.md,
    fontWeight: '600',
  },
  quickAmountTextActive: {
    color: Colors.primary,
  },

  // Fee toggle
  feeToggle: {
    alignItems: 'center',
    paddingVertical: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  feeToggleText: {
    color: Colors.textSecondary,
    fontSize: FontSizes.sm,
    textDecorationLine: 'underline',
  },

  // Fee panel
  feePanel: {
    backgroundColor: Colors.glass,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.glassBorder,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  feeTitle: {
    color: Colors.text,
    fontSize: FontSizes.md,
    fontWeight: '700',
    marginBottom: Spacing.sm,
  },
  feeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: Spacing.xs,
  },
  feeLabel: {
    color: Colors.textSecondary,
    fontSize: FontSizes.sm,
  },
  feeValue: {
    color: Colors.text,
    fontSize: FontSizes.sm,
  },
  feeTotalRow: {
    borderTopWidth: 1,
    borderTopColor: Colors.glassBorder,
    paddingTop: Spacing.sm,
    marginTop: Spacing.xs,
  },
  feeTotalLabel: {
    color: Colors.text,
    fontSize: FontSizes.md,
    fontWeight: '700',
  },
  feeTotalValue: {
    fontSize: FontSizes.md,
    fontWeight: '700',
  },
  feeCloseBtn: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.sm,
    alignItems: 'center',
    marginTop: Spacing.sm,
  },
  feeCloseBtnText: {
    color: Colors.textSecondary,
    fontSize: FontSizes.sm,
    fontWeight: '600',
  },

  // Crypto equivalent card
  cryptoEquivCard: {
    backgroundColor: Colors.primaryDim,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.primary,
    padding: Spacing.lg,
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  cryptoEquivLabel: {
    color: Colors.textSecondary,
    fontSize: FontSizes.sm,
    marginBottom: Spacing.xs,
  },
  cryptoEquivValue: {
    color: Colors.primary,
    fontSize: FontSizes.xl,
    fontWeight: '700',
    marginBottom: Spacing.xs,
  },
  cryptoEquivFee: {
    color: Colors.warning,
    fontSize: FontSizes.sm,
  },

  // Primary button
  primaryBtn: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.lg,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    marginTop: Spacing.lg,
  },
  primaryBtnDisabled: {
    opacity: 0.4,
  },
  primaryBtnText: {
    color: '#000',
    fontSize: FontSizes.lg,
    fontWeight: '700',
  },

  // Confirm card
  confirmCard: {
    backgroundColor: Colors.glass,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.glassBorder,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  confirmRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: Spacing.sm,
  },
  confirmLabel: {
    color: Colors.textSecondary,
    fontSize: FontSizes.md,
  },
  confirmValue: {
    color: Colors.text,
    fontSize: FontSizes.md,
    fontWeight: '700',
  },
  confirmDivider: {
    height: 1,
    backgroundColor: Colors.glassBorder,
    marginVertical: Spacing.sm,
  },

  // Tap / NFC screen
  tapContainer: {
    alignItems: 'center',
    paddingVertical: Spacing.xxl,
  },
  tapIcon: {
    fontSize: 64,
    marginBottom: Spacing.md,
  },
  tapTitle: {
    color: Colors.text,
    fontSize: FontSizes.xl,
    fontWeight: '700',
    marginBottom: Spacing.sm,
  },
  tapHint: {
    color: Colors.textSecondary,
    fontSize: FontSizes.md,
    textAlign: 'center',
    marginBottom: Spacing.xl,
  },
  tapAnimation: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 3,
    borderColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.lg,
  },
  tapAnimationText: {
    color: Colors.primary,
    fontSize: 36,
  },
  tapSimulateBtn: {
    backgroundColor: Colors.primaryDim,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.primary,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
    marginBottom: Spacing.md,
  },
  tapSimulateText: {
    color: Colors.primary,
    fontSize: FontSizes.md,
    fontWeight: '700',
  },
  cancelBtn: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
  },
  cancelBtnText: {
    color: Colors.textMuted,
    fontSize: FontSizes.md,
  },

  // Done screen
  doneContainer: {
    alignItems: 'center',
    paddingVertical: Spacing.xxl,
  },
  doneIcon: {
    fontSize: 72,
    marginBottom: Spacing.md,
  },
  doneTitle: {
    color: Colors.text,
    fontSize: FontSizes.xxl,
    fontWeight: '700',
    marginBottom: Spacing.sm,
  },
  doneAmount: {
    color: Colors.primary,
    fontSize: FontSizes.xl,
    fontWeight: '700',
    marginBottom: Spacing.xs,
  },
  doneDetails: {
    color: Colors.textSecondary,
    fontSize: FontSizes.md,
    marginBottom: Spacing.xs,
  },

  // History
  historyContainer: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  historyTitle: {
    color: Colors.text,
    fontSize: FontSizes.xl,
    fontWeight: '700',
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
  },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.md,
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  filterBtn: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.round,
    backgroundColor: Colors.glass,
    borderWidth: 1,
    borderColor: Colors.glassBorder,
  },
  filterBtnActive: {
    backgroundColor: Colors.primaryDim,
    borderColor: Colors.primary,
  },
  filterBtnText: {
    color: Colors.textSecondary,
    fontSize: FontSizes.sm,
    fontWeight: '600',
  },
  filterBtnTextActive: {
    color: Colors.primary,
  },
  historyCard: {
    backgroundColor: Colors.glass,
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.glassBorder,
    padding: Spacing.md,
  },
  historyCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  historyTypeIcon: {
    fontSize: 24,
    marginRight: Spacing.sm,
  },
  historyType: {
    color: Colors.text,
    fontSize: FontSizes.md,
    fontWeight: '600',
  },
  historyBank: {
    color: Colors.textSecondary,
    fontSize: FontSizes.sm,
  },
  historyAmount: {
    fontSize: FontSizes.lg,
    fontWeight: '700',
  },
  historyCardBody: {
    borderTopWidth: 1,
    borderTopColor: Colors.glassBorder,
    paddingTop: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  historyDetail: {
    color: Colors.textSecondary,
    fontSize: FontSizes.sm,
    marginBottom: Spacing.xs,
  },
  historyDate: {
    color: Colors.textMuted,
    fontSize: FontSizes.xs,
  },
  historyCardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusBadge: {
    borderRadius: BorderRadius.sm,
    paddingVertical: 2,
    paddingHorizontal: Spacing.sm,
  },
  statusBadgeText: {
    fontSize: FontSizes.xs,
    fontWeight: '600',
  },
  historyTxId: {
    color: Colors.textMuted,
    fontSize: FontSizes.xs,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },

  // Empty state
  emptyState: {
    alignItems: 'center',
    paddingVertical: Spacing.xxl,
    paddingHorizontal: Spacing.md,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: Spacing.md,
  },
  emptyText: {
    color: Colors.text,
    fontSize: FontSizes.lg,
    fontWeight: '600',
    marginBottom: Spacing.sm,
  },
  emptyHint: {
    color: Colors.textMuted,
    fontSize: FontSizes.sm,
    textAlign: 'center',
  },
});