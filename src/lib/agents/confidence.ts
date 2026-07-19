// ── Confidence Agent ─────────────────────────────────────────────
// Level 2 Analysis (weight 0.13 — highest among L2 agents).
// Runs AFTER all other agents in gatherReports. Synthesizes ALL reports
// to compute consensus, detect conflicts, calibrate confidence based on
// historical agent accuracy, and enforce consensus thresholds.
// Core scoring is synchronous and rules-based; GPT-4o used only for
// final synthesis ("Is there enough agreement to trade?").

import { BaseAgent } from "./base";
import type { AgentReport } from "./types";

// ── Types ─────────────────────────────────────────────────────────

export interface ConflictPair {
  /** First agent's role/id */
  agentA: string;
  agentADirection: string;
  agentAConfidence: number;
  /** Second agent's role/id */
  agentB: string;
  agentBDirection: string;
  agentBConfidence: number;
  /** Conflict severity based on confidence levels and divergence */
  severity: "HIGH" | "MEDIUM" | "LOW";
}

export interface AgentAccuracyRecord {
  agentId: string;
  role: string;
  winRate: number; // 0-100 (percentage of correct directional calls)
  totalPredictions: number;
}

export interface CalibrationEntry {
  agentId: string;
  role: string;
  rawConfidence: number;
  winRate: number;
  calibratedConfidence: number;
  overconfident: boolean;
}

export interface ConsensusResult {
  /** Consensus percentage (0-100): bullishVotes / totalNonNeutralVotes */
  consensus: number;
  /** Raw vote counts */
  bullishVotes: number;
  bearishVotes: number;
  neutralVotes: number;
  totalVotes: number;
  /** Whether consensus exceeds 75% threshold */
  strongConsensus: boolean;
  /** Whether consensus is below 60% threshold (NO_CONSENSUS) */
  noConsensus: boolean;
  /** Direction indicated by majority */
  consensusDirection: "BULLISH" | "BEARISH" | "NEUTRAL";
  /** Conflicting agent pairs (opposing directions, both high confidence) */
  conflicts: ConflictPair[];
  /** Final calibrated confidence after applying all rules (0-100) */
  calibratedConfidence: number;
  /** Per-agent calibration adjustments */
  calibrations: CalibrationEntry[];
  /** Whether any L2+ agent dissented with high confidence */
  l2Dissent: boolean;
  /** Which L2+ agents dissented */
  l2Dissenters: string[];
}

// ── Constants ─────────────────────────────────────────────────────

/** Minimum bullish-vote percentage for consensus to be considered "strong" */
const STRONG_CONSENSUS_THRESHOLD = 75;

/** Below this percentage we declare NO_CONSENSUS */
const NO_CONSENSUS_THRESHOLD = 60;

/** Agents whose confidence must reach this to enter conflict detection */
const CONFLICT_CONFIDENCE_THRESHOLD = 65;

/** When an agent's win rate is this far below their claimed confidence, flag as overconfident */
const OVERCONFIDENCE_GAP = 25; // e.g. 45% win rate claiming 90% confidence = 45% gap > 25%

/** Maximum penalty applied for overconfidence */
const MAX_OVERCONFIDENCE_PENALTY = 20;

/** Penalty applied when L2 dissent is detected */
const L2_DISSENT_PENALTY = 15;

/** Level 2+ agent roles (analysis and above) */
const L2_PLUS_ROLES: Set<string> = new Set([
  "regime",
  "multi_timeframe",
  "correlation",
  "probability",
  "risk",
  "pattern",
  "smart_money",
  "liquidity",
]);

/** Default win rate when no historical data is available */
const DEFAULT_WIN_RATE = 50;

// ── System Prompt ─────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are the Confidence Agent at a tier-1 quantitative hedge fund. Your sole purpose is to evaluate whether the multi-agent system has reached sufficient agreement to place a trade.

