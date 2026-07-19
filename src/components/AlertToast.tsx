import { useState, useEffect, useRef } from "react";
import { getAlerts, acknowledgeAlert } from "~/lib/alert-engine";
import type { Alert, AlertType } from "~/lib/alert-engine";

// ── Type Icons ─────────────────────────────────────────────────────

function typeIcon(type: AlertType): string {
  switch (type) {
    case "price_flash_crash":
      return "📉";
    case "price_pump":
      return "🚀";
    case "price_threshold":
      return "🎯";
    case "arbitrage_spread":
      return "💱";
    case "yield_rate":
      return "💰";
    case "security_wallet_tx":
      return "🔐";
    case "security_suspicious":
      return "🚨";
  }
}

function typeBorderColor(type: AlertType): string {
  switch (type) {
    case "price_flash_crash":
      return "border-l-accent-red";
    case "price_pump":
      return "border-l-accent-green";
    case "price_threshold":
      return "border-l-accent-blue";
    case "arbitrage_spread":
      return "border-l-accent-purple";
    case "yield_rate":
      return "border-l-accent-teal";
    default:
      return "border-l-accent-yellow";
  }
}

function severityColor(severity: string): string {
  switch (severity) {
    case "critical":
      return "text-accent-red";
    case "warning":
      return "text-accent-yellow";
    default:
      return "text-accent-blue";
  }
}

// ── Sound ──────────────────────────────────────────────────────────

function playToastSound(severity: string): void {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    const freq = severity === "critical" ? 400 : severity === "warning" ? 600 : 800;
    osc.frequency.value = freq;
    osc.type = "square";
    gain.gain.value = 0.06;
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.15);
  } catch {
    // Web Audio API may not be available
  }
}

// ── Toast Item ─────────────────────────────────────────────────────

interface ToastItem {
  alert: Alert;
  removing: boolean;
  timeoutId: ReturnType<typeof setTimeout>;
}

function ToastCard({
  toast,
  onDismiss,
}: {
  toast: ToastItem;
  onDismiss: (id: string) => void;
}) {
  const { alert, removing } = toast;

  useEffect(() => {
    const autoDismiss = setTimeout(() => {
      onDismiss(alert.id);
    }, 6_000);
    return () => clearTimeout(autoDismiss);
  }, [alert.id, onDismiss]);

  const handleClick = () => {
    onDismiss(alert.id);
  };

  return (
    <div
      className={`glass-card border-l-4 ${typeBorderColor(alert.type)} p-3 pr-8 min-w-72 max-w-sm cursor-pointer
        transition-all duration-300 ease-out
        ${removing ? "opacity-0 translate-x-4 scale-95" : "opacity-100 translate-x-0 scale-100 animate-slide-in-right"}`}
      onClick={handleClick}
    >
      <div className="flex items-start gap-2">
        <span className="text-lg shrink-0 mt-0.5">{typeIcon(alert.type)}</span>
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-semibold ${severityColor(alert.severity)}`}>
            {alert.title}
          </p>
          <p className="text-xs text-gray-300 mt-0.5 line-clamp-2">{alert.message}</p>
        </div>
      </div>
    </div>
  );
}

// ── Toast Stack ────────────────────────────────────────────────────

const MAX_VISIBLE = 3;

export default function AlertToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const lastAlertId = useRef<string | null>(null);
  const removingRef = useRef<Set<string>>(new Set());

  // Poll for alerts every 5 seconds
  useEffect(() => {
    const fetchAlerts = () => {
      getAlerts()
        .then((data: Alert[]) => {
          // Only show new (unseen) alerts — track by last ID
          const newAlerts = data.filter((a) => {
            if (!lastAlertId.current) return true;
            // Simple comparison: show alerts with IDs greater than last seen
            return a.id > lastAlertId.current;
          });

          if (newAlerts.length > 0) {
            // Update last seen ID
            lastAlertId.current = newAlerts[newAlerts.length - 1].id;

            // Add new toasts
            setToasts((prev) => {
              const existing = new Set(prev.map((t) => t.alert.id));
              const toAdd = newAlerts.filter((a) => !existing.has(a.id)).slice(0, 5);

              if (toAdd.length === 0) return prev;

              // Play sounds for new ones
              for (const a of toAdd) {
                playToastSound(a.severity);
              }

              const newItems = toAdd.map((alert) => ({
                alert,
                removing: false,
                timeoutId: setTimeout(() => {}, 0),
              }));

              const combined = [...newItems, ...prev];
              // Trim to max visible (older ones will be removed visually)
              return combined.slice(0, MAX_VISIBLE);
            });
          }
        })
        .catch(() => {
          // Silently handle fetch errors
        });
    };

    fetchAlerts();
    const interval = setInterval(fetchAlerts, 5_000);
    return () => clearInterval(interval);
  }, []);

  const handleDismiss = (alertId: string) => {
    if (removingRef.current.has(alertId)) return;
    removingRef.current.add(alertId);

    // Mark as removing to trigger fade-out animation
    setToasts((prev) =>
      prev.map((t) => (t.alert.id === alertId ? { ...t, removing: true } : t)),
    );

    // Acknowledge on server
    acknowledgeAlert({ data: { alertId } }).catch(() => {});

    // Remove after animation
    setTimeout(() => {
      removingRef.current.delete(alertId);
      setToasts((prev) => prev.filter((t) => t.alert.id !== alertId));
    }, 350);
  };

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-16 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map((toast) => (
        <div key={toast.alert.id} className="pointer-events-auto">
          <ToastCard toast={toast} onDismiss={handleDismiss} />
        </div>
      ))}
    </div>
  );
}
