import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef, useEffect, useCallback } from "react";
import { processChat, type ChatStreamResponse } from "./api/chat-stream";

// ── Types ─────────────────────────────────────────────────────────

interface Message {
  id: string;
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  toolCall?: { id: string; name: string; arguments: Record<string, unknown> };
  timestamp: number;
}

// ── Welcome ───────────────────────────────────────────────────────

const toolCommandList = [
  { cmd: "status / chain / network", desc: "Check all blockchain network statuses" },
  { cmd: "price / worth / token", desc: "Get current crypto prices" },
  { cmd: "scan / opportunity / find", desc: "Scan for yield & arbitrage" },
  { cmd: "agent / astra / neuron", desc: "View all AI agent statuses" },
  { cmd: "portfolio / balance", desc: "Calculate total portfolio value" },
  { cmd: "swap / trade / exchange", desc: "Get a simulated swap quote" },
];

const welcomeText = [
  "👋 **Welcome to Păun AI Chat!**",
  "",
  "I'm your AI assistant connected to the DeFi command center. I can help you with:",
  "",
  ...toolCommandList.map(t => `• **${t.cmd}** — ${t.desc}`),
  "",
  `Just type naturally — I'll detect what you need. Try *"How's the network?"* or *"Scan for opportunities"* or *"What's my portfolio worth?"*`,
].join("\n");

// ── Component ─────────────────────────────────────────────────────

