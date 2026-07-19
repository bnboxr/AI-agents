import { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "@tanstack/react-router";
import { getAlerts, acknowledgeAlert } from "~/lib/alert-engine";
import type { Alert, AlertType } from "~/lib/alert-engine";

// ── Type Icons & Colors ────────────────────────────────────────────

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

function typeColor(type: AlertType): string {
  switch (type) {
    case "price_flash_crash":
      return "text-accent-red";
    case "price_pump":
      return "text-accent-green";
    case "price_threshold":
      return "text-accent-blue";
    case "arbitrage_spread":
      return "text-accent-purple";
    case "yield_rate":
      return "text-accent-teal";
    default:
      return "text-accent-yellow";
  }
}

function typeBorderColor(type: AlertType): string {
  switch (type) {
    case "price_flash_crash":
      return "border-accent-red/40";
    case "price_pump":
      return "border-accent-green/40";
    case "price_threshold":
      return "border-accent-blue/40";
    case "arbitrage_spread":
      return "border-accent-purple/40";
    case "yield_rate":
      return "border-accent-teal/40";
    default:
      return "border-accent-yellow/40";
  }
}

// ── Relative Time ──────────────────────────────────────────────────

function fmtRelative(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60000) return `${Math.round(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.round(diff / 3600000)}h ago`;
  return `${Math.round(diff / 86400000)}d ago`;
}

// ── Sound ──────────────────────────────────────────────────────────

function playAlertSound(severity: string): void {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    const freq = severity === "critical" ? 400 : severity === "warning" ? 600 : 800;
    osc.frequency.value = freq;
    osc.type = "square";
    gain.gain.value = 0.08;
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.15);
  } catch {
    // Web Audio API may not be available
  }
}

// ── Component ──────────────────────────────────────────────────────

export default function AlertBell() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [open, setOpen] = useState(false);
  const prevCount = useRef(0);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Poll for alerts every 5 seconds
  useEffect(() => {
    const fetchAlerts = () => {
      getAlerts()
        .then((data: Alert[]) => {
          setAlerts(data);
          // Play sound for new critical alerts
          const newCritical = data.filter(
            (a) => a.severity === "critical" && !a.acknowledged,
          );
          if (newCritical.length > prevCount.current && prevCount.current > 0) {
            playAlertSound("critical");
          }
          prevCount.current = data.length;
        })
        .catch(() => {
          // Silently handle fetch errors
        });
    };

    fetchAlerts();
    const interval = setInterval(fetchAlerts, 5_000);
    return () => clearInterval(interval);
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const handleAcknowledge = useCallback(
    async (alertId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      try {
        await acknowledgeAlert({ data: { alertId } });
      } catch {
        // Silently handle errors
      }
      setAlerts((prev) => prev.filter((a) => a.id !== alertId));
    },
    [],
  );

  const handleViewAll = useCallback(() => {
    setOpen(false);
  }, []);

  const unreadCount = alerts.length;
  const recent = alerts.slice(0, 5);

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell Button */}
      <button
        onClick={() => setOpen(!open)}
        className="relative p-2 rounded-lg text-gray-400 hover:text-white hover:bg-dark-hover transition-all duration-150"
        aria-label="Alerts"
      >
        <span className="text-xl">🔔</span>
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 flex items-center justify-center w-5 h-5 text-xs font-bold text-white bg-accent-red rounded-full shadow-glow">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown Panel */}
      {open && (
        <div className="absolute right-0 mt-2 w-80 max-h-96 overflow-y-auto glass-card rounded-xl p-0 animate-fade-in shadow-2xl z-50 border border-dark-border-light">
          <div className="sticky top-0 z-10 px-4 py-3 border-b border-dark-border flex items-center justify-between bg-blue-dark/90 backdrop-blur-md rounded-t-xl">
            <h3 className="text-sm font-semibold text-white">Notifications</h3>
            {unreadCount > 0 && (
              <span className="text-xs text-gray-400">{unreadCount} new</span>
            )}
          </div>

          {recent.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <span className="text-3xl">✅</span>
              <p className="text-sm text-gray-400 mt-2">All clear — no new alerts</p>
            </div>
          ) : (
            <div>
              {recent.map((alert) => (
                <div
                  key={alert.id}
                  className={`px-4 py-3 border-b border-dark-border/50 hover:bg-dark-hover/50 transition-colors cursor-pointer ${typeBorderColor(alert.type)} border-l-2`}
                  onClick={(e) => handleAcknowledge(alert.id, e)}
                >
                  <div className="flex items-start gap-2">
                    <span className="text-lg shrink-0 mt-0.5">{typeIcon(alert.type)}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className={`text-sm font-medium truncate ${typeColor(alert.type)}`}>
                          {alert.title}
                        </p>
                        <span className="text-xs text-gray-400 shrink-0">
                          {fmtRelative(alert.timestamp)}
                        </span>
                      </div>
                      <p className="text-xs text-gray-300 mt-0.5 line-clamp-2">{alert.message}</p>
                    </div>
                    {!alert.acknowledged && (
                      <span className="w-1.5 h-1.5 rounded-full bg-accent-blue shrink-0 mt-1.5" />
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="sticky bottom-0 px-4 py-2 border-t border-dark-border bg-blue-dark/90 backdrop-blur-md rounded-b-xl">
            <Link
              to="/alerts"
              onClick={handleViewAll}
              className="block text-center text-sm font-medium text-accent-blue hover:text-accent-cyan transition-colors py-1"
            >
              View All →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
