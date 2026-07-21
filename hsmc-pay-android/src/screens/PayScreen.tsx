// PayScreen.tsx — Tap-to-pay interface with NFC readiness, POS detection,
// payment method selector bottom sheet, and Virtual Card support

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Easing,
  Platform,
  TouchableOpacity,
  Modal,
  Pressable,
  Dimensions,
} from 'react-native';
import * as HCEService from '../services/HCEService';
import * as BudgetService from '../services/BudgetService';
import * as VirtualCardService from '../services/VirtualCardService';
import * as NotificationService from '../services/NotificationService';
import type { VirtualCard } from '../services/VirtualCardService';
import { Colors, Spacing, FontSizes, BorderRadius } from '../theme/colors';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

export default function PayScreen() {
  const [isReady, setIsReady] = useState(false);
  const [lastPayment, setLastPayment] = useState<{
    amount: number;
    merchant: string;
    status: 'approved' | 'declined';
  } | null>(null);
  const [budget, setBudget] = useState({ remaining: 0, limit: 0 });

  // Payment method selector state
  const [showMethodSelector, setShowMethodSelector] = useState(false);
  const [pendingPayment, setPendingPayment] = useState<{
    amount: number;
    merchant: string;
    token: string;
    sessionId: string;
    contractAddress: string;
  } | null>(null);
  const [selectedMethod, setSelectedMethod] = useState<'crypto' | 'virtual_card'>('crypto');
  const [virtualCards, setVirtualCards] = useState<VirtualCard[]>([]);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [posTypeMessage, setPosTypeMessage] = useState<string | null>(null);
  const [detectedPOSType, setDetectedPOSType] = useState<HCEService.POSType>('unknown');

  const rippleAnim = useRef(new Animated.Value(1)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const sheetSlideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;

  // Pulse animation for the "Ready to Pay" circle
  useEffect(() => {
    if (!isReady) return;

    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.08,
          duration: 1200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [isReady, pulseAnim]);

  // Ripple effect on payment
  const triggerRipple = useCallback(() => {
    rippleAnim.setValue(0);
    Animated.timing(rippleAnim, {
      toValue: 1,
      duration: 600,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start();
  }, [rippleAnim]);

  const loadBudget = useCallback(async () => {
    const b = await BudgetService.getBudget();
    setBudget({ remaining: Math.max(0, b.limit - b.spent), limit: b.limit });
  }, []);

  const loadCards = useCallback(async () => {
    const cards = await VirtualCardService.getCards();
    setVirtualCards(cards);
    if (cards.length > 0) {
      setSelectedCardId(cards[0].id);
    }
  }, []);

  useEffect(() => {
    if (Platform.OS === 'android') {
      HCEService.initializeHCE();
      setIsReady(true);
      loadBudget();
      loadCards();
    }

    return () => {
      HCEService.stopHCE();
    };
  }, [loadBudget, loadCards]);

  // Listen for POS type detection
  useEffect(() => {
    HCEService.setOnPOSTypeDetected((type, _apduData) => {
      setDetectedPOSType(type);
      if (type !== 'hsmc' && type !== 'unknown') {
        setSelectedMethod('virtual_card');
      } else {
        setSelectedMethod('crypto');
      }
    });

    HCEService.setOnStandardPOSDetected((info) => {
      setPosTypeMessage(info.message);
    });

    return () => {
      HCEService.clearOnPOSTypeDetected();
      HCEService.clearOnStandardPOSDetected();
    };
  }, []);

  // Listen for HCE payment results — poll budget/cards periodically
  useEffect(() => {
    const interval = setInterval(() => {
      loadBudget();
      loadCards();
    }, 5000);
    return () => clearInterval(interval);
  }, [loadBudget, loadCards]);

  const rippleScale = rippleAnim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0.3, 1.8, 1],
  });

  const rippleOpacity = rippleAnim.interpolate({
    inputRange: [0, 0.3, 1],
    outputRange: [0.8, 0.2, 0],
  });

  // Show payment method selector bottom sheet
  const showSelector = (payment: {
    amount: number;
    merchant: string;
    token: string;
    sessionId: string;
    contractAddress: string;
  }) => {
    setPendingPayment(payment);
    setShowMethodSelector(true);
    Animated.spring(sheetSlideAnim, {
      toValue: 0,
      useNativeDriver: true,
      damping: 20,
      stiffness: 200,
    }).start();
  };

  const hideSelector = () => {
    Animated.timing(sheetSlideAnim, {
      toValue: SCREEN_HEIGHT,
      duration: 250,
      useNativeDriver: true,
    }).start(() => {
      setShowMethodSelector(false);
      setPendingPayment(null);
    });
  };

  const handlePayWithCrypto = async () => {
    if (!pendingPayment) return;
    hideSelector();
    triggerRipple();

    // Simulate crypto payment processing
    try {
      const response = await HCEService.processHCERequest({
        amount: pendingPayment.amount.toString(),
        token: pendingPayment.token,
        contractAddress: pendingPayment.contractAddress,
        sessionId: pendingPayment.sessionId,
        merchant: pendingPayment.merchant,
      });

      if (response.approved) {
        setLastPayment({
          amount: pendingPayment.amount,
          merchant: pendingPayment.merchant,
          status: 'approved',
        });

        // Send notification
        await NotificationService.notifyPaymentConfirmed({
          id: pendingPayment.sessionId,
          amount: pendingPayment.amount,
          token: pendingPayment.token,
          merchant: pendingPayment.merchant,
          date: Date.now(),
          status: 'approved',
        });
      } else {
        setLastPayment({
          amount: pendingPayment.amount,
          merchant: pendingPayment.merchant,
          status: 'declined',
        });
      }
    } catch {
      setLastPayment({
        amount: pendingPayment.amount,
        merchant: pendingPayment.merchant,
        status: 'declined',
      });
    }

    loadBudget();
  };

  const handlePayWithVirtualCard = async () => {
    if (!pendingPayment || !selectedCardId) {
      hideSelector();
      return;
    }

    hideSelector();
    triggerRipple();

    try {
      await VirtualCardService.spendFromCard(selectedCardId, pendingPayment.amount);

      setLastPayment({
        amount: pendingPayment.amount,
        merchant: pendingPayment.merchant,
        status: 'approved',
      });

      await NotificationService.notifyPaymentConfirmed({
        id: pendingPayment.sessionId,
        amount: pendingPayment.amount,
        token: 'USD',
        merchant: pendingPayment.merchant,
        date: Date.now(),
        status: 'approved',
      });

      loadCards();
    } catch (e: any) {
      setLastPayment({
        amount: pendingPayment.amount,
        merchant: pendingPayment.merchant,
        status: 'declined',
      });
    }

    loadBudget();
  };

  // Demo: simulate a payment detection (for development)
  const simulatePayment = () => {
    showSelector({
      amount: 25.0,
      merchant: 'CoffeeShop',
      token: 'USDC',
      sessionId: `sess_${Date.now()}`,
      contractAddress: '0x0000000000000000000000000000000000000000',
    });
  };

  const selectedCard = virtualCards.find((c) => c.id === selectedCardId);

  return (
    <View style={styles.container}>
      {/* Status Badge */}
      <View style={styles.statusBadge}>
        <View style={[styles.statusDot, isReady && styles.statusDotActive]} />
        <Text style={styles.statusText}>
          {isReady ? 'NFC Ready' : 'NFC Unavailable'}
        </Text>
      </View>

      {/* POS Type Indicator */}
      {detectedPOSType !== 'unknown' && detectedPOSType !== 'hsmc' && (
        <View style={styles.posTypeBadge}>
          <Text style={styles.posTypeText}>
            {detectedPOSType.toUpperCase()} Terminal Detected
          </Text>
        </View>
      )}

      {/* Central "Ready to Pay" Circle */}
      <View style={styles.circleContainer}>
        <Animated.View
          style={[
            styles.rippleCircle,
            { transform: [{ scale: rippleScale }], opacity: rippleOpacity },
          ]}
        />
        <Animated.View
          style={[styles.payCircle, { transform: [{ scale: pulseAnim }] }]}
        >
          <Text style={styles.payIcon}>💳</Text>
          <Text style={styles.payText}>Ready to Pay</Text>
          <Text style={styles.paySubtext}>Tap phone at POS terminal</Text>
        </Animated.View>
      </View>

      {/* Budget Info */}
      <View style={styles.glassCard}>
        <View style={styles.budgetRow}>
          <Text style={styles.budgetLabel}>Remaining Budget</Text>
          <Text style={styles.budgetValue}>${budget.remaining.toFixed(2)}</Text>
        </View>
        <View style={styles.budgetRow}>
          <Text style={styles.budgetLabel}>Monthly Limit</Text>
          <Text style={styles.budgetValue}>${budget.limit.toFixed(2)}</Text>
        </View>
      </View>

      {/* Virtual Card Status (if any) */}
      {virtualCards.length > 0 && selectedCard && (
        <View style={styles.glassCard}>
          <Text style={styles.cardSectionTitle}>Active Virtual Card</Text>
          <View style={styles.cardMini}>
            <Text style={styles.cardMiniType}>{selectedCard.type.toUpperCase()}</Text>
            <Text style={styles.cardMiniPAN}>
              ****{selectedCard.pan.slice(-4)}
            </Text>
            <Text style={styles.cardMiniBalance}>
              ${selectedCard.balance.toFixed(2)}
            </Text>
            {selectedCard.frozen && (
              <Text style={styles.cardFrozenLabel}>🔒 Frozen</Text>
            )}
          </View>
        </View>
      )}

      {/* PosType Message */}
      {posTypeMessage && (
        <View style={styles.glassCard}>
          <Text style={styles.posMessageIcon}>💳</Text>
          <Text style={styles.posMessageText}>{posTypeMessage}</Text>
        </View>
      )}

      {/* Last Payment Result */}
      {lastPayment && (
        <View
          style={[
            styles.glassCard,
            lastPayment.status === 'approved' ? styles.approvedCard : styles.declinedCard,
          ]}
        >
          <Text style={styles.resultStatus}>
            {lastPayment.status === 'approved' ? '✅ Approved' : '❌ Declined'}
          </Text>
          <Text style={styles.resultAmount}>${lastPayment.amount.toFixed(2)}</Text>
          <Text style={styles.resultMerchant}>{lastPayment.merchant}</Text>
        </View>
      )}

      {/* Instructions */}
      {!isReady && (
        <View style={styles.glassCard}>
          <Text style={styles.noteTitle}>NFC Not Available</Text>
          <Text style={styles.noteText}>
            This device does not support NFC HCE. HSMC Pay requires an Android device with NFC
            hardware and Android 4.4+ (KitKat) or later.
          </Text>
        </View>
      )}

      {/* How-to */}
      <View style={styles.glassCard}>
        <Text style={styles.noteTitle}>How to Pay</Text>
        <Text style={styles.noteText}>
          1. Set your spending budget in Wallet{'\n'}
          2. Hold your phone near the POS terminal{'\n'}
          3. Select payment method when prompted{'\n'}
          4. Receipt appears in History
        </Text>
      </View>

      {/* Demo: Simulate payment button (development only) */}
      <TouchableOpacity style={styles.demoButton} onPress={simulatePayment}>
        <Text style={styles.demoButtonText}>🔄 Simulate Payment</Text>
      </TouchableOpacity>

      {/* Payment Method Selector Bottom Sheet */}
      <Modal visible={showMethodSelector} transparent animationType="none">
        <Pressable style={styles.overlay} onPress={hideSelector}>
          <View />
        </Pressable>
        <Animated.View
          style={[
            styles.bottomSheet,
            { transform: [{ translateY: sheetSlideAnim }] },
          ]}
        >
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Payment Request</Text>

          {pendingPayment && (
            <>
              <Text style={styles.sheetAmount}>
                ${pendingPayment.amount.toFixed(2)}
              </Text>
              <Text style={styles.sheetMerchant}>
                {pendingPayment.merchant}
              </Text>

              <Text style={styles.sheetSectionTitle}>Pay with:</Text>

              {/* Crypto option */}
              <TouchableOpacity
                style={[
                  styles.methodOption,
                  selectedMethod === 'crypto' && styles.methodOptionSelected,
                ]}
                onPress={() => setSelectedMethod('crypto')}
              >
                <View style={styles.methodRadio}>
                  {selectedMethod === 'crypto' && <View style={styles.methodRadioDot} />}
                </View>
                <View style={styles.methodInfo}>
                  <Text style={styles.methodTitle}>Crypto (USDC)</Text>
                  <Text style={styles.methodSubtitle}>
                    ${pendingPayment.amount.toFixed(2)} — Direct wallet payment
                  </Text>
                </View>
              </TouchableOpacity>

              {/* Virtual Card option */}
              {virtualCards.map((card) => (
                <TouchableOpacity
                  key={card.id}
                  style={[
                    styles.methodOption,
                    selectedMethod === 'virtual_card' &&
                      selectedCardId === card.id &&
                      styles.methodOptionSelected,
                  ]}
                  onPress={() => {
                    setSelectedMethod('virtual_card');
                    setSelectedCardId(card.id);
                  }}
                >
                  <View style={styles.methodRadio}>
                    {selectedMethod === 'virtual_card' &&
                      selectedCardId === card.id && (
                        <View style={styles.methodRadioDot} />
                      )}
                  </View>
                  <View style={styles.methodInfo}>
                    <Text style={styles.methodTitle}>
                      Virtual Card ····{card.pan.slice(-4)}
                    </Text>
                    <Text style={styles.methodSubtitle}>
                      Balance: ${card.balance.toFixed(2)}{' '}
                      {card.frozen ? '🔒 Frozen' : ''}
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}

              {/* No cards message */}
              {virtualCards.length === 0 && selectedMethod === 'virtual_card' && (
                <View style={styles.noCardsMessage}>
                  <Text style={styles.noCardsText}>
                    No virtual cards available. Go to Settings to create one.
                  </Text>
                </View>
              )}

              {/* Pay button */}
              <TouchableOpacity
                style={[
                  styles.payButton,
                  selectedMethod === 'virtual_card' && !selectedCardId && styles.payButtonDisabled,
                ]}
                onPress={
                  selectedMethod === 'crypto'
                    ? handlePayWithCrypto
                    : handlePayWithVirtualCard
                }
                disabled={selectedMethod === 'virtual_card' && !selectedCardId}
              >
                <Text style={styles.payButtonText}>Pay Now</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.cancelButton} onPress={hideSelector}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
            </>
          )}
        </Animated.View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    padding: Spacing.lg,
    alignItems: 'center',
    gap: Spacing.lg,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.glass,
    borderRadius: BorderRadius.round,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.glassBorder,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.textMuted,
  },
  statusDotActive: { backgroundColor: Colors.primary },
  statusText: { color: Colors.text, fontSize: FontSizes.sm, fontWeight: '600' },
  posTypeBadge: {
    backgroundColor: Colors.primaryDim,
    borderRadius: BorderRadius.round,
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  posTypeText: { color: Colors.primary, fontSize: FontSizes.sm, fontWeight: '700' },
  circleContainer: {
    width: 220,
    height: 220,
    justifyContent: 'center',
    alignItems: 'center',
    marginVertical: Spacing.lg,
  },
  rippleCircle: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: Colors.primaryDim,
  },
  payCircle: {
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: Colors.glass,
    borderWidth: 3,
    borderColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  payIcon: { fontSize: 40 },
  payText: { color: Colors.primary, fontSize: FontSizes.lg, fontWeight: '700' },
  paySubtext: { color: Colors.textSecondary, fontSize: FontSizes.xs, textAlign: 'center' },
  glassCard: {
    width: '100%',
    backgroundColor: Colors.glass,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.glassBorder,
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  budgetRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  budgetLabel: { color: Colors.textSecondary, fontSize: FontSizes.md },
  budgetValue: { color: Colors.text, fontSize: FontSizes.lg, fontWeight: '700' },
  approvedCard: { borderColor: Colors.primary },
  declinedCard: { borderColor: Colors.danger },
  resultStatus: { color: Colors.text, fontSize: FontSizes.lg, fontWeight: '700' },
  resultAmount: { color: Colors.primary, fontSize: FontSizes.xl, fontWeight: '700' },
  resultMerchant: { color: Colors.textSecondary, fontSize: FontSizes.md },
  noteTitle: { color: Colors.text, fontSize: FontSizes.md, fontWeight: '700' },
  noteText: { color: Colors.textSecondary, fontSize: FontSizes.sm, lineHeight: 20 },
  cardSectionTitle: {
    color: Colors.textSecondary,
    fontSize: FontSizes.xs,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  cardMini: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
  },
  cardMiniType: { color: Colors.primary, fontSize: FontSizes.sm, fontWeight: '700' },
  cardMiniPAN: { color: Colors.text, fontSize: FontSizes.md, fontFamily: 'monospace' },
  cardMiniBalance: { color: Colors.primary, fontSize: FontSizes.md, fontWeight: '700' },
  cardFrozenLabel: { color: Colors.danger, fontSize: FontSizes.xs, fontWeight: '700' },
  posMessageIcon: { fontSize: 24, textAlign: 'center' },
  posMessageText: { color: Colors.textSecondary, fontSize: FontSizes.sm, textAlign: 'center' },

  // Demo button
  demoButton: {
    backgroundColor: Colors.primaryDim,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  demoButtonText: { color: Colors.primary, fontSize: FontSizes.md, fontWeight: '600' },

  // Bottom sheet
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  bottomSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: Colors.background,
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    borderWidth: 1,
    borderColor: Colors.glassBorder,
    padding: Spacing.lg,
    paddingBottom: Spacing.xxl,
    maxHeight: SCREEN_HEIGHT * 0.75,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    backgroundColor: Colors.glassBorder,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: Spacing.lg,
  },
  sheetTitle: {
    color: Colors.textSecondary,
    fontSize: FontSizes.sm,
    textTransform: 'uppercase',
    letterSpacing: 1,
    textAlign: 'center',
  },
  sheetAmount: {
    color: Colors.text,
    fontSize: FontSizes.hero,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: Spacing.xs,
  },
  sheetMerchant: {
    color: Colors.textSecondary,
    fontSize: FontSizes.lg,
    textAlign: 'center',
    marginBottom: Spacing.lg,
  },
  sheetSectionTitle: {
    color: Colors.textSecondary,
    fontSize: FontSizes.xs,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: Spacing.sm,
  },
  methodOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    backgroundColor: Colors.glass,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.glassBorder,
    marginBottom: Spacing.sm,
    gap: Spacing.md,
  },
  methodOptionSelected: {
    borderColor: Colors.primary,
    backgroundColor: 'rgba(0, 230, 118, 0.08)',
  },
  methodRadio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: Colors.glassBorder,
    justifyContent: 'center',
    alignItems: 'center',
  },
  methodRadioDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: Colors.primary,
  },
  methodInfo: { flex: 1 },
  methodTitle: { color: Colors.text, fontSize: FontSizes.md, fontWeight: '600' },
  methodSubtitle: { color: Colors.textSecondary, fontSize: FontSizes.xs, marginTop: 2 },
  noCardsMessage: {
    padding: Spacing.md,
    backgroundColor: Colors.glass,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.md,
  },
  noCardsText: { color: Colors.textMuted, fontSize: FontSizes.sm, textAlign: 'center' },
  payButton: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    marginTop: Spacing.md,
  },
  payButtonDisabled: { opacity: 0.4 },
  payButtonText: { color: Colors.background, fontSize: FontSizes.lg, fontWeight: '700' },
  cancelButton: {
    paddingVertical: Spacing.md,
    alignItems: 'center',
    marginTop: Spacing.sm,
  },
  cancelText: { color: Colors.textSecondary, fontSize: FontSizes.md },
});
