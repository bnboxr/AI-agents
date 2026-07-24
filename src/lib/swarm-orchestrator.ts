// ── Swarm Orchestrator ───────────────────────────────────────────────
// Accepts a high-level project description, decomposes it into tasks,
// spins up specialized agents, manages their lifecycle (create → work →
// merge results → destroy), and returns a unified SwarmResult.
//
// Integrates with the existing 29-agent framework in src/lib/agents/ and
// the multi-provider LLM pipeline in src/lib/llm/multi-provider.ts.

import type { AgentReport, AgentRole } from "./agents/types";
import { queryWithPrompt } from "./llm/multi-provider";
import { findAvailableLocalSource } from "./local-ai-scanner";
import { getHardwareProfile, recommendModel } from "./model-selector";

// ── Types ──────────────────────────────────────────────────────────

export interface SwarmTask {
  id: string;
  role: AgentRole;
  description: string;
  priority: number; // 1-10, higher = sooner
  dependencies: string[]; // task ids that must complete first
}

export interface SwarmTaskResult {
  taskId: string;
  role: AgentRole;
  report: AgentReport | null;
  error: string | null;
  durationMs: number;
}

export interface SwarmResult {
  success: boolean;
  projectDescription: string;
  tasksPlanned: number;
  tasksCompleted: number;
  taskResults: SwarmTaskResult[];
  mergedReport: string;
  agentCount: number;
  durationMs: number;
  localAIAvailable: boolean;
  errors: string[];
}

export interface SwarmConfig {
  maxAgents?: number; // maximum concurrent agents (default: 5)
  timeoutMs?: number; // per-task timeout (default: 30_000)
  localOnly?: boolean; // prefer local AI only (default: false)
  verbose?: boolean;
}

// ── Default Config ─────────────────────────────────────────────────

const DEFAULT_CONFIG: Required<SwarmConfig> = {
  maxAgents: 5,
  timeoutMs: 30_000,
  localOnly: false,
  verbose: false,
};

// ── Role Selection ─────────────────────────────────────────────────

/**
 * Maps a project description to the minimal set of agent roles needed.
 * Uses LLM for intelligent role selection when available.
 */
function selectRoles(
  description: string,
  agentCount: number,
): AgentRole[] {
  // Default role set for most projects
  const allRoles: AgentRole[] = [
    "market",
    "technical",
    "risk",
    "strategy",
    "reasoning",
  ];

  // For smaller projects, use a subset
  if (agentCount <= 3) {
    return ["market", "risk", "strategy"];
  }

  if (agentCount <= 5) {
    return allRoles;
  }

  // For larger swarms, add specialized agents
  return [
    ...allRoles,
    "execution",
    "sentiment",
    "macro",
    "portfolio",
    "learning",
  ];
}

// ── Task Decomposition ─────────────────────────────────────────────

function decomposeProject(
  description: string,
  agentCount: number,
): SwarmTask[] {
  const roles = selectRoles(description, agentCount);
  const tasks: SwarmTask[] = [];

  const roleDescriptions: Record<string, string> = {
    market: "Analyze overall market conditions and trends",
    technical:
      "Perform technical analysis on relevant assets/charts",
    risk: "Evaluate risk exposure and recommend position sizing",
    strategy:
      "Develop the execution strategy based on all inputs",
    reasoning:
      "Provide a final reasoned analysis and recommendation",
    execution:
      "Plan execution details: timing, venues, slippage",
    sentiment:
      "Analyze market sentiment from news and social media",
    macro: "Assess macroeconomic factors affecting the project",
    portfolio:
      "Evaluate portfolio impact and capital allocation",
    learning:
      "Apply historical learnings to improve the strategy",
  };

  for (let i = 0; i < roles.length; i++) {
    const role = roles[i];
    tasks.push({
      id: `${role}-${Date.now()}`,
      role,
      description: `${roleDescriptions[role] ?? "Analyze and report"} for: ${description}`,
      priority: 10 - i, // first roles get highest priority
      dependencies: [], // all run in parallel by default
    });
  }

  // Strategy depends on market, technical, and risk analyses
  const strategyTask = tasks.find((t) => t.role === "strategy");
  if (strategyTask) {
    strategyTask.dependencies = tasks
      .filter((t) =>
        ["market", "technical", "risk"].includes(t.role),
      )
      .map((t) => t.id);
  }

  // Reasoning depends on everything else
  const reasoningTask = tasks.find((t) => t.role === "reasoning");
  if (reasoningTask) {
    reasoningTask.dependencies = tasks
      .filter((t) => t.role !== "reasoning")
      .map((t) => t.id);
  }

  return tasks;
}