function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([
    { id: "welcome", role: "system", content: welcomeText, timestamp: Date.now() },
  ]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [currentTool, setCurrentTool] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, streamingText, isStreaming]);
  useEffect(() => { inputRef.current?.focus(); }, []);

  // Simulate SSE-style streaming of text word-by-word
  const simulateStream = useCallback(async (
    response: ChatStreamResponse,
    onToolCall: () => void,
    onToolResult: () => void,
  ): Promise<string> => {
    // Emit tool_call
    onToolCall();
    await new Promise(r => setTimeout(r, 200));

    // Emit tool_result
    onToolResult();
    await new Promise(r => setTimeout(r, 200));

    // Stream tokens
    const words = response.responseText.split(/(\s+)/);
    let accumulated = "";
    for (const word of words) {
      accumulated += word;
      setStreamingText(accumulated);
      await new Promise(r => setTimeout(r, 12));
    }
    return accumulated;
  }, []);

  const sendMessage = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;

    const userMsg: Message = { id: `u_${Date.now()}`, role: "user", content: trimmed, timestamp: Date.now() };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setIsStreaming(true);
    setStreamingText("");
    setCurrentTool(null);

    try {
      const history = [...messages.filter(m => m.role !== "system"), userMsg].map(m => ({ role: m.role, content: m.content }));

      const response = await processChat({ data: { messages: history } });

      let toolCallInfo: Message["toolCall"] = response.toolCall;

      const finalText = await simulateStream(
        response,
        () => setCurrentTool(response.toolCall.name),
        () => {},
      );

      const toolMsg: Message = {
        id: `t_${Date.now()}`,
        role: "tool",
        content: `🔧 Called **${response.toolCall.name}**`,
        toolCall: toolCallInfo,
        timestamp: Date.now(),
      };
      const asstMsg: Message = {
        id: `a_${Date.now()}`,
        role: "assistant",
        content: finalText,
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, toolMsg, asstMsg]);
    } catch (err: any) {
      setMessages(prev => [...prev, {
        id: `e_${Date.now()}`, role: "assistant",
        content: `❌ ${err.message || "Something went wrong. Try again."}`,
        timestamp: Date.now(),
      }]);
    } finally {
      setStreamingText("");
      setCurrentTool(null);
      setIsStreaming(false);
    }
  }, [input, isStreaming, messages, simulateStream]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  // ── Render ──────────────────────────────────────────────────────

  const renderMsg = (msg: Message) => {
    if (msg.role === "system") {
      return (
        <div key={msg.id} className="flex justify-center mb-4 px-4">
          <div className="glass-card p-6 max-w-2xl w-full text-left animate-fade-in-up">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-2xl">🦚</span>
              <span className="text-sm font-semibold text-accent-cyan">Păun AI Assistant</span>
            </div>
            <div className="text-gray-300 text-sm leading-relaxed whitespace-pre-wrap">{renderMD(msg.content)}</div>
          </div>
        </div>
      );
    }
    if (msg.role === "tool") {
      return (
        <div key={msg.id} className="flex justify-center mb-2 px-4">
          <div className="text-xs font-mono text-accent-cyan bg-cyan-500/5 border border-cyan-500/15 rounded-full px-3 py-1 animate-fade-in">{msg.content}</div>
        </div>
      );
    }
    const isUser = msg.role === "user";
    return (
      <div key={msg.id} className={`flex mb-4 px-4 ${isUser ? "justify-end" : "justify-start"}`}>
        <div className={`max-w-[75%] sm:max-w-[65%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
          isUser ? "bg-gradient-to-br from-accent-blue/80 to-accent-cyan/60 text-white rounded-br-md shadow-lg shadow-accent-blue/10"
          : "glass-card text-gray-200 rounded-bl-md"
        } animate-fade-in-up`}>
          <div className="whitespace-pre-wrap">{renderMD(msg.content)}</div>
          <div className={`text-[10px] mt-1.5 ${isUser ? "text-white/50" : "text-gray-500"}`}>
            {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-dvh pt-16 pb-24 flex flex-col">
      <div className="glass-card mx-4 mt-4 sm:mx-auto sm:max-w-2xl lg:max-w-3xl p-4 flex items-center gap-3">
        <span className="text-2xl">🦚</span>
        <div>
          <h1 className="text-lg font-bold text-white">Păun AI Chat</h1>
          <p className="text-xs text-gray-400">
            {isStreaming ? currentTool ? `Running ${currentTool}...` : "Thinking..." : "Ask about chains, prices, agents, portfolio, or swaps"}
          </p>
        </div>
        <div className="ml-auto">{isStreaming && (
          <span className="flex gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-accent-cyan animate-pulse" />
            <span className="w-1.5 h-1.5 rounded-full bg-accent-cyan animate-pulse" style={{ animationDelay: "0.15s" }} />
            <span className="w-1.5 h-1.5 rounded-full bg-accent-cyan animate-pulse" style={{ animationDelay: "0.3s" }} />
          </span>
        )}</div>
      </div>

      <div className="flex-1 overflow-y-auto mt-4 space-y-1">
        {messages.map(renderMsg)}

        {isStreaming && streamingText && (
          <div className="flex mb-4 px-4 justify-start">
            <div className="max-w-[75%] sm:max-w-[65%] rounded-2xl px-4 py-3 text-sm leading-relaxed glass-card text-gray-200 rounded-bl-md animate-fade-in-up">
              <div className="whitespace-pre-wrap">{renderMD(streamingText)}</div>
              <span className="inline-block w-1.5 h-4 bg-accent-cyan ml-0.5 animate-pulse align-text-bottom" />
            </div>
          </div>
        )}

        {isStreaming && !streamingText && (
          <div className="flex mb-4 px-4 justify-start">
            <div className="glass-card rounded-2xl px-4 py-3 rounded-bl-md animate-fade-in">
              <span className="flex gap-1">
                <span className="w-2 h-2 rounded-full bg-accent-cyan/60 animate-bounce" />
                <span className="w-2 h-2 rounded-full bg-accent-cyan/60 animate-bounce" style={{ animationDelay: "0.1s" }} />
                <span className="w-2 h-2 rounded-full bg-accent-cyan/60 animate-bounce" style={{ animationDelay: "0.2s" }} />
              </span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-40 bg-gradient-to-t from-darker via-darker/95 to-transparent pt-6 pb-4 px-4">
        <div className="mx-auto max-w-2xl lg:max-w-3xl">
          <div className="glass-card p-1.5 flex items-center gap-2">
            <input ref={inputRef} type="text" value={input}
              onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown}
              placeholder="Ask about networks, prices, agents, or portfolio..."
              disabled={isStreaming}
              className="flex-1 bg-transparent text-white placeholder-gray-500 px-3 py-2 text-sm outline-none disabled:opacity-40" />
            <button onClick={sendMessage} disabled={isStreaming || !input.trim()}
              className="glass-button px-4 py-2 text-sm rounded-xl flex items-center gap-1.5 shrink-0">
              <span>Send</span>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </div>
          <div className="flex gap-1.5 mt-2 overflow-x-auto scrollbar-hide pb-1">
            {[
              { l: "Network Status", q: "Show network status" },
              { l: "Prices", q: "What are current prices?" },
              { l: "Scan", q: "Scan for opportunities" },
              { l: "Agents", q: "Show agent status" },
              { l: "Portfolio", q: "What's my portfolio worth?" },
              { l: "Swap Quote", q: "Quote swap 1 ETH to USDC" },
            ].map(c => (
              <button key={c.l} onClick={() => setInput(c.q)} disabled={isStreaming}
                className="text-xs text-gray-400 hover:text-accent-cyan bg-dark-hover hover:bg-dark-border px-2.5 py-1 rounded-full border border-dark-border hover:border-accent-cyan/20 transition-all whitespace-nowrap disabled:opacity-30">
                {c.l}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function renderMD(text: string): React.ReactNode {
  if (!text) return null;
  const parts = text.split(/(\*\*[^*]+\*\*|\n)/g);
  return parts.map((part, i) => {
    if (part === "\n") return <br key={i} />;
    if (part.startsWith("**") && part.endsWith("**"))
      return <strong key={i} className="font-semibold text-white">{part.slice(2, -2)}</strong>;
    return <span key={i}>{part}</span>;
  });
}

export const Route = createFileRoute("/chat")({ component: ChatPage });
