// ── System Audit Runner ──────────────────────────────────────────────
// Server-side module that runs the SystemAuditAgent on a schedule.
// Caches the latest report for client polling.
// Uses dynamic import to avoid pulling Node.js builtins into client bundle.

import { createServerFn } from "@tanstack/react-start";

// ── Audit Types (kept here to avoid importing system-audit.ts in client) ─

export type AuditSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export interface AuditIssue {
  severity: AuditSeverity;
  category: string;
  description: string;
  location: string;
}

export interface AuditReport {
  score: number;
  issues: AuditIssue[];
  passedChecks: number;
  failedChecks: number;
  recommendations: string[];
  timestamp: number;
}

// ── Retry guard (stops infinite console spam on repeated failure) ────

let auditRetryCount = 0;
const MAX_AUDIT_RETRIES = 3;

// ── Lazy singleton ──────────────────────────────────────────────────

let auditAgent: any = null;
let cachedReport: AuditReport | null = null;
let lastScanTime = 0;

async function getAgent(): Promise<any> {
  if (!auditAgent) {
    const mod = await import("./agents/system-audit");
    // Handle both named export and default export (Vite SSR bundling quirk)
    const AgentClass = mod.SystemAuditAgent ?? mod.default;
    if (typeof AgentClass !== "function") {
      throw new Error(
        `SystemAuditAgent not constructable. Available exports: ${Object.keys(mod).join(", ")}`,
      );
    }
    auditAgent = new AgentClass();
  }
  return auditAgent;
}

// ── Internal runner (runs synchronously, caches result) ──────────────

export async function runSystemAudit(): Promise<AuditReport> {
  const agent = await getAgent();
  const report = agent.runAudit();
  cachedReport = report;
  lastScanTime = Date.now();
  return report;
}

// ── Startup: run initial audit ───────────────────────────────────────

setTimeout(() => {
  runSystemAudit()
    .then(() => {
      console.log(`[SystemAudit] Initial scan complete — Score: ${cachedReport?.score ?? "?"}/100`);
    })
    .catch((err) => {
      console.error("[SystemAudit] Initial scan failed:", err);
    });
}, 1000);

// ── Scheduled: re-run every 60 seconds ───────────────────────────────

const auditInterval = setInterval(() => {
  if (auditRetryCount >= MAX_AUDIT_RETRIES) {
    console.warn("[SystemAudit] Max retries reached, stopping audit scheduler");
    clearInterval(auditInterval);
    return;
  }
  auditRetryCount++;
  runSystemAudit()
    .then((report) => {
      // Reset retry count on success
      auditRetryCount = 0;
      const criticalCount = report.issues.filter((i) => i.severity === "CRITICAL").length;
      if (criticalCount > 0 || report.score < 80) {
        console.warn(
          `[SystemAudit] Scan — Score: ${report.score}/100, Issues: ${report.issues.length}, Critical: ${criticalCount}`,
        );
      }
    })
    .catch((err) => {
      console.error("[SystemAudit] Scheduled scan failed:", err);
    });
}, 60_000);

// ── Server Function: get latest audit report ─────────────────────────

export const getSystemAuditReport = createServerFn({ method: "GET" }).handler(async () => {
  if (!cachedReport || Date.now() - lastScanTime > 65_000) {
    await runSystemAudit();
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
  const report = await runSystemAudit();
  return report;
});
