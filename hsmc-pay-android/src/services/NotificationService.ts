// NotificationService.ts — Push notification management for HSMC Pay
// Uses react-native-push-notification for local notifications
// In production: integrate with Firebase Cloud Messaging for remote push

import { Platform, PermissionsAndroid, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Transaction } from './TransactionStore';

const NOTIF_PREFS_KEY = '@hsmc_notification_prefs';
const BUDGET_ALERT_PERCENT = 0.8; // 80% threshold

export interface NotificationPreferences {
  paymentConfirmations: boolean;
  budgetAlerts: boolean;
  cardFrozenAlerts: boolean;
  securityAlerts: boolean;
  promotionalOffers: boolean;
  quietHoursEnabled: boolean;
  quietHoursStart: string; // "22:00"
  quietHoursEnd: string;   // "08:00"
}

const DEFAULT_PREFS: NotificationPreferences = {
  paymentConfirmations: true,
  budgetAlerts: true,
  cardFrozenAlerts: true,
  securityAlerts: true,
  promotionalOffers: false,
  quietHoursEnabled: false,
  quietHoursStart: '22:00',
  quietHoursEnd: '08:00',
};

// Track whether push notifications module is loaded
let pushNotifAvailable = false;

export async function initialize(): Promise<void> {
  try {
    // Attempt to load push notification module
    // In production, this would configure react-native-push-notification
    if (Platform.OS === 'android') {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
        {
          title: 'HSMC Pay Notifications',
          message: 'Receive payment confirmations and security alerts',
          buttonPositive: 'Allow',
          buttonNegative: 'Deny',
        },
      );
      pushNotifAvailable = granted === PermissionsAndroid.RESULTS.GRANTED;
    } else {
      pushNotifAvailable = true;
    }

    if (pushNotifAvailable) {
      console.log('[HSMC Pay] Notifications initialized');
    } else {
      console.warn('[HSMC Pay] Notification permission denied');
    }
  } catch (error) {
    console.warn('[HSMC Pay] Notification setup failed:', error);
    pushNotifAvailable = false;
  }
}

export async function getPreferences(): Promise<NotificationPreferences> {
  try {
    const raw = await AsyncStorage.getItem(NOTIF_PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_PREFS;
  }
}

export async function updatePreferences(prefs: Partial<NotificationPreferences>): Promise<void> {
  const current = await getPreferences();
  const updated = { ...current, ...prefs };
  await AsyncStorage.setItem(NOTIF_PREFS_KEY, JSON.stringify(updated));
}

function isQuietHours(prefs: NotificationPreferences): boolean {
  if (!prefs.quietHoursEnabled) return false;
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const [startH, startM] = prefs.quietHoursStart.split(':').map(Number);
  const [endH, endM] = prefs.quietHoursEnd.split(':').map(Number);
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  if (startMinutes <= endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
  } else {
    // Overnight quiet hours
    return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
  }
}

async function shouldSend(type: keyof NotificationPreferences): Promise<boolean> {
  const prefs = await getPreferences();
  return prefs[type] && !isQuietHours(prefs);
}

async function sendLocalNotification(title: string, message: string): Promise<void> {
  if (!pushNotifAvailable) return;

  try {
    // In production: use react-native-push-notification's localNotification
    // For now, log to console (prototype)
    console.log(`[HSMC Notif] ${title}: ${message}`);

    // The actual push notification call would be:
    // PushNotification.localNotification({
    //   channelId: 'hsmc-pay',
    //   title,
    //   message,
    //   playSound: true,
    //   soundName: 'default',
    //   importance: 'high',
    //   priority: 'high',
    // });
  } catch (error) {
    console.warn('[HSMC Notif] Failed to send notification:', error);
  }
}

// ─── Notification Triggers ────────────────────────────────────────

export async function notifyPaymentConfirmed(txn: Transaction): Promise<void> {
  if (!(await shouldSend('paymentConfirmations'))) return;
  await sendLocalNotification(
    'Payment Confirmed',
    `✅ Paid $${txn.amount.toFixed(2)} at ${txn.merchant}`,
  );
}

export async function notifyPaymentDeclined(txn: Transaction): Promise<void> {
  if (!(await shouldSend('paymentConfirmations'))) return;
  await sendLocalNotification(
    'Payment Declined',
    `❌ $${txn.amount.toFixed(2)} at ${txn.merchant} was declined`,
  );
}

export async function notifyBudgetAlert(spent: number, limit: number, remaining: number): Promise<void> {
  if (!(await shouldSend('budgetAlerts'))) return;
  const percent = limit > 0 ? spent / limit : 0;

  if (percent >= 1) {
    await sendLocalNotification(
      'Budget Exceeded',
      `⚠️ You've spent $${spent.toFixed(2)} of your $${limit.toFixed(2)} budget`,
    );
  } else if (percent >= BUDGET_ALERT_PERCENT) {
    await sendLocalNotification(
      'Budget Alert',
      `⚠️ ${(percent * 100).toFixed(0)}% of monthly budget used — $${remaining.toFixed(2)} remaining`,
    );
  }
}

export async function notifyCardFrozen(cardMasked: string): Promise<void> {
  if (!(await shouldSend('cardFrozenAlerts'))) return;
  await sendLocalNotification(
    'Card Frozen',
    `🔒 Virtual Card ${cardMasked} has been frozen`,
  );
}

export async function notifyCardUnfrozen(cardMasked: string): Promise<void> {
  if (!(await shouldSend('cardFrozenAlerts'))) return;
  await sendLocalNotification(
    'Card Unfrozen',
    `🔓 Virtual Card ${cardMasked} has been unfrozen`,
  );
}

export async function notifySecurityAlert(message: string): Promise<void> {
  if (!(await shouldSend('securityAlerts'))) return;
  await sendLocalNotification('🔐 Security Alert', message);
}

export async function notifyAutoTopup(cardMasked: string, amount: number): Promise<void> {
  if (!(await shouldSend('paymentConfirmations'))) return;
  await sendLocalNotification(
    'Auto Top-Up',
    `💰 Virtual Card ${cardMasked} topped up with $${amount.toFixed(2)}`,
  );
}
