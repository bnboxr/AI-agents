import { createFileRoute, getRequest } from "@tanstack/react-start";
import { executeToolCall, type ToolCall } from "~/lib/chat-tools";

// ── Types ─────────────────────────────────────────────────────────

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

// ── Keyword intent detection ──────────────────────────────────────

function detectTool(messages: ChatMessage[]): string {
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
  return "getAgentStatus";
}

function getToolArgs(toolName: string, messages: ChatMessage[]): Record<string, unknown> {
  const lastUser = messages
    .filter((m) => m.role === "user")
    .slice(-1)[0]
    ?.content.toLowerCase() || "";

  const args: Record<string, unknown> = {};

  if (toolName === "getTokenPrice") {
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
    const chainIds = ["ethereum", "solana", "bnb", "polygon", "avalanche", "arbitrum", "optimism", "base"];
    for (const cid of chainIds) {
      if (lastUser.includes(cid)) { args.chainId = cid; break; }
    }
  }

  if (toolName === "executeSwap") {
    const amountMatch = lastUser.match(/([0-9.]+)\s*(eth|btc|sol|usdc|usdt|matic|avax|bnb)/i);
    if (amountMatch) {
      args.amount = parseFloat(amountMatch[1]);
      args.fromToken = amountMatch[2].toUpperCase();
    }
    const toMatch = lastUser.match(/(?:for|to|into)\s+([a-z]{2,6})\b/i);
    if (toMatch) args.toToken = toMatch[1].toUpperCase();
    if (!args.amount) args.amount = 1;
    if (!args.fromToken) args.fromToken = "ETH";
    if (!args.toToken) args.toToken = "USDC";
  }

  return args;
}

// ── Response text formatting ─────────────────────────────────────

function formatChainStatus(result: unknown): string {
  const statuses = result as Array<{ name: string; online: boolean; blockHeight: number | null; gasPrice: number | null; latency: number | null }>;
  if (!Array.isArray(statuses)) return "No chain status data available.";
  const online = statuses.filter(s => s.online);
  const offline = statuses.filter(s => !s.online);
  const lines = [`**🌐 Network Status:** ${online.length} online, ${offline.length} offline out of ${statuses.length} chains.\n`];
  for (const s of online.slice(0, 5))
    lines.push(`• **${s.name}**: ✅ Online — Block ${s.blockHeight?.toLocaleString() ?? "N/A"}${s.gasPrice ? `, ${s.gasPrice} gwei` : ""} (${s.latency}ms)`);
  if (online.length > 5) lines.push(`  …and ${online.length - 5} more online`);
  if (offline.length > 0) { lines.push(""); for (const s of offline) lines.push(`• **${s.name}**: ❌ Offline`); }
  return lines.join("\n");
}

function formatTokenPrice(result: unknown): string {
  const prices = result as Record<string, { usd: number; change24h: number } | null>;
  if (!prices || Object.keys(prices).length === 0) return "No price data available.";
  const lines = ["**💰 Current Prices:**\n"];
  const entries = Object.entries(prices).filter(([, v]) => v !== null) as [string, { usd: number; change24h: number }][];
  for (const [id, p] of entries)
    lines.push(`• **${id}**: $${p.usd.toLocaleString()} ${p.change24h >= 0 ? "📈" : "📉"} ${p.change24h.toFixed(2)}%`);
  return lines.join("\n");
}

function formatScanResults(result: unknown): string {
  const results = result as Array<{ chainId: string; opportunities: Array<{ type: string; description: string; estimatedProfit: number; confidence: string }> }>;
  if (!Array.isArray(results)) return "No scan data available.";
  const totalOpps = results.reduce((s, r) => s + r.opportunities.length, 0);
  const lines = [`**🔍 Agent Scan Results:** ${totalOpps} opportunities found across ${results.length} chains.\n`];
  const withOpps = results.filter(r => r.opportunities.length > 0);
  if (withOpps.length === 0) { lines.push("No opportunities detected at this time."); return lines.join("\n"); }
  for (const r of withOpps.slice(0, 5)) {
    lines.push(`\n**${r.chainId}** (${r.opportunities.length} opps):`);
    for (const o of r.opportunities.slice(0, 3))
      lines.push(`  ${o.confidence === "high" ? "🟢" : o.confidence === "medium" ? "🟡" : "🔴"} *${o.type}*: ${o.description}`);
  }
  return lines.join("\n");
}

