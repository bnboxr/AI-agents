export interface ChainConfig {
  id: string;
  name: string;
  rpc: string;
  chainId?: number;
  nativeToken: string;
  explorer: string;
  type: 'evm' | 'solana' | 'near' | 'aptos' | 'sui' | 'tron';
  icon?: string;
}

export const CHAINS: ChainConfig[] = [
  { id: 'ethereum', name: 'Ethereum', rpc: 'https://eth.drpc.org', chainId: 1, nativeToken: 'ETH', explorer: 'https://etherscan.io', type: 'evm' },
  { id: 'bnb', name: 'BNB Chain', rpc: 'https://bsc-dataseed1.binance.org', chainId: 56, nativeToken: 'BNB', explorer: 'https://bscscan.com', type: 'evm' },
  { id: 'polygon', name: 'Polygon', rpc: 'https://polygon-rpc.com', chainId: 137, nativeToken: 'MATIC', explorer: 'https://polygonscan.com', type: 'evm' },
  { id: 'arbitrum', name: 'Arbitrum', rpc: 'https://arb1.arbitrum.io/rpc', chainId: 42161, nativeToken: 'ETH', explorer: 'https://arbiscan.io', type: 'evm' },
  { id: 'optimism', name: 'Optimism', rpc: 'https://mainnet.optimism.io', chainId: 10, nativeToken: 'ETH', explorer: 'https://optimistic.etherscan.io', type: 'evm' },
  { id: 'base', name: 'Base', rpc: 'https://mainnet.base.org', chainId: 8453, nativeToken: 'ETH', explorer: 'https://basescan.org', type: 'evm' },
  { id: 'avalanche', name: 'Avalanche', rpc: 'https://api.avax.network/ext/bc/C/rpc', chainId: 43114, nativeToken: 'AVAX', explorer: 'https://snowtrace.io', type: 'evm' },
  { id: 'fantom', name: 'Fantom', rpc: 'https://fantom.drpc.org', chainId: 250, nativeToken: 'FTM', explorer: 'https://ftmscan.com', type: 'evm' },
  { id: 'gnosis', name: 'Gnosis', rpc: 'https://rpc.gnosischain.com', chainId: 100, nativeToken: 'XDAI', explorer: 'https://gnosisscan.io', type: 'evm' },
  { id: 'zksync', name: 'zkSync Era', rpc: 'https://mainnet.era.zksync.io', chainId: 324, nativeToken: 'ETH', explorer: 'https://explorer.zksync.io', type: 'evm' },
  { id: 'linea', name: 'Linea', rpc: 'https://rpc.linea.build', chainId: 59144, nativeToken: 'ETH', explorer: 'https://lineascan.build', type: 'evm' },
  { id: 'scroll', name: 'Scroll', rpc: 'https://rpc.scroll.io', chainId: 534352, nativeToken: 'ETH', explorer: 'https://scrollscan.com', type: 'evm' },
  { id: 'mantle', name: 'Mantle', rpc: 'https://rpc.mantle.xyz', chainId: 5000, nativeToken: 'MNT', explorer: 'https://explorer.mantle.xyz', type: 'evm' },
  { id: 'celo', name: 'Celo', rpc: 'https://forno.celo.org', chainId: 42220, nativeToken: 'CELO', explorer: 'https://celoscan.io', type: 'evm' },
  { id: 'moonbeam', name: 'Moonbeam', rpc: 'https://rpc.api.moonbeam.network', chainId: 1284, nativeToken: 'GLMR', explorer: 'https://moonscan.io', type: 'evm' },
  { id: 'solana', name: 'Solana', rpc: 'https://api.mainnet-beta.solana.com', nativeToken: 'SOL', explorer: 'https://solscan.io', type: 'solana' },
  { id: 'near', name: 'NEAR', rpc: 'https://rpc.mainnet.near.org', nativeToken: 'NEAR', explorer: 'https://nearblocks.io', type: 'near' },
  { id: 'aptos', name: 'Aptos', rpc: 'https://fullnode.mainnet.aptoslabs.com/v1', nativeToken: 'APT', explorer: 'https://explorer.aptoslabs.com', type: 'aptos' },
  { id: 'sui', name: 'Sui', rpc: 'https://fullnode.mainnet.sui.io', nativeToken: 'SUI', explorer: 'https://suiscan.xyz', type: 'sui' },
  { id: 'tron', name: 'TRON', rpc: 'https://api.trongrid.io', nativeToken: 'TRX', explorer: 'https://tronscan.org', type: 'tron' },
];

export function getChain(id: string): ChainConfig | undefined {
  return CHAINS.find((c) => c.id === id);
}
