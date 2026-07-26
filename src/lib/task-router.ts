// ── Smart Task Router ─────────────────────────────────────────────────
// AI-driven task planning and routing for the HSMC swarm.
// Given a natural-language task description, the router:
//   1. Plans: uses AI to determine how many agents, what specializations,
//      and which subtasks are needed.
//   2. Routes: assigns subtasks to available agents, spawns new ones for gaps.
//   3. Executes: monitors progress and merges results.
//
// Integrates with AgentPool (agent-queue.ts) and SwarmOrchestrator.

import type { AgentRole } from "./agents/types";
import { queryWithPrompt } from "./llm/multi-provider";
import { getHardwareProfile } from "./model-selector";

// ── Types ──────────────────────────────────────────────────────────

export interface TaskRequest {
  description: string;
  priority: "low" | "medium" | "high" | "critical";
  deadline?: number; // epoch ms
}

export interface Subtask {
  id: string;
  description: string;
  specialization: AgentRole;
  priority: number; // 1-10
  dependencies: string[]; // subtask ids that must complete first
  estimatedDurationMs: number;
}

export interface TaskPlan {
  taskId: string;
  originalDescription: string;
  agentsNeeded: number;
  existingAgents: string[];        // agent ids already available
  newSpecializations: AgentRole[]; // roles that need new agent slots
  estimatedTime: number;           // total estimated seconds
  subtasks: Subtask[];
}

export interface SubtaskResult {
  subtaskId: string;
  specialization: AgentRole;
  result: string | null;
  error: string | null;
  durationMs: number;
}

export interface TaskResult {
  taskId: string;
  success: boolean;
  plan: TaskPlan;
  subtaskResults: SubtaskResult[];
  mergedOutput: string;
  totalDurationMs: number;
  agentsUsed: number;
  agentsCreated: number;
  errors: string[];
}

// ── AI Planning Prompt ─────────────────────────────────────────────

const PLANNING_SYSTEM_PROMPT = `You are an agent orchestrator for the HSMC DeFi trading swarm.
Your job: for any user request, determine the optimal plan.

Available agent specializations (roles):
market, technical, news, macro, pattern, risk, strategy, execution, 
portfolio, learning, memory, reasoning, exit, smart_money, liquidity,
regime, multi_timeframe, correlation, sentiment, volume, probability,
confidence, devils_advocate, position_manager, system_audit

Output ONLY valid JSON — no markdown, no explanation. The JSON must match this shape exactly:

{
  "agentsNeeded": number (1-10),
  "newSpecializations": ["role1", "role2"],  // roles not in the existing pool
  "estimatedTimeSeconds": number,
  "subtasks": [
    {
      "description": "what this subtask does",
      "specialization": "role",
      "priority": number (1-10, higher=sooner),
      "estimatedDurationMs": number
    }
  ]
}

Rules:
- Simple queries ("what is BTC price?") → 1 agent (market)
- Analysis tasks ("analyze BTC for 24h") → 3-5 agents
- Complex projects ("build landing page", "create payment gateway") → 4-8 agents
- Keep subtasks concise and focused — each should be a single clear action.
- Assign dependencies strategically: "strategy" depends on "market"+ "technical"+ "risk", "reasoning" depends on all others.`;

// ── Plan from AI ───────────────────────────────────────────────────

async function aiPlanTask(
  description: string,
): Promise<Omit<TaskPlan, "taskId" | "originalDescription" | "existingAgents">> {
  const userPrompt = `Task: ${description}\nContext: This is for the HSMC crypto DeFi trading platform.`;

  try {
    const result = await queryWithPrompt(PLANNING_SYSTEM_PROMPT, userPrompt, {
      maxTokens: 800,
      timeoutMs: 15_000,
    });

    const content = result.response?.content ?? "";
    // Try to extract JSON from the response (may be wrapped in markdown fences)
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) ?? [null, content];
    const jsonStr = (jsonMatch[1] ?? content).trim();

    const parsed = JSON.parse(jsonStr);

    return {
      agentsNeeded: Math.min(10, Math.max(1, parsed.agentsNeeded ?? 3)),
      newSpecializations: (parsed.newSpecializations ?? []) as AgentRole[],
      estimatedTime: parsed.estimatedTimeSeconds ?? 30,
      subtasks: (parsed.subtasks ?? []).map((st: any, i: number) => ({
        id: `sub_${Date.now()}_${i}`,
        description: st.description ?? `Subtask ${i + 1}`,
        specialization: st.specialization ?? "reasoning",
        priority: st.priority ?? 5,
        dependencies: (st.dependencies ?? []) as string[],
        estimatedDurationMs: st.estimatedDurationMs ?? 5000,
      })),
    };
  } catch (err) {
    // Fallback: heuristic plan when AI is unavailable
    console.warn("[TaskRouter] AI planning failed, using heuristic fallback:", err);
    return heuristicPlan(description);
  }
}

