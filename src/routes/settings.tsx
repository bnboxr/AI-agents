import { createFileRoute } from "@tanstack/react-router";
import { useState, useCallback } from "react";
import {
  getSettings,
  saveApiKey,
  testApiKey,
  toggleService,
  addRpcEndpoint,
  toggleRpcEndpoint,
  deleteRpcEndpoint,
} from "~/lib/api-keys";
import type { ServiceKey, RpcEntry, ServiceName } from "~/lib/api-keys";
import {
  listDestinations,
  addDestination,
  deleteDestination,
  setDefaultDestination,
  DEST_TYPE_LABELS,
  DEST_TYPE_ICONS,
} from "~/lib/payment-destinations";
import type { PaymentDestination, DestType } from "~/lib/payment-destinations";
import { CHAINS } from "~/lib/chains";
import { getExchangeConfigs, toggleExchange } from "~/lib/exchange";
import type { ExchangeConfig } from "~/lib/exchange";

// ── Service definitions ────────────────────────────────────────────

interface ServiceDef {
  name: ServiceName;
  label: string;
  icon: string;
  description: string;
  placeholder: string;
}

const SERVICES: ServiceDef[] = [
  {
    name: "openai",
    label: "OpenAI",
    icon: "🤖",
    description: "GPT-4, embeddings, and AI completion APIs",
    placeholder: "sk-...",
  },
  {
    name: "anthropic",
    label: "Anthropic",
    icon: "🧠",
    description: "Claude models for reasoning and analysis",
    placeholder: "sk-ant-...",
  },
  {
    name: "telegram",
    label: "Telegram",
    icon: "📨",
    description: "Bot API for messaging and notifications",
    placeholder: "123456:ABC-DEF...",
  },
  {
    name: "discord",
    label: "Discord",
    icon: "💬",
    description: "Bot token for server integration",
    placeholder: "MTAx...",
  },
  {
    name: "1inch",
    label: "1inch",
    icon: "🦎",
    description: "DEX aggregator for optimal swaps",
    placeholder: "1inch-api-key...",
  },
  {
    name: "coingecko",
    label: "CoinGecko",
    icon: "📊",
    description: "Crypto price feeds and market data",
    placeholder: "CG-...",
  },
];

// ── Route ──────────────────────────────────────────────────────────

export const Route = createFileRoute("/settings")({
  loader: async () => {
    const [settings, destinations, exchangeConfigs] = await Promise.all([
      getSettings(),
      listDestinations(),
      getExchangeConfigs(),
    ]);
    return { ...settings, destinations, exchangeConfigs };
  },
  component: SettingsPage,
});

// ── Page ───────────────────────────────────────────────────────────

