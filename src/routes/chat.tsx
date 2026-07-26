import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef, useEffect, useCallback, lazy, Suspense } from "react";
import { processChat, type ChatStreamResponse } from "~/lib/chat-server";
import { getAgentPool, type PoolSnapshot } from "~/lib/agent-queue";
import { SwarmOrchestrator } from "~/lib/swarm-orchestrator";

const Terminal = lazy(() => import("~/components/Terminal"));

// ── Types ─────────────────────────────────────────────────────────

interface Message {
  id: string;
  role: "user" | "assistant" | "tool" | "system" | "swarm-plan" | "swarm-done";
  content: string;
  toolCall?: { id: string; name: string; arguments: Record<string, unknown> };
  timestamp: number;
  planDetails?: { agentsNeeded: number; existingAgents: string[]; newSpecializations: string[]; estimatedTime: number; subtaskCount: number };
  doneDetails?: { timeSeconds: number; filesCreated: number; linesTotal: number };
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
  "🧠 **Welcome to HSMC Swarm**",
  "",
  "I am your AI orchestrator with **29 agents** at my disposal. Describe what you need and I'll:",
  "",
  "📋 **Plan** — determine how many agents are needed",
  "🤖 **Route** — assign tasks to available agents, spawn new ones if needed",
  "⚡ **Execute** — agents work in parallel without overlap",
  "📊 **Report** — merged results from all agents",
  "",
  `Try: *"Analyze BTC for the next 24h"* or *"Build a crypto payment gateway"* or *"Scan for opportunities"*`,
].join("\n");

// ── Component ─────────────────────────────────────────────────────

type TabId = "chat" | "terminal";
type SidebarView = "agents" | null;

