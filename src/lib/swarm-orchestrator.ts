// ── Swarm Orchestrator ───────────────────────────────────────────────
// Accepts a high-level project description, decomposes it into tasks,
// spins up specialized agents, manages their lifecycle (create → work →
// merge results → destroy), and returns a unified SwarmResult.
//
// Updated: integrates TaskRouter (task-router.ts) for AI-driven planning
// and AgentPool (agent-queue.ts) for dynamic agent isolation & spawning.
//
// Integrates with the existing 29-agent framework in src/lib/agents/ and
// the multi-provider LLM pipeline in src/lib/llm/multi-provider.ts.

import type { AgentReport, AgentRole } from "./agents/types";
import { queryWithPrompt } from "./llm/multi-provider";
import { findAvailableLocalSource } from "./local-ai-scanner";
import { getHardwareProfile, recommendModel } from "./model-selector";
import { planTask, type TaskRequest, type TaskPlan } from "./task-router";
import { AgentPool, getAgentPool } from "./agent-queue";

// ── Types ──────────────────────────────────────────────────────────

export interface SwarmTask {
  id: string;
  role: AgentRole;
  description: string;
  priority: number;       // 1-10, higher = sooner
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
  // ── Kimi swarm extras ──
  plan?: TaskPlan;
  agentsCreated: number;
  agentsReused: number;
}

export interface SwarmConfig {
  maxAgents?: number;     // maximum concurrent agents (default: 5)
  timeoutMs?: number;     // per-task timeout (default: 30_000)
  localOnly?: boolean;    // prefer local AI only (default: false)
  verbose?: boolean;
}

// ── Default Config ─────────────────────────────────────────────────

const DEFAULT_CONFIG: Required<SwarmConfig> = {
  maxAgents: 5,
  timeoutMs: 30_000,
  localOnly: false,
  verbose: false,
};

// ── Simulated Agent Execution ──────────────────────────────────────

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

    const content = result.response?.content ?? "No analysis produced";
    const durationMs = Date.now() - startTime;

    const report: AgentReport = {
      agentId: task.id,
      role: task.role,
      timestamp: Date.now(),
      direction: extractDirection(content),
      confidence: extractConfidence(content),
      reasoning: content,
      data: { durationMs, provider: result.response?.provider ?? "none" },
    };

    return { taskId: task.id, role: task.role, report, error: null, durationMs };
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
  const percentMatch = content.match(/confidence[:\s]*(\d{1,3})/i);
  if (percentMatch) {
    return Math.min(100, Math.max(0, parseInt(percentMatch[1])));
  }
  const pctMatch = content.match(/(\d{1,3})%/);
  if (pctMatch) return Math.min(100, Math.max(0, parseInt(pctMatch[1])));
  return 50;
}

// ── Merge Results ──────────────────────────────────────────────────

function mergeResults(
  taskResults: SwarmTaskResult[],
  projectDescription: string,
): string {
  const successful = taskResults.filter((t) => t.report !== null);
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
      lines.push(`- **${result.role}**: ${result.error}`);
    }
  }

  const directions = successful.map((r) => r.report!.direction);
  const longCount = directions.filter((d) => d === "LONG").length;
  const shortCount = directions.filter((d) => d === "SHORT").length;
  const neutralCount = directions.filter((d) => d === "NEUTRAL").length;

  const avgConfidence = successful.length > 0
    ? Math.round(
        successful.reduce((sum, r) => sum + r.report!.confidence, 0) /
          successful.length,
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
  private pool: AgentPool;

  constructor(config: SwarmConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.pool = getAgentPool();
  }

  /**
   * Execute a project request using the Kimi-style task router + agent pool.
   * Uses AI-driven planning (task-router.ts) and dynamic agent isolation
   * (agent-queue.ts) with on-demand spawning.
   */
  async executeProject(description: string): Promise<SwarmResult> {
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

    // ── Step 2: AI-driven task planning ──
    const request: TaskRequest = {
      description,
      priority: "medium",
    };

    if (this.config.verbose) {
      console.log(`[Swarm] Planning task: "${description}"`);
    }

    const plan = await planTask(request);

    if (this.config.verbose) {
      console.log(
        `[Swarm] Plan: ${plan.agentsNeeded} agents, ${plan.subtasks.length} subtasks, ~${plan.estimatedTime}s`,
      );
    }

    // ── Step 3: Route subtasks to agent pool ──
    let createdCount = 0;
    let reusedCount = 0;

    const sortedSubtasks = [...plan.subtasks].sort(
      (a, b) => b.priority - a.priority,
    );

    const taskResults: SwarmTaskResult[] = [];

    // Execute subtasks in batches respecting pool capacity
    for (let i = 0; i < sortedSubtasks.length; i += this.config.maxAgents) {
      const batch = sortedSubtasks.slice(i, i + this.config.maxAgents);

      const batchPromises = batch.map(async (subtask) => {
        // Try to acquire an existing idle agent
        let slot = this.pool.acquire(subtask.specialization);

        if (!slot) {
          // All busy — spawn a new temporary agent
          slot = this.pool.spawn(subtask.specialization);
          if (slot) {
            createdCount++;
          } else {
            // Pool is full — queue until a slot frees (simple retry)
            // For now, execute without a slot (direct execution)
          }
        } else {
          reusedCount++;
        }

        if (slot) {
          this.pool.assign(slot.agentId, subtask.description);
        }

        // Execute via the legacy path (LLM call)
        const swarmTask: SwarmTask = {
          id: subtask.id,
          role: subtask.specialization,
          description: subtask.description,
          priority: subtask.priority,
          dependencies: subtask.dependencies,
        };

        const result = await executeTask(swarmTask, this.config);

        if (slot) {
          this.pool.release(slot.agentId, result.durationMs);
        }

        return result;
      });

      const batchResults = await Promise.all(batchPromises);
      taskResults.push(...batchResults);

      for (const r of batchResults) {
        if (r.error) errors.push(`${r.role}: ${r.error}`);
      }
    }

    // ── Step 4: Cleanup temporary agents ──
    this.pool.cleanup();

    // ── Step 5: Merge results ──
    const mergedReport = mergeResults(taskResults, description);
    const tasksCompleted = taskResults.filter((t) => t.report !== null).length;

    const result: SwarmResult = {
      success: tasksCompleted > 0,
      projectDescription: description,
      tasksPlanned: plan.subtasks.length,
      tasksCompleted,
      taskResults,
      mergedReport,
      agentCount: plan.agentsNeeded,
      durationMs: Date.now() - startTime,
      localAIAvailable,
      errors,
      plan,
      agentsCreated: createdCount,
      agentsReused: reusedCount,
    };

    if (this.config.verbose) {
      console.log(
        `[Swarm] Complete: ${tasksCompleted}/${plan.subtasks.length} tasks in ${result.durationMs}ms — ${reusedCount} reused, ${createdCount} created`,
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
    const orchestrator = new SwarmOrchestrator({ maxAgents, verbose: false });
    return orchestrator.executeProject(description);
  }

  /**
   * Kimi-style handleTask — returns a rich response with plan details.
   * Designed to be called from the chat UI for the new swarm interface.
   */
  async handleTask(description: string): Promise<SwarmResult> {
    return this.executeProject(description);
  }

  /**
   * Get pool snapshot for the dashboard sidebar.
   */
  getPoolSnapshot() {
    return this.pool.snapshot();
  }
}

// ── Re-exports for convenience ─────────────────────────────────────

export { getHardwareProfile, recommendModel, getAgentPool };
