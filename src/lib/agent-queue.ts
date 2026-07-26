// ── Agent Queue & Pool ────────────────────────────────────────────────
// Manages a dynamic pool of agent slots with isolation guarantees:
//   - No agent handles more than one task simultaneously.
//   - New specialized agents are spawned on demand.
//   - Temporary agents are cleaned up when pool exceeds capacity.
//   - Full status tracking for the Kimi-style dashboard.
//
// Integrates with TaskRouter (task-router.ts) and SwarmOrchestrator.

import type { AgentRole } from "./agents/types";
import { AGENTS } from "./agents";

// ── Types ──────────────────────────────────────────────────────────

export type AgentSlotStatus = "idle" | "working" | "paused";

export interface AgentSlot {
  agentId: string;
  displayName: string;         // e.g., "Agent-3 (Frontend)"
  icon: string;                // emoji
  role: AgentRole | string;
  status: AgentSlotStatus;
  currentTask?: string;         // description of current work
  capacity: number;             // max concurrent subtasks (always 1 for isolation)
  isTemporary: boolean;         // spawned on demand vs permanent
  chainId?: string;             // linked chain for existing agents
  startedAt: number;            // epoch ms when agent was created/allocated
  tasksCompleted: number;
  totalTaskTimeMs: number;
}

export interface PoolSnapshot {
  total: number;
  idle: number;
  working: number;
  paused: number;
  temporary: number;
  agents: AgentSlot[];
}

// ── AgentPool Class ────────────────────────────────────────────────

const DEFAULT_MAX_AGENTS = 29;     // matches the 29-agent framework
const DEFAULT_MAX_TEMPORARY = 8;   // cap on temp agents to prevent runaway spawning
const IDLE_CLEANUP_THRESHOLD_MS = 300_000; // 5min — cleanup idle temps after this

let tempCounter = 0; // global counter for naming temporary agents

export class AgentPool {
  private agents: Map<string, AgentSlot>;
  private maxPoolSize: number;
  private maxTemporary: number;

  constructor(maxPoolSize: number = DEFAULT_MAX_AGENTS) {
    this.agents = new Map();
    this.maxPoolSize = maxPoolSize;
    this.maxTemporary = DEFAULT_MAX_TEMPORARY;
    this.seed();
  }

  // ── Seeding ────────────────────────────────────────────────────

  /** Seed the pool from the existing 22 permanent chain agents + 7 virtual roles. */
  private seed(): void {
    const chainAgents = Object.entries(AGENTS);
    for (const [chainId, config] of chainAgents) {
      const id = `agent-${chainId}`;
      this.agents.set(id, {
        agentId: id,
        displayName: `${config.icon} ${config.name} (${config.role})`,
        icon: config.icon,
        role: "market", // default role mapping
        status: "idle",
        currentTask: undefined,
        capacity: 1,
        isTemporary: false,
        chainId,
        startedAt: Date.now(),
        tasksCompleted: 0,
        totalTaskTimeMs: 0,
      });
    }

    // Add virtual role agents to reach 29
    const virtualRoles: { role: AgentRole; displayName: string; icon: string }[] = [
      { role: "reasoning", displayName: "🧠 Reasoner", icon: "🧠" },
      { role: "strategy", displayName: "🎯 Strategist", icon: "🎯" },
      { role: "risk", displayName: "🛡️ Risk Manager", icon: "🛡️" },
      { role: "execution", displayName: "⚡ Executor", icon: "⚡" },
      { role: "sentiment", displayName: "💬 Sentiment AI", icon: "💬" },
      { role: "macro", displayName: "🌍 Macro Analyst", icon: "🌍" },
      { role: "learning", displayName: "📚 Learning Engine", icon: "📚" },
    ];

    for (const vr of virtualRoles) {
      const id = `agent-v-${vr.role}`;
      if (!this.agents.has(id)) {
        this.agents.set(id, {
          agentId: id,
          displayName: vr.displayName,
          icon: vr.icon,
          role: vr.role,
          status: "idle",
          currentTask: undefined,
          capacity: 1,
          isTemporary: false,
          startedAt: Date.now(),
          tasksCompleted: 0,
          totalTaskTimeMs: 0,
        });
      }
    }
  }

  // ── Acquire / Release ──────────────────────────────────────────

  /** Find an idle agent or return null if all are busy. */
  acquire(preferredRole?: AgentRole): AgentSlot | null {
    // Preferred: idle agent matching the role
    if (preferredRole) {
      for (const agent of this.agents.values()) {
        if (agent.status === "idle" && agent.role === preferredRole) {
          agent.status = "working";
          return agent;
        }
      }
    }

    // Any idle agent
    for (const agent of this.agents.values()) {
      if (agent.status === "idle") {
        agent.status = "working";
        return agent;
      }
    }

    return null;
  }