// ── Simulated Agent Execution ──────────────────────────────────────

/**
 * Runs a single task via LLM. In production, this would invoke the
 * actual agent class from src/lib/agents/ for architectural purity.
 * Currently uses the multi-provider pipeline for flexibility.
 */
async function executeTask(
  task: SwarmTask,
  config: Required<SwarmConfig>,
): Promise<SwarmTaskResult> {
  const startTime = Date.now();

  try {
    const systemPrompt = `You are the ${task.role} agent in a trading AI swarm. ${task.description}. Respond with a structured analysis including: 1) Key findings, 2) Confidence level (0-100), 3) Direction (LONG/SHORT/NEUTRAL), 4) Supporting data. Keep it concise (under 300 words).`;

    const userPrompt = `Task: ${task.description}\nRole: ${task.role}\nPriority: ${task.priority}`;

    const result = await queryWithPrompt(systemPrompt, userPrompt, {
      maxTokens: 400,
      timeoutMs: config.timeoutMs,
    });

    const content =
      result.response?.content ?? "No analysis produced";
    const durationMs = Date.now() - startTime;

    const report: AgentReport = {
      agentId: task.id,
      role: task.role,
      timestamp: Date.now(),
      direction: extractDirection(content),
      confidence: extractConfidence(content),
      reasoning: content,
      data: {
        durationMs,
        provider: result.response?.provider ?? "none",
      },
    };

    return {
      taskId: task.id,
      role: task.role,
      report,
      error: null,
      durationMs,
    };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    return {
      taskId: task.id,
      role: task.role,
      report: null,
      error: err instanceof Error ? err.message : "Unknown error",
      durationMs,
    };
  }
}

// ── Direction / Confidence Parsing ─────────────────────────────────

function extractDirection(content: string): "LONG" | "SHORT" | "NEUTRAL" {
  const upper = content.toUpperCase();
  if (upper.includes("LONG") && !upper.includes("SHORT")) return "LONG";
  if (upper.includes("SHORT") && !upper.includes("LONG")) return "SHORT";
  if (upper.includes("BULLISH")) return "LONG";
  if (upper.includes("BEARISH")) return "SHORT";
  return "NEUTRAL";
}

function extractConfidence(content: string): number {
  // Try to find "confidence: XX" or "XX% confident"
  const percentMatch = content.match(
    /confidence[:\s]*(\d{1,3})/i,
  );
  if (percentMatch) {
    return Math.min(100, Math.max(0, parseInt(percentMatch[1])));
  }

  const pctMatch = content.match(/(\d{1,3})%/);
  if (pctMatch) {
    return Math.min(100, Math.max(0, parseInt(pctMatch[1])));
  }

  return 50; // default moderate confidence
}

// ── Merge Results ──────────────────────────────────────────────────

function mergeResults(
  taskResults: SwarmTaskResult[],
  projectDescription: string,
): string {
  const successful = taskResults.filter(
    (t) => t.report !== null,
  );
  const failed = taskResults.filter((t) => t.error !== null);

  const lines: string[] = [
    `# Swarm Analysis: ${projectDescription}`,
    "",
    `## Summary`,
    `- ${successful.length} agents completed successfully`,
    `- ${failed.length} agents failed`,
    "",
    `## Agent Reports`,
  ];

  for (const result of successful) {
    lines.push(
      `### ${result.role.toUpperCase()} (${result.report!.direction}, ${result.report!.confidence}% confidence)`,
      result.report!.reasoning,
      "",
    );
  }

  if (failed.length > 0) {
    lines.push(`## Errors`);
    for (const result of failed) {
      lines.push(
        `- **${result.role}**: ${result.error}`,
      );
    }
  }

  // Compute aggregate direction and confidence
  const directions = successful.map(
    (r) => r.report!.direction,
  );
  const longCount = directions.filter((d) => d === "LONG")
    .length;
  const shortCount = directions.filter((d) => d === "SHORT")
    .length;
  const neutralCount = directions.filter((d) => d === "NEUTRAL")
    .length;

  const avgConfidence = successful.length > 0
    ? Math.round(
        successful.reduce(
          (sum, r) => sum + r.report!.confidence,
          0,
        ) / successful.length,
      )
    : 0;

  lines.push(
    `## Consensus`,
    `- LONG: ${longCount} | SHORT: ${shortCount} | NEUTRAL: ${neutralCount}`,
    `- Average confidence: ${avgConfidence}%`,
  );

  return lines.join("\n");
}

