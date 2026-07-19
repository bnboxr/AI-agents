import { createFileRoute } from '@tanstack/react-router'
import { createFileRoute } from "@tanstack/react-start";
import { executeToolCall, type ToolCall } from "~/lib/chat-tools";

// ── Types ─────────────────────────────────────────────────────────

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

interface ChatRequest {
  messages: ChatMessage[];
  chainId?: string;
}

// ── Keyword intent detection ──────────────────────────────────────

function detectTool(messages: ChatMessage[]): string | null {
  // Join the last user message (and optionally the one before for context)
  const combined = messages
    .filter((m) => m.role === "user")
    .slice(-2)
    .map((m) => m.content.toLowerCase())
    .join(" ");

  const patterns: [RegExp, string][] = [
    [/swap|trade|exchange/, "executeSwap"],
    [/portfolio|balance|worth.*total|total.*worth/, "getPortfolioValue"],
    [/scan|opportunit|find|search.*yield|yield.*search/, "scanOpportunities"],
    [/agent|astra|neuron|vortex|spectra|nova|zenith|frost|phantom|oracle|prism/, "getAgentStatus"],
    [/price|worth|token.*price|how much|cost/, "getTokenPrice"],
    [/status|chain|network|block.*height|gas.*price/, "getChainStatus"],
  ];

  for (const [regex, tool] of patterns) {
    if (regex.test(combined)) return tool;
  }

  // Fallback: if no keyword matches, default to getAgentStatus as a helpful overview
  return "getAgentStatus";
}

function getToolArgs(toolName: string, messages: ChatMessage[]): Record<string, unknown> {
  const lastUser = messages
    .filter((m) => m.role === "user")
    .slice(-1)[0]
    ?.content.toLowerCase() || "";

  const args: Record<string, unknown> = {};

  if (toolName === "getTokenPrice") {
    // Try to extract specific tokens
    const tokenMap: Record<string, string> = {
      bitcoin: "bitcoin", btc: "bitcoin",
      ethereum: "ethereum", eth: "ethereum",
      solana: "solana", sol: "solana",
      bnb: "binancecoin", binance: "binancecoin",
      matic: "matic-network", polygon: "matic-network",
      avalanche: "avalanche-2", avax: "avalanche-2",
      near: "near", aptos: "aptos", apt: "aptos",
      sui: "sui", tron: "tron", trx: "tron",
    };
    const found: string[] = [];
    for (const [keyword, id] of Object.entries(tokenMap)) {
      if (lastUser.includes(keyword)) found.push(id);
    }
    if (found.length > 0) args.tokens = [...new Set(found)].join(",");
  }

  if (toolName === "scanOpportunities") {
    const chainIds = [
      "ethereum", "solana", "bnb", "polygon", "avalanche",
      "arbitrum", "optimism", "base", "near", "aptos", "sui",
    ];
    for (const cid of chainIds) {
      if (lastUser.includes(cid)) {
        args.chainId = cid === "bnb" ? "bnb" : cid;
        break;
      }
    }
  }

  if (toolName === "executeSwap") {
    // Extract token names and amount
    const amountMatch = lastUser.match(/([0-9.]+)\s*(eth|btc|sol|usdc|usdt|matic|avax|bnb|near|apt|sui)/i);
    if (amountMatch) {
      args.amount = parseFloat(amountMatch[1]);
      args.fromToken = amountMatch[2].toUpperCase();
    }
    // Find "to" token — look for "for X" or "to X" pattern
    const toMatch = lastUser.match(/(?:for|to|into)\s+([a-z]{2,6})\b/i);
    if (toMatch) args.toToken = toMatch[1].toUpperCase();
    // Defaults
    if (!args.amount) args.amount = 1;
    if (!args.fromToken) args.fromToken = "ETH";
    if (!args.toToken) args.toToken = "USDC";
  }

  return args;
}

// ── SSE Helpers ───────────────────────────────────────────────────

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function tokenChunk(text: string): string {
  return `event: token\ndata: ${JSON.stringify({ text })}\n\n`;
}

