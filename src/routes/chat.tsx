import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef, useEffect, useCallback } from "react";
import { CHAT_TOOLS, type ToolDefinition } from "~/lib/chat-tools";

// ── Types ─────────────────────────────────────────────────────────

interface Message {
  id: string;
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  toolCall?: { id: string; name: string; arguments: Record<string, unknown> };
  timestamp: number;
}

// ── Welcome Message ───────────────────────────────────────────────

const toolCommandList = [
  { command: "status / chain / network", tool: "getChainStatus", desc: "Check all blockchain network statuses" },
  { command: "price / worth / token", tool: "getTokenPrice", desc: "Get current crypto prices" },
  { command: "scan / opportunity / find", tool: "scanOpportunities", desc: "Scan for yield & arbitrage" },
  { command: "agent / astra / neuron", tool: "getAgentStatus", desc: "View all AI agent statuses" },
  { command: "portfolio / balance", tool: "getPortfolioValue", desc: "Calculate total portfolio value" },
  { command: "swap / trade / exchange", tool: "executeSwap", desc: "Get a simulated swap quote" },
];

const WELCOME_MESSAGE: Message = {
  id: "welcome",
  role: "system",
  content: "",
  timestamp: Date.now(),
};

function getWelcomeText(): string {
  const lines = [
    "👋 **Welcome to Păun AI Chat!**",
    "",
    "I'm your AI assistant connected to the DeFi command center. I can help you with:",
    "",
  ];
  for (const cmd of toolCommandList) {
    lines.push(`• **${cmd.command}** — ${cmd.desc}`);
  }
  lines.push("");
  lines.push("Just type naturally — I'll detect what you need. Try *\"How's the network?\"* or *\"Scan for opportunities\"* or *\"What's my portfolio worth?\"*");
  return lines.join("\n");
}

// ── Component ─────────────────────────────────────────────────────

