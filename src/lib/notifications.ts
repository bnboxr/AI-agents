import { createServerFn } from "@tanstack/react-start";

// ── Types ──────────────────────────────────────────────────────────

export interface Notification {
  id: string;
  title: string;
  message: string;
  type: 'opportunity' | 'transaction' | 'alert' | 'info' | 'success';
  timestamp: number;
  read: boolean;
  actionUrl?: string;
  chainId?: string;
}

// ── In-memory notification store ───────────────────────────────────

const notifications: Notification[] = [];
const MAX_NOTIFICATIONS = 100;
let _notifIdCounter = 0;

// ── Server Functions ───────────────────────────────────────────────

export const getNotifications = createServerFn({ method: 'GET' }).handler(async (): Promise<Notification[]> => {
  // Return sorted by timestamp, newest first
  return [...notifications].sort((a, b) => b.timestamp - a.timestamp).slice(0, MAX_NOTIFICATIONS);
});

export const getUnreadCount = createServerFn({ method: 'GET' }).handler(async (): Promise<number> => {
  return notifications.filter(n => !n.read).length;
});

export const markAsRead = createServerFn({ method: 'POST' }).handler(async ({ data }: { data: { id: string } }): Promise<boolean> => {
  const notif = notifications.find(n => n.id === data.id);
  if (notif) {
    notif.read = true;
    return true;
  }
  return false;
});

export const markAllAsRead = createServerFn({ method: 'POST' }).handler(async (): Promise<boolean> => {
  notifications.forEach(n => { n.read = true; });
  return true;
});

export const addNotification = createServerFn({ method: 'POST' }).handler(async ({ data }: { 
  data: { 
    title: string; 
    message: string; 
    type: Notification['type'];
    actionUrl?: string;
    chainId?: string;
  } 
}): Promise<Notification> => {
  const notif: Notification = {
    id: `notif_${Date.now().toString(36)}_${(_notifIdCounter++).toString(36)}`,
    title: data.title,
    message: data.message,
    type: data.type,
    timestamp: Date.now(),
    read: false,
    actionUrl: data.actionUrl,
    chainId: data.chainId,
  };

  notifications.unshift(notif);
  
  // Keep under max
  if (notifications.length > MAX_NOTIFICATIONS) {
    notifications.length = MAX_NOTIFICATIONS;
  }

  return notif;
});
