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

// ── useAccount ──────────────────────────────────────────────────────

export function useAccount() {
  const wagmiResult = wagmiUseAccount();
    return {
      ...wagmiResult,
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
  return wagmiResult;
}

// ── useBalance ──────────────────────────────────────────────────────

export function useBalance(params?: { address?: `0x${string}`; chainId?: number; token?: `0x${string}` }) {
  const wagmiResult = wagmiUseBalance(params as any);
    return {
      ...wagmiResult,
      data: {
      },
      isLoading: false,
      isError: false,
      isSuccess: true,
    };
  }
  return wagmiResult;
}
