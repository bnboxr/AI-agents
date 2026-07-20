/**
 * Demo-aware wagmi wrapper.
 *
 * Re-exports everything from wagmi, but overrides select hooks
 * so that demo mode works seamlessly without a real wallet.
 *
 * Import from here instead of "wagmi" in all route/component files.
 */

export {
  // Re-export everything else unchanged
  WagmiProvider,
  useConnect,
  useDisconnect,
  useSwitchChain,
  useChains,
  useReadContract,
  useReadContracts,
  useWriteContract,
  useSendTransaction,
  useWaitForTransactionReceipt,
  type Config,
} from "wagmi";

import {
  useAccount as wagmiUseAccount,
  useChainId as wagmiUseChainId,
  useBalance as wagmiUseBalance,
} from "wagmi";
import { isDemoMode, DEMO_ADDRESS, DEMO_BALANCE } from "./demo-mode";

// ── useAccount ──────────────────────────────────────────────────────

export function useAccount() {
  const wagmiResult = wagmiUseAccount();
  if (isDemoMode()) {
    return {
      ...wagmiResult,
      address: DEMO_ADDRESS as `0x${string}`,
      addresses: [DEMO_ADDRESS as `0x${string}`],
      isConnected: true,
      isConnecting: false,
      isReconnecting: false,
      isDisconnected: false,
      status: "connected" as const,
      chainId: 1,
      connector: wagmiResult.connector ?? null,
    };
  }
  return wagmiResult;
}

// ── useChainId ──────────────────────────────────────────────────────

export function useChainId() {
  const wagmiResult = wagmiUseChainId();
  if (isDemoMode()) return 1; // Ethereum mainnet
  return wagmiResult;
}

// ── useBalance ──────────────────────────────────────────────────────

export function useBalance(params?: { address?: `0x${string}`; chainId?: number; token?: `0x${string}` }) {
  const wagmiResult = wagmiUseBalance(params as any);
  if (isDemoMode()) {
    return {
      ...wagmiResult,
      data: {
        value: DEMO_BALANCE.value,
        decimals: DEMO_BALANCE.decimals,
        symbol: DEMO_BALANCE.symbol,
        formatted: DEMO_BALANCE.formatted,
      },
      isLoading: false,
      isError: false,
      isSuccess: true,
    };
  }
  return wagmiResult;
}
