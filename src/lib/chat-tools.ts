import { getAllChainStatus, type ChainStatus } from "~/lib/blockchain";
import { getRobustMultiPrices, type MultiPriceResult } from "~/lib/price-feeds";
import {
  runAgentScan,
  runAllAgentScans,
  getAllAgentStatuses,
  getAgentState,
  type AgentStatus,
  type AgentScanResult,
} from "~/lib/agent-runner";
import { CHAINS } from "~/lib/chains";
import {
  listDestinations,
  addDestination,
  setDefaultDestination,
  type PaymentDestination,
  DEST_TYPE_LABELS,
  DEST_TYPE_ICONS,
} from "~/lib/payment-destinations";

// ── Types ──────────────────────────────────────────────────────────

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  result: unknown;
}

// ── Tool Definitions ──────────────────────────────────────────────

export const CHAT_TOOLS: ToolDefinition[] = [
  {
    name: "getChainStatus",
    description:
      "Get the current status of all supported blockchain networks including block height, gas price, latency, and online/offline status.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "getTokenPrice",
    description:
      "Get current USD prices and 24h change for major cryptocurrencies. Optionally filter by comma-separated token IDs (e.g., 'bitcoin,ethereum,solana').",
    parameters: {
      type: "object",
      properties: {
        tokens: {
          type: "string",
          description:
            "Comma-separated list of CoinGecko IDs (bitcoin,ethereum,binancecoin,matic-network,avalanche-2,solana,near,aptos,sui,tron). Leave empty for all.",
        },
      },
      required: [],
    },
  },
  {
    name: "scanOpportunities",
    description:
      "Run agent scans across all blockchain networks to find staking opportunities, price anomalies, and arbitrage openings. Optionally target a specific chain.",
    parameters: {
      type: "object",
      properties: {
        chainId: {
          type: "string",
          description:
            "Optional specific chain ID to scan (e.g., 'ethereum', 'solana', 'bnb'). Leave empty to scan all chains.",
        },
      },
      required: [],
    },
  },
  {
    name: "getAgentStatus",
    description:
      "Get the current status of all AI agents (Astra, Neuron, Vortex, etc.) deployed across blockchain networks — their state, last action, profit generated, and strategies.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "getPortfolioValue",
    description:
      "Calculate the total estimated portfolio value by aggregating all agent profits and current token holdings across all supported chains.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "executeSwap",
    description:
      "Get a simulated quote for swapping tokens. This is read-only — it returns a price quote and estimated output. Specify the token pair and amount.",
    parameters: {
      type: "object",
      properties: {
        fromToken: {
          type: "string",
          description: "Source token symbol or CoinGecko ID (e.g., 'ETH', 'bitcoin', 'USDC')",
        },
        toToken: {
          type: "string",
          description: "Destination token symbol or CoinGecko ID (e.g., 'USDC', 'ethereum', 'SOL')",
        },
        amount: {
          type: "number",
          description: "Amount of the source token to swap",
        },
      },
      required: ["fromToken", "toToken", "amount"],
    },
  },
  {
    name: "configurePaymentDestination",
    description:
      "Manage payment destinations for receiving earnings and payouts. List configured destinations, add a new crypto wallet or Stripe destination, or set a default. Use 'list' to see current destinations, 'add' to create a new one, or 'set_default' to change which one receives payments.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "Action to perform: 'list', 'add', or 'set_default'",
        },
        destType: {
          type: "string",
          description: "For 'add' action: type of destination — 'crypto', 'stripe_card', or 'stripe_deposit'",
        },
        label: {
          type: "string",
          description: "For 'add' action: a friendly label for this destination (e.g., 'My ETH Wallet')",
        },
        chainId: {
          type: "string",
          description: "For 'add' action with crypto type: the chain ID (e.g., 'ethereum', 'solana', 'bnb')",
        },
        address: {
          type: "string",
          description: "For 'add' action: the wallet address or Stripe account identifier",
        },
      },
      required: ["action"],
    },
  },
];

// ── Tool Executor ─────────────────────────────────────────────────