function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([
    { ...WELCOME_MESSAGE, content: getWelcomeText() },
  ]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [currentTool, setCurrentTool] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText, isStreaming]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const sendMessage = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;

    const userMessage: Message = {
      id: `msg_${Date.now()}`,
      role: "user",
      content: trimmed,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsStreaming(true);
    setStreamingText("");
    setCurrentTool(null);

    try {
      // Build the message history
      const history = [...messages.filter(m => m.role !== "system"), userMessage].map(m => ({
        role: m.role,
        content: m.content,
      }));

      const response = await fetch("/api/chat-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }),
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`Server error: ${err}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";
      let toolCallInfo: Message["toolCall"] | null = null;
      let accumulatedText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events from buffer
        const lines = buffer.split("\n");
        buffer = lines.pop() || ""; // keep incomplete line in buffer

        let eventType = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith("data: ") && eventType) {
            try {
              const data = JSON.parse(line.slice(6));

              switch (eventType) {
                case "tool_call": {
                  toolCallInfo = {
                    id: data.id,
                    name: data.name,
                    arguments: data.arguments,
                  };
                  setCurrentTool(data.name);
                  break;
                }
                case "tool_result": {
                  // We'll store this with the assistant message
                  break;
                }
                case "token": {
                  accumulatedText += data.text;
                  setStreamingText(accumulatedText);
                  break;
                }
                case "done": {
                  // Finalize the assistant message
                  const toolMsg: Message = {
                    id: `tool_${Date.now()}`,
                    role: "tool",
                    content: `🔧 Called **${toolCallInfo?.name || "tool"}**`,
                    toolCall: toolCallInfo || undefined,
                    timestamp: Date.now(),
                  };
                  const assistantMsg: Message = {
                    id: `asst_${Date.now()}`,
                    role: "assistant",
                    content: accumulatedText,
                    timestamp: Date.now(),
                  };
                  setMessages((prev) => [...prev, toolMsg, assistantMsg]);
                  setStreamingText("");
                  setCurrentTool(null);
                  setIsStreaming(false);
                  break;
                }
                case "error": {
                  const errorMsg: Message = {
                    id: `err_${Date.now()}`,
                    role: "assistant",
                    content: `❌ Error: ${data.message || "Something went wrong"}`,
                    timestamp: Date.now(),
                  };
                  setMessages((prev) => [...prev, errorMsg]);
                  setStreamingText("");
                  setCurrentTool(null);
                  setIsStreaming(false);
                  break;
                }
              }
            } catch {
              // skip malformed data
            }
            eventType = "";
          }
        }
      }

      // If stream ended without "done", finalize anyway
      if (isStreaming) {
        if (accumulatedText) {
          const assistantMsg: Message = {
            id: `asst_${Date.now()}`,
            role: "assistant",
            content: accumulatedText,
            timestamp: Date.now(),
          };
          setMessages((prev) => [...prev, assistantMsg]);
        }
        setStreamingText("");
        setCurrentTool(null);
        setIsStreaming(false);
      }
    } catch (err: any) {
      const errorMsg: Message = {
        id: `err_${Date.now()}`,
        role: "assistant",
        content: `❌ ${err.message || "Failed to connect. Please try again."}`,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, errorMsg]);
      setStreamingText("");
      setCurrentTool(null);
      setIsStreaming(false);
    }
  }, [input, isStreaming, messages]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // ── Render helpers ─────────────────────────────────────────────

  const renderMessage = (msg: Message) => {
    const isUser = msg.role === "user";
    const isTool = msg.role === "tool";
    const isSystem = msg.role === "system";

    if (isSystem) {
      return (
        <div key={msg.id} className="flex justify-center mb-4 px-4">
          <div className="glass-card p-6 max-w-2xl w-full text-left animate-fade-in-up">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-2xl">🦚</span>
              <span className="text-sm font-semibold text-accent-cyan">Păun AI Assistant</span>
            </div>
            <div className="text-gray-300 text-sm leading-relaxed whitespace-pre-wrap">
              {renderMarkdown(msg.content)}
            </div>
          </div>
        </div>
      );
    }

    if (isTool) {
      return (
        <div key={msg.id} className="flex justify-center mb-2 px-4">
          <div
            className="text-xs font-mono text-accent-cyan bg-cyan-500/5 border border-cyan-500/15 rounded-full px-3 py-1 animate-fade-in"
          >
            {msg.content}
          </div>
        </div>
      );
    }

    return (
      <div
        key={msg.id}
        className={`flex mb-4 px-4 ${isUser ? "justify-end" : "justify-start"}`}
      >
        <div
          className={`max-w-[75%] sm:max-w-[65%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
            isUser
              ? "bg-gradient-to-br from-accent-blue/80 to-accent-cyan/60 text-white rounded-br-md shadow-lg shadow-accent-blue/10"
              : "glass-card text-gray-200 rounded-bl-md"
          } animate-fade-in-up`}
        >
          <div className="whitespace-pre-wrap">{renderMarkdown(msg.content)}</div>
          <div
            className={`text-[10px] mt-1.5 ${
              isUser ? "text-white/50" : "text-gray-500"
            }`}
          >
            {new Date(msg.timestamp).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-dvh pt-16 pb-24 flex flex-col">
      {/* Header */}
      <div className="glass-card mx-4 mt-4 sm:mx-auto sm:max-w-2xl lg:max-w-3xl p-4 flex items-center gap-3">
        <span className="text-2xl">🦚</span>
        <div>
          <h1 className="text-lg font-bold text-white">Păun AI Chat</h1>
          <p className="text-xs text-gray-400">
            {isStreaming
              ? currentTool
                ? `Running ${currentTool}...`
                : "Thinking..."
              : "Ask about chains, prices, agents, portfolio, or swaps"}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {isStreaming && (
            <span className="flex gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-accent-cyan animate-pulse"></span>
              <span className="w-1.5 h-1.5 rounded-full bg-accent-cyan animate-pulse" style={{ animationDelay: "0.15s" }}></span>
              <span className="w-1.5 h-1.5 rounded-full bg-accent-cyan animate-pulse" style={{ animationDelay: "0.3s" }}></span>
            </span>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto mt-4 space-y-1">
        {messages.map(renderMessage)}

        {/* Streaming indicator */}
        {isStreaming && streamingText && (
          <div className="flex mb-4 px-4 justify-start">
            <div className="max-w-[75%] sm:max-w-[65%] rounded-2xl px-4 py-3 text-sm leading-relaxed glass-card text-gray-200 rounded-bl-md animate-fade-in-up">
              <div className="whitespace-pre-wrap">{renderMarkdown(streamingText)}</div>
              <span className="inline-block w-1.5 h-4 bg-accent-cyan ml-0.5 animate-pulse align-text-bottom"></span>
            </div>
          </div>
        )}

        {isStreaming && !streamingText && (
          <div className="flex mb-4 px-4 justify-start">
            <div className="glass-card rounded-2xl px-4 py-3 rounded-bl-md animate-fade-in">
              <span className="flex gap-1">
                <span className="w-2 h-2 rounded-full bg-accent-cyan/60 animate-bounce"></span>
                <span className="w-2 h-2 rounded-full bg-accent-cyan/60 animate-bounce" style={{ animationDelay: "0.1s" }}></span>
                <span className="w-2 h-2 rounded-full bg-accent-cyan/60 animate-bounce" style={{ animationDelay: "0.2s" }}></span>
              </span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-gradient-to-t from-darker via-darker/95 to-transparent pt-6 pb-4 px-4">
        <div className="mx-auto max-w-2xl lg:max-w-3xl">
          <div className="glass-card p-1.5 flex items-center gap-2">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about networks, prices, agents, or portfolio..."
              disabled={isStreaming}
              className="flex-1 bg-transparent text-white placeholder-gray-500 px-3 py-2 text-sm outline-none disabled:opacity-40"
            />
            <button
              onClick={sendMessage}
              disabled={isStreaming || !input.trim()}
              className="glass-button px-4 py-2 text-sm rounded-xl flex items-center gap-1.5 shrink-0"
            >
              <span>Send</span>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </div>

          {/* Quick commands */}
          <div className="flex gap-1.5 mt-2 overflow-x-auto scrollbar-hide pb-1">
            {[
              { label: "Network Status", query: "Show network status" },
              { label: "Prices", query: "What are current prices?" },
              { label: "Scan", query: "Scan for opportunities" },
              { label: "Agents", query: "Show agent status" },
              { label: "Portfolio", query: "What's my portfolio worth?" },
              { label: "Swap Quote", query: "Quote swap 1 ETH to USDC" },
            ].map((cmd) => (
              <button
                key={cmd.label}
                onClick={() => setInput(cmd.query)}
                disabled={isStreaming}
                className="text-xs text-gray-400 hover:text-accent-cyan bg-dark-hover hover:bg-dark-border px-2.5 py-1 rounded-full border border-dark-border hover:border-accent-cyan/20 transition-all whitespace-nowrap disabled:opacity-30"
              >
                {cmd.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Simple Markdown Renderer ─────────────────────────────────────

function renderMarkdown(text: string): React.ReactNode {
  if (!text) return null;

  // Split by **bold** markers and newlines
  const parts = text.split(/(\*\*[^*]+\*\*|\n)/g);

  return parts.map((part, i) => {
    if (part === "\n") return <br key={i} />;
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} className="font-semibold text-white">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

// ── Route ─────────────────────────────────────────────────────────

export const Route = createFileRoute("/chat")({
  component: ChatPage,
});
