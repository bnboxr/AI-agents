import { createServerFn } from "@tanstack/react-start";
import { executeToolCall, type ToolCall } from "~/lib/chat-tools";
import { listDestinations, type PaymentDestination } from "~/lib/payment-destinations";

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ChatStreamResponse {
  toolCall: { id: string; name: string; arguments: Record<string, unknown> };
  toolResult: unknown;
  responseText: string;
}

function detectTool(messages: ChatMessage[]): string {
  const combined = messages
    .filter(m => m.role === "user").slice(-2)
    .map(m => m.content.toLowerCase()).join(" ");
  const patterns: [RegExp, string][] = [
    [/swap|trade|exchange/, "executeSwap"],
    [/portfolio|balance|worth.*total|total.*worth/, "getPortfolioValue"],
    [/scan|opportunit|find|search.*yield|yield.*search/, "scanOpportunities"],
    [/agent|astra|neuron|vortex|spectra|nova|zenith|frost|phantom|oracle|prism/, "getAgentStatus"],
    [/price|worth|token.*price|how much|cost/, "getTokenPrice"],
    [/status|chain|network|block.*height|gas.*price/, "getChainStatus"],
    [/money|earning|payout|payment|destination|receive.*fund/, "configurePaymentDestination"],
  ];
  for (const [re, tool] of patterns) if (re.test(combined)) return tool;
  return "getAgentStatus";
}

function getToolArgs(toolName: string, messages: ChatMessage[]): Record<string, unknown> {
  const last = messages.filter(m => m.role === "user").slice(-1)[0]?.content.toLowerCase() || "";
  const args: Record<string, unknown> = {};
  if (toolName === "getTokenPrice") {
    const m: Record<string, string> = { bitcoin:"bitcoin",btc:"bitcoin",ethereum:"ethereum",eth:"ethereum",solana:"solana",sol:"solana",bnb:"binancecoin",matic:"matic-network",avalanche:"avalanche-2",avax:"avalanche-2",near:"near",aptos:"aptos",sui:"sui",tron:"tron" };
    const f: string[] = [];
    for (const [kw, id] of Object.entries(m)) if (last.includes(kw)) f.push(id);
    if (f.length) args.tokens = [...new Set(f)].join(",");
  }
  if (toolName === "scanOpportunities")
    for (const c of ["ethereum","solana","bnb","polygon","avalanche","arbitrum","optimism","base"])
      if (last.includes(c)) { args.chainId = c; break; }
  if (toolName === "executeSwap") {
    const ma = last.match(/([0-9.]+)\s*(eth|btc|sol|usdc|usdt|matic|avax|bnb)/i);
    if (ma) { args.amount = parseFloat(ma[1]); args.fromToken = ma[2].toUpperCase(); }
    const tm = last.match(/(?:for|to|into)\s+([a-z]{2,6})\b/i);
    if (tm) args.toToken = tm[1].toUpperCase();
    if (!args.amount) args.amount = 1;
    if (!args.fromToken) args.fromToken = "ETH";
    if (!args.toToken) args.toToken = "USDC";
  }
  if (toolName === "configurePaymentDestination") {
    args.action = "list";
  }
  return args;
}

function fmtChainStatus(r: unknown): string {
  const s = r as Array<{name:string;online:boolean;blockHeight:number|null;gasPrice:number|null;latency:number|null}>;
  if (!Array.isArray(s)) return "No data.";
  const on=s.filter(x=>x.online), off=s.filter(x=>!x.online);
  const l=[`**🌐 Network Status:** ${on.length} online, ${off.length} offline of ${s.length}.\n`];
  for (const c of on.slice(0,5)) l.push(`• **${c.name}**: ✅ Online — Blk ${c.blockHeight?.toLocaleString()??"?"}${c.gasPrice?`, ${c.gasPrice} gwei`:""} (${c.latency}ms)`);
  if (on.length>5) l.push(`  …+${on.length-5} more`);
  if (off.length){l.push("");for(const c of off) l.push(`• **${c.name}**: ❌ Offline`);}
  return l.join("\n");
}
function fmtPrices(r: unknown): string {
  const p=r as Record<string,{usd:number;change24h:number}|null>;
  const l=["**💰 Current Prices:**\n"];
  for(const[id,v] of Object.entries(p).filter(([,v])=>v) as [string,{usd:number;change24h:number}][])
    l.push(`• **${id}**: $${v.usd.toLocaleString()} ${v.change24h>=0?"📈":"📉"} ${v.change24h.toFixed(2)}%`);
  return l.join("\n");
}
function fmtScan(r: unknown): string {
  const rs=r as Array<{chainId:string;opportunities:Array<{type:string;description:string;estimatedProfit:number;confidence:string}>}>;
  if(!Array.isArray(rs)) return "No scan data.";
  const t=rs.reduce((s,r)=>s+r.opportunities.length,0);
  const l=[`**🔍 Scan:** ${t} opps across ${rs.length} chains.\n`];
  const wo=rs.filter(r=>r.opportunities.length);
  if(!wo.length){l.push("No opportunities detected.");return l.join("\n");}
  for(const r of wo.slice(0,5)){l.push(`\n**${r.chainId}** (${r.opportunities.length}):`);
    for(const o of r.opportunities.slice(0,3))l.push(`  ${o.confidence==="high"?"🟢":o.confidence==="medium"?"🟡":"🔴"} *${o.type}*: ${o.description}`);}
  return l.join("\n");
}
function fmtAgents(r: unknown): string {
  const s=r as Array<{agentName:string;icon:string;status:string;lastAction:string;profitGenerated:number;transactions:number}>;
  if(!Array.isArray(s)) return "No agents.";
  const a=s.filter(x=>x.status==="active"||x.status==="scanning");
  const l=[`**🤖 Agents:** ${a.length}/${s.length} active.\n`];
  for(const ag of s.slice(0,7)) l.push(`• ${ag.icon} **${ag.agentName}**: ${ag.status==="active"?"🟢":ag.status==="scanning"?"🔵":ag.status==="idle"?"🟡":"🔴"} ${ag.status} — ${ag.lastAction}`);
  if(s.length>7) l.push(`  …+${s.length-7} more`);
  l.push(`\n📊 Profit: $${s.reduce((t,a)=>t+a.profitGenerated,0).toFixed(2)} | TXs: ${s.reduce((t,a)=>t+a.transactions,0)}`);
  return l.join("\n");
}
function fmtPortfolio(r: unknown): string {
  const d=r as {totalEstimatedValue:number;agentProfitTotal:number;estimatedHoldingsValue:number;activeAgents:number;totalAgents:number};
  if(!d) return "No data.";
  return [`**💼 Portfolio:**\n`,`• Total: $${d.totalEstimatedValue.toLocaleString()}`,`• Profit: $${d.agentProfitTotal.toLocaleString()}`,`• Holdings: $${d.estimatedHoldingsValue.toLocaleString()}`,`• Active: ${d.activeAgents}/${d.totalAgents}`].join("\n");
}
function fmtSwap(r: unknown): string {
  const d=r as {error?:string;fromToken:string;toToken:string;amount:number;estimatedOutput:number;effectiveRate:number;usdValue:number};
  if(!d) return "No quote."; if(d.error) return `⚠ ${d.error}`;
  return [`**🔄 Quote:**\n`,`• ${d.amount} ${d.fromToken} → ${d.estimatedOutput} ${d.toToken}`,`• Rate: 1 ${d.fromToken} = ${d.effectiveRate} ${d.toToken}`,`• ~${d.usdValue.toLocaleString()} | Fee: 0.5%`,"","⚠ Simulated — no real tx."].join("\n");
}

