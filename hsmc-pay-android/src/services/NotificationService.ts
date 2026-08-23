// NotificationService.ts — Real local push notifications for HSMC Pay
//
// Uses react-native-push-notification v8. Android 8+ requires an explicit
// notification channel before any notification can be shown; v9+/Android 13+
// additionally requires the POST_NOTIFICATIONS runtime permission. Both are
// set up here at startup (initialize). All of the notify* triggers below fire
// a real device notification via PushNotification.localNotification().
//
// Remote (FCM) push is intentionally not wired: HSMC Pay is a local-first
// wallet and its alerts are generated on-device. The configure() call is still
// registered so that the native emitter is initialized and so a future FCM
// integration can attach the same callbacks without rework.

import { Platform, PermissionsAndroid } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import PushNotification from 'react-native-push-notification';
import type { Transaction } from './TransactionStore';

const NOTIF_PREFS_KEY = '@hsmc_notification_prefs';
const BUDGET_ALERT_PERCENT = 0.8; // 80% threshold

/** Android notification channel used for all HSMC Pay alerts. */
export const NOTIFICATION_CHANNEL_ID = 'hsmc-pay';
const NOTIFICATION_CHANNEL_NAME = 'HSMC Pay';

/** Guard so the native PushNotification.configure is only ever called once. */
let configured = false;
/** Whether the OS has granted the notification permission. */
let permissionGranted = Platform.OS === 'android' ? false : true;

export interface NotificationPreferences {
  paymentConfirmations: boolean;
  budgetAlerts: boolean;
  cardFrozenAlerts: boolean;
  securityAlerts: boolean;
  promotionalOffers: boolean;
  quietHoursEnabled: boolean;
  quietHoursStart: string; // "22:00"
  quietHoursEnd: string; // "08:00"
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

/**
 * Register the push notification native emitter, request the Android 13+
 * runtime permission and create the app's notification channel. Call once at
 * app startup (App.tsx). Safe to call multiple times.
 */
export async function initialize(): Promise<void> {
  try {
    if (!configured) {
      PushNotification.configure({
        // Local notifications do not register a remote token; this callback is
        // a no-op but must be present for a valid configuration.
        onRegister: () => {},
        // When the app is in the foreground, Android shows the notification in
        // the shade but does not banner it by default. Nothing to do here for
        // local notifications.
        onNotification: () => {},
        onAction: () => {},
        onRegistrationError: () => {},
        popInitialNotification: false,
        requestPermissions: false, // permission is handled explicitly below
      });
      configured = true;
    }

    await ensureChannel();

    if (Platform.OS === 'android') {
      const granted = await requestNotificationPermission();
      permissionGranted = granted;
    }
  } catch (error) {
    // Log and degrade gracefully: the app still works, just without alerts.
    console.warn('[HSMC Pay] Notification setup failed:', error);
    permissionGranted = false;
  }
}

/**
 * Create (or ensure) the Android 8+ notification channel. Android silently
 * drops notifications posted to a channel that does not exist, so this must
 * complete before any localNotification call.
 */
async function ensureChannel(): Promise<void> {
  await new Promise<void>((resolve) => {
    PushNotification.createChannel(
      {
        channelId: NOTIFICATION_CHANNEL_ID,
        channelName: NOTIFICATION_CHANNEL_NAME,
        channelDescription: 'HSMC Pay payment and security alerts',
        importance: 4, // IMPORTANCE_HIGH — banners + heads-up alerts
        vibrate: true,
        playSound: true,
        soundName: 'default',
        vibration: 300,
        badge: true,
      },
      () => resolve(),
    );
  });
}

/**
 * Request the POST_NOTIFICATIONS runtime permission (Android 13+). On earlier
 * versions the permission is granted at install time and this resolves true.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const granted = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
    {
      title: 'HSMC Pay Notifications',
      message:
        'Receive payment confirmations and security alerts for your wallet.',
      buttonPositive: 'Allow',
      buttonNegative: 'Deny',
    },
  );
  const ok = granted === PermissionsAndroid.RESULTS.GRANTED;
  permissionGranted = ok;
  return ok;
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

export async function updatePreferences(
  prefs: Partial<NotificationPreferences>,
): Promise<void> {
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
  }
  // Overnight quiet hours (e.g. 22:00 → 08:00)
  return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
}

async function shouldSend(type: keyof NotificationPreferences): Promise<boolean> {
  const prefs = await getPreferences();
  // Only the boolean preference fields gate sends; === true narrows the union
  // of boolean|string keys so a quiet-hour time string can never gate a send.
  return prefs[type] === true && !isQuietHours(prefs);
}

/**
 * Fire a real local notification. Honors the user's permission state.
 * Posting to a permission-granted channel on Android never throws; failures
 * are caught and logged so a notification problem can never crash the wallet.
 */
async function sendLocalNotification(
  title: string,
  message: string,
): Promise<void> {
  if (!permissionGranted) return;

  try {
    await ensureChannel(); // re-assert channel exists before posting
    PushNotification.localNotification({
      channelId: NOTIFICATION_CHANNEL_ID,
      title,
      message,
      playSound: true,
      soundName: 'default',
      importance: 'high',
      priority: 'high',
      vibrate: true,
      smallIcon: 'ic_stat_hsmc',
      color: '#00E676',
      showWhen: true,
    });
  } catch (error) {
    console.warn('[HSMC Pay] Failed to send notification:', error);
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

export async function notifyBudgetAlert(
  spent: number,
  limit: number,
  remaining: number,
): Promise<void> {
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
      `⚠️ ${(percent * 100).toFixed(0)}% of monthly budget used — $${remaining.toFixed(
        2,
      )} remaining`,
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

export async function notifyAutoTopup(
  cardMasked: string,
  amount: number,
): Promise<void> {
  if (!(await shouldSend('paymentConfirmations'))) return;
  await sendLocalNotification(
    'Auto Top-Up',
    `💰 Virtual Card ${cardMasked} topped up with $${amount.toFixed(2)}`,
  );
}
