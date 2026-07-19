// ── System Audit Runner ──────────────────────────────────────────────
// Server-side module that runs the SystemAuditAgent on a schedule.
// Caches the latest report for client polling.

import { createServerFn } from "@tanstack/react-start";
import { SystemAuditAgent, type AuditReport } from "./agents/system-audit";

// ── Singleton ────────────────────────────────────────────────────────

let auditAgent: SystemAuditAgent | null = null;
let cachedReport: AuditReport | null = null;
let lastScanTime = 0;

function getAgent(): SystemAuditAgent {
  if (!auditAgent) {
    auditAgent = new SystemAuditAgent();
  }
  return auditAgent;
}

// ── Internal runner (runs synchronously, caches result) ──────────────

export function runSystemAudit(): AuditReport {
  const agent = getAgent();
  const report = agent.runAudit();
  cachedReport = report;
  lastScanTime = Date.now();
  return report;
}

// ── Startup: run initial audit ───────────────────────────────────────

// Use setImmediate-like pattern to run after module load
setTimeout(() => {
  try {
    runSystemAudit();
    console.log(`[SystemAudit] Initial scan complete — Score: ${cachedReport?.score ?? "?"}/100`);
  } catch (err) {
    console.error("[SystemAudit] Initial scan failed:", err);
  }
}, 1000);

// ── Scheduled: re-run every 60 seconds ───────────────────────────────

setInterval(() => {
  try {
    const report = runSystemAudit();
    const criticalCount = report.issues.filter((i) => i.severity === "CRITICAL").length;
    if (criticalCount > 0 || report.score < 80) {
      console.warn(
        `[SystemAudit] Scan — Score: ${report.score}/100, Issues: ${report.issues.length}, Critical: ${criticalCount}`,
      );
    }
  } catch (err) {
    console.error("[SystemAudit] Scheduled scan failed:", err);
  }
}, 60_000);

// ── Server Function: get latest audit report ─────────────────────────

export const getSystemAuditReport = createServerFn({ method: "GET" }).handler(async () => {
  // Run a fresh scan if no cached report or older than 65 seconds
  if (!cachedReport || Date.now() - lastScanTime > 65_000) {
    runSystemAudit();
  }

  return cachedReport || {
    score: 0,
    issues: [],
    passedChecks: 0,
    failedChecks: 1,
    recommendations: ["Audit not yet run — initializing..."],
    timestamp: Date.now(),
  } as AuditReport;
});

// ── Force re-scan (used by agents page or manual trigger) ────────────

export const forceSystemAudit = createServerFn({ method: "POST" }).handler(async () => {
  const report = runSystemAudit();
  return report;
});