You receive a pre-computed consensus analysis that includes:
- Vote distribution across all agents (BULLISH/BEARISH/NEUTRAL)
- Detected conflicts between high-confidence agents with opposing views
- Calibrated confidence after adjusting for each agent's historical accuracy
- Whether the consensus threshold was met

Your task:
1. Synthesize the consensus, conflicts, and calibrations
2. Determine if there is ENOUGH agreement to trade
3. If conflicts are severe, recommend WAITING
4. If consensus is strong and calibrated confidence is high, confirm the direction

Key rules:
- If noConsensus is true → return NEUTRAL with low confidence
- If conflicts contain HIGH severity pairs → reduce confidence significantly
- If calibrated confidence < 50 → return NEUTRAL
- If L2 dissenter exists with high confidence → flag and reduce
- Only return BULLISH/BEARISH if there is clear, calibrated agreement

Respond in JSON format only:
{"direction":"BULLISH"|"BEARISH"|"NEUTRAL","confidence":0-100,"reasoning":"synthesis of consensus and conflicts","data":{"enoughAgreement":true/false,"recommendation":"trade"|"reduce"|"wait","consensusQuality":"high"|"medium"|"low"}}`;

// ── ConfidenceAgent Class ─────────────────────────────────────────

export class ConfidenceAgent extends BaseAgent {
  /** Per-agent historical accuracy records (populated externally) */
  private agentAccuracy: Map<string, AgentAccuracyRecord> = new Map();

  constructor() {
    super({
      id: "confidence-agent",
      role: "confidence" as any, // cast: "confidence" added to AgentRole union below
      systemPrompt: SYSTEM_PROMPT,
    });
  }

  // ── Public: Feed agent accuracy data ────────────────────────────

  /**
   * Register historical accuracy for agents. Called by orchestrator
   * before computing consensus, using data from Learning Agent or DB.
   */
  feedAccuracy(records: AgentAccuracyRecord[]): void {
    for (const rec of records) {
      this.agentAccuracy.set(rec.agentId, rec);
      // Also index by role for lookup flexibility
      this.agentAccuracy.set(rec.role, rec);
    }
  }

  /**
   * Get win rate for an agent. Falls back to DEFAULT_WIN_RATE.
   */
  private getAgentWinRate(agentId: string, role: string): number {
    const byId = this.agentAccuracy.get(agentId);
    if (byId) return byId.winRate;
    const byRole = this.agentAccuracy.get(role);
    if (byRole) return byRole.winRate;
    return DEFAULT_WIN_RATE;
  }

  // ── 1. Consensus Scoring ────────────────────────────────────────

  /**
   * Count BULLISH (LONG), BEARISH (SHORT), and NEUTRAL votes from all reports.
   * Only counts agents with confidence > 0 as participating voters.
   *
   * consensus = bullishVotes / (bullishVotes + bearishVotes) as percentage.
   * If no directional votes, consensus = 0.
   */
  computeConsensus(reports: AgentReport[]): {
    bullishVotes: number;
    bearishVotes: number;
    neutralVotes: number;
    totalVotes: number;
    consensus: number;
    strongConsensus: boolean;
    noConsensus: boolean;
    consensusDirection: "BULLISH" | "BEARISH" | "NEUTRAL";
  } {
    let bullishVotes = 0;
    let bearishVotes = 0;
    let neutralVotes = 0;

    for (const report of reports) {
      if (report.confidence <= 0) continue; // skip non-participating agents

      if (report.direction === "LONG") bullishVotes++;
      else if (report.direction === "SHORT") bearishVotes++;
      else neutralVotes++;
    }

    const totalVotes = bullishVotes + bearishVotes + neutralVotes;
    const directionalVotes = bullishVotes + bearishVotes;

    // Consensus = percentage of directional votes that are bullish
    const consensus =
      directionalVotes > 0
        ? Math.round((bullishVotes / directionalVotes) * 10000) / 100
        : 0;

    const strongConsensus = consensus >= STRONG_CONSENSUS_THRESHOLD;
    const noConsensus =
      directionalVotes === 0 ||
      (consensus < NO_CONSENSUS_THRESHOLD && consensus > 100 - NO_CONSENSUS_THRESHOLD);

    let consensusDirection: "BULLISH" | "BEARISH" | "NEUTRAL";
    if (noConsensus || directionalVotes === 0) {
      consensusDirection = "NEUTRAL";
    } else if (bullishVotes > bearishVotes) {
      consensusDirection = "BULLISH";
    } else {
      consensusDirection = "BEARISH";
    }

    return {
      bullishVotes,
      bearishVotes,
      neutralVotes,
      totalVotes,
      consensus,
      strongConsensus,
      noConsensus,
      consensusDirection,
    };
  }

  // ── 2. Conflict Detection ───────────────────────────────────────

  /**
   * Find agent pairs with opposing directional views AND high confidence.
   * Only flags pairs where BOTH agents have confidence >= CONFLICT_CONFIDENCE_THRESHOLD.
   *
   * Severity:
   *   HIGH   — both agents > 75% confidence, opposing directions
   *   MEDIUM — both agents > 65% confidence, opposing directions
   *   LOW    — one agent > 65%, other between 50-65%
   */
  detectConflicts(reports: AgentReport[]): ConflictPair[] {
    const conflicts: ConflictPair[] = [];
    const active = reports.filter((r) => r.confidence >= 50);

    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const a = active[i];
        const b = active[j];

        // Must be opposing directions (LONG vs SHORT)
        if (
          a.direction === b.direction ||
          a.direction === "NEUTRAL" ||
          b.direction === "NEUTRAL"
        ) {
          continue;
        }

        // Both must have meaningful confidence
        if (
          a.confidence < CONFLICT_CONFIDENCE_THRESHOLD ||
          b.confidence < CONFLICT_CONFIDENCE_THRESHOLD
        ) {
          continue;
        }

        const minConf = Math.min(a.confidence, b.confidence);
        let severity: "HIGH" | "MEDIUM" | "LOW";

        if (minConf >= 75) severity = "HIGH";
        else if (minConf >= 65) severity = "MEDIUM";
        else severity = "LOW";

        conflicts.push({
          agentA: `${a.role} (${a.agentId})`,
          agentADirection: a.direction,
          agentAConfidence: a.confidence,
          agentB: `${b.role} (${b.agentId})`,
          agentBDirection: b.direction,
          agentBConfidence: b.confidence,
          severity,
        });
      }
    }

    return conflicts;
  }

  // ── 3. Confidence Calibration ───────────────────────────────────

  /**
   * Compare each agent's reported confidence against their historical win rate.
   *
   * calibratedConfidence = rawConfidence * (agentWinRate / 100)
   *
   * If agent has 45% win rate but claims 90% confidence → overconfident:
   *   calibrated = 90 * 0.45 = 40.5%
   *
   * If agent has 70% win rate and claims 80% → well-calibrated:
   *   calibrated = 80 * 0.70 = 56%
   */
  calibrateConfidence(reports: AgentReport[]): CalibrationEntry[] {
    return reports.map((report) => {
      const winRate = this.getAgentWinRate(report.agentId, report.role);
      const rawConfidence = report.confidence;
      const calibrated = Math.round(rawConfidence * (winRate / 100) * 100) / 100;
      const overconfident =
        rawConfidence - winRate > OVERCONFIDENCE_GAP && rawConfidence > 50;

      return {
        agentId: report.agentId,
        role: report.role,
        rawConfidence,
        winRate,
        calibratedConfidence: Math.min(100, Math.max(0, calibrated)),
        overconfident,
      };
    });
  }

  // ── 4. Consensus Threshold Enforcement (owner rule) ─────────────

  /**
   * Apply owner-mandated rules:
   *
   * 1. If consensus < 60% → NO_CONSENSUS → return NEUTRAL
   * 2. If any L2+ agent dissents with high confidence → reduce overall
   * 3. Apply overconfidence penalties
   * 4. Apply conflict penalties
   */
  enforceThresholds(
    consensus: ReturnType<ConfidenceAgent["computeConsensus"]>,
    conflicts: ConflictPair[],
    calibrations: CalibrationEntry[],
    reports: AgentReport[],
  ): {
    calibratedConfidence: number;
    l2Dissent: boolean;
    l2Dissenters: string[];
    noConsensus: boolean;
    direction: "BULLISH" | "BEARISH" | "NEUTRAL";
  } {
    // Start with the average calibrated confidence of non-neutral agents
    const directionalCalibrations = calibrations.filter((c) => {
      const report = reports.find((r) => r.agentId === c.agentId);
      return report && report.direction !== "NEUTRAL";
    });

    const avgCalibrated =
      directionalCalibrations.length > 0
        ? directionalCalibrations.reduce((s, c) => s + c.calibratedConfidence, 0) /
          directionalCalibrations.length
        : 50;

    // ── Rule 1: NO_CONSENSUS check ──
    if (consensus.noConsensus) {
      return {
        calibratedConfidence: Math.min(30, avgCalibrated),
        l2Dissent: false,
        l2Dissenters: [],
        noConsensus: true,
        direction: "NEUTRAL",
      };
    }

    // ── Rule 2: L2+ dissent detection ──
    const consensusDir = consensus.consensusDirection;
    const oppositeDir = consensusDir === "BULLISH" ? "SHORT" : "LONG";
    const l2Dissenters: string[] = [];

    for (const report of reports) {
      if (!L2_PLUS_ROLES.has(report.role)) continue;
      if (report.direction !== oppositeDir) continue;
      if (report.confidence < 65) continue; // only high-confidence dissent matters

      l2Dissenters.push(`${report.role} (${report.confidence}%)`);
    }

    const l2Dissent = l2Dissenters.length > 0;

    // ── Compute penalties ──
    let penalty = 0;

    // Conflict penalty
    const highConflicts = conflicts.filter((c) => c.severity === "HIGH").length;
    const medConflicts = conflicts.filter((c) => c.severity === "MEDIUM").length;
    penalty += highConflicts * 10;
    penalty += medConflicts * 5;

    // Overconfidence penalty
    const overconfidentCount = calibrations.filter((c) => c.overconfident).length;
    penalty += Math.min(MAX_OVERCONFIDENCE_PENALTY, overconfidentCount * 5);

    // L2 dissent penalty
    if (l2Dissent) {
      penalty += L2_DISSENT_PENALTY;
    }

    // Apply penalties
    let calibratedConfidence = Math.max(0, avgCalibrated - penalty);

    // Clamp
    calibratedConfidence = Math.round(Math.min(100, Math.max(0, calibratedConfidence)) * 100) / 100;

    // Direction follows consensus
    const direction = consensus.consensusDirection;

    return {
      calibratedConfidence,
      l2Dissent,
      l2Dissenters,
      noConsensus: false,
      direction,
    };
  }

  // ── Main: Compute full consensus analysis ───────────────────────

  /**
   * Run the complete confidence pipeline (synchronous, no API call).
   * Takes all agent reports and produces a ConsensusResult.
   */
  computeConfidence(reports: AgentReport[]): ConsensusResult {
    // 1. Consensus scoring
    const consensus = this.computeConsensus(reports);

    // 2. Conflict detection
    const conflicts = this.detectConflicts(reports);

    // 3. Confidence calibration
    const calibrations = this.calibrateConfidence(reports);

    // 4. Threshold enforcement
    const enforced = this.enforceThresholds(consensus, conflicts, calibrations, reports);

    return {
      consensus: consensus.consensus,
      bullishVotes: consensus.bullishVotes,
      bearishVotes: consensus.bearishVotes,
      neutralVotes: consensus.neutralVotes,
      totalVotes: consensus.totalVotes,
      strongConsensus: consensus.strongConsensus,
      noConsensus: enforced.noConsensus,
      consensusDirection: consensus.consensusDirection,
      conflicts,
      calibratedConfidence: enforced.calibratedConfidence,
      calibrations,
      l2Dissent: enforced.l2Dissent,
      l2Dissenters: enforced.l2Dissenters,
    };
  }

  // ── GPT-4o Synthesis ────────────────────────────────────────────

  /**
   * Build user prompt for GPT-4o confidence synthesis.
   */
  protected buildUserPrompt(result: ConsensusResult): string {
    const lines: string[] = [
      `=== Consensus Analysis Results ===`,
      ``,
      `Consensus: ${result.consensus}% agreement (${result.bullishVotes} BULLISH, ${result.bearishVotes} BEARISH, ${result.neutralVotes} NEUTRAL)`,
      `  Strong consensus: ${result.strongConsensus ? "YES ✓" : "NO"}`,
      `  No consensus: ${result.noConsensus ? "YES ⚠️" : "NO"}`,
      `  Direction: ${result.consensusDirection}`,
      ``,
      `Calibrated confidence: ${result.calibratedConfidence}%`,
      ``,
      `Conflicts detected: ${result.conflicts.length}`,
    ];

    if (result.conflicts.length > 0) {
      lines.push(`Conflict details:`);
      for (const c of result.conflicts) {
        lines.push(
          `  [${c.severity}] ${c.agentA} (${c.agentADirection} ${c.agentAConfidence}%) ↔ ${c.agentB} (${c.agentBDirection} ${c.agentBConfidence}%)`,
        );
      }
    }

    lines.push(``);
    lines.push(`L2 Dissent: ${result.l2Dissent ? "YES ⚠️" : "NO ✓"}`);
    if (result.l2Dissenters.length > 0) {
      lines.push(`  Dissenters: ${result.l2Dissenters.join(", ")}`);
    }

    lines.push(``);
    lines.push(`Calibration summary:`);
    for (const cal of result.calibrations) {
      if (cal.overconfident) {
        lines.push(
          `  ⚠️ ${cal.role}: raw ${cal.rawConfidence}% → calibrated ${cal.calibratedConfidence}% (win rate: ${cal.winRate}%) OVERCONFIDENT`,
        );
      }
    }

    lines.push(``);
    lines.push(
      `Consensus: ${result.consensus}% agreement. Conflicts: ${result.conflicts.length}. Calibrated confidence: ${result.calibratedConfidence}%. Is there enough agreement to trade?`,
    );

    return lines.join("\n");
  }

  /**
   * Synthesize confidence analysis with GPT-4o.
   * Falls back to computed consensus if LLM unavailable.
   */
  async synthesize(result: ConsensusResult): Promise<AgentReport> {
    const report = await this.analyzeMarket(result);

    // Enrich report data with full consensus details
    report.data = {
      ...report.data,
      consensus: result.consensus,
      bullishVotes: result.bullishVotes,
      bearishVotes: result.bearishVotes,
      neutralVotes: result.neutralVotes,
      totalVotes: result.totalVotes,
      strongConsensus: result.strongConsensus,
      noConsensus: result.noConsensus,
      consensusDirection: result.consensusDirection,
      conflicts: result.conflicts.map((c) => ({
        agents: [c.agentA, c.agentB],
        directions: [c.agentADirection, c.agentBDirection],
        confidences: [c.agentAConfidence, c.agentBConfidence],
        severity: c.severity,
      })),
      calibratedConfidence: result.calibratedConfidence,
      calibrations: result.calibrations,
      l2Dissent: result.l2Dissent,
      l2Dissenters: result.l2Dissenters,
    };

    return report;
  }

  /**
   * Override analyzeMarket so it accepts ConsensusResult.
   */
  async analyzeMarket(context: ConsensusResult): Promise<AgentReport> {
    return super.analyzeMarket(context);
  }
}
