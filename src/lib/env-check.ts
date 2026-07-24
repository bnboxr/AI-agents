const REQUIRED_VARS = [
  "DATABASE_URL",
  "OPENAI_API_KEY",
  "VITE_POS_CONTRACT_ADDRESS",
  "AUTONOMOUS_WALLET_SECRET",
];

const RECOMMENDED_VARS = [
  "BINANCE_API_KEY",
  "BINANCE_SECRET_KEY",
  "COINGECKO_API_KEY",
  "POLYGON_RPC_URL",
];

export interface EnvCheckResult {
  ok: boolean;
  missing: string[];
  warnings: string[];
}

export function validateEnv(): EnvCheckResult {
  const missing: string[] = [];
  const warnings: string[] = [];

  for (const v of REQUIRED_VARS) {
    if (!process.env[v]) {
      missing.push(v);
    }
  }

  for (const v of RECOMMENDED_VARS) {
    if (!process.env[v]) {
      warnings.push(v);
    }
  }

  return {
    ok: missing.length === 0,
    missing,
    warnings,
  };
}
