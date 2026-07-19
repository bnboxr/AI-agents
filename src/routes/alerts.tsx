import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useCallback } from "react";
import {
  getAlertHistory,
  getConfigRaw,
  acknowledgeAlert,
  setAlertConfig,
  type Alert,
  type AlertType,
  type AlertSeverity,
  type AlertConfig,
} from "~/lib/alert-engine";

// ── Route ──────────────────────────────────────────────────────────

export const Route = createFileRoute("/alerts")({
  loader: async () => {
    const [history, config] = await Promise.all([getAlertHistory(), getConfigRaw()]);
    return { history, config };
  },
  component: AlertsPage,
});

// ── Helpers ────────────────────────────────────────────────────────

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

function typeLabel(type: AlertType): string {
  return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function severityBadge(severity: AlertSeverity): { cls: string; label: string } {
  switch (severity) {
    case "critical":
      return { cls: "badge-red", label: "Critical" };
    case "warning":
      return { cls: "badge-yellow", label: "Warning" };
    case "info":
      return { cls: "badge-blue", label: "Info" };
  }
}

function typeBadgeColor(type: AlertType): string {
  switch (type) {
    case "price_flash_crash":
      return "badge-red";
    case "price_pump":
      return "badge-green";
    case "price_threshold":
      return "badge-blue";
    case "arbitrage_spread":
      return "bg-accent-purple/10 text-accent-purple border-accent-purple/20 inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border";
    case "yield_rate":
      return "bg-accent-teal/10 text-accent-teal border-accent-teal/20 inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border";
    default:
      return "badge-yellow";
  }
}

function fmtRelative(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60000) return `${Math.round(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.round(diff / 3600000)}h ago`;
  return `${Math.round(diff / 86400000)}d ago`;
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// ── Page Component ─────────────────────────────────────────────────

function AlertsPage() {
  const { history: initialHistory, config: initialConfig } = Route.useLoaderData();
  const [alerts, setAlerts] = useState<Alert[]>(initialHistory);
  const [config, setConfig] = useState<AlertConfig>(initialConfig);
  const [filter, setFilter] = useState<"all" | "price" | "opportunity" | "security">("all");
  const [severityFilter, setSeverityFilter] = useState<"all" | AlertSeverity>("all");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // New user threshold form state
  const [thresholdToken, setThresholdToken] = useState("ETH");
  const [thresholdDirection, setThresholdDirection] = useState<"above" | "below">("above");
  const [thresholdPrice, setThresholdPrice] = useState("");

  // Poll for updates every 5 seconds
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const [history, cfg] = await Promise.all([getAlertHistory(), getConfigRaw()]);
        setAlerts(history);
        setConfig(cfg);
      } catch {
        // Silently handle errors
      }
    }, 5_000);
    return () => clearInterval(interval);
  }, []);

  // Filter alerts
  const filteredAlerts = alerts.filter((a) => {
    if (severityFilter !== "all" && a.severity !== severityFilter) return false;
    if (filter === "all") return true;
    if (filter === "price") return a.type.startsWith("price_");
    if (filter === "opportunity") return a.type === "arbitrage_spread" || a.type === "yield_rate";
    if (filter === "security") return a.type.startsWith("security_");
    return true;
  });

  // Handle acknowledging an alert
  const handleAcknowledge = useCallback(async (alertId: string) => {
    try {
      await acknowledgeAlert({ data: { alertId } });
      setAlerts((prev) =>
        prev.map((a) => (a.id === alertId ? { ...a, acknowledged: true } : a)),
      );
    } catch {
      // Silently handle errors
    }
  }, []);

  // Handle config change
  const handleConfigChange = useCallback(
    async (updates: Partial<AlertConfig>) => {
      setSaving(true);
      try {
        const result = await setAlertConfig({ data: { config: updates } });
        if (result.success) {
          setConfig(result.config);
        }
      } catch {
        // Silently handle errors
      }
      setSaving(false);
    },
    [],
  );

  // Toggle alert type
  const toggleType = useCallback(
    (type: AlertType) => {
      const updated = { ...config.enabledTypes, [type]: !config.enabledTypes[type] };
      handleConfigChange({ enabledTypes: updated });
    },
    [config.enabledTypes, handleConfigChange],
  );

  // Add user threshold
  const addThreshold = useCallback(() => {
    const price = parseFloat(thresholdPrice);
    if (isNaN(price) || price <= 0) return;

    const newThresholds = [
      ...config.userThresholds,
      {
        id: `thresh-${Date.now()}`,
        token: thresholdToken,
        direction: thresholdDirection,
        price,
      },
    ];

    handleConfigChange({ userThresholds: newThresholds });
    setThresholdPrice("");
  }, [thresholdToken, thresholdDirection, thresholdPrice, config.userThresholds, handleConfigChange]);

  // Remove user threshold
  const removeThreshold = useCallback(
    (id: string) => {
      const newThresholds = config.userThresholds.filter((t) => t.id !== id);
      handleConfigChange({ userThresholds: newThresholds });
    },
    [config.userThresholds, handleConfigChange],
  );

  // Available tokens for threshold dropdown
  const tokenOptions = [
    "ETH", "BTC", "SOL", "BNB", "AVAX", "MATIC", "ARB", "OP", "APT", "SUI",
  ];

  const unacknowledgedCount = alerts.filter((a) => !a.acknowledged).length;

  return (
    <div className="min-h-dvh pt-16 pb-12">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 py-8">
        {/* Header */}
        <div className="mb-8 animate-fade-in-up">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-3xl">🔔</span>
            <h1 className="text-3xl font-bold text-white">Portfolio Alerts</h1>
            {unacknowledgedCount > 0 && (
              <span className="badge-red">{unacknowledgedCount} new</span>
            )}
          </div>
          <p className="text-gray-400">Real-time alerts for price movements, arbitrage opportunities, and security events.</p>
        </div>

        {/* Filter Bar */}
        <div className="glass-card p-4 mb-6 animate-fade-in-up">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5 rounded-lg bg-dark-hover p-1">
              {(["all", "price", "opportunity", "security"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                    filter === f
                      ? "bg-accent-blue text-white shadow-sm"
                      : "text-gray-400 hover:text-white"
                  }`}
                >
                  {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5 rounded-lg bg-dark-hover p-1">
              {(["all", "info", "warning", "critical"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setSeverityFilter(s)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                    severityFilter === s
                      ? "bg-accent-blue text-white shadow-sm"
                      : "text-gray-400 hover:text-white"
                  }`}
                >
                  {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>
            <button
              onClick={() => setSettingsOpen(!settingsOpen)}
              className={`ml-auto px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                settingsOpen
                  ? "bg-accent-blue text-white"
                  : "text-gray-400 hover:text-white bg-dark-hover"
              }`}
            >
              ⚙️ Settings
            </button>
          </div>
        </div>

        {/* Settings Section */}
        {settingsOpen && (
          <div className="glass-card p-6 mb-6 animate-fade-in-up">
            <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <span>⚙️</span> Alert Configuration
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
              {/* Enable/Disable Toggles */}
              <div className="space-y-3">
                <h3 className="text-sm font-medium text-gray-300 uppercase tracking-wider">Alert Types</h3>
                {([
                  ["price_flash_crash", "📉 Flash Crash"],
                  ["price_pump", "🚀 Price Pump"],
                  ["price_threshold", "🎯 Price Threshold"],
                  ["arbitrage_spread", "💱 Arbitrage"],
                  ["yield_rate", "💰 Yield Rate"],
                  ["security_wallet_tx", "🔐 Wallet Tx"],
                  ["security_suspicious", "🚨 Suspicious"],
                ] as [AlertType, string][]).map(([type, label]) => (
                  <label
                    key={type}
                    className="flex items-center justify-between cursor-pointer group"
                  >
                    <span className="text-sm text-gray-400 group-hover:text-gray-200 transition-colors">
                      {label}
                    </span>
                    <button
                      onClick={() => toggleType(type)}
                      className={`relative w-10 h-5 rounded-full transition-colors duration-200 ${
                        config.enabledTypes[type] ? "bg-accent-blue" : "bg-dark-border"
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform duration-200 ${
                          config.enabledTypes[type] ? "translate-x-5" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </label>
                ))}
              </div>

              {/* Numeric Inputs */}
              <div className="space-y-4">
                <h3 className="text-sm font-medium text-gray-300 uppercase tracking-wider">Thresholds</h3>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Flash Crash %</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0.1"
                    max="100"
                    value={config.flashCrashPct}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      if (!isNaN(v)) handleConfigChange({ flashCrashPct: v });
                    }}
                    className="glass-input w-full text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Pump %</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0.1"
                    max="1000"
                    value={config.pumpPct}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      if (!isNaN(v)) handleConfigChange({ pumpPct: v });
                    }}
                    className="glass-input w-full text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Time Window (minutes)</label>
                  <input
                    type="number"
                    step="1"
                    min="1"
                    max="1440"
                    value={config.flashCrashWindowMin}
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10);
                      if (!isNaN(v)) {
                        handleConfigChange({
                          flashCrashWindowMin: v,
                          pumpWindowMin: v,
                        });
                      }
                    }}
                    className="glass-input w-full text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Arbitrage Spread % (Phase 2)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    max="100"
                    value={config.arbitrageSpreadPct}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      if (!isNaN(v)) handleConfigChange({ arbitrageSpreadPct: v });
                    }}
                    className="glass-input w-full text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Min Yield APY % (Phase 2)</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="10000"
                    value={config.minYieldAPY}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      if (!isNaN(v)) handleConfigChange({ minYieldAPY: v });
                    }}
                    className="glass-input w-full text-sm"
                  />
                </div>
                <div>
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="text-sm text-gray-400">Sound Alerts</span>
                    <button
                      onClick={() => handleConfigChange({ soundEnabled: !config.soundEnabled })}
                      className={`relative w-10 h-5 rounded-full transition-colors duration-200 ${
                        config.soundEnabled ? "bg-accent-blue" : "bg-dark-border"
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform duration-200 ${
                          config.soundEnabled ? "translate-x-5" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </label>
                </div>
              </div>
            </div>

            {/* User Price Thresholds */}
            <div className="border-t border-dark-border pt-4">
              <h3 className="text-sm font-medium text-gray-300 uppercase tracking-wider mb-3">
                User Price Thresholds
              </h3>
              <div className="flex flex-wrap items-end gap-2 mb-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Token</label>
                  <select
                    value={thresholdToken}
                    onChange={(e) => setThresholdToken(e.target.value)}
                    className="glass-input text-sm"
                  >
                    {tokenOptions.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Direction</label>
                  <select
                    value={thresholdDirection}
                    onChange={(e) => setThresholdDirection(e.target.value as "above" | "below")}
                    className="glass-input text-sm"
                  >
                    <option value="above">Above</option>
                    <option value="below">Below</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Price ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    value={thresholdPrice}
                    onChange={(e) => setThresholdPrice(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") addThreshold();
                    }}
                    className="glass-input w-28 text-sm"
                  />
                </div>
                <button
                  onClick={addThreshold}
                  disabled={saving}
                  className="glass-button text-sm py-2 px-4"
                >
                  Add
                </button>
              </div>

              {/* Active Thresholds */}
              {config.userThresholds.length > 0 ? (
                <div className="space-y-2">
                  {config.userThresholds.map((t) => (
                    <div
                      key={t.id}
                      className="flex items-center justify-between glass-card px-3 py-2 rounded-lg"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-mono text-white">{t.token}</span>
                        <span
                          className={`text-xs font-medium ${
                            t.direction === "above" ? "text-accent-green" : "text-accent-red"
                          }`}
                        >
                          {t.direction === "above" ? "↑ above" : "↓ below"}
                        </span>
                        <span className="text-sm font-mono text-accent-blue">
                          ${t.price.toLocaleString()}
                        </span>
                      </div>
                      <button
                        onClick={() => removeThreshold(t.id)}
                        className="text-gray-400 hover:text-accent-red transition-colors text-sm"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-500">
                  No user price thresholds set. Add one to get notified when a token crosses your target price.
                </p>
              )}
            </div>
          </div>
        )}

        {/* Alert History Timeline */}
        <div className="glass-card p-4 animate-fade-in-up">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <span>📋</span> Alert History
            <span className="text-xs text-gray-400 font-normal">
              ({filteredAlerts.length} of {alerts.length} alerts)
            </span>
          </h2>

          {filteredAlerts.length === 0 ? (
            <div className="py-12 text-center">
              <span className="text-4xl">📭</span>
              <p className="text-gray-400 mt-3">No alerts match your filters</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
              {filteredAlerts.map((alert) => (
                <div
                  key={alert.id}
                  className={`glass-card p-4 rounded-lg transition-all ${
                    alert.acknowledged ? "opacity-60" : ""
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <span className="text-2xl shrink-0 mt-0.5">{typeIcon(alert.type)}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className={`text-xs font-medium ${typeBadgeColor(alert.type)}`}>
                          {typeLabel(alert.type)}
                        </span>
                        <span className={severityBadge(alert.severity).cls}>
                          {severityBadge(alert.severity).label}
                        </span>
                        <span className="text-xs text-gray-400">{fmtTime(alert.timestamp)}</span>
                        <span className="text-xs text-gray-500">({fmtRelative(alert.timestamp)})</span>
                      </div>
                      <h3 className="text-sm font-semibold text-white">{alert.title}</h3>
                      <p className="text-sm text-gray-300 mt-1">{alert.message}</p>
                      {alert.data && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {Object.entries(alert.data).map(([key, value]) => {
                            const displayValue =
                              typeof value === "number"
                                ? value.toLocaleString(undefined, {
                                    maximumFractionDigits: 2,
                                  })
                                : String(value);
                            return (
                              <span
                                key={key}
                                className="text-xs px-1.5 py-0.5 rounded bg-dark-hover text-gray-400 font-mono"
                              >
                                {key}: {displayValue}
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    {!alert.acknowledged && (
                      <button
                        onClick={() => handleAcknowledge(alert.id)}
                        className="shrink-0 px-3 py-1.5 text-xs font-medium text-accent-blue hover:text-white hover:bg-accent-blue/20 rounded-md transition-all border border-accent-blue/30"
                      >
                        ✓ Ack
                      </button>
                    )}
                    {alert.acknowledged && (
                      <span className="shrink-0 text-xs text-gray-500 italic">Acknowledged</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
