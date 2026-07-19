import { createServerFn } from "@tanstack/react-start";
import { isAddress } from "viem";
import { CHAINS } from "~/lib/chains";

// ── Types ──────────────────────────────────────────────────────────

export type DestType = "crypto" | "stripe_card" | "stripe_deposit";

export interface PaymentDestination {
  id: string;
  label: string;
  destType: DestType;
  isDefault: boolean;
  chainId?: string;
  tokenSymbol?: string;
  destAddress?: string;
  createdAt: number;
}

export const DEST_TYPE_LABELS: Record<DestType, string> = {
  crypto: "Crypto Wallet",
  stripe_card: "Stripe Card",
  stripe_deposit: "Stripe Bank Deposit",
};

export const DEST_TYPE_ICONS: Record<DestType, string> = {
  crypto: "₿",
  stripe_card: "💳",
  stripe_deposit: "🏦",
};

// ── In-memory store ────────────────────────────────────────────────

const store = new Map<string, PaymentDestination>();

// ── Server Functions ───────────────────────────────────────────────

export const listDestinations = createServerFn({ method: "GET" }).handler(
  async (): Promise<PaymentDestination[]> => {
    return Array.from(store.values()).sort((a, b) => b.createdAt - a.createdAt);
  },
);

export const addDestination = createServerFn({ method: "POST" }).handler(
  async ({
    data,
  }: {
    data: {
      label: string;
      destType: DestType;
      chainId?: string;
      tokenSymbol?: string;
      destAddress?: string;
    };
  }): Promise<PaymentDestination> => {
    const { label, destType, chainId, tokenSymbol, destAddress } = data;

    if (!label?.trim()) throw new Error("Label is required");
    if (!destType) throw new Error("Destination type is required");

    if (destType === "crypto") {
      if (!destAddress?.trim()) throw new Error("Wallet address is required");
      if (!isAddress(destAddress.trim())) {
        throw new Error(
          "Invalid wallet address — must be a valid EVM address (0x...)",
        );
      }
      if (!chainId) throw new Error("Chain is required for crypto destinations");
      const chain = CHAINS.find((c) => c.id === chainId);
      if (!chain) throw new Error(`Unknown chain: ${chainId}`);
    }

    if (destType === "stripe_card" || destType === "stripe_deposit") {
      if (!destAddress?.trim())
        throw new Error("Account identifier is required");
    }

    const id = crypto.randomUUID();
    const dest: PaymentDestination = {
      id,
      label: label.trim(),
      destType,
      isDefault: store.size === 0,
      chainId: destType === "crypto" ? chainId : undefined,
      tokenSymbol: destType === "crypto" ? tokenSymbol : undefined,
      destAddress: destAddress?.trim(),
      createdAt: Date.now(),
    };

    store.set(id, dest);
    return dest;
  },
);

export const deleteDestination = createServerFn({ method: "POST" }).handler(
  async ({ data }: { data: { id: string } }): Promise<{ success: boolean }> => {
    const { id } = data;
    if (!id) throw new Error("ID required");

    const target = store.get(id);
    store.delete(id);

    // If the deleted destination was the default, assign default to the next one
    if (target?.isDefault && store.size > 0) {
      const first = store.values().next().value as PaymentDestination;
      if (first) first.isDefault = true;
    }

    return { success: true };
  },
);

export const setDefaultDestination = createServerFn({ method: "POST" }).handler(
  async ({
    data,
  }: {
    data: { id: string };
  }): Promise<PaymentDestination> => {
    const { id } = data;
    if (!id) throw new Error("ID required");

    const dest = store.get(id);
    if (!dest) throw new Error("Destination not found");

    // Unset all defaults
    for (const d of store.values()) {
      d.isDefault = false;
    }

    dest.isDefault = true;
    return dest;
  },
);