// ── Response text generation ──────────────────────────────────────

function formatChainStatus(result: unknown): string {
  const statuses = result as Array<{
    name: string; online: boolean; blockHeight: number | null;
    gasPrice: number | null; latency: number | null;
  }>;
  if (!Array.isArray(statuses)) return "No chain status data available.";

  const online = statuses.filter((s) => s.online);
  const offline = statuses.filter((s) => !s.online);

  const lines: string[] = [`**🌐 Network Status:** ${online.length} online, ${offline.length} offline out of ${statuses.length} chains.\n`];

  for (const s of online.slice(0, 5)) {
    lines.push(`• **${s.name}**: ✅ Online — Block ${s.blockHeight?.toLocaleString() ?? "N/A"}${s.gasPrice ? `, ${s.gasPrice} gwei` : ""} (${s.latency}ms)`);
  }
  if (online.length > 5) lines.push(`  …and ${online.length - 5} more online`);
  if (offline.length > 0) {
    lines.push("");
    for (const s of offline) {
      lines.push(`• **${s.name}**: ❌ Offline`);
    }
  }
  return lines.join("\n");
}

function formatTokenPrice(result: unknown): string {
  const prices = result as Record<string, { usd: number; change24h: number } | null>;
  if (!prices || Object.keys(prices).length === 0) return "No price data available.";

  const lines: string[] = ["**💰 Current Prices:**\n"];
  const entries = Object.entries(prices).filter(([, v]) => v !== null) as [string, { usd: number; change24h: number }][];
  for (const [id, p] of entries) {
    const change = p.change24h >= 0 ? "📈" : "📉";
    lines.push(`• **${id}**: $${p.usd.toLocaleString()} ${change} ${p.change24h.toFixed(2)}%`);
  }
  return lines.join("\n");
}

function formatScanResults(result: unknown): string {
  const results = result as Array<{
    chainId: string; opportunities: Array<{
      type: string; description: string; estimatedProfit: number; confidence: string;
    }>;
  }>;
  if (!Array.isArray(results)) return "No scan data available.";

  const totalOpps = results.reduce((sum, r) => sum + r.opportunities.length, 0);
  const lines: string[] = [`**🔍 Agent Scan Results:** ${totalOpps} opportunities found across ${results.length} chains.\n`];

  const withOpps = results.filter((r) => r.opportunities.length > 0);
  if (withOpps.length === 0) {
    lines.push("No opportunities detected at this time. Markets are stable.");
    return lines.join("\n");
  }

  for (const r of withOpps.slice(0, 5)) {
    lines.push(`\n**${r.chainId}** (${r.opportunities.length} opps):`);
    for (const o of r.opportunities.slice(0, 3)) {
      const confIcon = o.confidence === "high" ? "🟢" : o.confidence === "medium" ? "🟡" : "🔴";
      lines.push(`  ${confIcon} *${o.type}*: ${o.description} — ~${o.estimatedProfit.toFixed(1)}%`);
    }
  }
  return lines.join("\n");
}

function formatAgentStatus(result: unknown): string {
  const statuses = result as Array<{
    agentName: string; icon: string; status: string; lastAction: string;
    profitGenerated: number; transactions: number;
  }>;
  if (!Array.isArray(statuses)) return "No agent status data available.";

  const active = statuses.filter((s) => s.status === "active" || s.status === "scanning");
  const lines: string[] = [`**🤖 Agent Status:** ${active.length}/${statuses.length} agents active.\n`];

  for (const s of statuses.slice(0, 7)) {
    const statusIcon = s.status === "active" ? "🟢" : s.status === "scanning" ? "🔵" : s.status === "idle" ? "🟡" : "🔴";
    lines.push(`• ${s.icon} **${s.agentName}**: ${statusIcon} ${s.status} — ${s.lastAction}`);
  }
  if (statuses.length > 7) lines.push(`  …and ${statuses.length - 7} more agents`);

  const totalProfit = statuses.reduce((s, a) => s + a.profitGenerated, 0);
  const totalTx = statuses.reduce((s, a) => s + a.transactions, 0);
  lines.push(`\n📊 Total profit: $${totalProfit.toFixed(2)} | Transactions: ${totalTx}`);

  return lines.join("\n");
}

