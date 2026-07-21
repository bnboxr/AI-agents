// PayScreen.tsx — Tap-to-pay interface with NFC readiness indicator

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Easing,
  Platform,
} from 'react-native';
import * as HCEService from '../services/HCEService';
import * as BudgetService from '../services/BudgetService';
import { Colors, Spacing, FontSizes, BorderRadius } from '../theme/colors';

export default function PayScreen() {
  const [isReady, setIsReady] = useState(false);
  const [lastPayment, setLastPayment] = useState<{
    amount: number;
    merchant: string;
    status: 'approved' | 'declined';
  } | null>(null);
  const [budget, setBudget] = useState({ remaining: 0, limit: 0 });

  const rippleAnim = React.useRef(new Animated.Value(1)).current;
  const pulseAnim = React.useRef(new Animated.Value(1)).current;

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
      ])
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

  useEffect(() => {
    if (Platform.OS === 'android') {
      HCEService.initializeHCE();
      setIsReady(true);
      loadBudget();
    }

    return () => {
      HCEService.stopHCE();
    };
  }, [loadBudget]);

  // Listen for HCE payment results
  useEffect(() => {
    // In a full implementation, we'd subscribe to payment events
    // For now, poll budget periodically
    const interval = setInterval(loadBudget, 5000);
    return () => clearInterval(interval);
  }, [loadBudget]);

  const rippleScale = rippleAnim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0.3, 1.8, 1],
  });

  const rippleOpacity = rippleAnim.interpolate({
    inputRange: [0, 0.3, 1],
    outputRange: [0.8, 0.2, 0],
  });

  return (
    <View style={styles.container}>
      {/* Status Badge */}
      <View style={styles.statusBadge}>
        <View style={[styles.statusDot, isReady && styles.statusDotActive]} />
        <Text style={styles.statusText}>
          {isReady ? 'NFC Ready' : 'NFC Unavailable'}
        </Text>
      </View>

      {/* Central "Ready to Pay" Circle */}
      <View style={styles.circleContainer}>
        <Animated.View
          style={[
            styles.rippleCircle,
            { transform: [{ scale: rippleScale }], opacity: rippleOpacity },
          ]}
        />
        <Animated.View
          style={[
            styles.payCircle,
            { transform: [{ scale: pulseAnim }] },
          ]}
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
          3. Payment auto-processes — no confirmation needed{'\n'}
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
  statusDotActive: {
    backgroundColor: Colors.primary,
  },
  statusText: {
    color: Colors.text,
    fontSize: FontSizes.sm,
    fontWeight: '600',
  },
  circleContainer: {
    width: 220,
    height: 220,
    justifyContent: 'center',
    alignItems: 'center',
    marginVertical: Spacing.xl,
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
});
