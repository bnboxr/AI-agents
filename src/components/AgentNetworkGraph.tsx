// ── Agent Network Graph — React Flow + Framer Motion ────────────────
// Interactive draggable graph showing all 29 HSMC agents + AI Model center.
// React Flow v12 (@xyflow/react) with custom nodes, animated edges,
// glassmorphism detail cards, dark grid background.
import { useCallback, useState, useMemo, useEffect } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeProps,
  type EdgeProps,
  BaseEdge,
  getBezierPath,
  EdgeLabelRenderer,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { motion, AnimatePresence } from "framer-motion";
import { findAvailableLocalSource } from "~/lib/local-ai-scanner";
import type { LocalAISource } from "~/lib/local-ai-scanner";
import { getAvailableProviders } from "~/lib/llm/multi-provider";
import type { LLMProvider } from "~/lib/llm/multi-provider";

// ── Agent Data (same as before) ─────────────────────────────────────

type Ring = "center" | "inner" | "outer";

interface AgentNode {
  id: string;
  name: string;
  displayName: string;
  role: string;
  ring: Ring;
  color: string;
  glowColor: string;
  icon: string;
  description: string;
}

// All 29 agents + Master Orchestrator at center
// Colors: Intelligence=blue, Analysis=green, Decision=gold, Execution=red, Monitoring=purple
const AGENT_NODES: AgentNode[] = [
  // ── CENTER ──────────────────────────────────────────────────
  {
    id: "orchestrator",
    name: "Master Orchestrator",
    displayName: "ORCHESTRATOR",
    role: "Decision",
    ring: "center",
    color: "#ffab00",
    glowColor: "rgba(255,171,0,0.4)",
    icon: "🧠",
    description:
      "Central decision engine. Orchestrates all 28 agents, runs the Devil's Advocate challenge, and produces final trade signals.",
  },
  // ── INNER RING — 6 Core Agents ──────────────────────────────
  {
    id: "devils-advocate",
    name: "Devil's Advocate",
    displayName: "DEVILS ADVOCATE",
    role: "Decision",
    ring: "inner",
    color: "#ffab00",
    glowColor: "rgba(255,171,0,0.3)",
    icon: "⚖️",
    description:
      "Challenges every trade decision. Identifies red flags, biases, and risks. No trade passes without its approval.",
  },
  {
    id: "position-manager",
    name: "Position Manager",
    displayName: "POSITION MGR",
    role: "Execution",
    ring: "inner",
    color: "#ff3d00",
    glowColor: "rgba(255,61,0,0.3)",
    icon: "📐",
    description:
      "Manages position sizing, scaling in/out, and risk-adjusted allocation. Computes optimal entry/exit sizing.",
  },
  {
    id: "execution",
    name: "Execution Agent",
    displayName: "EXECUTION",
    role: "Execution",
    ring: "inner",
    color: "#ff3d00",
    glowColor: "rgba(255,61,0,0.3)",
    icon: "⚡",
    description:
      "Executes trades across exchanges. Handles order splitting, slippage protection, and venue selection.",
  },
  {
    id: "risk",
    name: "Risk Manager",
    displayName: "RISK MGR",
    role: "Analysis",
    ring: "inner",
    color: "#00e676",
    glowColor: "rgba(0,230,118,0.3)",
    icon: "🛡️",
    description:
      "Monitors portfolio risk, sets stop-losses, enforces drawdown limits, and activates the kill switch when needed.",
  },
  {
    id: "learning",
    name: "Learning Agent",
    displayName: "LEARNING",
    role: "Monitoring",
    ring: "inner",
    color: "#7c4dff",
    glowColor: "rgba(124,77,255,0.3)",
    icon: "📚",
    description:
      "Learns from every trade outcome. Adjusts agent weights, discovers patterns, and improves future decisions.",
  },
  {
    id: "memory",
    name: "Memory Agent",
    displayName: "MEMORY",
    role: "Monitoring",
    ring: "inner",
    color: "#7c4dff",
    glowColor: "rgba(124,77,255,0.3)",
    icon: "💾",
    description:
      "Stores and retrieves past decisions. Finds similar historical trades to inform current decisions.",
  },
  // ── OUTER RING — 22 Specialized Agents ──────────────────────
  {
    id: "market",
    name: "Market Analysis",
    displayName: "MARKET",
    role: "Intelligence",
    ring: "outer",
    color: "#00bcd4",
    glowColor: "rgba(0,188,212,0.25)",
    icon: "📈",
    description:
      "Reads price action, trend structure, and momentum on short timeframes (5m–1h).",
  },
  {
    id: "technical",
    name: "Technical Analysis",
    displayName: "TECHNICAL",
    role: "Intelligence",
    ring: "outer",
    color: "#00bcd4",
    glowColor: "rgba(0,188,212,0.25)",
    icon: "📊",
    description:
      "Computes RSI, MACD, EMA crossovers, Bollinger Bands, and 20+ technical indicators.",
  },
  {
    id: "sentiment",
    name: "Sentiment Agent",
    displayName: "SENTIMENT",
    role: "Intelligence",
    ring: "outer",
    color: "#00bcd4",
    glowColor: "rgba(0,188,212,0.25)",
    icon: "💬",
    description:
      "Analyzes Fear & Greed index, social media sentiment, and crowd psychology metrics.",
  },
  {
    id: "news",
    name: "News Agent",
    displayName: "NEWS",
    role: "Intelligence",
    ring: "outer",
    color: "#00bcd4",
    glowColor: "rgba(0,188,212,0.25)",
    icon: "📰",
    description:
      "Processes crypto news headlines, scores sentiment, and detects market-moving events.",
  },
  {
    id: "macro",
    name: "Macro Analysis",
    displayName: "MACRO",
    role: "Intelligence",
    ring: "outer",
    color: "#00bcd4",
    glowColor: "rgba(0,188,212,0.25)",
    icon: "🌍",
    description:
      "Monitors interest rates, inflation data, DXY, and global macro correlations.",
  },
  {
    id: "pattern",
    name: "Pattern Recognition",
    displayName: "PATTERN",
    role: "Intelligence",
    ring: "outer",
    color: "#00bcd4",
    glowColor: "rgba(0,188,212,0.25)",
    icon: "🔍",
    description:
      "Detects chart patterns: head & shoulders, wedges, flags, double tops/bottoms.",
  },
  {
    id: "smart-money",
    name: "Smart Money",
    displayName: "SMART MONEY",
    role: "Intelligence",
    ring: "outer",
    color: "#00bcd4",
    glowColor: "rgba(0,188,212,0.25)",
    icon: "🐋",
    description:
      "Tracks order blocks, FVGs, liquidity grabs, and institutional order flow patterns.",
  },
  {
    id: "liquidity",
    name: "Liquidity Agent",
    displayName: "LIQUIDITY",
    role: "Intelligence",
    ring: "outer",
    color: "#00bcd4",
    glowColor: "rgba(0,188,212,0.25)",
    icon: "💧",
    description:
      "Analyzes order book depth, detects liquidity sweeps, iceberg orders, and slippage.",
  },
  {
    id: "regime",
    name: "Regime Detection",
    displayName: "REGIME",
    role: "Intelligence",
    ring: "outer",
    color: "#00bcd4",
    glowColor: "rgba(0,188,212,0.25)",
    icon: "🔄",
    description:
      "Classifies market regime: trending, ranging, volatile, or accumulation/distribution.",
  },
  {
    id: "multi-timeframe",
    name: "Multi-Timeframe",
    displayName: "MULTI-TF",
    role: "Intelligence",
    ring: "outer",
    color: "#00bcd4",
    glowColor: "rgba(0,188,212,0.25)",
    icon: "⏰",
    description:
      "Analyzes 5m, 15m, 1h, 4h, and 1D timeframes for confluence and divergence.",
  },
  {
    id: "correlation",
    name: "Correlation Agent",
    displayName: "CORRELATION",
    role: "Analysis",
    ring: "outer",
    color: "#00e676",
    glowColor: "rgba(0,230,118,0.25)",
    icon: "🔗",
    description:
      "Computes Pearson correlation between assets. Detects regime shifts in correlation matrices.",
  },
  {
    id: "volume",
    name: "Volume Agent",
    displayName: "VOLUME",
    role: "Analysis",
    ring: "outer",
    color: "#00e676",
    glowColor: "rgba(0,230,118,0.25)",
    icon: "📶",
    description:
      "Analyzes volume profiles, OBV, delta, climax detection, accumulation/distribution.",
  },
  {
    id: "probability",
    name: "Probability Agent",
    displayName: "PROBABILITY",
    role: "Analysis",
    ring: "outer",
    color: "#00e676",
    glowColor: "rgba(0,230,118,0.25)",
    icon: "🎲",
    description:
      "Computes Bayesian probabilities for trade outcomes using historical data.",
  },
  {
    id: "confidence",
    name: "Confidence Agent",
    displayName: "CONFIDENCE",
    role: "Analysis",
    ring: "outer",
    color: "#00e676",
    glowColor: "rgba(0,230,118,0.25)",
    icon: "📏",
    description:
      "Aggregates agent consensus, detects conflicts, calibrates confidence scores.",
  },
  {
    id: "reasoning",
    name: "Reasoning Agent",
    displayName: "REASONING",
    role: "Analysis",
    ring: "outer",
    color: "#00e676",
    glowColor: "rgba(0,230,118,0.25)",
    icon: "🧩",
    description:
      "Generates human-readable explanations for every trading decision. Audits trade logic.",
  },
  {
    id: "system-audit",
    name: "System Audit",
    displayName: "SYS AUDIT",
    role: "Monitoring",
    ring: "outer",
    color: "#7c4dff",
    glowColor: "rgba(124,77,255,0.25)",
    icon: "🛰️",
    description:
      "Monitors system health, API latency, exchange connectivity, and agent performance.",
  },
  {
    id: "exit",
    name: "Exit Agent",
    displayName: "EXIT",
    role: "Execution",
    ring: "outer",
    color: "#ff3d00",
    glowColor: "rgba(255,61,0,0.25)",
    icon: "🚪",
    description:
      "Determines optimal exit points. Manages trailing stops, TP levels, and time-based exits.",
  },
  {
    id: "portfolio",
    name: "Portfolio Agent",
    displayName: "PORTFOLIO",
    role: "Analysis",
    ring: "outer",
    color: "#00e676",
    glowColor: "rgba(0,230,118,0.25)",
    icon: "💼",
    description:
      "Tracks portfolio composition, diversification, and rebalancing opportunities.",
  },
];