// ── Heuristic Fallback ─────────────────────────────────────────────

function heuristicPlan(
  description: string,
): Omit<TaskPlan, "taskId" | "originalDescription" | "existingAgents"> {
  const desc = description.toLowerCase();

  // Detect complexity
  const isSimple =
    /\b(price|worth|status|what|how much|show)\b/.test(desc) &&
    !/\b(analyze|build|create|full|deep|comprehensive)\b/.test(desc);

  const isBuild =
    /\b(build|create|generate|make|scaffold|implement)\b/.test(desc);

  if (isSimple) {
    // Single-agent simple query
    const role: AgentRole = /\bprice|worth\b/.test(desc)
      ? "market"
      : /\bstatus|network|chain\b/.test(desc)
        ? "technical"
        : "reasoning";

    return {
      agentsNeeded: 1,
      newSpecializations: [],
      estimatedTime: 5,
      subtasks: [
        {
          id: `sub_${Date.now()}_0`,
          description: `Quick response to: ${description}`,
          specialization: role,
          priority: 10,
          dependencies: [],
          estimatedDurationMs: 3000,
        },
      ],
    };
  }

  if (isBuild) {
    // Building project — need multiple agents
    return {
      agentsNeeded: 4,
      newSpecializations: [],
      estimatedTime: 60,
      subtasks: [
        {
          id: `sub_${Date.now()}_0`,
          description: `Plan architecture for: ${description}`,
          specialization: "strategy",
          priority: 10,
          dependencies: [],
          estimatedDurationMs: 5000,
        },
        {
          id: `sub_${Date.now()}_1`,
          description: `Implement core logic for: ${description}`,
          specialization: "execution",
          priority: 9,
          dependencies: [],
          estimatedDurationMs: 8000,
        },
        {
          id: `sub_${Date.now()}_2`,
          description: `Risk assessment for: ${description}`,
          specialization: "risk",
          priority: 8,
          dependencies: [],
          estimatedDurationMs: 4000,
        },
        {
          id: `sub_${Date.now()}_3`,
          description: `Final review and reasoning for: ${description}`,
          specialization: "reasoning",
          priority: 7,
          dependencies: [],
          estimatedDurationMs: 3000,
        },
      ],
    };
  }

  // Default: moderate analysis
  const roles: AgentRole[] = ["market", "technical", "risk", "strategy", "reasoning"];
  return {
    agentsNeeded: roles.length,
    newSpecializations: [],
    estimatedTime: 30,
    subtasks: roles.map((role, i) => ({
      id: `sub_${Date.now()}_${i}`,
      description: `${role} analysis for: ${description}`,
      specialization: role,
      priority: 10 - i,
      dependencies: role === "strategy"
        ? [] // Will be resolved at routing time
        : role === "reasoning"
          ? []
          : [],
      estimatedDurationMs: 5000,
    })),
  };
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * Analyze a text description and produce an execution plan.
 * Uses AI when available, falls back to heuristics.
 */
export async function planTask(request: TaskRequest): Promise<TaskPlan> {
  const taskId = `task_${Date.now().toString(36)}`;

  const aiPlan = await aiPlanTask(request.description);

  // Get hardware profile to constrain agent count
  const hw = getHardwareProfile();
  const maxByHardware = Math.max(1, Math.min(10, Math.floor(hw.cpus * 1.5)));

  const agentsNeeded = Math.min(aiPlan.agentsNeeded, maxByHardware);
  const subtasks = aiPlan.subtasks.slice(0, agentsNeeded);

  // Build dependency chain: strategy → depends on market/technical/risk; reasoning on all
  const strategyIdx = subtasks.findIndex((s) => s.specialization === "strategy");
  const reasoningIdx = subtasks.findIndex((s) => s.specialization === "reasoning");

  if (strategyIdx >= 0) {
    const analysisIds = subtasks
      .filter((s) => ["market", "technical", "risk"].includes(s.specialization))
      .map((s) => s.id);
    subtasks[strategyIdx] = { ...subtasks[strategyIdx], dependencies: analysisIds };
  }

  if (reasoningIdx >= 0) {
    const allOtherIds = subtasks
      .filter((s) => s.specialization !== "reasoning")
      .map((s) => s.id);
    subtasks[reasoningIdx] = { ...subtasks[reasoningIdx], dependencies: allOtherIds };
  }

  const plan: TaskPlan = {
    taskId,
    originalDescription: request.description,
    agentsNeeded,
    existingAgents: [], // populated by AgentPool
    newSpecializations: aiPlan.newSpecializations.slice(0, Math.max(0, agentsNeeded - 5)),
    estimatedTime: aiPlan.estimatedTime,
    subtasks,
  };

  return plan;
}

/**
 * Execute a single subtask via LLM.
 */
async function executeSubtask(
  subtask: Subtask,
  timeoutMs: number = 30_000,
): Promise<SubtaskResult> {
  const startTime = Date.now();

  try {
    const systemPrompt = `You are the ${subtask.specialization} agent. ${subtask.description}. Provide a concise, structured response.`;

    const result = await queryWithPrompt(systemPrompt, subtask.description, {
      maxTokens: 500,
      timeoutMs,
    });

    const content = result.response?.content ?? `Analysis complete for ${subtask.specialization}`;

    return {
      subtaskId: subtask.id,
      specialization: subtask.specialization,
      result: content,
      error: null,
      durationMs: Date.now() - startTime,
    };
  } catch (err) {
    return {
      subtaskId: subtask.id,
      specialization: subtask.specialization,
      result: null,
      error: err instanceof Error ? err.message : "Execution error",
      durationMs: Date.now() - startTime,
    };
  }
}

/**
 * Execute a full task plan: run all subtasks and merge results.
 */
export async function executeTaskPlan(
  plan: TaskPlan,
  maxConcurrency: number = 5,
): Promise<TaskResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  const subtaskResults: SubtaskResult[] = [];

  // Sort by priority (highest first), respecting dependencies
  const pending = [...plan.subtasks].sort((a, b) => b.priority - a.priority);
  const completed = new Set<string>();

  while (pending.length > 0) {
    // Find subtasks whose dependencies are all satisfied
    const ready: Subtask[] = [];
    const stillWaiting: Subtask[] = [];

    for (const st of pending) {
      if (st.dependencies.every((dep) => completed.has(dep))) {
        ready.push(st);
      } else {
        stillWaiting.push(st);
      }
    }

    if (ready.length === 0) {
      // Circular dependency or all blocked — execute remaining in order
      break;
    }

    // Execute in batches of maxConcurrency
    const batch = ready.slice(0, maxConcurrency);
    const batchResults = await Promise.all(
      batch.map((st) => executeSubtask(st, 30_000)),
    );

    for (const r of batchResults) {
      subtaskResults.push(r);
      completed.add(r.subtaskId);
      if (r.error) errors.push(`${r.specialization}: ${r.error}`);
    }

    // Rebuild pending list
    pending.length = 0;
    pending.push(...stillWaiting);
  }

  // Merge results into a unified output
  const mergedOutput = mergeSubtaskResults(subtaskResults, plan.originalDescription);

  return {
    taskId: plan.taskId,
    success: subtaskResults.some((r) => r.result !== null),
    plan,
    subtaskResults,
    mergedOutput,
    totalDurationMs: Date.now() - startTime,
    agentsUsed: plan.agentsNeeded,
    agentsCreated: plan.newSpecializations.length,
    errors,
  };
}

// ── Merge Helpers ──────────────────────────────────────────────────

function mergeSubtaskResults(
  results: SubtaskResult[],
  description: string,
): string {
  const successful = results.filter((r) => r.result !== null);
  const failed = results.filter((r) => r.error !== null);

  const lines: string[] = [
    `## Swarm Result: ${description}`,
    "",
    `${successful.length} agents completed, ${failed.length} failed.`,
    "",
  ];

  for (const r of successful) {
    lines.push(`### ${r.specialization.toUpperCase()}`);
    lines.push(r.result!);
    lines.push("");
  }

  if (failed.length > 0) {
    lines.push("### Errors");
    for (const r of failed) {
      lines.push(`- **${r.specialization}**: ${r.error}`);
    }
  }

  return lines.join("\n");
}

// ── Re-exports ────────────────────────────────────────────────────

export { PLANNING_SYSTEM_PROMPT };