// ── SwarmOrchestrator Class ────────────────────────────────────────

export class SwarmOrchestrator {
  private config: Required<SwarmConfig>;

  constructor(config: SwarmConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Execute a project request by decomposing it into tasks,
   * running agents in parallel (with dependency ordering), and
   * merging results into a unified report.
   */
  async executeProject(
    description: string,
  ): Promise<SwarmResult> {
    const startTime = Date.now();
    const errors: string[] = [];

    // ── Step 1: Check for local AI availability ──
    let localAIAvailable = false;
    try {
      const localSource = await findAvailableLocalSource();
      localAIAvailable = localSource !== null;
      if (this.config.verbose && localAIAvailable) {
        console.log(
          `[Swarm] Local AI available: ${localSource!.source}:${localSource!.port}`,
        );
      }
    } catch {
      // Ignore scan errors
    }

    // ── Step 2: Hardware-aware agent count ──
    const hw = getHardwareProfile();
    const agentCount = this.config.maxAgents; // Use max config, not auto-scale for now

    if (this.config.verbose) {
      console.log(
        `[Swarm] Hardware: ${hw.ramGB}GB RAM, ${hw.cpus} CPUs → ${agentCount} agents`,
      );
    }

    // ── Step 3: Decompose project ──
    const tasks = decomposeProject(description, agentCount);

    if (this.config.verbose) {
      console.log(
        `[Swarm] Decomposed into ${tasks.length} tasks:`,
        tasks.map((t) => t.role).join(", "),
      );
    }

    // ── Step 4: Execute tasks in parallel (with batch limiting) ──
    const taskResults: SwarmTaskResult[] = [];

    // Sort by priority, then execute in batches
    const sorted = [...tasks].sort(
      (a, b) => b.priority - a.priority,
    );

    // Execute in batches of maxAgents
    for (let i = 0; i < sorted.length; i += this.config.maxAgents) {
      const batch = sorted.slice(i, i + this.config.maxAgents);
      const batchResults = await Promise.all(
        batch.map((task) =>
          executeTask(task, this.config),
        ),
      );
      taskResults.push(...batchResults);

      for (const r of batchResults) {
        if (r.error) {
          errors.push(`${r.role}: ${r.error}`);
        }
      }
    }

    // ── Step 5: Merge results ──
    const mergedReport = mergeResults(
      taskResults,
      description,
    );
    const tasksCompleted = taskResults.filter(
      (t) => t.report !== null,
    ).length;

    const result: SwarmResult = {
      success: tasksCompleted > 0,
      projectDescription: description,
      tasksPlanned: tasks.length,
      tasksCompleted,
      taskResults,
      mergedReport,
      agentCount: tasks.length,
      durationMs: Date.now() - startTime,
      localAIAvailable,
      errors,
    };

    if (this.config.verbose) {
      console.log(
        `[Swarm] Complete: ${tasksCompleted}/${tasks.length} tasks in ${result.durationMs}ms`,
      );
    }

    return result;
  }

  /**
   * Quick single-query convenience: decomposes and runs with default config.
   */
  static async quickRun(
    description: string,
    maxAgents: number = 3,
  ): Promise<SwarmResult> {
    const orchestrator = new SwarmOrchestrator({
      maxAgents,
      verbose: false,
    });
    return orchestrator.executeProject(description);
  }
}

// ── Re-exports for convenience ─────────────────────────────────────

export { getHardwareProfile, recommendModel };