// ── AI Model Node (center of the graph) ─────────────────────────────

interface ModelDetails {
  name: string;
  provider: "local" | "cloud";
  source: LocalAISource | LLMProvider | null;
  status: "active" | "loading" | "offline";
  memoryUsage: string;
}

const defaultModelDetails: ModelDetails = {
  name: "DeepSeek V4 Pro",
  provider: "cloud",
  source: "deepseek",
  status: "active",
  memoryUsage: "N/A (cloud)",
};

const MODEL_NODE: AgentNode = {
  id: "ai-model",
  name: "AI Model",
  displayName: "AI MODEL",
  role: "Model",
  ring: "center",
  color: "#00e676",
  glowColor: "rgba(0,230,118,0.5)",
  icon: "🧠",
  description: "Central AI inference engine. All 29 agents query this model for reasoning, analysis, and decision-making.",
};

// ── Communication Edges ────────────────────────────────────────────

interface GraphEdge {
  from: string;
  to: string;
}

const EDGES: GraphEdge[] = [];

// Model edges: connect all agents to the AI model node
const MODEL_EDGES: GraphEdge[] = [];
for (const n of AGENT_NODES) {
  if (n.id !== "orchestrator") {
    MODEL_EDGES.push({ from: "ai-model", to: n.id });
  }
}
// Orchestrator has a bidirectional special connection
MODEL_EDGES.push({ from: "ai-model", to: "orchestrator" });
MODEL_EDGES.push({ from: "orchestrator", to: "ai-model" });

