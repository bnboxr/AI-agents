// ── Agent Network Graph — Circular Visualization ─────────────────────
// SVG-based interactive graph showing all 29 HSMC agents and their
// communication topology. No external library dependency — pure SVG + CSS.
import { useState, useMemo, useCallback } from "react";

// ── Agent Data ──────────────────────────────────────────────────────

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
  // ── OUTER RING — 23 Specialized Agents ──────────────────────
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

// ── Communication Edges ────────────────────────────────────────────

interface GraphEdge {
  from: string;
  to: string;
}

// All outer agents talk to inner agents; inner agents talk to orchestrator
const EDGES: GraphEdge[] = [];

// Build edges: all outer → inner, all inner → center
for (const n of AGENT_NODES) {
  if (n.ring === "outer") {
    // Connect to relevant inner agents
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

// ── Layout Constants ──────────────────────────────────────────────

const CENTER_X = 460;
const CENTER_Y = 360;
const INNER_RADIUS = 110;
const OUTER_RADIUS = 260;
const NODE_RADIUS_SM = 20;
const NODE_RADIUS_MD = 28;
const NODE_RADIUS_LG = 42;

// ── Position Computation ──────────────────────────────────────────

function getNodePosition(node: AgentNode, index: number, total: number) {
  if (node.ring === "center") {
    return { x: CENTER_X, y: CENTER_Y, r: NODE_RADIUS_LG };
  }

  const innerNodes = AGENT_NODES.filter((n) => n.ring === "inner");
  const outerNodes = AGENT_NODES.filter((n) => n.ring === "outer");

  const ringNodes = node.ring === "inner" ? innerNodes : outerNodes;
  const radius = node.ring === "inner" ? INNER_RADIUS : OUTER_RADIUS;
  const r = node.ring === "inner" ? NODE_RADIUS_MD : NODE_RADIUS_SM;
  const idx = ringNodes.findIndex((n) => n.id === node.id);
  const angle = (idx / ringNodes.length) * 2 * Math.PI - Math.PI / 2;

  return {
    x: CENTER_X + radius * Math.cos(angle),
    y: CENTER_Y + radius * Math.sin(angle),
    r,
  };
}

// ── Status Simulation ─────────────────────────────────────────────

function getSimulatedStatus(agentId: string): "active" | "idle" | "error" {
  // Deterministic pseudo-random based on agent ID
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

// ── SVG Path for Edge ─────────────────────────────────────────────

function edgePath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  r1: number,
  r2: number
): string {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 0.01) return "";
  const ux = dx / dist;
  const uy = dy / dist;
  const sx = x1 + ux * (r1 + 3);
  const sy = y1 + uy * (r1 + 3);
  const ex = x2 - ux * (r2 + 3);
  const ey = y2 - uy * (r2 + 3);
  // Quadratic bezier for a slight curve
  const mx = (sx + ex) / 2;
  const my = (sy + ey) / 2 - 15;
  return `M${sx},${sy} Q${mx},${my} ${ex},${ey}`;
}

// ── Main Component ──────────────────────────────────────────────────

export function AgentNetworkGraph() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // Precompute positions
  const posMap = useMemo(() => {
    const map = new Map<string, { x: number; y: number; r: number }>();
    for (const node of AGENT_NODES) {
      map.set(node.id, getNodePosition(node, 0, AGENT_NODES.length));
    }
    return map;
  }, []);

  // Which edges to highlight
  const highlightedEdges = useMemo(() => {
    if (!hoveredId && !selectedId) return new Set<string>();
    const focusId = hoveredId ?? selectedId!;
    const connected = new Set<string>();
    for (const e of EDGES) {
      if (e.from === focusId || e.to === focusId) {
        connected.add(`${e.from}->${e.to}`);
      }
    }
    return connected;
  }, [hoveredId, selectedId]);

  const selectedNode = useMemo(
    () => AGENT_NODES.find((n) => n.id === selectedId) ?? null,
    [selectedId]
  );

  return (
    <div className="relative w-full">
      {/* ── SVG Canvas ─────────────────────────────────────── */}
      <svg
        viewBox="0 0 920 720"
        className="w-full h-auto max-h-[80vh]"
        style={{ background: "transparent" }}
      >
        {/* Background glow rings */}
        <circle
          cx={CENTER_X}
          cy={CENTER_Y}
          r={INNER_RADIUS}
          fill="none"
          stroke="rgba(255,171,0,0.06)"
          strokeWidth={1}
          strokeDasharray="6 4"
        />
        <circle
          cx={CENTER_X}
          cy={CENTER_Y}
          r={OUTER_RADIUS}
          fill="none"
          stroke="rgba(0,188,212,0.04)"
          strokeWidth={1}
          strokeDasharray="4 6"
        />

        {/* ── Edges ─────────────────────────────────────── */}
        {EDGES.map((edge, i) => {
          const fromPos = posMap.get(edge.from);
          const toPos = posMap.get(edge.to);
          if (!fromPos || !toPos) return null;
          const key = `${edge.from}->${edge.to}`;
          const isHighlighted = highlightedEdges.has(key);
          return (
            <g key={i}>
              <path
                d={edgePath(fromPos.x, fromPos.y, toPos.x, toPos.y, fromPos.r, toPos.r)}
                fill="none"
                stroke={isHighlighted ? "rgba(0,230,118,0.5)" : "rgba(255,255,255,0.06)"}
                strokeWidth={isHighlighted ? 1.5 : 0.5}
                strokeDasharray={isHighlighted ? "4 3" : "3 6"}
                className={isHighlighted ? "edge-glow" : ""}
              />
              {/* Animated dot along path for highlighted edges */}
              {isHighlighted && (
                <circle r={3} fill="#00e676" opacity={0.8}>
                  <animateMotion
                    dur="2s"
                    repeatCount="indefinite"
                    path={edgePath(fromPos.x, fromPos.y, toPos.x, toPos.y, fromPos.r, toPos.r)}
                  />
                </circle>
              )}
            </g>
          );
        })}

        {/* ── Nodes ─────────────────────────────────────── */}
        {AGENT_NODES.map((node) => {
          const pos = posMap.get(node.id)!;
          const status = node.ring === "center" ? "active" : getSimulatedStatus(node.id);
          const statusColor = getStatusColor(status);
          const isSelected = selectedId === node.id;
          const isHovered = hoveredId === node.id;
          const isDimmed =
            (hoveredId || selectedId) && !isHovered && !isSelected;

          return (
            <g
              key={node.id}
              transform={`translate(${pos.x},${pos.y})`}
              className="cursor-pointer"
              style={{ opacity: isDimmed ? 0.35 : 1, transition: "opacity 0.3s" }}
              onMouseEnter={() => setHoveredId(node.id)}
              onMouseLeave={() => setHoveredId(null)}
              onClick={() =>
                setSelectedId(selectedId === node.id ? null : node.id)
              }
            >
              {/* Glow ring */}
              <circle
                r={pos.r + 8}
                fill="none"
                stroke={node.glowColor}
                strokeWidth={isSelected || isHovered ? 3 : 1}
                className={node.ring === "center" ? "animate-glow-pulse" : ""}
                style={{
                  opacity: isSelected || isHovered ? 0.6 : 0.15,
                  transition: "all 0.3s",
                }}
              />
              {/* Outer ring (status indicator) */}
              <circle
                r={pos.r + 3}
                fill="none"
                stroke={statusColor}
                strokeWidth={2}
                opacity={0.8}
                className={
                  status === "active" ? "animate-pulse-slow" : ""
                }
              />
              {/* Main circle */}
              <circle
                r={pos.r}
                fill={node.color}
                opacity={0.25}
                stroke={node.color}
                strokeWidth={1.5}
              />
              {/* Inner filled circle */}
              <circle r={pos.r - 3} fill={node.color} opacity={0.15} />
              {/* Icon / text */}
              <text
                textAnchor="middle"
                dy={node.ring === "center" ? "0.35em" : "0.35em"}
                style={{
                  fontSize:
                    node.ring === "center"
                      ? "22px"
                      : node.ring === "inner"
                      ? "10px"
                      : "8px",
                  fill: "#e0e6ed",
                  fontWeight: 700,
                  fontFamily: "'JetBrains Mono', monospace",
                  pointerEvents: "none",
                }}
              >
                {node.ring === "center"
                  ? node.icon
                  : node.displayName.slice(0, 4)}
              </text>
              {/* Node label */}
              <text
                textAnchor="middle"
                dy={pos.r + 16}
                style={{
                  fontSize: node.ring === "center" ? "11px" : "8px",
                  fill: node.ring === "center" ? "#ffab00" : "#b0bec5",
                  fontWeight: node.ring === "center" ? 800 : 500,
                  fontFamily: "'JetBrains Mono', monospace",
                  pointerEvents: "none",
                  letterSpacing: "0.5px",
                }}
              >
                {node.displayName}
              </text>
            </g>
          );
        })}
      </svg>

      {/* ── Detail Panel ─────────────────────────────────────── */}
      {selectedNode && (
        <div className="absolute bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-80 glass-card p-5 animate-slide-in-right z-10 max-h-[320px] overflow-y-auto">
          <button
            onClick={() => setSelectedId(null)}
            className="absolute top-2 right-3 text-gray-400 hover:text-white text-lg leading-none"
          >
            ×
          </button>
          <div className="flex items-center gap-3 mb-3">
            <span className="text-2xl">{selectedNode.icon}</span>
            <div>
              <h3 className="text-white font-bold text-sm">{selectedNode.name}</h3>
              <span
                className="text-xs font-mono px-2 py-0.5 rounded-full"
                style={{
                  background: `${selectedNode.color}20`,
                  color: selectedNode.color,
                  border: `1px solid ${selectedNode.color}40`,
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
              <span className="text-xs text-gray-400 font-mono">
                {getSimulatedStatus(selectedNode.id).toUpperCase()}
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
              <span className="text-gray-500">Confidence</span>
              <span className="text-accent-green font-mono">
                {Math.round(50 + Math.random() * 45)}%
              </span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-[#1a1f2e]">
              <span className="text-gray-500">Last Signal</span>
              <span className="text-white font-mono">
                {["LONG", "SHORT", "NEUTRAL"][
                  Math.floor(Math.random() * 3)
                ]}
              </span>
            </div>
            <div className="flex justify-between py-1.5">
              <span className="text-gray-500">Connections</span>
              <span className="text-accent-cyan font-mono">
                {
                  EDGES.filter(
                    (e) => e.from === selectedNode.id || e.to === selectedNode.id
                  ).length
                }
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ── Legend ──────────────────────────────────────────── */}
      <div className="absolute top-4 right-4 glass-card p-3 space-y-1.5 hidden md:block">
        <h4 className="text-xs font-semibold text-gray-400 mb-2 font-mono tracking-wider">
          LEGEND
        </h4>
        {[
          { label: "Intelligence", color: "#00bcd4" },
          { label: "Analysis", color: "#00e676" },
          { label: "Decision", color: "#ffab00" },
          { label: "Execution", color: "#ff3d00" },
          { label: "Monitoring", color: "#7c4dff" },
        ].map((item) => (
          <div key={item.label} className="flex items-center gap-2 text-xs">
            <span
              className="inline-block w-3 h-3 rounded-full"
              style={{ backgroundColor: item.color }}
            />
            <span className="text-gray-300">{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export { AGENT_NODES, EDGES };
