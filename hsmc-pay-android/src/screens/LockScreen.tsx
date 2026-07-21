// LockScreen.tsx — PIN / Biometric security lock screen
// App opens to this screen first. User must authenticate before accessing wallet.

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Alert,
  Platform,
  Vibration,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import * as WalletService from '../services/WalletService';
import { Colors, Spacing, FontSizes, BorderRadius } from '../theme/colors';

const PIN_KEY = '@hsmc_pin';
const PIN_ATTEMPTS_KEY = '@hsmc_pin_attempts';
const LOCKOUT_KEY = '@hsmc_pin_lockout';
const BIOMETRIC_ENABLED_KEY = '@hsmc_biometric_enabled';
const PIN_LENGTH = 6;
const MAX_ATTEMPTS = 3;
const LOCKOUT_DURATION_MS = 30_000; // 30 seconds

interface LockScreenProps {
  onUnlock: () => void;
}

export default function LockScreen({ onUnlock }: LockScreenProps) {
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [hasPin, setHasPin] = useState<boolean | null>(null);
  const [mode, setMode] = useState<'enter' | 'create' | 'confirm' | 'recover'>('enter');
  const [attempts, setAttempts] = useState(0);
  const [lockoutUntil, setLockoutUntil] = useState<number | null>(null);
  const [lockoutSeconds, setLockoutSeconds] = useState(0);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [recoverPhrase, setRecoverPhrase] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const shakeAnim = useRef(new Animated.Value(0)).current;
  const dotsAnim = useRef(Array.from({ length: PIN_LENGTH }, () => new Animated.Value(1))).current;

  // Load stored PIN state
  useEffect(() => {
    (async () => {
      const stored = await AsyncStorage.getItem(PIN_KEY);
      setHasPin(!!stored);

      const bioEnabled = await AsyncStorage.getItem(BIOMETRIC_ENABLED_KEY);
      setBiometricEnabled(bioEnabled === 'true');

      // Check lockout
      const lockoutRaw = await AsyncStorage.getItem(LOCKOUT_KEY);
      if (lockoutRaw) {
        const lockTime = parseInt(lockoutRaw, 10);
        if (Date.now() < lockTime) {
          setLockoutUntil(lockTime);
          const remaining = Math.ceil((lockTime - Date.now()) / 1000);
          setLockoutSeconds(remaining);
        }
      }
    })();
  }, []);

  // Lockout countdown
  useEffect(() => {
    if (!lockoutUntil) return;
    const interval = setInterval(() => {
      const remaining = Math.ceil((lockoutUntil - Date.now()) / 1000);
      if (remaining <= 0) {
        setLockoutUntil(null);
        setLockoutSeconds(0);
        setAttempts(0);
        AsyncStorage.removeItem(LOCKOUT_KEY);
      } else {
        setLockoutSeconds(remaining);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [lockoutUntil]);

  // Check biometric on mount
  useEffect(() => {
    if (hasPin && biometricEnabled) {
      triggerBiometric();
    }
  }, [hasPin, biometricEnabled]);

  const triggerBiometric = async () => {
    try {
      // In production: use react-native-keychain for biometric
      // const result = await Keychain.getGenericPassword({
      //   authenticationPrompt: { title: 'Unlock HSMC Pay' },
      //   accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_ANY,
      // });
      // if (result) { onUnlock(); return; }

      // For prototype, simulate:
      Alert.alert(
        'Biometric Unlock',
        Platform.OS === 'android' ? 'Use fingerprint to unlock' : 'Use Face ID to unlock',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Simulate Success',
            onPress: () => {
              AsyncStorage.removeItem(PIN_ATTEMPTS_KEY);
              onUnlock();
            },
          },
        ],
      );
    } catch (e) {
      // Biometric failed, fall through to PIN
    }
  };

  const shake = () => {
    Vibration.vibrate(300);
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 50, useNativeDriver: true }),
    ]).start();
  };

  const handleKeyPress = useCallback(
    async (digit: string) => {
      if (lockoutUntil) return;

      if (mode === 'recover') {
        // In recover mode, we're typing the mnemonic phrase
        setErrorMessage('');
        if (digit === '⌫') {
          setRecoverPhrase((prev) => prev.slice(0, -1));
        } else if (recoverPhrase.length < 500) {
          setRecoverPhrase((prev) => prev + digit);
        }
        return;
      }

      setErrorMessage('');

      if (digit === '⌫') {
        setPin((prev) => prev.slice(0, -1));
        return;
      }
      if (digit === 'bio') {
        triggerBiometric();
        return;
      }

      const newPin = pin + digit;
      if (newPin.length > PIN_LENGTH) return;
      setPin(newPin);

      // Animate dot
      const idx = newPin.length - 1;
      if (idx >= 0 && idx < PIN_LENGTH) {
        Animated.sequence([
          Animated.timing(dotsAnim[idx], { toValue: 1.3, duration: 100, useNativeDriver: true }),
          Animated.timing(dotsAnim[idx], { toValue: 1, duration: 100, useNativeDriver: true }),
        ]).start();
      }

      if (newPin.length === PIN_LENGTH) {
        if (mode === 'create') {
          setPin('');
          setMode('confirm');
          setConfirmPin(newPin);
        } else if (mode === 'confirm') {
          if (newPin === confirmPin) {
            await savePin(newPin);
          } else {
            setErrorMessage('PINs do not match. Try again.');
            shake();
            setPin('');
            setConfirmPin('');
            setMode('create');
          }
        } else if (mode === 'enter') {
          await verifyPin(newPin);
        }
      }
    },
    [pin, mode, confirmPin, lockoutUntil, recoverPhrase],
  );

  const savePin = async (newPin: string) => {
    await AsyncStorage.setItem(PIN_KEY, newPin);
    await AsyncStorage.removeItem(PIN_ATTEMPTS_KEY);
    setHasPin(true);
    setMode('enter');
    setPin('');
    setConfirmPin('');
    onUnlock();
  };

  const verifyPin = async (entered: string) => {
    const stored = await AsyncStorage.getItem(PIN_KEY);
    if (entered === stored) {
      await AsyncStorage.removeItem(PIN_ATTEMPTS_KEY);
      setAttempts(0);
      setPin('');
      onUnlock();
    } else {
      const newAttempts = attempts + 1;
      setAttempts(newAttempts);
      await AsyncStorage.setItem(PIN_ATTEMPTS_KEY, newAttempts.toString());

      if (newAttempts >= MAX_ATTEMPTS) {
        const lockTime = Date.now() + LOCKOUT_DURATION_MS;
        setLockoutUntil(lockTime);
        setLockoutSeconds(30);
        await AsyncStorage.setItem(LOCKOUT_KEY, lockTime.toString());
        setErrorMessage(`Too many attempts. Wait 30 seconds.`);
      } else {
        setErrorMessage(`Wrong PIN. ${MAX_ATTEMPTS - newAttempts} attempts remaining.`);
      }
      shake();
      setPin('');
    }
  };

  const handleForgotPin = () => {
    Alert.alert(
      'Recover Access',
      'Enter your wallet mnemonic phrase to reset your PIN.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          onPress: () => {
            setMode('recover');
            setRecoverPhrase('');
            setErrorMessage('');
          },
        },
      ],
    );
  };

  const handleRecoverSubmit = async () => {
    try {
      const mnemonic = await WalletService.getMnemonic();
      if (recoverPhrase.trim().toLowerCase() === mnemonic?.toLowerCase()) {
        // Correct mnemonic — allow PIN reset
        await AsyncStorage.removeItem(PIN_KEY);
        await AsyncStorage.removeItem(PIN_ATTEMPTS_KEY);
        await AsyncStorage.removeItem(LOCKOUT_KEY);
        setHasPin(false);
        setMode('create');
        setPin('');
        setRecoverPhrase('');
        setErrorMessage('');
        Alert.alert('Verified', 'Set a new PIN.');
      } else {
        setErrorMessage('Incorrect mnemonic phrase.');
        shake();
      }
    } catch (e: any) {
      setErrorMessage(e.message || 'Recovery failed');
    }
  };

  if (hasPin === null) {
    return (
      <View style={styles.container}>
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  const renderDots = () => {
    const count = mode === 'recover' ? 0 : PIN_LENGTH;
    return (
      <View style={styles.dotsRow}>
        {Array.from({ length: count }).map((_, i) => (
          <Animated.View
            key={i}
            style={[
              styles.dot,
              i < pin.length && styles.dotFilled,
              { transform: [{ scale: dotsAnim[i] }] },
            ]}
          />
        ))}
      </View>
    );
  };

  const renderTitle = () => {
    if (lockoutUntil) return `Wait ${lockoutSeconds}s`;
    switch (mode) {
      case 'create':
        return 'Create PIN';
      case 'confirm':
        return 'Confirm PIN';
      case 'recover':
        return 'Enter Mnemonic';
      default:
        return 'Enter PIN';
    }
  };

  const renderRecoverInput = () => (
    <View style={styles.recoverContainer}>
      <Text style={styles.recoverText} numberOfLines={4}>
        {recoverPhrase || 'Type your 12-word recovery phrase...'}
      </Text>
      <TouchableOpacity style={styles.recoverSubmitBtn} onPress={handleRecoverSubmit}>
        <Text style={styles.recoverSubmitText}>Verify & Reset</Text>
      </TouchableOpacity>
    </View>
  );

  const keypad = [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
    ['bio', '0', '⌫'],
  ];

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Icon name="shield-lock" size={48} color={Colors.primary} />
        <Text style={styles.appName}>HSMC Pay</Text>
      </View>

      {/* Title & Dots */}
      <Animated.View style={[styles.inputSection, { transform: [{ translateX: shakeAnim }] }]}>
        <Text style={styles.title}>{renderTitle()}</Text>
        {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}
        {mode === 'recover' ? renderRecoverInput() : renderDots()}
      </Animated.View>

      {/* Keypad */}
      {!lockoutUntil && mode !== 'recover' && (
        <View style={styles.keypadContainer}>
          {keypad.map((row, rowIdx) => (
            <View key={rowIdx} style={styles.keypadRow}>
              {row.map((key) => (
                <TouchableOpacity
                  key={key}
                  style={[styles.keyButton, key === 'bio' && styles.bioButton]}
                  onPress={() => handleKeyPress(key)}
                  disabled={lockoutUntil !== null}
                  activeOpacity={0.4}
                >
                  {key === 'bio' ? (
                    <Icon name="fingerprint" size={28} color={Colors.primary} />
                  ) : key === '⌫' ? (
                    <Icon name="backspace-outline" size={24} color={Colors.text} />
                  ) : (
                    <Text style={styles.keyText}>{key}</Text>
                  )}
                </TouchableOpacity>
              ))}
            </View>
          ))}
        </View>
      )}

      {/* Footer */}
      <View style={styles.footer}>
        {mode === 'enter' && (
          <TouchableOpacity onPress={handleForgotPin}>
            <Text style={styles.forgotText}>Forgot PIN?</Text>
          </TouchableOpacity>
        )}
        {mode === 'recover' && (
          <TouchableOpacity onPress={() => setMode(hasPin ? 'enter' : 'create')}>
            <Text style={styles.forgotText}>Back to PIN</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
  },
  loadingText: {
    color: Colors.textSecondary,
    fontSize: FontSizes.lg,
  },
  header: {
    alignItems: 'center',
    gap: Spacing.md,
    marginBottom: Spacing.xxl,
  },
  appName: {
    color: Colors.primary,
    fontSize: FontSizes.xl,
    fontWeight: '700',
    letterSpacing: 2,
  },
  inputSection: {
    alignItems: 'center',
    gap: Spacing.md,
    marginBottom: Spacing.xl,
  },
  title: {
    color: Colors.text,
    fontSize: FontSizes.lg,
    fontWeight: '600',
  },
  errorText: {
    color: Colors.danger,
    fontSize: FontSizes.sm,
    textAlign: 'center',
  },
  dotsRow: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginVertical: Spacing.md,
  },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: Colors.glassBorder,
    backgroundColor: 'transparent',
  },
  dotFilled: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  keypadContainer: {
    width: '100%',
    maxWidth: 300,
    gap: Spacing.sm,
  },
  keypadRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.lg,
  },
  keyButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.glass,
    borderWidth: 1,
    borderColor: Colors.glassBorder,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bioButton: {
    backgroundColor: 'rgba(0, 230, 118, 0.12)',
    borderColor: Colors.primaryDim,
  },
  keyText: {
    color: Colors.text,
    fontSize: FontSizes.xl,
    fontWeight: '600',
  },
  footer: {
    marginTop: Spacing.xl,
    alignItems: 'center',
  },
  forgotText: {
    color: Colors.textSecondary,
    fontSize: FontSizes.sm,
    textDecorationLine: 'underline',
  },
  recoverContainer: {
    width: '100%',
    alignItems: 'center',
    gap: Spacing.md,
  },
  recoverText: {
    color: Colors.textSecondary,
    fontSize: FontSizes.md,
    fontFamily: 'monospace',
    backgroundColor: Colors.glass,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.glassBorder,
    padding: Spacing.md,
    width: '100%',
    minHeight: 80,
    textAlignVertical: 'top',
  },
  recoverSubmitBtn: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
  },
  recoverSubmitText: {
    color: Colors.background,
    fontSize: FontSizes.md,
    fontWeight: '700',
  },
});