function formatAgentStatus(result: unknown): string {
  const statuses = result as Array<{ agentName: string; icon: string; status: string; lastAction: string; profitGenerated: number; transactions: number }>;
  if (!Array.isArray(statuses)) return "No agent status data available.";
  const active = statuses.filter(s => s.status === "active" || s.status === "scanning");
  const lines = [`**🤖 Agent Status:** ${active.length}/${statuses.length} agents active.\n`];
  for (const s of statuses.slice(0, 7))
    lines.push(`• ${s.icon} **${s.agentName}**: ${s.status === "active" ? "🟢" : s.status === "scanning" ? "🔵" : s.status === "idle" ? "🟡" : "🔴"} ${s.status} — ${s.lastAction}`);
  if (statuses.length > 7) lines.push(`  …and ${statuses.length - 7} more`);
  const tp = statuses.reduce((s, a) => s + a.profitGenerated, 0);
  const tt = statuses.reduce((s, a) => s + a.transactions, 0);
  lines.push(`\n📊 Total profit: $${tp.toFixed(2)} | Transactions: ${tt}`);
  return lines.join("\n");
}

function formatPortfolioValue(result: unknown): string {
  const data = result as { totalEstimatedValue: number; agentProfitTotal: number; estimatedHoldingsValue: number; activeAgents: number; totalAgents: number };
  if (!data) return "No portfolio data.";
  return [
    "**💼 Portfolio Summary:**\n",
    `• **Total Estimated Value:** $${data.totalEstimatedValue.toLocaleString()}`,
    `• Agent Profit: $${data.agentProfitTotal.toLocaleString()}`,
    `• Estimated Holdings: $${data.estimatedHoldingsValue.toLocaleString()}`,
    `• Active Agents: ${data.activeAgents}/${data.totalAgents}`,
  ].join("\n");
}

function formatSwapQuote(result: unknown): string {
  const data = result as { error?: string; fromToken: string; toToken: string; amount: number; estimatedOutput: number; effectiveRate: number; usdValue: number; note?: string };
  if (!data) return "No swap quote available.";
  if (data.error) return `⚠ ${data.error}`;
  return [
    "**🔄 Simulated Swap Quote:**\n",
    `• ${data.amount} ${data.fromToken} → ${data.estimatedOutput} ${data.toToken}`,
    `• Rate: 1 ${data.fromToken} = ${data.effectiveRate} ${data.toToken}`,
    `• USD Value: $${data.usdValue.toLocaleString()}`,
    `• Fee: 0.5% | Est. Slippage: ~0.3%`,
    "",
    data.note ?? "⚠ Read-only simulation. No real transaction.",
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

async function buildSSEStream(messages: ChatMessage[]): Promise<Response> {
  const toolName = detectTool(messages);
  const args = getToolArgs(toolName, messages);
  const toolCallId = `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const toolCall: ToolCall = { id: toolCallId, name: toolName, arguments: args };

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const enqueue = (data: string) => controller.enqueue(encoder.encode(data));
      try {
        enqueue(`event: tool_call\ndata: ${JSON.stringify({ id: toolCall.id, name: toolCall.name, arguments: toolCall.arguments })}\n\n`);
        const toolResult = await executeToolCall(toolCall);
        enqueue(`event: tool_result\ndata: ${JSON.stringify({ toolCallId: toolResult.toolCallId, result: toolResult.result })}\n\n`);
        const responseText = formatToolResult(toolCall.name, toolResult.result);
        const words = responseText.split(/(\s+)/);
        for (const word of words) {
          enqueue(`event: token\ndata: ${JSON.stringify({ text: word })}\n\n`);
          await new Promise(r => setTimeout(r, 10));
        }
        enqueue(`event: done\ndata: ${JSON.stringify({ toolCallId: toolCall.id })}\n\n`);
      } catch (err: any) {
        enqueue(`event: error\ndata: ${JSON.stringify({ message: err.message || "Tool execution failed", toolCallId: toolCall.id })}\n\n`);
        enqueue(`event: done\ndata: ${JSON.stringify({ toolCallId: toolCall.id, error: true })}\n\n`);
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
  loader: async () => {
    const request = getRequest();
    if (!request || request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json" },
      });
    }

    let body: { messages: ChatMessage[] };
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { messages } = body;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: "Messages array required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    return buildSSEStream(messages);
  },
});