// Build edges: all outer → inner, all inner → center
for (const n of AGENT_NODES) {
  if (n.ring === "outer") {
    if (
      ["market", "technical", "sentiment", "news", "macro", "pattern", "smart-money", "liquidity", "regime", "multi-timeframe"].includes(n.id)
    ) {
      EDGES.push({ from: n.id, to: "devils-advocate" });
      EDGES.push({ from: n.id, to: "risk" });
    }
    if (["correlation", "volume", "probability", "confidence", "reasoning", "portfolio"].includes(n.id)) {
      EDGES.push({ from: n.id, to: "risk" });
      EDGES.push({ from: n.id, to: "position-manager" });
    }
    if (["exit"].includes(n.id)) {
      EDGES.push({ from: n.id, to: "execution" });
      EDGES.push({ from: n.id, to: "position-manager" });
    }
    if (["system-audit"].includes(n.id)) {
      EDGES.push({ from: n.id, to: "learning" });
      EDGES.push({ from: n.id, to: "memory" });
    }
  } else if (n.ring === "inner") {
    EDGES.push({ from: n.id, to: "orchestrator" });
  }
}

// ── Status Simulation (deterministic) ──────────────────────────────

function getSimulatedStatus(agentId: string): "active" | "idle" | "error" {
  let hash = 0;
  for (let i = 0; i < agentId.length; i++) {
    hash = (hash * 31 + agentId.charCodeAt(i)) & 0xffffffff;
  }
  const v = hash % 100;
  if (v < 65) return "active";
  if (v < 90) return "idle";
  return "error";
}

function getStatusColor(status: "active" | "idle" | "error") {
  if (status === "active") return "#00e676";
  if (status === "idle") return "#ffab00";
  return "#ff3d00";
}

// ── Layout computation ─────────────────────────────────────────────
// Canvas: 1200 x 900 (React Flow coordinates)
// Center: AI Model node (largest, diamond-like glow)
// Ring 0: Orchestrator — just below model
// Ring 1: Inner core agents — tight arc
// Ring 2: Intelligence agents — mid arc
// Ring 3: Analysis agents — outer arc
// Ring 4: Execution/Monitoring — outermost arc