function formatPortfolioValue(result: unknown): string {
  const data = result as {
    totalEstimatedValue: number; agentProfitTotal: number;
    estimatedHoldingsValue: number; activeAgents: number; totalAgents: number;
  };
  if (!data) return "No portfolio data available.";

  return [
    "**💼 Portfolio Summary:**\n",
    `• **Total Estimated Value:** $${data.totalEstimatedValue.toLocaleString()}`,
    `• Agent-Generated Profit: $${data.agentProfitTotal.toLocaleString()}`,
    `• Estimated Holdings: $${data.estimatedHoldingsValue.toLocaleString()}`,
    `• Active Agents: ${data.activeAgents}/${data.totalAgents}`,
  ].join("\n");
}

function formatSwapQuote(result: unknown): string {
  const data = result as {
    error?: string; fromToken: string; toToken: string; amount: number;
    estimatedOutput: number; effectiveRate: number; usdValue: number; note?: string;
  };
  if (!data) return "No swap quote available.";
  if (data.error) return `⚠ ${data.error}`;

  return [
    "**🔄 Simulated Swap Quote:**\n",
    `• ${data.amount} ${data.fromToken} → ${data.estimatedOutput} ${data.toToken}`,
    `• Rate: 1 ${data.fromToken} = ${data.effectiveRate} ${data.toToken}`,
    `• USD Value: $${data.usdValue.toLocaleString()}`,
    `• Fee: 0.5% | Est. Slippage: ~0.3%`,
    "",
    data.note ?? "⚠ This is a read-only simulation. No real transaction.",
  ].join("\n");
}

function formatToolResult(toolName: string, result: unknown): string {
  switch (toolName) {
    case "getChainStatus": return formatChainStatus(result);
    case "getTokenPrice": return formatTokenPrice(result);
    case "scanOpportunities": return formatScanResults(result);
    case "getAgentStatus": return formatAgentStatus(result);
    case "getPortfolioValue": return formatPortfolioValue(result);
    case "executeSwap": return formatSwapQuote(result);
    default: return JSON.stringify(result);
  }
}

// ── SSE Stream Builder ────────────────────────────────────────────

async function buildSSEStream(body: ChatRequest): Promise<Response> {
  const { messages } = body;
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return new Response(JSON.stringify({ error: "Messages array required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const toolName = detectTool(messages);
  const args = getToolArgs(toolName, messages);
  const toolCallId = `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const toolCall: ToolCall = {
    id: toolCallId,
    name: toolName,
    arguments: args,
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const enqueue = (data: string) => controller.enqueue(encoder.encode(data));

      try {
        enqueue(sseEvent("tool_call", { id: toolCall.id, name: toolCall.name, arguments: toolCall.arguments }));

        const toolResult = await executeToolCall(toolCall);

        enqueue(sseEvent("tool_result", { toolCallId: toolResult.toolCallId, result: toolResult.result }));

        const responseText = formatToolResult(toolCall.name, toolResult.result);

        const words = responseText.split(/(\s+)/);
        for (const word of words) {
          enqueue(tokenChunk(word));
          await new Promise((r) => setTimeout(r, 15));
        }

        enqueue(sseEvent("done", { toolCallId: toolCall.id }));
      } catch (err: any) {
        enqueue(sseEvent("error", { message: err.message || "Tool execution failed", toolCallId: toolCall.id }));
        enqueue(sseEvent("done", { toolCallId: toolCall.id, error: true }));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

// ── Route ─────────────────────────────────────────────────────────

export const Route = createFileRoute("/api/chat-stream")({
  loader: async ({ request }) => {
    if (request.method === "POST") {
      let body: ChatRequest;
      try {
        body = await request.json();
      } catch {
        return new Response(JSON.stringify({ error: "Invalid JSON" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }
      return buildSSEStream(body);
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  },
});