function SettingsPage() {
  const initial = Route.useLoaderData();
  const [keys, setKeys] = useState<ServiceKey[]>(initial.keys);
  const [rpcs, setRpcs] = useState<RpcEntry[]>(initial.rpcs);
  const [destinations, setDestinations] = useState<PaymentDestination[]>(
    initial.destinations,
  );
  const [exchangeCfgs, setExchangeCfgs] = useState<ExchangeConfig[]>(
    initial.exchangeConfigs,
  );
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; message: string } | null>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [exchangeToggling, setExchangeToggling] = useState<Record<string, boolean>>({});

  // ── RPC form state ─────────────────────────────────────────────
  const [newRpcLabel, setNewRpcLabel] = useState("");
  const [newRpcUrl, setNewRpcUrl] = useState("");
  const [addingRpc, setAddingRpc] = useState(false);

  // ── Payment destinations form state ────────────────────────────
  const [showAddDest, setShowAddDest] = useState(false);
  const [newDestType, setNewDestType] = useState<DestType>("crypto");
  const [newDestLabel, setNewDestLabel] = useState("");
  const [newDestChain, setNewDestChain] = useState("ethereum");
  const [newDestAddress, setNewDestAddress] = useState("");
  const [addingDest, setAddingDest] = useState(false);
  const [destError, setDestError] = useState<string | null>(null);

  // ── Key actions ────────────────────────────────────────────────

  const handleSave = useCallback(async (service: ServiceName) => {
    const key = inputs[service]?.trim();
    if (!key) return;

    setSaving((p) => ({ ...p, [service]: true }));
    try {
      const updated = await saveApiKey({ data: { service, key } });
      setKeys((prev) => prev.map((k) => (k.service === service ? updated : k)));
      setInputs((prev) => ({ ...prev, [service]: "" }));
      setTestResults((prev) => ({ ...prev, [service]: null }));
    } catch {
      // keep current state
    } finally {
      setSaving((p) => ({ ...p, [service]: false }));
    }
  }, [inputs]);

  const handleToggle = useCallback(async (service: ServiceName, currentEnabled: boolean) => {
    try {
      const updated = await toggleService({ data: { service, enabled: !currentEnabled } });
      setKeys((prev) => prev.map((k) => (k.service === service ? updated : k)));
    } catch {
      // keep current state
    }
  }, []);

  const handleTest = useCallback(async (service: ServiceName) => {
    setTesting((p) => ({ ...p, [service]: true }));
    setTestResults((prev) => ({ ...prev, [service]: null }));
    try {
      const result = await testApiKey({ data: { service } });
      setTestResults((prev) => ({ ...prev, [service]: result }));
    } catch {
      setTestResults((prev) => ({ ...prev, [service]: { ok: false, message: "Test request failed" } }));
    } finally {
      setTesting((p) => ({ ...p, [service]: false }));
    }
  }, []);

  // ── RPC actions ────────────────────────────────────────────────

  const handleAddRpc = useCallback(async () => {
    if (!newRpcLabel.trim() || !newRpcUrl.trim()) return;
    setAddingRpc(true);
    try {
      const entry = await addRpcEndpoint({ data: { label: newRpcLabel.trim(), url: newRpcUrl.trim() } });
      setRpcs((prev) => [...prev, entry]);
      setNewRpcLabel("");
      setNewRpcUrl("");
    } catch {
      // keep current state
    } finally {
      setAddingRpc(false);
    }
  }, [newRpcLabel, newRpcUrl]);

  const handleRpcToggle = useCallback(async (id: string, currentEnabled: boolean) => {
    try {
      const updated = await toggleRpcEndpoint({ data: { id, enabled: !currentEnabled } });
      if (updated) {
        setRpcs((prev) => prev.map((r) => (r.id === id ? updated : r)));
      }
    } catch {
      // keep current state
    }
  }, []);

  const handleRpcDelete = useCallback(async (id: string) => {
    try {
      await deleteRpcEndpoint({ data: { id } });
      setRpcs((prev) => prev.filter((r) => r.id !== id));
    } catch {
      // keep current state
    }
  }, []);

  // ── Payment destination actions ────────────────────────────────

  const handleAddDest = useCallback(async () => {
    if (!newDestLabel.trim() || !newDestAddress.trim()) return;
    setAddingDest(true);
    setDestError(null);
    try {
      const dest = await addDestination({
        data: {
          label: newDestLabel.trim(),
          destType: newDestType,
          chainId: newDestType === "crypto" ? newDestChain : undefined,
          destAddress: newDestAddress.trim(),
        },
      });
      setDestinations((prev) => [dest, ...prev]);
      setNewDestLabel("");
      setNewDestAddress("");
      setShowAddDest(false);
    } catch (err: unknown) {
      setDestError((err as Error).message);
    } finally {
      setAddingDest(false);
    }
  }, [newDestLabel, newDestAddress, newDestType, newDestChain]);

  const handleDeleteDest = useCallback(async (id: string) => {
    try {
      await deleteDestination({ data: { id } });
      setDestinations((prev) => prev.filter((d) => d.id !== id));
    } catch {
      // keep current state
    }
  }, []);

  const handleSetDefaultDest = useCallback(async (id: string) => {
    try {
      const updated = await setDefaultDestination({ data: { id } });
      setDestinations((prev) =>
        prev.map((d) => (d.id === id ? updated : { ...d, isDefault: false })),
      );
    } catch {
      // keep current state
    }
  }, []);

  // ── Exchange toggle actions ────────────────────────────────────

  const handleExchangeToggle = useCallback(async (exchangeId: string, currentEnabled: boolean) => {
    setExchangeToggling((p) => ({ ...p, [exchangeId]: true }));
    try {
      const updated = await toggleExchange({ data: { exchangeId, enabled: !currentEnabled } });
      setExchangeCfgs((prev) => prev.map((e) => (e.exchangeId === exchangeId ? updated : e)));
    } catch {
      // keep current state
    } finally {
      setExchangeToggling((p) => ({ ...p, [exchangeId]: false }));
    }
  }, []);

  // ── Render ─────────────────────────────────────────────────────

  return (
    <div className="min-h-dvh bg-darker pt-20 pb-16">
      <div className="mx-auto max-w-4xl px-4 sm:px-6">
        {/* Page header */}
        <div className="mb-10 animate-fade-in-up">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-3xl">⚙️</span>
            <h1 className="text-3xl sm:text-4xl font-black text-white">
              Settings
            </h1>
          </div>
          <p className="text-gray-400 text-sm sm:text-base max-w-xl">
            Manage API keys, RPC endpoints, and service integrations for the
            autonomous agent network.
          </p>
        </div>

        {/* API Keys section */}
        <div className="mb-10 animate-fade-in-up" style={{ animationDelay: "0.1s" }}>
          <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
            <span>🔑</span> API Keys
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {SERVICES.map((svc, i) => {
              const keyData = keys.find((k) => k.service === svc.name);
              const isConfigured = keyData?.configured ?? false;
              const isEnabled = keyData?.enabled ?? false;
              const masked = keyData?.maskedKey ?? null;
              const isTesting = testing[svc.name] ?? false;
              const isSaving = saving[svc.name] ?? false;
              const result = testResults[svc.name] ?? null;
              const inputVal = inputs[svc.name] ?? "";

              return (
                <div
                  key={svc.name}
                  className="glass-card p-5 animate-fade-in-up"
                  style={{ animationDelay: `${0.15 + i * 0.05}s` }}
                >
                  {/* Header row */}
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2.5">
                      <span className="text-2xl">{svc.icon}</span>
                      <div>
                        <h3 className="text-sm font-semibold text-white">
                          {svc.label}
                        </h3>
                        <p className="text-xs text-gray-500">
                          {svc.description}
                        </p>
                      </div>
                    </div>
                    {/* Status dot */}
                    <span
                      className={
                        isConfigured && isEnabled
                          ? "status-dot-online"
                          : "status-dot-offline"
                      }
                      title={
                        isConfigured && isEnabled
                          ? "Connected"
                          : isConfigured
                            ? "Disabled"
                            : "Not configured"
                      }
                    />
                  </div>

                  {/* Masked key display */}
                  {masked && (
                    <div className="mb-3">
                      <code className="block text-xs text-gray-400 bg-dark-hover rounded-lg px-3 py-2 font-mono truncate border border-dark-border">
                        {masked}
                      </code>
                    </div>
                  )}

                  {/* Key input */}
                  <div className="flex gap-2 mb-3">
                    <input
                      type="password"
                      value={inputVal}
                      onChange={(e) =>
                        setInputs((p) => ({ ...p, [svc.name]: e.target.value }))
                      }
                      placeholder={svc.placeholder}
                      className="glass-input flex-1 text-sm min-w-0"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSave(svc.name);
                      }}
                    />
                    <button
                      onClick={() => handleSave(svc.name)}
                      disabled={!inputVal.trim() || isSaving}
                      className="glass-button text-sm px-4 py-2 whitespace-nowrap"
                    >
                      {isSaving ? "…" : "Save"}
                    </button>
                  </div>

                  {/* Action buttons */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Toggle */}
                    {isConfigured && (
                      <label className="flex items-center gap-2 cursor-pointer select-none">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={isEnabled}
                          onClick={() => handleToggle(svc.name, isEnabled)}
                          className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                            isEnabled
                              ? "bg-accent-blue"
                              : "bg-dark-border"
                          }`}
                        >
                          <span
                            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                              isEnabled ? "translate-x-4" : "translate-x-0"
                            }`}
                          />
                        </button>
                        <span className="text-xs text-gray-400">
                          {isEnabled ? "On" : "Off"}
                        </span>
                      </label>
                    )}

                    {/* Test button */}
                    {isConfigured && (
                      <button
                        onClick={() => handleTest(svc.name)}
                        disabled={isTesting}
                        className="text-xs px-3 py-1.5 rounded-lg border border-dark-border text-gray-400 hover:text-white hover:border-accent-blue/40 hover:bg-dark-hover transition-all duration-200 disabled:opacity-40"
                      >
                        {isTesting ? "Testing…" : "Test"}
                      </button>
                    )}

                    {!isConfigured && (
                      <span className="text-xs text-gray-600 italic">
                        No key saved
                      </span>
                    )}
                  </div>

                  {/* Test result */}
                  {result && (
                    <div
                      className={`mt-3 text-xs px-3 py-2 rounded-lg border ${
                        result.ok
                          ? "border-accent-green/30 bg-accent-green/5 text-accent-green"
                          : "border-accent-red/30 bg-accent-red/5 text-accent-red"
                      }`}
                    >
                      {result.message}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* RPC Endpoints section */}
        <div className="animate-fade-in-up" style={{ animationDelay: "0.2s" }}>
          <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
            <span>🌐</span> Custom RPC Endpoints
          </h2>

          {/* Existing RPCs */}
          {rpcs.length > 0 && (
            <div className="space-y-2 mb-6">
              {rpcs.map((rpc) => (
                <div
                  key={rpc.id}
                  className="glass-card p-4 flex items-center gap-3 flex-wrap"
                >
                  <span
                    className={
                      rpc.enabled ? "status-dot-online" : "status-dot-offline"
                    }
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">
                      {rpc.label}
                    </p>
                    <code className="text-xs text-gray-500 font-mono truncate block">
                      {rpc.url}
                    </code>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={rpc.enabled}
                      onClick={() => handleRpcToggle(rpc.id, rpc.enabled)}
                      className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        rpc.enabled ? "bg-accent-blue" : "bg-dark-border"
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                          rpc.enabled ? "translate-x-4" : "translate-x-0"
                        }`}
                      />
                    </button>
                    <button
                      onClick={() => handleRpcDelete(rpc.id)}
                      className="text-xs px-2 py-1 rounded-md text-gray-500 hover:text-accent-red hover:bg-accent-red/10 transition-colors"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {rpcs.length === 0 && (
            <div className="glass-card p-6 text-center mb-6">
              <p className="text-gray-500 text-sm">
                No custom RPC endpoints configured. Add one below.
              </p>
            </div>
          )}

          {/* Add RPC form */}
          <div className="glass-card p-5">
            <h3 className="text-sm font-semibold text-white mb-4">
              Add RPC Endpoint
            </h3>
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                type="text"
                value={newRpcLabel}
                onChange={(e) => setNewRpcLabel(e.target.value)}
                placeholder="Label (e.g. Alchemy ETH)"
                className="glass-input flex-1 text-sm"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddRpc();
                }}
              />
              <input
                type="url"
                value={newRpcUrl}
                onChange={(e) => setNewRpcUrl(e.target.value)}
                placeholder="https://..."
                className="glass-input flex-[2] text-sm font-mono"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddRpc();
                }}
              />
              <button
                onClick={handleAddRpc}
                disabled={!newRpcLabel.trim() || !newRpcUrl.trim() || addingRpc}
                className="glass-button text-sm px-5 py-2 whitespace-nowrap"
              >
                {addingRpc ? "Adding…" : "Add"}
              </button>
            </div>
          </div>
        </div>

        {/* Payment Destinations section */}
        <div className="mt-10 animate-fade-in-up" style={{ animationDelay: "0.3s" }}>
          <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
            <span>💸</span> Payment Destinations
          </h2>
          <p className="text-gray-400 text-sm mb-6">
            Configure where earnings and payouts are sent. Add crypto wallets or
            Stripe destinations to receive funds.
          </p>

          {/* Existing destinations */}
          {destinations.length > 0 && (
            <div className="space-y-3 mb-6">
              {destinations.map((dest) => {
                const addr = dest.destAddress ?? "—";
                const shortAddr =
                  addr.length > 16
                    ? `${addr.slice(0, 8)}...${addr.slice(-6)}`
                    : addr;
                const chain = dest.chainId
                  ? CHAINS.find((c) => c.id === dest.chainId)
                  : null;

                return (
                  <div
                    key={dest.id}
                    className="glass-card p-4 flex items-center gap-3 flex-wrap"
                  >
                    <span className="text-xl">
                      {DEST_TYPE_ICONS[dest.destType]}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-white">
                          {dest.label}
                        </p>
                        {dest.isDefault && (
                          <span className="badge-cyan text-[0.6rem]">
                            DEFAULT
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500">
                        {DEST_TYPE_LABELS[dest.destType]}
                        {chain ? ` · ${chain.name}` : ""}
                      </p>
                      <code className="text-xs text-gray-400 font-mono truncate block mt-0.5">
                        {shortAddr}
                      </code>
                    </div>
                    <div className="flex items-center gap-2">
                      {!dest.isDefault && (
                        <button
                          onClick={() => handleSetDefaultDest(dest.id)}
                          className="text-xs px-2 py-1 rounded-md text-gray-500 hover:text-accent-cyan hover:bg-accent-cyan/10 transition-colors"
                          title="Set as default"
                        >
                          ⭐
                        </button>
                      )}
                      <button
                        onClick={() => handleDeleteDest(dest.id)}
                        className="text-xs px-2 py-1 rounded-md text-gray-500 hover:text-accent-red hover:bg-accent-red/10 transition-colors"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {destinations.length === 0 && !showAddDest && (
            <div className="glass-card p-6 text-center mb-6">
              <p className="text-gray-500 text-sm">
                No payment destinations configured. Add one to start receiving
                earnings.
              </p>
            </div>
          )}

          {/* Add destination form */}
          {showAddDest ? (
            <div className="glass-card p-5 animate-fade-in-up">
              <h3 className="text-sm font-semibold text-white mb-4">
                Add Payment Destination
              </h3>

              {/* Type selector */}
              <div className="flex gap-2 mb-4 flex-wrap">
                {(
                  ["crypto", "stripe_card", "stripe_deposit"] as DestType[]
                ).map((t) => (
                  <button
                    key={t}
                    onClick={() => {
                      setNewDestType(t);
                      setDestError(null);
                    }}
                    className={`text-xs px-3 py-2 rounded-lg border transition-all duration-200 ${
                      newDestType === t
                        ? "border-accent-blue bg-accent-blue/10 text-white"
                        : "border-dark-border text-gray-500 hover:border-dark-border-light hover:text-gray-300"
                    }`}
                  >
                    {DEST_TYPE_ICONS[t]} {DEST_TYPE_LABELS[t]}
                  </button>
                ))}
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <input
                  type="text"
                  value={newDestLabel}
                  onChange={(e) => {
                    setNewDestLabel(e.target.value);
                    setDestError(null);
                  }}
                  placeholder="Label (e.g. My ETH Wallet)"
                  className="glass-input flex-1 text-sm min-w-[200px]"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleAddDest();
                  }}
                />

                {newDestType === "crypto" && (
                  <select
                    value={newDestChain}
                    onChange={(e) => setNewDestChain(e.target.value)}
                    className="glass-input text-sm min-w-[140px] bg-dark-hover"
                  >
                    {CHAINS.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                )}

                <input
                  type="text"
                  value={newDestAddress}
                  onChange={(e) => {
                    setNewDestAddress(e.target.value);
                    setDestError(null);
                  }}
                  placeholder={
                    newDestType === "crypto"
                      ? "0x... wallet address"
                      : newDestType === "stripe_card"
                        ? "card_... or account ID"
                        : "ba_... or account ID"
                  }
                  className="glass-input flex-[2] text-sm font-mono min-w-[240px]"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleAddDest();
                  }}
                />

                <button
                  onClick={handleAddDest}
                  disabled={
                    !newDestLabel.trim() ||
                    !newDestAddress.trim() ||
                    addingDest
                  }
                  className="glass-button text-sm px-5 py-2 whitespace-nowrap"
                >
                  {addingDest ? "Adding…" : "Save"}
                </button>

                <button
                  onClick={() => {
                    setShowAddDest(false);
                    setDestError(null);
                  }}
                  className="text-sm px-4 py-2 rounded-lg border border-dark-border text-gray-400 hover:text-white hover:border-dark-border-light transition-colors"
                >
                  Cancel
                </button>
              </div>

              {destError && (
                <div className="mt-3 text-xs px-3 py-2 rounded-lg border border-accent-red/30 bg-accent-red/5 text-accent-red">
                  {destError}
                </div>
              )}
            </div>
          ) : (
            <button
              onClick={() => setShowAddDest(true)}
              className="glass-button text-sm px-5 py-2"
            >
              + Add Destination
            </button>
          )}
        </div>
        {/* Exchange Toggles section */}
        <div className="mt-10 animate-fade-in-up" style={{ animationDelay: "0.4s" }}>
          <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
            <span>🏦</span> Exchange Connections
          </h2>
          <p className="text-gray-400 text-sm mb-6">
            Enable or disable exchange integrations. All exchanges run in paper
            trading mode by default — no real API keys are needed. Add API keys
            to enable live trading when ready.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            {exchangeCfgs.map((exchange, i) => {
              const isEnabled = exchange.enabled;
              const isToggling = exchangeToggling[exchange.exchangeId] ?? false;

              // Exchange-specific icons and colors
              const exchangeMeta: Record<string, { icon: string; color: string }> = {
                binance: { icon: "🟡", color: "border-accent-yellow/40" },
                bitunix: { icon: "🔵", color: "border-accent-blue/40" },
                bybit: { icon: "🟠", color: "border-accent-orange/40" },
                coinbase: { icon: "🔷", color: "border-blue-400/40" },
              };
              const meta = exchangeMeta[exchange.exchangeId] ?? { icon: "🏦", color: "border-dark-border" };

              return (
                <div
                  key={exchange.exchangeId}
                  className={`glass-card p-5 animate-fade-in-up border-l-2 ${meta.color}`}
                  style={{ animationDelay: `${0.45 + i * 0.05}s` }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{meta.icon}</span>
                      <div>
                        <h3 className="text-sm font-semibold text-white">
                          {exchange.name}
                        </h3>
                        <p className="text-xs text-gray-500">
                          {exchange.isLive
                            ? "Live — API keys configured"
                            : "Paper trading mode"}
                        </p>
                      </div>
                    </div>

                    {/* Toggle switch */}
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={isEnabled}
                        disabled={isToggling}
                        onClick={() => handleExchangeToggle(exchange.exchangeId, isEnabled)}
                        className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-40 ${
                          isEnabled ? "bg-accent-blue" : "bg-dark-border"
                        }`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                            isEnabled ? "translate-x-4" : "translate-x-0"
                          }`}
                        />
                      </button>
                      <span className="text-xs text-gray-400 w-7">
                        {isToggling ? "…" : isEnabled ? "ON" : "OFF"}
                      </span>
                    </label>
                  </div>

                  {/* Status indicator */}
                  <div className="mt-3 flex items-center gap-2">
                    <span
                      className={
                        isEnabled
                          ? "status-dot-online"
                          : "status-dot-offline"
                      }
                    />
                    <span className="text-xs text-gray-500">
                      {isEnabled ? "Connected & active" : "Disabled"}
                    </span>
                    {exchange.apiKeyConfigured && (
                      <span className="badge-cyan text-[0.6rem] ml-auto">LIVE</span>
                    )}
                    {!exchange.apiKeyConfigured && (
                      <span className="text-[0.6rem] px-2 py-0.5 rounded-full bg-dark-border text-gray-500 ml-auto">
                        PAPER
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {exchangeCfgs.length === 0 && (
            <div className="glass-card p-6 text-center">
              <p className="text-gray-500 text-sm">
                No exchange connections configured.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
