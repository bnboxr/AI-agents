// Type declarations for react-native-push-notification@8.x
//
// The upstream package ships JavaScript only (no bundled .d.ts), so we provide
// a minimal, accurate declaration for the subset of the v8 API that HSMC Pay
// uses (local notifications: configure / createChannel / localNotification /
// requestPermissions / getApplicationIconBadgeNumber). Keeping the surface
// small on purpose — it matches what the runtime module actually exposes.

declare module 'react-native-push-notification' {
  export interface PushNotificationPermissions {
    alert: boolean;
    badge: boolean;
    sound: boolean;
    lockScreen?: boolean;
    notificationCenter?: boolean;
  }

  export interface PushNotificationObject {
    /* Android - required */
    channelId: string;
    /* Android - optional */
    ticker?: string;
    showWhen?: boolean;
    autoCancel?: boolean;
    largeIcon?: string;
    smallIcon?: string;
    bigText?: string;
    subText?: string;
    bigPictureUrl?: string;
    color?: string;
    vibrate?: boolean;
    vibration?: number;
    tag?: string;
    group?: string;
    groupSummary?: boolean;
    ongoing?: boolean;
    priority?: 'max' | 'high' | 'default' | 'low' | 'min';
    visibility?: 'public' | 'private' | 'secret';
    importance?: 'max' | 'high' | 'default' | 'low' | 'min' | 'none';
    messageId?: string;
    when?: number | null;
    onlyAlertOnce?: boolean;
    ignoreInForeground?: boolean;
    /* iOS + Android */
    id?: string;
    title?: string;
    message: string;
    picture?: string;
    userInfo?: Record<string, unknown>;
    playSound?: boolean;
    soundName?: string;
    number?: number;
    actions?: Array<{ title: string; callback?: () => void }>;
    repeatType?: 'week' | 'day' | 'hour' | 'minute' | 'time';
    repeatTime?: number;
  }

  export interface PushNotificationOptions {
    onRegister?: (token: { os: string; token: string }) => void;
    onNotification?: (notification: PushNotificationObject) => void;
    onAction?: (notification: PushNotificationObject) => void;
    onRegistrationError?: (error: { message: string }) => void;
    popInitialNotification?: boolean;
    requestPermissions?: boolean;
  }

  export interface Channel {
    channelId: string;
    channelName: string;
    channelDescription?: string;
    soundName?: string;
    importance?: number;
    vibrate?: boolean;
    playSound?: boolean;
    vibration?: number;
    badge?: boolean;
    bypassDnd?: boolean;
  }

  const PushNotification: {
    configure(options: PushNotificationOptions): void;
    createChannel(channel: Channel, callback?: (created: boolean) => void): void;
    channelExists(channelId: string, callback: (exists: boolean) => void): void;
    localNotification(notification: PushNotificationObject): void;
    requestPermissions(permissions?: Partial<PushNotificationPermissions>): void;
    checkPermissions(
      callback: (permissions: PushNotificationPermissions) => void,
    ): void;
    getApplicationIconBadgeNumber(callback: (count: number) => void): void;
    setApplicationIconBadgeNumber(count: number): void;
    abandonPermissions(): void;
    clearAllNotifications(): void;
    cancelAllLocalNotifications(): void;
    removeAllDeliveredNotifications(): void;
    setNotificationChannelImportance?(
      channelId: string,
      importance: number,
    ): void;
  };

  export default PushNotification;
}