  /** Mark an agent as done, free for next task. */
  release(agentId: string, taskDurationMs: number = 0): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    agent.status = "idle";
    agent.currentTask = undefined;
    agent.tasksCompleted += 1;
    agent.totalTaskTimeMs += taskDurationMs;
  }

  /** Assign a task to an agent (marks it working). */
  assign(agentId: string, taskDescription: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    agent.status = "working";
    agent.currentTask = taskDescription;
  }

  /** Pause an agent (keep its state but free from scheduling). */
  pause(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (agent && agent.status === "working") {
      agent.status = "paused";
    }
  }

  /** Resume a paused agent. */
  resume(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (agent && agent.status === "paused") {
      agent.status = "working";
    }
  }

  // ── Spawn / Destroy ────────────────────────────────────────────

  /**
   * Create a new specialized agent on demand.
   * Returns null if pool is at max capacity.
   */
  spawn(specialization: AgentRole | string): AgentSlot | null {
    // Enforce pool limits
    if (this.agents.size >= this.maxPoolSize) {
      console.warn(`[AgentPool] Max pool size (${this.maxPoolSize}) reached`);
      return null;
    }

    const tempCount = this.countTemporary();
    if (tempCount >= this.maxTemporary) {
      console.warn(`[AgentPool] Max temporary agents (${this.maxTemporary}) reached`);
      return null;
    }

    tempCounter++;
    const id = `agent-temp-${tempCounter}`;

    const slot: AgentSlot = {
      agentId: id,
      displayName: `🔧 Agent-Temp-${tempCounter} (${specialization})`,
      icon: "🔧",
      role: specialization as AgentRole,
      status: "working",
      currentTask: `Assigned: ${specialization}`,
      capacity: 1,
      isTemporary: true,
      startedAt: Date.now(),
      tasksCompleted: 0,
      totalTaskTimeMs: 0,
    };

    this.agents.set(id, slot);
    return slot;
  }

  /** Destroy a temporary agent by id. */
  destroy(agentId: string): boolean {
    const agent = this.agents.get(agentId);
    if (!agent || !agent.isTemporary) return false;
    this.agents.delete(agentId);
    return true;
  }

  /**
   * Clean up idle temporary agents that have been idle beyond threshold.
   * Also removes excess agents when pool is over the soft-cap (22 permanent).
   */
  cleanup(softCap: number = 22): number {
    const now = Date.now();
    let removed = 0;

    // Remove idle temporary agents beyond threshold
    for (const [id, agent] of this.agents) {
      if (
        agent.isTemporary &&
        agent.status === "idle" &&
        now - agent.startedAt > IDLE_CLEANUP_THRESHOLD_MS
      ) {
        this.agents.delete(id);
        removed++;
      }
    }

    // If still over softCap, remove oldest idle temporaries
    if (this.agents.size > softCap) {
      const idleTemps = [...this.agents.entries()]
        .filter(([, a]) => a.isTemporary && a.status === "idle")
        .sort(([, a], [, b]) => a.startedAt - b.startedAt);

      const toRemove = this.agents.size - softCap;
      for (let i = 0; i < Math.min(toRemove, idleTemps.length); i++) {
        this.agents.delete(idleTemps[i][0]);
        removed++;
      }
    }

    return removed;
  }

  // ── Queries ─────────────────────────────────────────────────────

  /** Number of idle (available) agents. */
  available(): number {
    let count = 0;
    for (const agent of this.agents.values()) {
      if (agent.status === "idle") count++;
    }
    return count;
  }

  /** Total agents in pool. */
  size(): number {
    return this.agents.size;
  }

  /** Get agent by id. */
  get(agentId: string): AgentSlot | undefined {
    return this.agents.get(agentId);
  }

  /** Count of temporary agents. */
  countTemporary(): number {
    let count = 0;
    for (const agent of this.agents.values()) {
      if (agent.isTemporary) count++;
    }
    return count;
  }

  /** All agents, sorted by status (working first) then name. */
  getAllAgents(): AgentSlot[] {
    const statusOrder: Record<AgentSlotStatus, number> = {
      working: 0,
      paused: 1,
      idle: 2,
    };

    return [...this.agents.values()].sort(
      (a, b) =>
        statusOrder[a.status] - statusOrder[b.status] ||
        a.displayName.localeCompare(b.displayName),
    );
  }

  /** Snapshot for the dashboard. */
  snapshot(): PoolSnapshot {
    let idle = 0;
    let working = 0;
    let paused = 0;
    let temporary = 0;

    for (const agent of this.agents.values()) {
      switch (agent.status) {
        case "idle": idle++; break;
        case "working": working++; break;
        case "paused": paused++; break;
      }
      if (agent.isTemporary) temporary++;
    }

    return {
      total: this.agents.size,
      idle,
      working,
      paused,
      temporary,
      agents: this.getAllAgents(),
    };
  }

  // ── Status icon helpers ─────────────────────────────────────────

  static statusIcon(status: AgentSlotStatus): string {
    switch (status) {
      case "working": return "🟢";
      case "paused": return "🟡";
      case "idle": return "⚪";
    }
  }

  static statusColor(status: AgentSlotStatus): string {
    switch (status) {
      case "working": return "green";
      case "paused": return "yellow";
      case "idle": return "gray";
    }
  }
}

// ── Singleton ─────────────────────────────────────────────────────

let _defaultPool: AgentPool | null = null;

export function getAgentPool(): AgentPool {
  if (!_defaultPool) {
    _defaultPool = new AgentPool();
  }
  return _defaultPool;
}

export function resetAgentPool(): void {
  _defaultPool = null;
}