function fmtPayDest(r: unknown): string {
  const d = r as { action: string; destinations?: PaymentDestination[]; destination?: PaymentDestination; error?: string };
  if (!d) return "No payment data.";
  if (d.error) return `⚠ ${d.error}`;

  if (d.action === "add" && d.destination) {
    const dest = d.destination;
    const icon = dest.destType === "crypto" ? "₿" : dest.destType === "stripe_card" ? "💳" : "🏦";
    const typeLabel = dest.destType === "crypto" ? "Crypto Wallet" : dest.destType === "stripe_card" ? "Stripe Card" : "Stripe Bank Deposit";
    const chainInfo = dest.chainId ? ` on **${dest.chainId}**` : "";
    const addrDisplay = dest.destAddress
      ? dest.destAddress.length > 16
        ? `${dest.destAddress.slice(0, 8)}...${dest.destAddress.slice(-6)}`
        : dest.destAddress
      : "";
    return [
      `**✅ Payment destination added:**\n`,
      `• ${icon} **${dest.label}** — ${typeLabel}${chainInfo}`,
      `• Address: \`${addrDisplay}\``,
      dest.isDefault ? `• ⭐ This is now the default destination` : "",
    ].join("\n");
  }

  if (d.action === "set_default" && d.destination) {
    return `**⭐ Default payment destination set to "${d.destination.label}"** — funds will be sent to ${d.destination.destAddress?.slice(0, 8)}...`;
  }

  // list action
  const dests = d.destinations ?? [];
  if (!dests.length) {
    return [
      `**💸 Payment Destinations:**\n`,
      `No payment destinations configured yet.`,
      ``,
      `To receive earnings, add a destination:`,
      `• **Crypto wallet** — send funds to an on-chain address`,
      `• **Stripe** — receive via card or bank deposit`,
      ``,
      `Go to **Settings → Payment Destinations** or tell me:`,
      `_"add a crypto wallet on Ethereum"_`,
    ].join("\n");
  }

  const lines: string[] = [`**💸 Payment Destinations (${dests.length}):**\n`];
  for (const dest of dests) {
    const icon = dest.destType === "crypto" ? "₿" : dest.destType === "stripe_card" ? "💳" : "🏦";
    const addr = dest.destAddress ?? "—";
    const shortAddr = addr.length > 16 ? `${addr.slice(0, 8)}...${addr.slice(-6)}` : addr;
    const defMark = dest.isDefault ? " ⭐" : "";
    const chainStr = dest.chainId ? ` (${dest.chainId})` : "";
    lines.push(`• ${icon} **${dest.label}**${defMark}${chainStr}: \`${shortAddr}\``);
  }
  lines.push(``, `Manage in **Settings → Payment Destinations**.`);
  return lines.join("\n");
}

function fmtResult(name: string, r: unknown): string {
  switch(name){case"getChainStatus":return fmtChainStatus(r);case"getTokenPrice":return fmtPrices(r);case"scanOpportunities":return fmtScan(r);case"getAgentStatus":return fmtAgents(r);case"getPortfolioValue":return fmtPortfolio(r);case"executeSwap":return fmtSwap(r);case"configurePaymentDestination":return fmtPayDest(r);default:return JSON.stringify(r);}
}

export const processChat = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: { messages: ChatMessage[] } }): Promise<ChatStreamResponse> => {
    const { messages } = data;
    if (!messages?.length) throw new Error("Messages required");
    const toolName = detectTool(messages);
    const args = getToolArgs(toolName, messages);
    const id = `call_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
    const tc: ToolCall = { id, name: toolName, arguments: args };
    const tr = await executeToolCall(tc);
    return { toolCall: { id: tc.id, name: tc.name, arguments: tc.arguments }, toolResult: tr.result, responseText: fmtResult(tc.name, tr.result) };
  });