function computeLayout(): Map<string, { x: number; y: number; size: number }> {
  const map = new Map<string, { x: number; y: number; size: number }>();
  const CX = 600;
  const MODEL_Y = 300; // AI Model at true center

  // AI Model — largest, at true center
  map.set("ai-model", { x: CX, y: MODEL_Y, size: 70 });

  // Orchestrator — just below the model
  map.set("orchestrator", { x: CX, y: MODEL_Y + 80, size: 48 });

  // Group agents by role level
  const intelligenceAgents = AGENT_NODES.filter(
    (n) => n.role === "Intelligence" && n.ring !== "inner"
  );
  const analysisAgents = AGENT_NODES.filter(
    (n) => n.role === "Analysis" && n.ring !== "inner"
  );
  const innerAgents = AGENT_NODES.filter(
    (n) => n.ring === "inner"
  );

  // Arc positioning helper
  function placeArc(
    agents: AgentNode[],
    centerX: number,
    centerY: number,
    radius: number,
    startAngle: number,
    endAngle: number,
    size: number
  ) {
    const count = agents.length;
    agents.forEach((agent, i) => {
      const angle =
        count === 1
          ? (startAngle + endAngle) / 2
          : startAngle + (i / (count - 1)) * (endAngle - startAngle);
      map.set(agent.id, {
        x: centerX + radius * Math.cos(angle),
        y: centerY + radius * Math.sin(angle),
        size,
      });
    });
  }

  // Inner core agents — tight arc below orchestrator
  placeArc(innerAgents, CX, MODEL_Y + 160, 130, Math.PI * 0.22, Math.PI * 0.78, 30);

  // Level 1: Intelligence (10) — mid arc
  placeArc(
    intelligenceAgents,
    CX,
    MODEL_Y + 80,
    300,
    Math.PI * 0.08,
    Math.PI * 0.92,
    24
  );

  // Level 2: Analysis — outer arc
  placeArc(
    analysisAgents,
    CX,
    MODEL_Y + 60,
    400,
    Math.PI * 0.08,
    Math.PI * 0.92,
    24
  );

  // Level 3: rest — outermost arc
  const remainingOuter = AGENT_NODES.filter(
    (n) => n.ring === "outer" && !map.has(n.id)
  );
  if (remainingOuter.length > 0) {
    placeArc(
      remainingOuter,
      CX,
      MODEL_Y + 50,
      490,
      Math.PI * 0.08,
      Math.PI * 0.92,
      24
    );
  }

  return map;
}

const layoutMap = computeLayout();

// ── React Flow Node Data ───────────────────────────────────────────

interface AgentFlowData {
  agent: AgentNode;
  status: "active" | "idle" | "error";
  isSelected: boolean;
  isHighlighted: boolean;
  onClick: (id: string) => void;
}

// ── Custom Node Component ──────────────────────────────────────────

function AgentFlowNode({ data, selected }: NodeProps) {
  const { agent, status, isHighlighted } = data as AgentFlowData;
  const statusColor = getStatusColor(status);
  const isModel = agent.id === "ai-model";
  const isOrchestrator = agent.id === "orchestrator" && !isModel;
  const nodeSize = isModel ? 56 : isOrchestrator ? 42 : agent.ring === "inner" ? 30 : 24;
  const fontSize = isModel ? 28 : isOrchestrator ? 18 : agent.ring === "inner" ? 10 : 8;


  return (
    <div
      className={`agent-flow-node${isModel ? " model-node" : ""}`}
      style={{
        position: "relative",
        width: nodeSize * 2 + 24,
        height: nodeSize * 2 + 32,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        filter: isHighlighted
          ? `drop-shadow(0 0 ${isModel ? 24 : 14}px ${agent.glowColor})`
          : `drop-shadow(0 0 ${isModel ? 8 : 4}px ${agent.glowColor})`,
        transition: "filter 0.3s ease, transform 0.3s ease",
        transform: selected ? "scale(1.08)" : "scale(1)",
      }}
    >
      {/* Invisible handles for edge connections */}
      <Handle
        type="target"
        position={Position.Top}
        style={{ opacity: 0, width: 1, height: 1 }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ opacity: 0, width: 1, height: 1 }}
      />

      {/* Glow ring — extra large for model */}
      <div
        className={isModel ? "model-glow" : isOrchestrator ? "orchestrator-glow" : ""}
        style={{
          position: "absolute",
          width: nodeSize * 2 + (isModel ? 32 : 16),
          height: nodeSize * 2 + (isModel ? 32 : 16),
          borderRadius: isModel ? "30%" : "50%",
          border: `2px solid ${isModel ? "rgba(0,230,118,0.6)" : agent.glowColor}`,
          transform: isModel ? "rotate(45deg)" : "none",
          opacity: selected ? 0.7 : 0.2,
          animation:
            status === "active"
              ? `${isModel ? "modelPulse" : "agentPulse"} ${isModel ? 2 : isOrchestrator ? 2 : 3}s ease-in-out infinite`
              : "none",
          transition: "opacity 0.3s",
        }}
      />

      {/* Status ring */}
      {!isModel && (
        <div
          style={{
            position: "absolute",
            width: nodeSize * 2 + 6,
            height: nodeSize * 2 + 6,
            borderRadius: "50%",
            border: `2px solid ${statusColor}`,
            opacity: 0.7,
          }}
        />
      )}

      {/* Main node circle (diamond for model) */}
      <div
        style={{
          width: nodeSize * 2,
          height: nodeSize * 2,
          borderRadius: isModel ? "28%" : "50%",
          transform: isModel ? "rotate(45deg)" : "none",
          background: isModel
            ? `radial-gradient(circle at 35% 35%, rgba(0,230,118,0.5), rgba(0,188,212,0.2) 60%, rgba(0,230,118,0.08) 100%)`
            : `radial-gradient(circle at 35% 35%, ${agent.color}88, ${agent.color}22 60%, ${agent.color}11 100%)`,
          border: `2px solid ${isModel ? "rgba(0,230,118,0.8)" : agent.color}66`,
          boxShadow: isModel ? "0 0 24px rgba(0,230,118,0.3), inset 0 0 16px rgba(0,230,118,0.1)" : "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Inner highlight */}
        <div
          style={{
            position: "absolute",
            top: "15%",
            left: "25%",
            width: "30%",
            height: "25%",
            borderRadius: "50%",
            background: `radial-gradient(ellipse, ${isModel ? "rgba(0,255,135,0.6)" : agent.color}44, transparent)`,
            opacity: 0.6,
          }}
        />

        {/* Icon — counter-rotate for model so icon stays upright */}
        <span
          style={{
            fontSize: `${fontSize}px`,
            lineHeight: 1,
            zIndex: 1,
            transform: isModel ? "rotate(-45deg)" : "none",
            filter: "drop-shadow(0 0 3px rgba(0,0,0,0.5))",
          }}
        >
          {agent.icon}
        </span>
      </div>

      {/* Label */}
      <span
        style={{
          fontSize: isModel ? "10px" : isOrchestrator ? "10px" : "8px",
          fontWeight: isModel ? 900 : isOrchestrator ? 800 : 600,
          fontFamily: "'JetBrains Mono', monospace",
          color: isModel ? "#00e676" : isOrchestrator ? "#ffab00" : "#b0bec5",
          marginTop: 6,
          textAlign: "center",
          letterSpacing: "0.5px",
          whiteSpace: "nowrap",
          maxWidth: nodeSize * 2 + 20,
        }}
      >
        {agent.displayName}
      </span>
    </div>
  );
}

// ── Custom Edge with Animated Particles ────────────────────────────

function AnimatedFlowEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  // Deterministic animation delay based on edge id
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) & 0xffff;
  }
  const animDelay = (hash % 3000) / 1000;
  const animDuration = 2.5 + (hash % 1500) / 1000;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: selected ? "rgba(0,230,118,0.5)" : "rgba(255,255,255,0.06)",
          strokeWidth: selected ? 1.5 : 0.5,
          strokeDasharray: selected ? "5 4" : "3 8",
          transition: "all 0.3s ease",
        }}
      />
      {/* Animated particles along edge */}
      <EdgeLabelRenderer>
        <div
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: "none",
          }}
        >
          {[0, 0.33, 0.66].map((offset) => (
            <div
              key={offset}
              style={{
                position: "absolute",
                width: 4,
                height: 4,
                borderRadius: "50%",
                background: selected
                  ? "rgba(0,230,118,0.8)"
                  : "rgba(0,188,212,0.3)",
                boxShadow: selected
                  ? "0 0 6px rgba(0,230,118,0.6)"
                  : "0 0 3px rgba(0,188,212,0.2)",
                animation: `particleFlow ${animDuration}s linear infinite`,
                animationDelay: `${animDelay + offset * (animDuration / 3)}s`,
                opacity: 0,
              }}
            />
          ))}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

