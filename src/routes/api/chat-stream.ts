import { createServerFn } from "@tanstack/react-start";
import { executeToolCall, type ToolCall } from "~/lib/chat-tools";

// ── Types ─────────────────────────────────────────────────────────

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ChatStreamResponse {
  toolCall: { id: string; name: string; arguments: Record<string, unknown> };
  toolResult: unknown;
  responseText: string;
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
  const lastUser = messages.filter((m) => m.role === "user").slice(-1)[0]?.content.toLowerCase() || "";
  const args: Record<string, unknown> = {};

  if (toolName === "getTokenPrice") {
    const tokenMap: Record<string, string> = {
      bitcoin: "bitcoin", btc: "bitcoin", ethereum: "ethereum", eth: "ethereum",
      solana: "solana", sol: "solana", bnb: "binancecoin", binance: "binancecoin",
      matic: "matic-network", polygon: "matic-network", avalanche: "avalanche-2", avax: "avalanche-2",
      near: "near", aptos: "aptos", apt: "aptos", sui: "sui", tron: "tron", trx: "tron",
    };
    const found: string[] = [];
    for (const [kw, id] of Object.entries(tokenMap)) if (lastUser.includes(kw)) found.push(id);
    if (found.length > 0) args.tokens = [...new Set(found)].join(",");
  }
  if (toolName === "scanOpportunities") {
    for (const cid of ["ethereum", "solana", "bnb", "polygon", "avalanche", "arbitrum", "optimism", "base"])
      if (lastUser.includes(cid)) { args.chainId = cid; break; }
  }
  if (toolName === "executeSwap") {
    const m = lastUser.match(/([0-9.]+)\s*(eth|btc|sol|usdc|usdt|matic|avax|bnb)/i);
    if (m) { args.amount = parseFloat(m[1]); args.fromToken = m[2].toUpperCase(); }
    const tm = lastUser.match(/(?:for|to|into)\s+([a-z]{2,6})\b/i);
    if (tm) args.toToken = tm[1].toUpperCase();
    if (!args.amount) args.amount = 1;
    if (!args.fromToken) args.fromToken = "ETH";
    if (!args.toToken) args.toToken = "USDC";
  }
  return args;
}

// ── Formatting ────────────────────────────────────────────────────

function formatChainStatus(r: unknown): string {
  const s = r as Array<{ name: string; online: boolean; blockHeight: number | null; gasPrice: number | null; latency: number | null }>;
  if (!Array.isArray(s)) return "No data.";
  const on = s.filter(x => x.online), off = s.filter(x => !x.online);
  const l = [`**🌐 Network Status:** ${on.length} online, ${off.length} offline of ${s.length}.\n`];
  for (const c of on.slice(0, 5)) l.push(`• **${c.name}**: ✅ Online — Blk ${c.blockHeight?.toLocaleString() ?? "?"}${c.gasPrice ? `, ${c.gasPrice} gwei` : ""} (${c.latency}ms)`);
  if (on.length > 5) l.push(`  …+${on.length - 5} more`);
  if (off.length) { l.push(""); for (const c of off) l.push(`• **${c.name}**: ❌ Offline`); }
  return l.join("\n");
}

function formatTokenPrice(r: unknown): string {
  const p = r as Record<string, { usd: number; change24h: number } | null>;
  const l = ["**💰 Current Prices:**\n"];
  for (const [id, v] of Object.entries(p).filter(([,v]) => v) as [string, {usd:number;change24h:number}][])
    l.push(`• **${id}**: $${v.usd.toLocaleString()} ${v.change24h>=0?"📈":"📉"} ${v.change24h.toFixed(2)}%`);
  return l.join("\n");
}

