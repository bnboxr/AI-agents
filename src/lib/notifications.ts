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

// Seed some initial notifications
function seedNotifications() {
  const now = Date.now();
  const mins30 = 30 * 60 * 1000;
  
  const seed: Notification[] = [
    {
      id: 'seed-1',
      title: 'Oportunitate Staking',
      message: 'Lido oferă 3.1% APY pe stETH — randament peste medie',
      type: 'opportunity',
      timestamp: now - mins30,
      read: false,
      chainId: 'ethereum',
    },
    {
      id: 'seed-2',
      title: 'Arbitraj detectat',
      message: 'Diferență de preț 0.45% USDC între Arbitrum și Optimism',
      type: 'opportunity',
      timestamp: now - mins30 * 2,
      read: false,
    },
    {
      id: 'seed-3',
      title: 'Agent activat',
      message: 'Agentul Neon (Solana) a început scanarea pentru oportunități',
      type: 'info',
      timestamp: now - mins30 * 3,
      read: true,
      chainId: 'solana',
    },
    {
      id: 'seed-4',
      title: 'Alertă preț',
      message: 'ETH a scăzut cu 3.2% în ultima oră — verifică oportunități de cumpărare',
      type: 'alert',
      timestamp: now - mins30 * 4,
      read: false,
    },
  ];

  notifications.push(...seed);
}

seedNotifications();

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
    id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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
