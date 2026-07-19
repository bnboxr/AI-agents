// ── Airdrop Farming Types ──────────────────────────────────────────────

export type AirdropActionType = 'swap' | 'deposit' | 'borrow' | 'bridge';

export interface AirdropProtocol {
  id: string;
  name: string;
  category: string;
  chain: string;
  tvl: number;
  hasToken: boolean;
  audits: number;
  ageDays: number;
  score: number;
  change7d: number;
  slug: string;
  url: string;
}

export interface WalletChainState {
  chainId: string;
  nonce: number;
  balance: string;
  lastInteraction: number;
  totalGasSpent: string;
}

export interface AirdropWallet {
  index: number;
  address: string;
  privateKey: string;
  chains: Map<string, WalletChainState>;
}

export interface WalletPersona {
  preferredActionOrder: AirdropActionType[];
  skipProbability: number;
  actionCountRange: [number, number];
  timezoneOffset: number;
  dexPreference: 'v2' | 'v3';
  stablecoinPreference: string;
}

export interface AirdropInteraction {
  walletIndex: number;
  protocolId: string;
  actionType: AirdropActionType;
  txHash: string;
  amount: string;
  timestamp: number;
  status: 'pending' | 'confirmed' | 'failed';
  chainId: string;
}

export interface AirdropConfig {
  maxWallets: number;
  maxDailyGasUsd: number;
  maxDepositPerProtocolUsd: number;
  maxDepositPerWalletUsd: number;
  maxActiveProtocols: number;
  minProtocolTvlUsd: number;
  minProtocolAgeDays: number;
  minAuditCount: number;
  seedPhrase: string;
}

export interface AirdropState {
  protocols: AirdropProtocol[];
  wallets: AirdropWallet[];
  interactions: AirdropInteraction[];
  config: AirdropConfig;
  dailyGasSpent: number;
  lastDiscovery: number;
}

export const defaultAirdropConfig: AirdropConfig = {
  maxWallets: 25,
  maxDailyGasUsd: 50,
  maxDepositPerProtocolUsd: 200,
  maxDepositPerWalletUsd: 500,
  maxActiveProtocols: 15,
  minProtocolTvlUsd: 10_000_000,
  minProtocolAgeDays: 60,
  minAuditCount: 1,
  seedPhrase: '',
};
