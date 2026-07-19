// Airdrop-specific risk checks — limits, gas tracking, daily reset
import { agentBus } from "../agent-bus";
import type { AirdropConfig } from "./types";
import { defaultAirdropConfig } from "./types";

// ── In-memory state ─────────────────────────────────────────────────

let config: AirdropConfig = { ...defaultAirdropConfig };
let dailyGasSpent = 0;

// Track per-protocol deposits (protocolId -> total USD)
const protocolDeposits = new Map<string, number>();

// Track per-wallet deposits (walletIndex -> total USD)
const walletDeposits = new Map<number, number>();

// ── Bus emit helper ─────────────────────────────────────────────────

interface BusLike {
  emit(event: string, payload: unknown): void;
}
const bus = agentBus as unknown as BusLike;

// ── Public API ──────────────────────────────────────────────────────

/** Get current airdrop config */
export function getAirdropConfig(): AirdropConfig {
  return { ...config };
}

/** Set airdrop config (partial update) */
export function setAirdropConfig(partial: Partial<AirdropConfig>): AirdropConfig {
  config = { ...config, ...partial };
  return { ...config };
}

/**
 * Check all airdrop limits before executing an interaction.
 * Returns { allowed: boolean, reason?: string }
 */
export function checkAirdropLimits(params: {
  walletIndex: number;
  protocolId: string;
  amountUsd: number;
}): { allowed: boolean; reason?: string } {
  const { walletIndex, protocolId, amountUsd } = params;

  // Daily gas cap
  if (dailyGasSpent >= config.maxDailyGasUsd) {
    return {
      allowed: false,
      reason: `Daily gas cap reached: $${dailyGasSpent.toFixed(2)} / $${config.maxDailyGasUsd}`,
    };
  }

  // Per-protocol deposit cap
  const protoDeposit = protocolDeposits.get(protocolId) ?? 0;
  if (protoDeposit + amountUsd > config.maxDepositPerProtocolUsd) {
    return {
      allowed: false,
      reason: `Protocol deposit cap would be exceeded: $${(protoDeposit + amountUsd).toFixed(2)} > $${config.maxDepositPerProtocolUsd} for ${protocolId}`,
    };
  }

  // Per-wallet deposit cap
  const walletDeposit = walletDeposits.get(walletIndex) ?? 0;
  if (walletDeposit + amountUsd > config.maxDepositPerWalletUsd) {
    return {
      allowed: false,
      reason: `Wallet deposit cap would be exceeded: $${(walletDeposit + amountUsd).toFixed(2)} > $${config.maxDepositPerWalletUsd} for wallet ${walletIndex}`,
    };
  }

  return { allowed: true };
}

/**
 * Record a deposit for tracking per-protocol and per-wallet limits.
 */
export function recordDeposit(walletIndex: number, protocolId: string, amountUsd: number): void {
  const protoCurrent = protocolDeposits.get(protocolId) ?? 0;
  protocolDeposits.set(protocolId, protoCurrent + amountUsd);

  const walletCurrent = walletDeposits.get(walletIndex) ?? 0;
  walletDeposits.set(walletIndex, walletCurrent + amountUsd);
}

/**
 * Track daily gas spending. Emits a warning if approaching the cap.
 */
export function trackDailyGas(amount: number): void {
  dailyGasSpent += amount;

  if (dailyGasSpent >= config.maxDailyGasUsd * 0.9) {
    bus.emit("airdrop_gas_warning", {
      spent: dailyGasSpent,
      cap: config.maxDailyGasUsd,
      pct: (dailyGasSpent / config.maxDailyGasUsd) * 100,
      timestamp: Date.now(),
    });
  }
}

/**
 * Reset daily gas counter (call at midnight UTC).
 */
export function resetDailyGas(): void {
  dailyGasSpent = 0;
  console.log("[Airdrop] Daily gas counter reset");
}

/**
 * Get current daily gas spent.
 */
export function getDailyGasSpent(): number {
  return dailyGasSpent;
}

/**
 * Get per-protocol deposit summary.
 */
export function getProtocolDeposits(): Map<string, number> {
  return new Map(protocolDeposits);
}

/**
 * Get per-wallet deposit summary.
 */
export function getWalletDeposits(): Map<number, number> {
  return new Map(walletDeposits);
}

/**
 * Full reset of all airdrop risk state.
 */
export function resetAirdropRiskState(): void {
  dailyGasSpent = 0;
  protocolDeposits.clear();
  walletDeposits.clear();
  config = { ...defaultAirdropConfig };
}
