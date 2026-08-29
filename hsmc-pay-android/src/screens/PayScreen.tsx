// PayScreen.tsx — Tap-to-pay interface with NFC readiness and POS detection.
//
// The NFC Ready badge reflects the REAL device capability (native
// isHCEAvailable()). Payments are only ever produced by the real HCE flow:
// a POS terminal tap drives HCEService.kt → onHCERequest → processHCERequest
// → EIP-712 signing → APDU response. This screen does NOT fake an approval.

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Easing,
  Platform,
  TouchableOpacity,
} from 'react-native';
import * as HCEService from '../services/HCEService';
import * as BudgetService from '../services/BudgetService';
import * as VirtualCardService from '../services/VirtualCardService';
import type { VirtualCard } from '../services/VirtualCardService';
import { Colors, Spacing, FontSizes, BorderRadius } from '../theme/colors';

export default function PayScreen() {
  const [isReady, setIsReady] = useState(false);
  const [budget, setBudget] = useState({ remaining: 0, limit: 0 });
  const [virtualCards, setVirtualCards] = useState<VirtualCard[]>([]);
  const [posTypeMessage, setPosTypeMessage] = useState<string | null>(null);
  const [detectedPOSType, setDetectedPOSType] = useState<HCEService.POSType>('unknown');

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const rippleAnim = useRef(new Animated.Value(1)).current;

  // Pulse animation for the "Ready to Pay" circle (only when NFC is truly ready)
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

  // Ripple effect on a real payment (triggered from the HCE tap path).
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
  }, []);

  useEffect(() => {
    if (Platform.OS === 'android') {
      HCEService.initializeHCE();
      // Real availability check: reflect the native NFC adapter state instead
      // of hardcoding "ready".
      HCEService.isHCEAvailable()
        .then((available) => setIsReady(available))
        .catch(() => setIsReady(false));
      loadBudget();
      loadCards();
    }

    return () => {
      HCEService.stopHCE();
    };
  }, [loadBudget, loadCards]);

  // Listen for POS type detection (real HCE events)
  useEffect(() => {
    HCEService.setOnPOSTypeDetected((type, _apduData) => {
      setDetectedPOSType(type);
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

  const selectedCard = virtualCards[0] ?? null;

  return (
    <View style={styles.container}>
      {/* Status Badge — reflects the real HCE availability */}
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
          2. Hold your phone near an HSMC POS terminal{'\n'}
          3. Approve the payment with your device biometrics{'\n'}
          4. Receipt appears in History
        </Text>
      </View>
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
});
