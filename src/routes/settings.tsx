import { createFileRoute } from "@tanstack/react-router";
import { useState, useCallback, useEffect } from "react";
import {
  getSettings,
  saveApiKey,
  testApiKey,
  toggleService,
  addRpcEndpoint,
  toggleRpcEndpoint,
  deleteRpcEndpoint,
  getLLMProvider,
  setLLMProvider,
} from "~/lib/api-keys";
import type { ServiceKey, RpcEntry, ServiceName, LLMProvider } from "~/lib/api-keys";
import { detectOllama, findCompatibleModel } from "~/lib/llm/local";
import type { OllamaModel } from "~/lib/llm/local";
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
import { getVenuePreference, setVenuePreference, type TradingVenue } from "~/lib/venue-selector";
import {
  getWalletChainId,
  getWalletChainName,
  setWalletChain,
  listWalletChainIds,
  isWalletTestnet,
  WALLET_CHAINS,
  type WalletChainConfig,
} from "~/lib/venue-selector";
import { getDexSlippageSetting, getPreferredDex, getGasPreference } from "~/lib/exchange/dex";
import { getFaucetsForCurrentChain, requestSepoliaFaucet } from "~/lib/faucet";

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
    const [settings, destinations, exchangeConfigs, llmProvider] = await Promise.all([
      getSettings(),
      listDestinations(),
      getExchangeConfigs(),
      getLLMProvider(),
    ]);
    // Try to detect Ollama on the server side
    let ollamaStatus = { running: false, models: [] as OllamaModel[] };
    try {
      ollamaStatus = await detectOllama();
    } catch {
      // Ollama not available
    }
    return { ...settings, destinations, exchangeConfigs, llmProvider, ollamaStatus };
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
  const [provider, setProvider] = useState<LLMProvider>(initial.llmProvider);
  const [ollamaModels, setOllamaModels] = useState<OllamaModel[]>(initial.ollamaStatus.models);
  const [ollamaRunning, setOllamaRunning] = useState(initial.ollamaStatus.running);
  const [ollamaChecking, setOllamaChecking] = useState(false);
  const [providerSaving, setProviderSaving] = useState(false);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; message: string } | null>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [exchangeToggling, setExchangeToggling] = useState<Record<string, boolean>>({});
  const [tradingVenue, setTradingVenue] = useState<TradingVenue>(getVenuePreference());

  // ── Wallet chain state ──────────────────────────────────────────
  const [walletChain, setWalletChainState] = useState<string>(() => getWalletChainId());
  const [walletTestnet, setWalletTestnet] = useState<boolean>(() => isWalletTestnet());
  const [faucetAddress, setFaucetAddress] = useState("");
  const [faucetRequesting, setFaucetRequesting] = useState(false);
  const [faucetResult, setFaucetResult] = useState<string | null>(null);

  // ── DEX settings state ──────────────────────────────────────────
  const [dexSlippage, setDexSlippage] = useState<number>(() => getDexSlippageSetting() * 100);
  const [preferredDex, setPreferredDex] = useState<string>(() => getPreferredDex());
  const [gasPreference, setGasPreferenceState] = useState<"fast" | "medium" | "slow">(() => getGasPreference());

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

  // ── LLM Provider actions ─────────────────────────────────────────

  const handleProviderChange = useCallback(async (newProvider: LLMProvider) => {
    setProviderSaving(true);
    try {
      await setLLMProvider({ data: { provider: newProvider } });
      setProvider(newProvider);
      // Re-check Ollama if switching to it
      if (newProvider === "ollama") {
        setOllamaChecking(true);
        try {
          const status = await detectOllama();
          setOllamaRunning(status.running);
          setOllamaModels(status.models);
        } catch {
          setOllamaRunning(false);
          setOllamaModels([]);
        } finally {
          setOllamaChecking(false);
        }
      }
    } catch {
      // keep current state
    } finally {
      setProviderSaving(false);
    }
  }, []);

  const handleRefreshOllama = useCallback(async () => {
    setOllamaChecking(true);
    try {
      const status = await detectOllama();
      setOllamaRunning(status.running);
      setOllamaModels(status.models);
    } catch {
      setOllamaRunning(false);
      setOllamaModels([]);
    } finally {
      setOllamaChecking(false);
    }
  }, []);

  // ── Trading venue actions ──────────────────────────────────────
  
  const handleVenueChange = useCallback((venue: TradingVenue) => {
    setTradingVenue(venue);
    setVenuePreference(venue);
  }, []);

  // ── Wallet chain actions ───────────────────────────────────────

  const handleChainChange = useCallback((chainId: string) => {
    setWalletChain(chainId);
    setWalletChainState(chainId);
    setWalletTestnet(WALLET_CHAINS[chainId]?.testnet ?? false);
    setFaucetResult(null);
  }, []);

  const handleFaucetRequest = useCallback(async () => {
    if (!faucetAddress.trim()) return;
    setFaucetRequesting(true);
    setFaucetResult(null);
    try {
      const result = await requestSepoliaFaucet(faucetAddress.trim());
      setFaucetResult(result.success ? result.message : result.message);
    } catch (err) {
      setFaucetResult(`Request failed: ${(err as Error).message}`);
    } finally {
      setFaucetRequesting(false);
    }
  }, [faucetAddress]);

  // ── DEX settings handlers ──────────────────────────────────────

  const handleDexSlippageChange = useCallback((value: number) => {
    setDexSlippage(value);
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem("hsmc_dex_slippage", (value / 100).toString());
    }
  }, []);

  const handlePreferredDexChange = useCallback((dex: string) => {
    setPreferredDex(dex);
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem("hsmc_preferred_dex", dex);
    }
  }, []);

  const handleGasPreferenceChange = useCallback((pref: "fast" | "medium" | "slow") => {
    setGasPreferenceState(pref);
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem("hsmc_gas_preference", pref);
    }
  }, []);

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

        {/* LLM Provider section */}
        <div className="mb-10 animate-fade-in-up" style={{ animationDelay: "0.05s" }}>
          <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
            <span>🧠</span> LLM Provider
          </h2>
          <div className="glass-card p-5">
            <p className="text-gray-400 text-sm mb-4">
              Select which AI model to use for chat and agent reasoning.
              Ollama runs locally on your PC — no API key needed.
            </p>

            {/* Provider selector */}
            <div className="flex gap-3 mb-4 flex-wrap">
              {(["openai", "anthropic", "ollama"] as LLMProvider[]).map((p) => (
                <button
                  key={p}
                  onClick={() => handleProviderChange(p)}
                  disabled={providerSaving}
                  className={`text-sm px-4 py-2.5 rounded-lg border transition-all duration-200 flex items-center gap-2 ${
                    provider === p
                      ? "border-accent-blue bg-accent-blue/10 text-white"
                      : "border-dark-border text-gray-500 hover:border-dark-border-light hover:text-gray-300"
                  } disabled:opacity-40`}
                >
                  <span>
                    {p === "openai" ? "🤖" : p === "anthropic" ? "🧠" : "🦙"}
                  </span>
                  <span>
                    {p === "openai" ? "OpenAI (GPT-4o)" : p === "anthropic" ? "Anthropic (Claude)" : "Ollama (Local)"}
                  </span>
                  {provider === p && (
                    <span className="text-accent-blue text-xs">●</span>
                  )}
                </button>
              ))}
            </div>

            {/* Ollama status panel */}
            {provider === "ollama" && (
              <div className="mt-3 p-4 rounded-lg border border-dark-border bg-dark-hover/40">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-semibold text-white flex items-center gap-2">
                    <span>🦙</span> Ollama Status
                  </h4>
                  <button
                    onClick={handleRefreshOllama}
                    disabled={ollamaChecking}
                    className="text-xs px-3 py-1 rounded-lg border border-dark-border text-gray-400 hover:text-white hover:border-accent-blue/40 transition-all disabled:opacity-40"
                  >
                    {ollamaChecking ? "Checking…" : "🔄 Refresh"}
                  </button>
                </div>

                {ollamaRunning ? (
                  <>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="status-dot-online" />
                      <span className="text-sm text-accent-green">Ollama is running</span>
                    </div>
                    {ollamaModels.length > 0 ? (
                      <div className="space-y-1.5">
                        <p className="text-xs text-gray-500 mb-2">Available models:</p>
                        {ollamaModels.map((m) => {
                          const isCompat = findCompatibleModel([m]) !== null;
                          return (
                            <div
                              key={m.name}
                              className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg border ${
                                isCompat
                                  ? "border-accent-green/20 bg-accent-green/5 text-accent-green"
                                  : "border-dark-border bg-dark-hover/20 text-gray-400"
                              }`}
                            >
                              <span>{isCompat ? "✅" : "📦"}</span>
                              <span className="font-mono">{m.name}</span>
                              <span className="text-gray-600 ml-auto">
                                {(m.size / 1e9).toFixed(1)} GB
                              </span>
                            </div>
                          );
                        })}
                        {ollamaModels.length > 0 && findCompatibleModel(ollamaModels) && (
                          <p className="text-xs text-accent-green mt-2">
                            ✓ Compatible model found — Ollama is ready to use
                          </p>
                        )}
                        {ollamaModels.length > 0 && !findCompatibleModel(ollamaModels) && (
                          <div className="mt-3">
                            <p className="text-xs text-accent-yellow mb-2">
                              ⚠ No compatible model found. Download one:
                            </p>
                            <code className="block text-xs text-gray-300 bg-dark-hover rounded-lg px-3 py-2 font-mono border border-dark-border">
                              ollama pull llama3
                            </code>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="mt-2">
                        <p className="text-xs text-accent-yellow mb-2">
                          No models installed. Download llama3 to get started:
                        </p>
                        <div className="flex gap-2">
                          <code className="block flex-1 text-xs text-gray-300 bg-dark-hover rounded-lg px-3 py-2 font-mono border border-dark-border">
                            ollama pull llama3
                          </code>
                          <button
                            className="text-xs px-3 py-1.5 rounded-lg bg-accent-blue/10 border border-accent-blue/30 text-accent-blue hover:bg-accent-blue/20 transition-colors whitespace-nowrap"
                            title="Copy to clipboard — run in terminal"
                            onClick={() => {
                              navigator.clipboard?.writeText("ollama pull llama3");
                            }}
                          >
                            📋 Copy
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="status-dot-offline" />
                      <span className="text-sm text-gray-400">
                        {ollamaChecking ? "Checking..." : "Ollama not detected"}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mb-2">
                      Make sure Ollama is installed and running at <code className="text-gray-400">http://localhost:11434</code>.
                    </p>
                    <a
                      href="https://ollama.com/download"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-accent-blue hover:text-accent-cyan transition-colors"
                    >
                      Download Ollama →
                    </a>
                  </div>
                )}
              </div>
            )}

            {providerSaving && (
              <p className="text-xs text-gray-500 mt-2">Saving preference...</p>
            )}
          </div>
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
        {/* Trading Venue Selector */}
        <div className="mt-10 animate-fade-in-up" style={{ animationDelay: "0.35s" }}>
          <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
            <span>📍</span> Trading Venue
          </h2>
          <p className="text-gray-400 text-sm mb-4">
            Select where paper trades are routed. Bitunix is the primary
            perpetuals exchange. Wallet/DEX simulates on-chain execution.
          </p>
          <div className="glass-card p-5">
            <div className="flex gap-3 flex-wrap">
              {([
                { value: "bitunix" as TradingVenue, label: "🔵 Bitunix", desc: "Perpetuals & spot trading" },
                { value: "wallet" as TradingVenue, label: "🔗 Wallet/DEX", desc: "On-chain simulated execution" },
                { value: "auto" as TradingVenue, label: "🔄 Auto", desc: "Bitunix → Wallet fallback" },
              ]).map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => handleVenueChange(opt.value)}
                  className={`text-sm px-4 py-3 rounded-lg border transition-all duration-200 text-left ${
                    tradingVenue === opt.value
                      ? "border-accent-blue bg-accent-blue/10 text-white"
                      : "border-dark-border text-gray-500 hover:border-dark-border-light hover:text-gray-300"
                  }`}
                >
                  <div className="font-semibold">{opt.label}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{opt.desc}</div>
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-600 mt-3">
              Current venue:{" "}
              <span className="text-accent-blue font-semibold">
                {tradingVenue === "bitunix" ? "Bitunix" : tradingVenue === "wallet" ? "Wallet/DEX" : "Auto (Bitunix → Wallet)"}
              </span>
            </p>
          </div>
        </div>

        {/* Wallet Network section */}
        {tradingVenue === "wallet" && (
          <div className="mt-10 animate-fade-in-up" style={{ animationDelay: "0.37s" }}>
            <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <span>⛓️</span> Wallet Network
            </h2>
            <p className="text-gray-400 text-sm mb-4">
              Select which blockchain to use for wallet/DEX trading.
              Testnets let you trade with zero-value test tokens.
            </p>

            {/* Testnet warning banner */}
            {walletTestnet && (
              <div className="mb-4 p-4 rounded-lg border border-accent-yellow/30 bg-accent-yellow/5 text-accent-yellow text-sm flex items-center gap-3">
                <span className="text-lg">⚠️</span>
                <div>
                  <p className="font-semibold">Testnet mode — no real value at risk</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    You are trading on {getWalletChainName()} testnet. Get free test tokens below.
                  </p>
                </div>
              </div>
            )}

            {/* Chain selector grid */}
            <div className="glass-card p-5">
              <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
                {listWalletChainIds().map((chainId) => {
                  const cfg = WALLET_CHAINS[chainId];
                  if (!cfg) return null;
                  const isSelected = walletChain === chainId;
                  const isTestnet = cfg.testnet ?? false;

                  return (
                    <button
                      key={chainId}
                      onClick={() => handleChainChange(chainId)}
                      className={`text-sm px-3 py-3 rounded-lg border transition-all duration-200 text-center ${
                        isSelected
                          ? isTestnet
                            ? "border-accent-yellow bg-accent-yellow/10 text-white"
                            : "border-accent-blue bg-accent-blue/10 text-white"
                          : "border-dark-border text-gray-500 hover:border-dark-border-light hover:text-gray-300"
                      }`}
                    >
                      <div className="font-semibold text-xs truncate">{cfg.name}</div>
                      <div className={`text-[0.6rem] mt-1 ${isTestnet ? "text-accent-yellow" : "text-accent-green"}`}>
                        {isTestnet ? "🟡 Testnet" : "🟢 Mainnet"}
                      </div>
                      {isSelected && (
                        <div className={`text-[0.6rem] mt-0.5 ${isTestnet ? "text-accent-yellow" : "text-accent-blue"}`}>
                          ● Active
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Faucet section — only on testnets */}
            {walletTestnet && (
              <div className="mt-6 glass-card p-5">
                <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                  <span>🚰</span> Get Test Tokens
                </h3>
                <p className="text-xs text-gray-500 mb-4">
                  Use these faucets to get free testnet tokens for {getWalletChainName()}.
                </p>

                {/* Faucet links */}
                {getFaucetsForCurrentChain().length > 0 && (
                  <div className="space-y-3 mb-4">
                    {getFaucetsForCurrentChain().map((f, i) => (
                      <a
                        key={i}
                        href={f.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-3 text-sm px-4 py-3 rounded-lg border border-dark-border bg-dark-hover/30 text-gray-300 hover:text-white hover:border-accent-blue/30 hover:bg-dark-hover/50 transition-all duration-200"
                      >
                        <span className="text-lg">🔗</span>
                        <div>
                          <div className="font-medium text-sm">{f.label}</div>
                          <div className="text-xs text-gray-500">{f.description}</div>
                        </div>
                        <span className="ml-auto text-gray-500">↗</span>
                      </a>
                    ))}
                  </div>
                )}

                {/* Auto-faucet for Sepolia */}
                {walletChain === "sepolia" && (
                  <div className="mt-4 pt-4 border-t border-dark-border">
                    <p className="text-xs text-gray-500 mb-3">
                      Or try the automated PoW faucet (may require captcha):
                    </p>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={faucetAddress}
                        onChange={(e) => setFaucetAddress(e.target.value)}
                        placeholder="0x... your wallet address"
                        className="glass-input flex-1 text-sm font-mono"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleFaucetRequest();
                        }}
                      />
                      <button
                        onClick={handleFaucetRequest}
                        disabled={!faucetAddress.trim() || faucetRequesting}
                        className="glass-button text-sm px-4 py-2 whitespace-nowrap"
                      >
                        {faucetRequesting ? "Sending…" : "Request ETH"}
                      </button>
                    </div>
                    {faucetResult && (
                      <div className={`mt-3 text-xs px-3 py-2 rounded-lg border ${
                        faucetResult.startsWith("Faucet request submitted")
                          ? "border-accent-green/30 bg-accent-green/5 text-accent-green"
                          : "border-accent-yellow/30 bg-accent-yellow/5 text-accent-yellow"
                      }`}>
                        {faucetResult}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Venue status display */}
            <div className="mt-4 flex items-center gap-2 text-sm text-gray-400">
              <span className={walletTestnet ? "text-accent-yellow" : "text-accent-green"}>
                {walletTestnet ? "🟡" : "🟢"}
              </span>
              <span>
                {walletTestnet
                  ? `Testnet (${getWalletChainName()}) — Test tokens only`
                  : `Mainnet (${getWalletChainName()}) — Real funds`}
              </span>
            </div>
          </div>
        )}

        {/* DEX Configuration section */}
        <div className="mt-10 animate-fade-in-up" style={{ animationDelay: "0.38s" }}>
          <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
            <span>🦄</span> DEX Configuration
          </h2>
          <p className="text-gray-400 text-sm mb-4">
            Configure how DEX/Uniswap trades are simulated in paper mode.
          </p>
          <div className="glass-card p-5 space-y-6">
            {/* Slippage tolerance */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-white">
                  Slippage Tolerance
                </label>
                <span className="text-sm text-accent-blue font-mono">
                  {dexSlippage.toFixed(1)}%
                </span>
              </div>
              <p className="text-xs text-gray-500 mb-3">
                Total DEX slippage = 0.3% Uniswap pool fee + this price impact.
                Applied to both entry and exit.
              </p>
              <input
                type="range"
                min={0.1}
                max={5}
                step={0.1}
                value={dexSlippage}
                onChange={(e) => handleDexSlippageChange(parseFloat(e.target.value))}
                className="w-full h-2 rounded-lg appearance-none cursor-pointer"
                style={{
                  background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${(dexSlippage / 5) * 100}%, #1e293b ${(dexSlippage / 5) * 100}%, #1e293b 100%)`,
                }}
              />
              <div className="flex justify-between text-xs text-gray-600 mt-1">
                <span>0.1% (tight)</span>
                <span>5% (loose)</span>
              </div>
              <p className="text-xs text-accent-yellow mt-2">
                Default: 0.5% price impact + 0.3% pool fee = 0.8% total.
              </p>
            </div>

            {/* Preferred DEX */}
            <div>
              <label className="text-sm font-medium text-white mb-2 block">
                Preferred DEX
              </label>
              <p className="text-xs text-gray-500 mb-3">
                Select the DEX protocol to simulate swaps through.
              </p>
              <div className="flex gap-3 flex-wrap">
                {([
                  { value: "uniswap_v3", label: "🦄 Uniswap V3", desc: "Concentrated liquidity, best prices" },
                  { value: "uniswap_v2", label: "🔄 Uniswap V2", desc: "Classic AMM, wider spreads" },
                  { value: "sushiswap", label: "🍣 SushiSwap", desc: "0.25% fee (vs 0.3%)" },
                ]).map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => handlePreferredDexChange(opt.value)}
                    className={`text-sm px-4 py-3 rounded-lg border transition-all duration-200 text-left ${
                      preferredDex === opt.value
                        ? "border-accent-blue bg-accent-blue/10 text-white"
                        : "border-dark-border text-gray-500 hover:border-dark-border-light hover:text-gray-300"
                    }`}
                  >
                    <div className="font-semibold">{opt.label}</div>
                    <div className="text-xs text-gray-500 mt-0.5">{opt.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Gas preference */}
            <div>
              <label className="text-sm font-medium text-white mb-2 block">
                Gas Preference
              </label>
              <p className="text-xs text-gray-500 mb-3">
                Simulated gas cost for DEX transactions. Affects fee estimates.
              </p>
              <div className="flex gap-3 flex-wrap">
                {([
                  { value: "fast" as const, label: "⚡ Fast", desc: "~50 gwei", cost: "~$26" },
                  { value: "medium" as const, label: "🚶 Medium", desc: "~25 gwei", cost: "~$13" },
                  { value: "slow" as const, label: "🐢 Slow", desc: "~10 gwei", cost: "~$5" },
                ]).map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => handleGasPreferenceChange(opt.value)}
                    className={`text-sm px-4 py-3 rounded-lg border transition-all duration-200 text-left ${
                      gasPreference === opt.value
                        ? "border-accent-blue bg-accent-blue/10 text-white"
                        : "border-dark-border text-gray-500 hover:border-dark-border-light hover:text-gray-300"
                    }`}
                  >
                    <div className="font-semibold">{opt.label}</div>
                    <div className="text-xs text-gray-500 mt-0.5">{opt.desc} · est. {opt.cost}/swap</div>
                  </button>
                ))}
              </div>
            </div>
          </div>
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