function formatScanResults(r: unknown): string {
  const results = r as Array<{ chainId: string; opportunities: Array<{ type: string; description: string; estimatedProfit: number; confidence: string }> }>;
  if (!Array.isArray(results)) return "No scan data.";
  const total = results.reduce((s,r) => s + r.opportunities.length, 0);
  const l = [`**🔍 Scan:** ${total} opps across ${results.length} chains.\n`];
  const wo = results.filter(r => r.opportunities.length);
  if (!wo.length) { l.push("No opportunities detected."); return l.join("\n"); }
  for (const r of wo.slice(0,5)) {
    l.push(`\n**${r.chainId}** (${r.opportunities.length}):`);
    for (const o of r.opportunities.slice(0,3))
      l.push(`  ${o.confidence==="high"?"🟢":o.confidence==="medium"?"🟡":"🔴"} *${o.type}*: ${o.description}`);
  }
  return l.join("\n");
}

function formatAgentStatus(r: unknown): string {
  const s = r as Array<{ agentName: string; icon: string; status: string; lastAction: string; profitGenerated: number; transactions: number }>;
  if (!Array.isArray(s)) return "No agents.";
  const active = s.filter(x => x.status==="active"||x.status==="scanning");
  const l = [`**🤖 Agents:** ${active.length}/${s.length} active.\n`];
  for (const a of s.slice(0,7))
    l.push(`• ${a.icon} **${a.agentName}**: ${a.status==="active"?"🟢":a.status==="scanning"?"🔵":a.status==="idle"?"🟡":"🔴"} ${a.status} — ${a.lastAction}`);
  if (s.length>7) l.push(`  …+${s.length-7} more`);
  l.push(`\n📊 Profit: $${s.reduce((t,a)=>t+a.profitGenerated,0).toFixed(2)} | TXs: ${s.reduce((t,a)=>t+a.transactions,0)}`);
  return l.join("\n");
}

function formatPortfolioValue(r: unknown): string {
  const d = r as { totalEstimatedValue: number; agentProfitTotal: number; estimatedHoldingsValue: number; activeAgents: number; totalAgents: number };
  if (!d) return "No data.";
  return [`**💼 Portfolio:**\n`,`• Total: $${d.totalEstimatedValue.toLocaleString()}`,`• Agent Profit: $${d.agentProfitTotal.toLocaleString()}`,`• Holdings: $${d.estimatedHoldingsValue.toLocaleString()}`,`• Active: ${d.activeAgents}/${d.totalAgents}`].join("\n");
}

function formatSwapQuote(r: unknown): string {
  const d = r as { error?: string; fromToken: string; toToken: string; amount: number; estimatedOutput: number; effectiveRate: number; usdValue: number };
  if (!d) return "No quote.";
  if (d.error) return `⚠ ${d.error}`;
  return [`**🔄 Quote:**\n`,`• ${d.amount} ${d.fromToken} → ${d.estimatedOutput} ${d.toToken}`,`• Rate: 1 ${d.fromToken} = ${d.effectiveRate} ${d.toToken}`,`• ~$${d.usdValue.toLocaleString()} | Fee: 0.5%`,"","⚠ Simulated — no real tx."].join("\n");
}

function formatResult(name: string, r: unknown): string {
  switch (name) {
    case "getChainStatus": return formatChainStatus(r);
    case "getTokenPrice": return formatTokenPrice(r);
    case "scanOpportunities": return formatScanResults(r);
    case "getAgentStatus": return formatAgentStatus(r);
    case "getPortfolioValue": return formatPortfolioValue(r);
    case "executeSwap": return formatSwapQuote(r);
    default: return JSON.stringify(r);
  }
}

// ── Server Function ───────────────────────────────────────────────

export const processChat = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: { messages: ChatMessage[] } }): Promise<ChatStreamResponse> => {
    const { messages } = data;
    if (!messages?.length) throw new Error("Messages required");

    const toolName = detectTool(messages);
    const args = getToolArgs(toolName, messages);
    const toolCallId = `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const toolCall: ToolCall = { id: toolCallId, name: toolName, arguments: args };

    const toolResult = await executeToolCall(toolCall);
    const responseText = formatResult(toolCall.name, toolResult.result);

    return {
      toolCall: { id: toolCall.id, name: toolCall.name, arguments: toolCall.arguments },
      toolResult: toolResult.result,
      responseText,
    };
  });