function ChatPage() {
  const [activeTab, setActiveTab] = useState<TabId>("chat");
  const [sidebarView, setSidebarView] = useState<SidebarView>("agents");
  const [messages, setMessages] = useState<Message[]>([
    { id: "welcome", role: "system", content: welcomeText, timestamp: Date.now() },
  ]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [currentTool, setCurrentTool] = useState<string | null>(null);
  const [poolSnapshot, setPoolSnapshot] = useState<PoolSnapshot | null>(null);
  const [swarmMode, setSwarmMode] = useState(true); // Kimi-style by default
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const poolRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Update pool snapshot every 2s
  useEffect(() => {
    const updatePool = () => {
      try {
        const pool = getAgentPool();
        setPoolSnapshot(pool.snapshot());
      } catch { /* pool may not be initialized yet */ }
    };
    updatePool();
    poolRefreshRef.current = setInterval(updatePool, 2000);
    return () => {
      if (poolRefreshRef.current) clearInterval(poolRefreshRef.current);
    };
  }, []);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, streamingText, isStreaming]);
  useEffect(() => { inputRef.current?.focus(); }, []);

  // ── Simulate SSE-style streaming ────────────────────────────────

  const simulateStream = useCallback(async (
    response: ChatStreamResponse,
    onToolCall: () => void,
    onToolResult: () => void,
  ): Promise<string> => {
    onToolCall();
    await new Promise(r => setTimeout(r, 200));
    onToolResult();
    await new Promise(r => setTimeout(r, 200));

    const words = response.responseText.split(/(\s+)/);
    let accumulated = "";
    for (const word of words) {
      accumulated += word;
      setStreamingText(accumulated);
      await new Promise(r => setTimeout(r, 12));
    }
    return accumulated;
  }, []);

  // ── Kimi-style swarm execute ────────────────────────────────────

  const executeSwarmTask = useCallback(async (description: string) => {
    setIsStreaming(true);
    setStreamingText("");
    setCurrentTool(null);

    try {
      const orch = new SwarmOrchestrator({ maxAgents: 5, verbose: false });

      // Emit the planning message
      const planMsg: Message = {
        id: `plan_${Date.now()}`,
        role: "swarm-plan",
        content: "",
        timestamp: Date.now(),
        planDetails: {
          agentsNeeded: 0,
          existingAgents: [],
          newSpecializations: [],
          estimatedTime: 0,
          subtaskCount: 0,
        },
      };

      // Start swarm execution
      const result = await orch.executeProject(description);

      // Update plan message with real data
      planMsg.planDetails = {
        agentsNeeded: result.plan?.agentsNeeded ?? result.agentCount,
        existingAgents: result.plan?.existingAgents ?? [],
        newSpecializations: result.plan?.newSpecializations ?? [],
        estimatedTime: result.plan?.estimatedTime ?? Math.round(result.durationMs / 1000),
        subtaskCount: result.tasksPlanned,
      };
      planMsg.content = formatPlanMessage(planMsg.planDetails);

      setMessages(prev => [...prev, planMsg]);

      // Done message
      const doneMsg: Message = {
        id: `done_${Date.now()}`,
        role: "swarm-done",
        content: "",
        timestamp: Date.now(),
        doneDetails: {
          timeSeconds: Number((result.durationMs / 1000).toFixed(1)),
          filesCreated: result.agentsCreated,
          linesTotal: result.mergedReport.split("\n").length,
        },
      };
      doneMsg.content = formatDoneMessage(doneMsg.doneDetails, result.mergedReport);
      setMessages(prev => [...prev, doneMsg]);

      // Show merged report as assistant message
      const asstMsg: Message = {
        id: `a_${Date.now()}`,
        role: "assistant",
        content: result.mergedReport,
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, asstMsg]);
    } catch (err: any) {
      setMessages(prev => [...prev, {
        id: `e_${Date.now()}`, role: "assistant",
        content: `❌ Swarm execution failed: ${err.message || "Unknown error"}`,
        timestamp: Date.now(),
      }]);
    } finally {
      setStreamingText("");
      setCurrentTool(null);
      setIsStreaming(false);
    }
  }, []);

  // ── Legacy chat path ────────────────────────────────────────────

  const executeLegacyChat = useCallback(async (trimmed: string) => {
    const userMsg: Message = { id: `u_${Date.now()}`, role: "user", content: trimmed, timestamp: Date.now() };

    try {
      const history = [...messages.filter(m => m.role !== "system"), userMsg].map(m => ({ role: m.role, content: m.content }));
      const response = await processChat({ data: { messages: history } });

      const finalText = await simulateStream(
        response,
        () => setCurrentTool(response.toolCall.name),
        () => {},
      );

      const toolMsg: Message = {
        id: `t_${Date.now()}`,
        role: "tool",
        content: `🔧 Called **${response.toolCall.name}**`,
        toolCall: { id: response.toolCall.id, name: response.toolCall.name, arguments: response.toolCall.arguments },
        timestamp: Date.now(),
      };
      const asstMsg: Message = {
        id: `a_${Date.now()}`,
        role: "assistant",
        content: finalText,
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, userMsg, toolMsg, asstMsg]);
    } catch (err: any) {
      setMessages(prev => [...prev, userMsg, {
        id: `e_${Date.now()}`, role: "assistant",
        content: `❌ ${err.message || "Something went wrong. Try again."}`,
        timestamp: Date.now(),
      }]);
    }
  }, [messages, simulateStream]);

  // ── Send handler ────────────────────────────────────────────────

  const sendMessage = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;

    setInput("");
    setIsStreaming(true);
    setStreamingText("");
    setCurrentTool(null);

    if (swarmMode) {
      await executeSwarmTask(trimmed);
    } else {
      await executeLegacyChat(trimmed);
    }

    setIsStreaming(false);
  }, [input, isStreaming, swarmMode, executeSwarmTask, executeLegacyChat]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  // ── Render helpers ──────────────────────────────────────────────

  const renderMsg = (msg: Message) => {
    // Swarm plan message
    if (msg.role === "swarm-plan") {
      return (
        <div key={msg.id} className="flex justify-center mb-3 px-4">
          <div className="glass-card p-4 max-w-xl w-full text-left animate-fade-in-up border-l-2 border-accent-cyan">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-lg">🧠</span>
              <span className="text-sm font-semibold text-accent-cyan">HSMC Swarm — Planning</span>
              {isStreaming && <span className="flex gap-1 ml-1">
                <span className="w-1 h-1 rounded-full bg-accent-cyan animate-pulse" />
                <span className="w-1 h-1 rounded-full bg-accent-cyan animate-pulse" style={{ animationDelay: "0.15s" }} />
                <span className="w-1 h-1 rounded-full bg-accent-cyan animate-pulse" style={{ animationDelay: "0.3s" }} />
              </span>}
            </div>
            <div className="text-gray-300 text-xs leading-relaxed whitespace-pre-wrap">
              {msg.content || "📋 Analyzing task..."}
            </div>
          </div>
        </div>
      );
    }

    // Swarm done message
    if (msg.role === "swarm-done") {
      return (
        <div key={msg.id} className="flex justify-center mb-3 px-4">
          <div className="glass-card p-4 max-w-xl w-full text-left animate-fade-in-up border-l-2 border-green-500">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-lg">✅</span>
              <span className="text-sm font-semibold text-green-400">Swarm Task Complete</span>
            </div>
            <div className="text-gray-300 text-xs leading-relaxed whitespace-pre-wrap">
              {msg.content || "✅ Complete"}
            </div>
          </div>
        </div>
      );
    }

    // System / welcome message
    if (msg.role === "system") {
      return (
        <div key={msg.id} className="flex justify-center mb-4 px-4">
          <div className="glass-card p-6 max-w-2xl w-full text-left animate-fade-in-up">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-2xl">🧠</span>
              <span className="text-sm font-semibold text-accent-cyan">HSMC Swarm</span>
              <span className="text-xs text-gray-500 ml-auto">29 agents ready</span>
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

  // ── Agent sidebar ───────────────────────────────────────────────

  const renderAgentSidebar = () => {
    if (!poolSnapshot) {
      return (
        <div className="p-4 text-xs text-gray-500 text-center">
          Loading agent pool...
        </div>
      );
    }

    return (
      <div className="p-3 space-y-2">
        {/* Summary bar */}
        <div className="glass-card p-2 text-xs">
          <div className="text-gray-300 font-semibold mb-1">
            🤖 Active Agents ({poolSnapshot.working + poolSnapshot.idle}/{poolSnapshot.total})
          </div>
          <div className="flex gap-2 text-gray-400">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" /> {poolSnapshot.working} working</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-500 inline-block" /> {poolSnapshot.paused} paused</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-500 inline-block" /> {poolSnapshot.idle} idle</span>
          </div>
          {poolSnapshot.temporary > 0 && (
            <div className="text-accent-cyan mt-1">
              🔧 {poolSnapshot.temporary} temporary
            </div>
          )}
        </div>

        {/* Agent list */}
        <div className="space-y-1 max-h-[60vh] overflow-y-auto scrollbar-thin">
          {poolSnapshot.agents.slice(0, 20).map((agent) => (
            <div
              key={agent.agentId}
              className={`glass-card p-1.5 text-xs flex items-start gap-1.5 transition-all ${
                agent.status === "working"
                  ? "border-l-2 border-green-500"
                  : agent.status === "paused"
                    ? "border-l-2 border-yellow-500/50 opacity-60"
                    : "opacity-50"
              }`}
            >
              <span className="text-sm shrink-0">{agent.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="text-gray-200 truncate font-medium">
                  {agent.status === "working" && "🟢 "}
                  {agent.status === "paused" && "🟡 "}
                  {agent.status === "idle" && "⚪ "}
                  {agent.displayName.replace(/^[^\s]+\s*/, "")}
                </div>
                {agent.currentTask && (
                  <div className="text-gray-500 truncate text-[10px] mt-0.5">
                    → {agent.currentTask}
                  </div>
                )}
                {agent.isTemporary && (
                  <div className="text-accent-cyan/60 text-[10px]">temp</div>
                )}
              </div>
              {agent.tasksCompleted > 0 && (
                <span className="text-gray-600 text-[10px] shrink-0">{agent.tasksCompleted}✓</span>
              )}
            </div>
          ))}
          {poolSnapshot.agents.length > 20 && (
            <div className="text-xs text-gray-500 text-center py-1">
              +{poolSnapshot.agents.length - 20} more agents
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-1">
          <button className="text-[10px] text-gray-400 hover:text-accent-cyan bg-dark-hover px-2 py-1 rounded-full border border-dark-border">
            View All {poolSnapshot.total}
          </button>
        </div>
      </div>
    );
  };

  // ── Main render ─────────────────────────────────────────────────

  return (
    <div className="min-h-dvh pt-16 pb-24 flex">
      {/* ── Chat area ──────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="glass-card mx-4 mt-4 sm:mx-auto sm:max-w-2xl lg:max-w-3xl p-3 flex items-center gap-3">
          <span className="text-2xl">🧠</span>
          <div className="flex-1">
            <h1 className="text-lg font-bold text-white">
              HSMC Swarm
              <span className="text-xs text-gray-500 ml-2 font-normal">
                {swarmMode ? "Kimi-style" : "Chat"}
              </span>
            </h1>
            {activeTab === "chat" && (
              <p className="text-xs text-gray-400">
                {isStreaming
                  ? currentTool ? `Running ${currentTool}...` : "Thinking..."
                  : swarmMode
                    ? "Describe your task — I'll plan & route to the right agents"
                    : "Ask about chains, prices, agents, portfolio, or swaps"}
              </p>
            )}
            {activeTab === "terminal" && (
              <p className="text-xs text-gray-400">Real shell — /home/team/shared/site</p>
            )}
          </div>

          {/* Swarm / Chat mode toggle */}
          <div className="flex gap-0.5 bg-dark-hover rounded-lg p-0.5">
            <button
              onClick={() => setSwarmMode(true)}
              className={`px-2.5 py-1.5 text-xs font-mono font-semibold rounded-md transition-all ${
                swarmMode
                  ? "bg-accent-cyan/20 text-accent-cyan shadow-sm"
                  : "text-gray-400 hover:text-gray-200"
              }`}
              title="Kimi-style swarm — AI plans and routes to agents"
            >
              Swarm
            </button>
            <button
              onClick={() => setSwarmMode(false)}
              className={`px-2.5 py-1.5 text-xs font-mono font-semibold rounded-md transition-all ${
                !swarmMode
                  ? "bg-accent-cyan/20 text-accent-cyan shadow-sm"
                  : "text-gray-400 hover:text-gray-200"
              }`}
              title="Legacy chat mode — direct tool calls"
            >
              Chat
            </button>
          </div>

          {/* Tab switcher */}
          <div className="flex gap-0.5 bg-dark-hover rounded-lg p-0.5">
            <button
              onClick={() => setActiveTab("chat")}
              className={`px-3 py-1.5 text-xs font-mono font-semibold rounded-md transition-all ${
                activeTab === "chat"
                  ? "bg-accent-cyan/20 text-accent-cyan shadow-sm"
                  : "text-gray-400 hover:text-gray-200"
              }`}
            >
              Chat
            </button>
            <button
              onClick={() => setActiveTab("terminal")}
              className={`px-3 py-1.5 text-xs font-mono font-semibold rounded-md transition-all ${
                activeTab === "terminal"
                  ? "bg-accent-cyan/20 text-accent-cyan shadow-sm"
                  : "text-gray-400 hover:text-gray-200"
              }`}
            >
              Terminal
            </button>
          </div>

          {/* Agent sidebar toggle */}
          <button
            onClick={() => setSidebarView(sidebarView === "agents" ? null : "agents")}
            className={`p-1.5 rounded-lg text-xs transition-all ${
              sidebarView === "agents"
                ? "bg-accent-cyan/20 text-accent-cyan"
                : "text-gray-400 hover:text-gray-200"
            }`}
            title="Toggle agent status sidebar"
          >
            🤖
          </button>

          {activeTab === "chat" && isStreaming && (
            <span className="flex gap-1 shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-accent-cyan animate-pulse" />
              <span className="w-1.5 h-1.5 rounded-full bg-accent-cyan animate-pulse" style={{ animationDelay: "0.15s" }} />
              <span className="w-1.5 h-1.5 rounded-full bg-accent-cyan animate-pulse" style={{ animationDelay: "0.3s" }} />
            </span>
          )}
        </div>

        {/* ── Chat tab ────────────────────────────────────────── */}
        {activeTab === "chat" && (
          <>
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

              {isStreaming && !streamingText && !swarmMode && (
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

            {/* Input bar */}
            <div className="fixed bottom-0 left-0 right-0 z-40 bg-gradient-to-t from-darker via-darker/95 to-transparent pt-6 pb-4 px-4">
              <div className="mx-auto max-w-2xl lg:max-w-3xl">
                <div className="glass-card p-1.5 flex items-center gap-2">
                  <input ref={inputRef} type="text" value={input}
                    onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown}
                    placeholder={swarmMode
                      ? "What do you want to build today? e.g., \"Build a crypto payment gateway\""
                      : "Ask about networks, prices, agents, or portfolio..."}
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
                    { l: "Analyze BTC", q: "Analyze BTC for the next 24 hours" },
                    { l: "Build Payment", q: "Build a crypto payment gateway" },
                    { l: "Network Status", q: "Show network status" },
                    { l: "Prices", q: "What are current prices?" },
                    { l: "Scan", q: "Scan for opportunities" },
                    { l: "Portfolio", q: "What's my portfolio worth?" },
                  ].map(c => (
                    <button key={c.l} onClick={() => setInput(c.q)} disabled={isStreaming}
                      className="text-xs text-gray-400 hover:text-accent-cyan bg-dark-hover hover:bg-dark-border px-2.5 py-1 rounded-full border border-dark-border hover:border-accent-cyan/20 transition-all whitespace-nowrap disabled:opacity-30">
                      {c.l}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}

        {/* ── Terminal tab ─────────────────────────────────────── */}
        {activeTab === "terminal" && (
          <div className="flex-1 flex flex-col mx-4 mt-4 sm:mx-auto sm:max-w-2xl lg:max-w-3xl w-full min-h-0">
            <Suspense
              fallback={
                <div className="flex-1 flex items-center justify-center glass-card">
                  <div className="flex flex-col items-center gap-3">
                    <span className="flex gap-1">
                      <span className="w-2 h-2 rounded-full bg-accent-cyan/60 animate-bounce" />
                      <span className="w-2 h-2 rounded-full bg-accent-cyan/60 animate-bounce" style={{ animationDelay: "0.1s" }} />
                      <span className="w-2 h-2 rounded-full bg-accent-cyan/60 animate-bounce" style={{ animationDelay: "0.2s" }} />
                    </span>
                    <span className="text-xs text-mono text-gray-500">Loading terminal...</span>
                  </div>
                </div>
              }
            >
              <Terminal className="flex-1 min-h-0" />
            </Suspense>
          </div>
        )}
      </div>

      {/* ── Agent sidebar ──────────────────────────────────────── */}
      {sidebarView === "agents" && activeTab === "chat" && (
        <div className="hidden lg:block w-72 shrink-0 border-l border-dark-border overflow-y-auto bg-darker/50">
          <div className="p-3 border-b border-dark-border flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-200">🤖 Agent Status</h3>
            <button
              onClick={() => setSidebarView(null)}
              className="text-gray-500 hover:text-gray-300 text-xs"
            >
              ✕
            </button>
          </div>
          {renderAgentSidebar()}
        </div>
      )}
    </div>
  );
}

// ── Format helpers ────────────────────────────────────────────────

function formatPlanMessage(details: NonNullable<Message["planDetails"]>): string {
  const lines: string[] = [
    `📋 **Task Analysis Complete**`,
    ``,
    `→ Need **${details.agentsNeeded} agents**`,
    details.existingAgents.length > 0
      ? `→ Using: ${details.existingAgents.slice(0, 3).join(", ")}${details.existingAgents.length > 3 ? ` +${details.existingAgents.length - 3} more` : ""}`
      : `→ Using available idle agents`,
    details.newSpecializations.length > 0
      ? `→ Creating: ${details.newSpecializations.map(s => `Agent-Temp-${s}`).join(", ")}`
      : null,
    details.estimatedTime > 0
      ? `→ Estimated time: ~${details.estimatedTime}s`
      : null,
    ``,
    `⚡ Executing ${details.subtaskCount} subtasks in parallel...`,
  ];
  return lines.filter(Boolean).join("\n");
}

function formatDoneMessage(
  details: NonNullable<Message["doneDetails"]>,
  report: string,
): string {
  const lines: string[] = [
    `✅ **Task complete** (${details.timeSeconds}s)`,
    ``,
    report.split("\n").length > 3
      ? `• ${report.split("\n").length} lines generated`
      : null,
    details.filesCreated > 0
      ? `• ${details.filesCreated} new agents created`
      : `• Using existing agents`,
    ``,
    `📊 See detailed report below ↓`,
  ];
  return lines.filter(Boolean).join("\n");
}

// ── Markdown render ───────────────────────────────────────────────

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