// ── Node Types Registration ────────────────────────────────────────

const nodeTypes = {
  agentNode: AgentFlowNode,
};

const edgeTypes = {
  animatedEdge: AnimatedFlowEdge,
};

// ── Build React Flow Nodes & Edges from Data ───────────────────────

function buildFlowNodes(
  highlightedId: string | null,
  selectedId: string | null,
  onClick: (id: string) => void,
  modelStatus: "active" | "idle" | "error"
): Node<AgentFlowData>[] {
  const allNodes: AgentNode[] = [MODEL_NODE, ...AGENT_NODES];
  return allNodes.map((agent) => {
    const pos = layoutMap.get(agent.id) ?? { x: 0, y: 0, size: 28 };
    const isHighlighted =
      (highlightedId || selectedId) != null &&
      agent.id !== highlightedId &&
      agent.id !== selectedId
        ? false
        : true;
    const isDimmed =
      (highlightedId || selectedId) != null &&
      agent.id !== highlightedId &&
      agent.id !== selectedId;

    const status = agent.id === "ai-model" ? modelStatus : getSimulatedStatus(agent.id);

    return {
      id: agent.id,
      type: "agentNode",
      position: {
        x: pos.x - pos.size,
        y: pos.y - pos.size,
      },
      data: {
        agent,
        status,
        isSelected: selectedId === agent.id,
        isHighlighted,
        onClick,
      },
      style: {
        opacity: isDimmed ? 0.3 : 1,
        transition: "opacity 0.3s ease",
      },
      draggable: agent.id !== "ai-model",
      selectable: true,
    };
  });
}

function buildFlowEdges(highlightedId: string | null, selectedId: string | null): Edge[] {
  const focusId = highlightedId ?? selectedId;
  const allEdges = [...MODEL_EDGES, ...EDGES];
  return allEdges.map((edge, i) => {
    const isSelected =
      focusId != null && (edge.from === focusId || edge.to === focusId);
    const isModelEdge = edge.from === "ai-model" || edge.to === "ai-model";
    return {
      id: `${edge.from}->${edge.to}-${i}`,
      source: edge.from,
      target: edge.to,
      type: "animatedEdge",
      animated: true,
      selected: isSelected,
      style: {
        stroke: isSelected
          ? "rgba(0,230,118,0.5)"
          : isModelEdge
          ? "rgba(0,230,118,0.15)"
          : "rgba(255,255,255,0.06)",
        strokeWidth: isSelected ? 1.5 : isModelEdge ? 0.8 : 0.5,
        transition: "all 0.3s ease",
      },
    };
  });
}

