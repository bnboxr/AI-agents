export interface AgentConfig {
  name: string;
  role: string;
  strategies: string[];
  description: string;
  icon: string;
}

export const AGENTS: Record<string, AgentConfig> = {
  ethereum: {
    name: 'Astra',
    role: 'Arbitrage Executor',
    strategies: ['flash-loan-arbitrage', 'yield-optimizer', 'mev-detection'],
    description: 'Monitorizează Uniswap V3, AAVE și Curve pentru oportunități de arbitraj și yield farming pe Ethereum.',
    icon: '🔷',
  },
  bnb: {
    name: 'Neuron',
    role: 'Yield Strategist',
    strategies: ['yield-farming', 'pancake-arbitrage', 'venus-lending'],
    description: 'Optimizează yield-ul pe PancakeSwap și Venus Protocol, execută arbitraj între DEX-uri BNB Chain.',
    icon: '🟡',
  },
  polygon: {
    name: 'Vortex',
    role: 'Cross-Chain Scout',
    strategies: ['cross-chain-arbitrage', 'quickswap-trading', 'aave-polygon'],
    description: 'Scanează diferențe de preț între Polygon și Ethereum, execută swap-uri pe QuickSwap.',
    icon: '🟣',
  },
  arbitrum: {
    name: 'Spectra',
    role: 'L2 Arbitrage Specialist',
    strategies: ['arbitrum-arbitrage', 'gmx-trading', 'camelot-yield'],
    description: 'Profită de oportunitățile de arbitraj între Arbitrum și L1, trading pe GMX și Camelot.',
    icon: '🔵',
  },
  optimism: {
    name: 'Nova',
    role: 'Optimistic Rollup Scout',
    strategies: ['optimism-arbitrage', 'velodrome-yield', 'synthetix-trading'],
    description: 'Scanează Velodrome și Synthetix pe Optimism pentru yield și oportunități de trading.',
    icon: '🔴',
  },
  base: {
    name: 'Zenith',
    role: 'Base Chain Specialist',
    strategies: ['base-arbitrage', 'aerodrome-yield', 'morpho-lending'],
    description: 'Monitorizează Aerodrome și Morpho pe Base pentru yield maximizat și swap-uri eficiente.',
    icon: '🔘',
  },
  avalanche: {
    name: 'Frost',
    role: 'Avalanche DeFi Scout',
    strategies: ['trader-joe-arbitrage', 'aave-avalanche', 'pangolin-yield'],
    description: 'Execută strategii pe Trader Joe, AAVE Avalanche și Pangolin pentru randamente optime.',
    icon: '❄️',
  },
  fantom: {
    name: 'Phantom',
    role: 'Fantom Yield Hunter',
    strategies: ['spookyswap-yield', 'geist-lending', 'beethoven-x'],
    description: 'Vânează yield pe SpookySwap, Geist Finance și Beethoven X pe Fantom.',
    icon: '👻',
  },
  gnosis: {
    name: 'Oracle',
    role: 'Gnosis Chain Monitor',
    strategies: ['honeyswap-arbitrage', 'agave-lending', 'bridge-monitor'],
    description: 'Monitorizează HoneySwap și Agave pe Gnosis Chain, verifică oportunități de bridging.',
    icon: '🦉',
  },
  zksync: {
    name: 'Prism',
    role: 'zkSync Era Scout',
    strategies: ['syncswap-arbitrage', 'mute-yield', 'zksync-bridge'],
    description: 'Identifică oportunități pe SyncSwap și Mute pe zkSync Era, arbitraj L1↔L2.',
    icon: '💎',
  },
  linea: {
    name: 'Vector',
    role: 'Linea Chain Specialist',
    strategies: ['linea-arbitrage', 'syncswap-linea', 'mendi-lending'],
    description: 'Scanează DEX-uri pe Linea pentru swap-uri eficiente și yield lending.',
    icon: '📐',
  },
  scroll: {
    name: 'Echo',
    role: 'Scroll zkEVM Scout',
    strategies: ['scroll-arbitrage', 'skydrome-yield', 'scroll-bridge'],
    description: 'Monitorizează DEX-urile de pe Scroll pentru arbitraj și optimizare yield.',
    icon: '📜',
  },
  mantle: {
    name: 'Ignis',
    role: 'Mantle Network Agent',
    strategies: ['mantle-arbitrage', 'lendle-yield', 'agni-fi'],
    description: 'Execută pe Agni Finance și Lendle pe Mantle pentru swap-uri și lending.',
    icon: '🔥',
  },
  celo: {
    name: 'Aura',
    role: 'Celo Chain Monitor',
    strategies: ['ubeswap-arbitrage', 'moola-lending', 'celo-bridge'],
    description: 'Scanează Ubeswap și Moola Market pe Celo pentru oportunități de yield.',
    icon: '🌿',
  },
  moonbeam: {
    name: 'Lunar',
    role: 'Moonbeam DeFi Agent',
    strategies: ['stellaswap-arbitrage', 'moonwell-lending', 'beamswap-yield'],
    description: 'Operează pe StellaSwap și Moonwell pe Moonbeam pentru randamente cross-chain.',
    icon: '🌙',
  },
  solana: {
    name: 'Neon',
    role: 'Solana Speed Trader',
    strategies: ['jupiter-arbitrage', 'raydium-yield', 'mango-markets'],
    description: 'Profită de viteza Solana pentru arbitraj pe Jupiter, yield pe Raydium și trading pe Mango Markets.',
    icon: '🟢',
  },
  near: {
    name: 'Atmos',
    role: 'NEAR Protocol Scout',
    strategies: ['ref-finance-arbitrage', 'burrow-lending', 'near-bridge'],
    description: 'Monitorizează Ref Finance și Burrow pe NEAR pentru yield și arbitraj.',
    icon: '🌐',
  },
  aptos: {
    name: 'Helix',
    role: 'Aptos Move Specialist',
    strategies: ['pancake-aptos-arbitrage', 'thala-yield', 'liquidswap'],
    description: 'Operează pe PancakeSwap Aptos, Thala și Liquidswap pentru oportunități DeFi.',
    icon: '🧬',
  },
  sui: {
    name: 'Drift',
    role: 'Sui Move Agent',
    strategies: ['cetus-arbitrage', 'navi-lending', 'turbos-yield'],
    description: 'Execută pe Cetus, NAVI Protocol și Turbos pe Sui pentru yield și swap-uri.',
    icon: '💧',
  },
  tron: {
    name: 'Nexus',
    role: 'TRON Network Agent',
    strategies: ['sunswap-arbitrage', 'justlend-yield', 'tron-bridge'],
    description: 'Monitorizează SUNSwap și JustLend pe TRON pentru oportunități DeFi.',
    icon: '⚡',
  },
  xrp: {
    name: 'Ripple',
    role: 'XRP Ledger Monitor',
    strategies: ['xrp-dex-arbitrage', 'xrpl-lending', 'xrp-bridge'],
    description: 'Monitorizează XRP Ledger DEX și AMM-uri pentru oportunități de arbitraj și lichiditate.',
    icon: '🌊',
  },
  cosmos: {
    name: 'Cosmos',
    role: 'Cosmos Hub Agent',
    strategies: ['cosmos-staking', 'osmosis-arbitrage', 'ibc-bridge'],
    description: 'Optimizează staking-ul pe Cosmos Hub și arbitrajul între chain-uri IBC via Osmosis.',
    icon: '⚛️',
  },
};

export function getAgent(chainId: string): AgentConfig | undefined {
  return AGENTS[chainId];
}

// CoinGecko IDs for native tokens of each chain
export const COINGECKO_IDS: Record<string, string> = {
  ethereum: 'ethereum',
  bnb: 'binancecoin',
  polygon: 'matic-network',
  arbitrum: 'ethereum', // uses ETH
  optimism: 'ethereum',
  base: 'ethereum',
  avalanche: 'avalanche-2',
  fantom: 'fantom',
  gnosis: 'gnosis',
  zksync: 'ethereum',
  linea: 'ethereum',
  scroll: 'ethereum',
  mantle: 'mantle',
  celo: 'celo',
  moonbeam: 'moonbeam',
  solana: 'solana',
  near: 'near',
  aptos: 'aptos',
  sui: 'sui',
  tron: 'tron',
  xrp: 'ripple',
  cosmos: 'cosmos',
};

// Unique native token CoinGecko IDs for chart display (deduplicate ETH)
export const UNIQUE_NATIVE_IDS = [...new Set(Object.values(COINGECKO_IDS))];