export async function executeToolCall(toolCall: ToolCall): Promise<ToolResult> {
  const { name, arguments: args, id } = toolCall;

  switch (name) {
    case "getChainStatus": {
      const statuses: ChainStatus[] = await getAllChainStatus();
      return { toolCallId: id, result: statuses };
    }

    case "getTokenPrice": {
      const tokensStr = (args.tokens as string) || "";
      const defaultIds = [
        "bitcoin", "ethereum", "binancecoin", "matic-network",
        "avalanche-2", "solana", "near", "aptos", "sui", "tron",
      ];
      const ids = tokensStr
        ? tokensStr.split(",").map((s) => s.trim()).filter(Boolean)
        : defaultIds;
      const prices: MultiPriceResult = await getRobustMultiPrices(ids);
      return { toolCallId: id, result: prices };
    }

    case "scanOpportunities": {
      const chainId = args.chainId as string | undefined;
      let results: AgentScanResult[];
      if (chainId) {
        const single = await runAgentScan({ data: { chainId } });
        results = [single];
      } else {
        results = await runAllAgentScans();
      }
      return { toolCallId: id, result: results };
    }

    case "getAgentStatus": {
      const statuses: AgentStatus[] = await getAllAgentStatuses();
      return { toolCallId: id, result: statuses };
    }

    case "getPortfolioValue": {
      // Aggregate agent states + check native token prices
      const statuses: AgentStatus[] = await getAllAgentStatuses();
      const totalAgentProfit = statuses.reduce((sum, s) => sum + s.profitGenerated, 0);

      // Get prices for major native tokens
      const nativeIds = CHAINS.map((c) => {
        const t = c.nativeToken.toLowerCase();
        const map: Record<string, string> = {
          eth: "ethereum", bnb: "binancecoin", matic: "matic-network",
          avax: "avalanche-2", ftm: "fantom", sol: "solana",
          near: "near", apt: "aptos", sui: "sui", trx: "tron",
        };
        return map[t] || t;
      });
      const uniqueIds = [...new Set(nativeIds)];
      const prices: MultiPriceResult = await getRobustMultiPrices(uniqueIds);

      // Estimate portfolio: agent profit + 1 unit of each native token where price available
      const chainHoldings: { chain: string; token: string; price: number | null }[] = [];
      let estimatedHoldingsValue = 0;
      for (const chain of CHAINS) {
        const mapped = (() => {
          const t = chain.nativeToken.toLowerCase();
          const map: Record<string, string> = {
            eth: "ethereum", bnb: "binancecoin", matic: "matic-network",
            avax: "avalanche-2", ftm: "fantom", sol: "solana",
            near: "near", apt: "aptos", sui: "sui", trx: "tron",
          };
          return map[t] || t;
        })();
        const price = prices[mapped]?.usd ?? null;
        chainHoldings.push({ chain: chain.name, token: chain.nativeToken, price });
        if (price) estimatedHoldingsValue += price; // assume 1 unit per chain for demo
      }

      const result = {
        totalEstimatedValue: Math.round((totalAgentProfit + estimatedHoldingsValue) * 100) / 100,
        agentProfitTotal: Math.round(totalAgentProfit * 100) / 100,
        estimatedHoldingsValue: Math.round(estimatedHoldingsValue * 100) / 100,
        activeAgents: statuses.filter((s) => s.status === "active" || s.status === "scanning").length,
        totalAgents: statuses.length,
        chainHoldings,
      };
      return { toolCallId: id, result };
    }

    case "executeSwap": {
      const fromToken = (args.fromToken as string) || "";
      const toToken = (args.toToken as string) || "";
      const amount = Number(args.amount) || 1;

      // Map common symbols to CoinGecko IDs
      const symbolMap: Record<string, string> = {
        eth: "ethereum", weth: "ethereum", btc: "bitcoin", wbtc: "wrapped-bitcoin",
        usdc: "usd-coin", usdt: "tether", dai: "dai", matic: "matic-network",
        sol: "solana", avax: "avalanche-2", bnb: "binancecoin", near: "near",
        apt: "aptos", sui: "sui", trx: "tron", dot: "polkadot",
      };

      const fromId = symbolMap[fromToken.toLowerCase()] || fromToken.toLowerCase();
      const toId = symbolMap[toToken.toLowerCase()] || toToken.toLowerCase();

      const prices: MultiPriceResult = await getRobustMultiPrices([fromId, toId]);
      const fromPrice = prices[fromId]?.usd ?? null;
      const toPrice = prices[toId]?.usd ?? null;

      if (!fromPrice || !toPrice) {
        return {
          toolCallId: id,
          result: {
            error: `Could not fetch price for ${!fromPrice ? fromToken : toToken}. Try different tokens.`,
            fromToken,
            toToken,
            amount,
          },
        };
      }

      const fromValueUSD = amount * fromPrice;
      // Simulate 0.5% fee + small slippage
      const afterFee = fromValueUSD * 0.995;
      const estimatedOutput = afterFee / toPrice;
      const effectiveRate = amount > 0 ? estimatedOutput / amount : 0;

      const result = {
        fromToken,
        toToken,
        amount,
        fromPriceUSD: fromPrice,
        toPriceUSD: toPrice,
        estimatedOutput: Math.round(estimatedOutput * 1000000) / 1000000,
        effectiveRate: Math.round(effectiveRate * 1000000) / 1000000,
        fee: "0.5%",
        slippage: "~0.3%",
        usdValue: Math.round(fromValueUSD * 100) / 100,
        note: "⚠ This is a simulated read-only quote. No real transaction is executed.",
      };
      return { toolCallId: id, result };
    }

    case "configurePaymentDestination": {
      const action = (args.action as string) || "list";
      if (action === "list") {
        const destinations: PaymentDestination[] = await listDestinations();
        return { toolCallId: id, result: { action: "list", destinations } };
      }
      if (action === "add") {
        const destType = (args.destType as string) || "crypto";
        const label = (args.label as string) || "Payment Destination";
        const chainId = args.chainId as string | undefined;
        const destAddress = args.address as string | undefined;
        if (destType !== "crypto" && destType !== "stripe_card" && destType !== "stripe_deposit") {
          return { toolCallId: id, result: { error: `Invalid destType: ${destType}. Must be 'crypto', 'stripe_card', or 'stripe_deposit'.` } };
        }
        try {
          const dest = await addDestination({
            data: { label, destType: destType as "crypto" | "stripe_card" | "stripe_deposit", chainId, destAddress },
          });
          return { toolCallId: id, result: { action: "add", destination: dest } };
        } catch (err: unknown) {
          return { toolCallId: id, result: { error: (err as Error).message } };
        }
      }
      if (action === "set_default") {
        const addr = args.address as string;
        if (!addr) {
          return { toolCallId: id, result: { error: "Provide the destination ID or address to set as default." } };
        }
        const all = await listDestinations();
        const match = all.find(
          (d) => d.id === addr || d.destAddress === addr,
        );
        if (!match) {
          return { toolCallId: id, result: { error: `No destination found matching "${addr}".` } };
        }
        const updated = await setDefaultDestination({ data: { id: match.id } });
        return { toolCallId: id, result: { action: "set_default", destination: updated } };
      }
      return { toolCallId: id, result: { error: `Unknown action: ${action}. Use 'list', 'add', or 'set_default'.` } };
    }

    default:
      return {
        toolCallId: id,
        result: { error: `Unknown tool: ${name}` },
      };
  }
}