// ── Main Component ──────────────────────────────────────────────────

export function AgentNetworkGraph() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [modelDetails, setModelDetails] = useState<ModelDetails>(defaultModelDetails);
  const [modelStatus, setModelStatus] = useState<"active" | "idle" | "error">("active");

  // ── Scan local AI + detect active provider on mount ────────────────
  useEffect(() => {
    let cancelled = false;
    async function detectModel() {
      setModelStatus("idle");
      try {
        // 1. Check for local AI servers
        const localResult = await findAvailableLocalSource();
        // 2. Check cloud providers
        const cloudProviders = getAvailableProviders();

        if (localResult) {
          const sourceName =
            localResult.source === "ollama" ? "Ollama" :
            localResult.source === "lmStudio" ? "LM Studio" :
            localResult.source === "llamaCpp" ? "llama.cpp" :
            localResult.source === "textGenWebUI" ? "Oobabooga" :
            localResult.source === "jan" ? "Jan AI" :
            localResult.source === "openWebUI" ? "Open WebUI" : localResult.source;
          if (!cancelled) {
            setModelDetails({
              name: sourceName,
              provider: "local",
              source: localResult.source,
              status: "active",
              memoryUsage: "Local instance",
            });
            setModelStatus("active");
          }
        } else if (cloudProviders.length > 0) {
          if (!cancelled) {
            setModelDetails({
              name: cloudProviders.includes("deepseek") ? "DeepSeek V4 Pro" :
                    cloudProviders.includes("openai") ? "GPT-4o" :
                    cloudProviders.includes("grok") ? "Grok" :
                    cloudProviders.includes("gemini") ? "Gemini Pro" : "Cloud LLM",
              provider: "cloud",
              source: cloudProviders[0],
              status: "active",
              memoryUsage: "N/A (cloud)",
            });
            setModelStatus("active");
          }
        } else {
          if (!cancelled) {
            setModelDetails({ ...defaultModelDetails, status: "offline", name: "No provider detected" });
            setModelStatus("error");
          }
        }
      } catch {
        if (!cancelled) {
          setModelDetails({ ...defaultModelDetails, status: "offline" });
          setModelStatus("error");
        }
      }
    }
    detectModel();
    return () => { cancelled = true; };
  }, []);

  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      setSelectedId((prev) => (prev === node.id ? null : node.id));
    },
    []
  );

  const onNodeMouseEnter = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      setHoveredId(node.id);
    },
    []
  );

  const onNodeMouseLeave = useCallback(() => {
    setHoveredId(null);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedId(null);
  }, []);

  // Build nodes and edges reactively
  const initialNodes = useMemo(
    () => buildFlowNodes(hoveredId, selectedId, setSelectedId, modelStatus),
    [hoveredId, selectedId, modelStatus]
  );
  const initialEdges = useMemo(
    () => buildFlowEdges(hoveredId, selectedId),
    [hoveredId, selectedId]
  );

  const [nodes, _setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, _setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Keep nodes/edges in sync when selection changes
  const syncedNodes = useMemo(() => {
    return nodes.map((n) => {
      const fresh = initialNodes.find((fn) => fn.id === n.id);
      if (fresh) {
        return { ...n, data: fresh.data, style: fresh.style, selected: fresh.data.isSelected };
      }
      return n;
    });
  }, [nodes, initialNodes]);

  const syncedEdges = useMemo(() => {
    return edges.map((e) => {
      const fresh = initialEdges.find((fe) => fe.id === e.id);
      if (fresh) {
        return { ...e, selected: fresh.selected, style: fresh.style };
      }
      return e;
    });
  }, [edges, initialEdges]);

  const allAgents = useMemo(() => [MODEL_NODE, ...AGENT_NODES], []);
  const selectedNode = useMemo(
    () => allAgents.find((n) => n.id === selectedId) ?? null,
    [selectedId, allAgents]
  );
  const isModelSelected = selectedId === "ai-model";

  return (
    <div
      className="relative w-full"
      style={{ height: "min(80vh, 800px)", minHeight: "600px" }}
    >
      {/* ── React Flow Graph ────────────────────────────────── */}
      <ReactFlow
        nodes={syncedNodes}
        edges={syncedEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onNodeMouseEnter={onNodeMouseEnter}
        onNodeMouseLeave={onNodeMouseLeave}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        minZoom={0.3}
        maxZoom={1.8}
        defaultViewport={{ x: 0, y: 0, zoom: 0.85 }}
        attributionPosition="bottom-right"
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable
        proOptions={{ hideAttribution: true }}
        style={{ background: "transparent" }}
      >
        {/* Dark grid background */}
        <Background
          color="rgba(0, 188, 212, 0.05)"
          gap={24}
          size={1.5}
          style={{ backgroundColor: "#080a0f" }}
        />
        <Controls
          style={{
            background: "#0d1117",
            border: "1px solid #1a1f2e",
            borderRadius: "8px",
          }}
        />
      </ReactFlow>

      {/* ── Agent Detail Card (Framer Motion) ──────────────────── */}
      <AnimatePresence>
        {selectedNode && !isModelSelected && (
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.96 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="absolute bottom-4 right-4 w-80 max-w-[calc(100%-2rem)] z-20"
            style={{
              background: "rgba(13, 17, 23, 0.92)",
              backdropFilter: "blur(16px)",
              WebkitBackdropFilter: "blur(16px)",
              border: "1px solid #1a1f2e",
              borderRadius: "12px",
              padding: "20px",
              boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
              maxHeight: "360px",
              overflowY: "auto",
            }}
          >
            {/* Close button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                setSelectedId(null);
              }}
              className="absolute top-3 right-3 text-gray-400 hover:text-white text-lg leading-none transition-colors"
            >
              ×
            </button>

            <div className="flex items-center gap-3 mb-3">
              <span className="text-2xl">{selectedNode.icon}</span>
              <div>
                <h3 className="text-white font-bold text-sm">
                  {selectedNode.name}
                </h3>
                <span
                  className="text-xs font-mono px-2 py-0.5 rounded-full inline-block mt-0.5"
                  style={{
                    background: `${selectedNode.color}18`,
                    color: selectedNode.color,
                    border: `1px solid ${selectedNode.color}33`,
                  }}
                >
                  {selectedNode.role}
                </span>
              </div>
              <div className="ml-auto flex items-center gap-1.5">
                <span
                  className="inline-block w-2 h-2 rounded-full"
                  style={{
                    backgroundColor: getStatusColor(
                      getSimulatedStatus(selectedNode.id)
                    ),
                    boxShadow: `0 0 6px ${getStatusColor(getSimulatedStatus(selectedNode.id))}`,
                  }}
                />
                <span className="text-xs text-gray-400 font-mono uppercase">
                  {getSimulatedStatus(selectedNode.id)}
                </span>
              </div>
            </div>

            <p className="text-gray-400 text-xs leading-relaxed mb-3">
              {selectedNode.description}
            </p>

            <div className="space-y-2 text-xs">
              <div className="flex justify-between py-1.5 border-b border-[#1a1f2e]">
                <span className="text-gray-500">Ring</span>
                <span className="text-white capitalize font-mono">
                  {selectedNode.ring === "center"
                    ? "Master"
                    : selectedNode.ring === "inner"
                    ? "Core"
                    : "Specialized"}
                </span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-[#1a1f2e]">
                <span className="text-gray-500">Connections</span>
                <span className="text-[#00bcd4] font-mono">
                  {
                    EDGES.filter(
                      (e) =>
                        e.from === selectedNode.id || e.to === selectedNode.id
                    ).length
                  }
                </span>
              </div>
              <div className="flex justify-between py-1.5">
                <span className="text-gray-500">Level</span>
                <span className="text-[#00e676] font-mono">
                  {selectedNode.ring === "center"
                    ? "Orchestrator"
                    : selectedNode.ring === "inner"
                    ? "Core Decision"
                    : selectedNode.role === "Intelligence"
                    ? "Level 1 · Intelligence"
                    : selectedNode.role === "Analysis"
                    ? "Level 2 · Analysis"
                    : "Level 3 · Execution"}
                </span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Model Info Panel (when clicking the AI Model node) ──── */}
      <AnimatePresence>
        {isModelSelected && (
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.96 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="absolute bottom-4 right-4 w-80 max-w-[calc(100%-2rem)] z-20"
            style={{
              background: "rgba(13, 17, 23, 0.92)",
              backdropFilter: "blur(16px)",
              WebkitBackdropFilter: "blur(16px)",
              border: "1px solid #00e67633",
              borderRadius: "12px",
              padding: "20px",
              boxShadow: "0 8px 32px rgba(0,230,118,0.15)",
              maxHeight: "420px",
              overflowY: "auto",
            }}
          >
            {/* Close button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                setSelectedId(null);
              }}
              className="absolute top-3 right-3 text-gray-400 hover:text-white text-lg leading-none transition-colors"
            >
              ×
            </button>

            {/* Header */}
            <div className="flex items-center gap-3 mb-4">
              <div
                className="text-2xl w-10 h-10 flex items-center justify-center rounded-xl"
                style={{
                  background: "rgba(0,230,118,0.12)",
                  border: "1px solid rgba(0,230,118,0.3)",
                }}
              >
                🧠
              </div>
              <div>
                <h3 className="text-white font-bold text-sm">AI Model</h3>
                <span
                  className="text-xs font-mono px-2 py-0.5 rounded-full inline-block mt-0.5"
                  style={{
                    background: "rgba(0,230,118,0.12)",
                    color: "#00e676",
                    border: "1px solid rgba(0,230,118,0.3)",
                  }}
                >
                  {modelDetails.provider === "local" ? "Local" : "Cloud"}
                </span>
              </div>
              <div className="ml-auto flex items-center gap-1.5">
                <span
                  className="inline-block w-2 h-2 rounded-full"
                  style={{
                    backgroundColor:
                      modelStatus === "active" ? "#00e676" :
                      modelStatus === "idle" ? "#ffab00" : "#9e9e9e",
                    boxShadow: `0 0 6px ${
                      modelStatus === "active" ? "#00e676" :
                      modelStatus === "idle" ? "#ffab00" : "#9e9e9e"
                    }`,
                  }}
                />
                <span className="text-xs text-gray-400 font-mono uppercase">
                  {modelStatus}
                </span>
              </div>
            </div>

            {/* Model details */}
            <div className="space-y-2 text-xs mb-4">
              <div className="flex justify-between py-1.5 border-b border-[#1a1f2e]">
                <span className="text-gray-500">Model Name</span>
                <span className="text-white font-mono">{modelDetails.name}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-[#1a1f2e]">
                <span className="text-gray-500">Provider</span>
                <span className="text-[#00bcd4] font-mono capitalize">
                  {modelDetails.provider}
                  {modelDetails.source ? ` · ${modelDetails.source}` : ""}
                </span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-[#1a1f2e]">
                <span className="text-gray-500">Status</span>
                <span
                  className="font-mono capitalize"
                  style={{
                    color:
                      modelDetails.status === "active" ? "#00e676" :
                      modelDetails.status === "loading" ? "#ffab00" : "#9e9e9e",
                  }}
                >
                  {modelDetails.status}
                </span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-[#1a1f2e]">
                <span className="text-gray-500">Memory Usage</span>
                <span className="text-white font-mono">{modelDetails.memoryUsage}</span>
              </div>
              <div className="flex justify-between py-1.5">
                <span className="text-gray-500">Connected Agents</span>
                <span className="text-[#00e676] font-mono">
                  {AGENT_NODES.length}
                </span>
              </div>
            </div>

            {/* Switch Model button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                // Placeholder — opens settings or model selector in future iteration
              }}
              className="w-full py-2 px-4 text-xs font-semibold rounded-lg transition-colors"
              style={{
                background: "rgba(0,230,118,0.1)",
                color: "#00e676",
                border: "1px solid rgba(0,230,118,0.3)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(0,230,118,0.2)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "rgba(0,230,118,0.1)";
              }}
            >
              🔄 Switch Model
            </button>

            <p className="text-gray-500 text-xs mt-3 text-center">
              All {AGENT_NODES.length} agents are connected to this model
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Legend ────────────────────────────────────────────── */}
      <div
        className="absolute top-4 right-4 z-10 hidden md:block"
        style={{
          background: "rgba(13, 17, 23, 0.85)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          border: "1px solid #1a1f2e",
          borderRadius: "10px",
          padding: "12px 14px",
        }}
      >
        <h4 className="text-xs font-semibold text-gray-400 mb-2 font-mono tracking-wider">
          LEGEND
        </h4>
        {[
          { label: "AI Model", color: "#00e676" },
          { label: "Intelligence", color: "#00bcd4" },
          { label: "Analysis", color: "#00e676" },
          { label: "Decision", color: "#ffab00" },
          { label: "Execution", color: "#ff3d00" },
          { label: "Monitoring", color: "#7c4dff" },
        ].map((item) => (
          <div key={item.label} className="flex items-center gap-2 text-xs mb-1.5">
            <span
              className={`inline-block flex-shrink-0 ${item.label === "AI Model" ? "w-3 h-3 rotate-45 rounded-sm" : "w-3 h-3 rounded-full"}`}
              style={{
                backgroundColor: item.color,
                boxShadow: `0 0 6px ${item.color}66`,
              }}
            />
            <span className="text-gray-300">{item.label}</span>
          </div>
        ))}
      </div>

      {/* ── Particle Flow Keyframes (injected via style tag) ── */}
      <style>{`
        @keyframes agentPulse {
          0%, 100% { transform: scale(1); opacity: 0.2; }
          50% { transform: scale(1.08); opacity: 0.5; }
        }
        @keyframes modelPulse {
          0%, 100% { transform: rotate(45deg) scale(1); opacity: 0.2; }
          50% { transform: rotate(45deg) scale(1.10); opacity: 0.6; }
        }
        @keyframes particleFlow {
          0% { opacity: 0; }
          20% { opacity: 1; }
          80% { opacity: 1; }
          100% { opacity: 0; }
        }
        .orchestrator-glow {
          animation: orchestratorGlow 2.5s ease-in-out infinite !important;
        }
        .model-glow {
          animation: modelGlow 2s ease-in-out infinite !important;
        }
        @keyframes orchestratorGlow {
          0%, 100% { transform: scale(1); opacity: 0.3; }
          50% { transform: scale(1.06); opacity: 0.6; }
        }
        @keyframes modelGlow {
          0%, 100% { transform: rotate(45deg) scale(1); opacity: 0.3; }
          50% { transform: rotate(45deg) scale(1.08); opacity: 0.7; }
        }
      `}</style>
    </div>
  );
}

export { AGENT_NODES, EDGES };
