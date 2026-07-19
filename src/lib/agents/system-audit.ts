// ── System Audit Agent — Level 5 Monitoring ────────────────────────
// Continuous live scanner that detects ANYTHING fake, broken, or dangerous.
// All checks are synchronous — no LLM calls needed for audit.
// The BaseAgent analyzeMarket() method is preserved for GPT-4o synthesis
// of audit findings into natural-language recommendations.

import { BaseAgent } from "./base";
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { getApiKey } from "~/lib/api-keys";

// ── Types ────────────────────────────────────────────────────────────

export type AuditSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export interface AuditIssue {
  severity: AuditSeverity;
  category: string;
  description: string;
  location: string;
}

export interface AuditReport {
  score: number; // 0-100, 100 = clean
  issues: AuditIssue[];
  passedChecks: number;
  failedChecks: number;
  recommendations: string[];
  timestamp: number;
}

interface CheckResult {
  name: string;
  passed: boolean;
  issues: AuditIssue[];
}

// ── Severity Weights for Scoring ─────────────────────────────────────

const SEVERITY_WEIGHT: Record<AuditSeverity, number> = {
  CRITICAL: 25,
  HIGH: 12,
  MEDIUM: 5,
  LOW: 2,
};

// ── Sensitive patterns (never hardcode real keys — these detect leaks) ──

const SENSITIVE_PATTERNS = [
  { pattern: /sk-[a-zA-Z0-9]{32,}/, label: "OpenAI API key" },
  { pattern: /eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}/, label: "JWT token" },
  { pattern: /(?:api_key|apikey|API_KEY|apiSecret)\s*[:=]\s*["'][A-Za-z0-9+/=]{20,}["']/, label: "API key literal" },
  { pattern: /(?:private_key|PRIVATE_KEY|secret)\s*[:=]\s*["'][A-Za-z0-9+/=]{20,}["']/, label: "Private key literal" },
  { pattern: /postgres:\/\/[^:]+:[^@]+@/, label: "Database connection string with credentials" },
  { pattern: /mongodb\+srv:\/\/[^:]+:[^@]+@/, label: "MongoDB connection string with credentials" },
];

// ── Source file extensions to scan ───────────────────────────────────

const SCAN_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".json", ".env", ".yaml", ".yml", ".toml"]);

// ── Known safe paths to exclude ──────────────────────────────────────

const EXCLUDE_DIRS = new Set(["node_modules", ".git", "dist", ".run", ".turbo", ".next", "build"]);

// ── System Audit Agent ───────────────────────────────────────────────

const SYSTEM_PROMPT = `You are the System Audit Agent — the "truth guardian" of the Păun AI Hedge Fund OS. Your role is to analyze audit findings and produce actionable security and integrity recommendations.

You review scan results for:
- Mock/fake data in production code
- Placeholders and TODOs in active paths
- Stub functions returning hardcoded values
- Stale market data
- False or deceptive alerts
- Missing integrations (env vars, APIs)
- Build health and TypeScript errors
- Exposed secrets and insecure endpoints

Respond in JSON format:
{"direction":"NEUTRAL","confidence":0-100,"reasoning":"audit synthesis with top priorities","data":{"topRisks":["risk1"],"urgentActions":["action1"],"overallHealth":"healthy"|"warning"|"critical"}}`;

export class SystemAuditAgent extends BaseAgent {
  private lastReport: AuditReport | null = null;
  private lastScanTime: number = 0;
  private projectRoot: string;

  constructor(projectRoot?: string) {
    super({
      id: "system-audit-agent",
      role: "system_audit",
      systemPrompt: SYSTEM_PROMPT,
    });
    this.projectRoot = projectRoot || resolve(process.cwd());
  }

  // ── Public API ─────────────────────────────────────────────────────

  /** Run all audit checks synchronously. Returns a full audit report. */
  runAudit(): AuditReport {
    const checks: CheckResult[] = [
      this.checkMockData(),
      this.checkPlaceholders(),
      this.checkStubs(),
      this.checkStaleData(),
      this.checkFalseAlerts(),
      this.checkMissingIntegrations(),
      this.checkBuildHealth(),
      this.checkSecurity(),
    ];

    const allIssues: AuditIssue[] = [];
    let passedChecks = 0;
    let failedChecks = 0;

    for (const check of checks) {
      if (check.passed) {
        passedChecks++;
      } else {
        failedChecks++;
      }
      allIssues.push(...check.issues);
    }

    // Compute score: start at 100, deduct per issue weighted by severity
    let score = 100;
    for (const issue of allIssues) {
      score -= SEVERITY_WEIGHT[issue.severity];
    }
    score = Math.max(0, Math.min(100, score));

    const recommendations = this.generateRecommendations(allIssues);

    const report: AuditReport = {
      score,
      issues: allIssues,
      passedChecks,
      failedChecks,
      recommendations,
      timestamp: Date.now(),
    };

    this.lastReport = report;
    this.lastScanTime = Date.now();
    return report;
  }

  /** Get the last cached report without re-scanning. */
  getLastReport(): AuditReport | null {
    return this.lastReport;
  }

  /** Get timestamp of last scan. */
  getLastScanTime(): number {
    return this.lastScanTime;
  }

  // ── Detection Method 1: Mock Data ──────────────────────────────────

  private checkMockData(): CheckResult {
    const issues: AuditIssue[] = [];
    const files = this.collectSourceFiles();

    for (const file of files) {
      try {
        const content = readFileSync(file, "utf-8");
        const lines = content.split("\n");

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const lineNum = i + 1;

          // Math.random() used in production data paths (allow tests/utils)
          if (line.includes("Math.random()") && !file.includes(".test.") && !file.includes(".spec.") && !file.includes("__tests__")) {
            // Skip if it's in a comment
            const trimmed = line.trim();
            if (!trimmed.startsWith("//") && !trimmed.startsWith("/*") && !trimmed.startsWith("*")) {
              issues.push({
                severity: "MEDIUM",
                category: "mock-data",
                description: "Math.random() used in non-test file — potential mock/randomized data generation",
                location: `${file}:${lineNum}`,
              });
            }
          }

          // Hardcoded 0 values in profit/price fields
          if (/\b(profit|pnl|price|revenue)\s*[:=]\s*0\b/i.test(line) && !line.includes("fallback") && !line.includes("default")) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("//") && !trimmed.startsWith("/*")) {
              issues.push({
                severity: "MEDIUM",
                category: "mock-data",
                description: `Hardcoded zero value in profit/price field: "${trimmed.slice(0, 80)}"`,
                location: `${file}:${lineNum}`,
              });
            }
          }

          // "mock" or "simulated" in data contexts
          if (/\b(mock|simulated|fake|dummy)\s*(data|price|trade|order|balance|position)\b/i.test(line)) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("//") && !trimmed.startsWith("/*") && !trimmed.startsWith("*")) {
              issues.push({
                severity: "HIGH",
                category: "mock-data",
                description: `Mock/simulated data reference in production code: "${trimmed.slice(0, 80)}"`,
                location: `${file}:${lineNum}`,
              });
            }
          }
        }
      } catch {
        // Skip unreadable files
      }
    }

    return {
      name: "Mock Data Detection",
      passed: issues.length === 0,
      issues,
    };
  }

  // ── Detection Method 2: Placeholders ───────────────────────────────

  private checkPlaceholders(): CheckResult {
    const issues: AuditIssue[] = [];
    const files = this.collectSourceFiles();

    for (const file of files) {
      try {
        const content = readFileSync(file, "utf-8");
        const lines = content.split("\n");

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const lineNum = i + 1;
          const trimmed = line.trim();

          if (trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) continue;

          // TODO / FIXME
          if (/\b(TODO|FIXME|HACK|XXX)\b/.test(line)) {
            issues.push({
              severity: "LOW",
              category: "placeholder",
              description: `Unresolved ${line.match(/\b(TODO|FIXME|HACK|XXX)\b/)?.[0] || "marker"}: "${trimmed.slice(0, 80)}"`,
              location: `${file}:${lineNum}`,
            });
          }

          // "0x0000..." or "0x0000000000000000000000000000000000000000"
          if (/0x0{8,}/.test(line) && !line.includes("address(0)") && !line.includes("0x0000000000000000000000000000000000000000")) {
            issues.push({
              severity: "MEDIUM",
              category: "placeholder",
              description: "Zero-address placeholder pattern detected",
              location: `${file}:${lineNum}`,
            });
          }

          // Empty strings where data should exist (heuristic)
          if (/(?:url|endpoint|key|secret|token|address|hash)\s*[:=]\s*["']\s*["']/i.test(line)) {
            issues.push({
              severity: "HIGH",
              category: "placeholder",
              description: `Empty string assigned to data field: "${trimmed.slice(0, 80)}"`,
              location: `${file}:${lineNum}`,
            });
          }
        }
      } catch {
        // Skip unreadable files
      }
    }

    return {
      name: "Placeholder Detection",
      passed: issues.filter((i) => i.severity !== "LOW").length === 0,
      issues,
    };
  }

  // ── Detection Method 3: Stub Detection ─────────────────────────────

  private checkStubs(): CheckResult {
    const issues: AuditIssue[] = [];
    const files = this.collectSourceFiles();

    for (const file of files) {
      try {
        const content = readFileSync(file, "utf-8");

        // Pattern: async function that just returns a hardcoded value
        // Regex: function body with only "return <literal>;" and nothing else meaningful
        const stubPattern = /(?:async\s+)?function\s+\w+[^{]*\{[^}]*\breturn\s+(?:0|""|''|\[\]|\{\}|null|undefined|true|false)\s*;?\s*\}/g;
        let match;
        while ((match = stubPattern.exec(content)) !== null) {
          const fnBody = match[0];
          // Only flag if the function is short (likely a stub)
          if (fnBody.length < 80) {
            const beforeMatch = content.lastIndexOf("\n", match.index);
            const lineNum = content.slice(0, match.index).split("\n").length;
            issues.push({
              severity: "LOW",
              category: "stub",
              description: `Stub function returning hardcoded value: "${fnBody.slice(0, 70)}"`,
              location: `${file}:${lineNum}`,
            });
          }
        }

        // Also check arrow functions: const x = () => 0 or const x = async () => null
        const arrowStubPattern = /const\s+\w+\s*=\s*(?:async\s*)?\([^)]*\)\s*(?::\s*\w+)?\s*=>\s*(?:0|null|undefined|""|''|\[\]|\{\})\s*;?/g;
        while ((match = arrowStubPattern.exec(content)) !== null) {
          const lineNum = content.slice(0, match.index).split("\n").length;
          issues.push({
            severity: "LOW",
            category: "stub",
            description: `Stub arrow function returning hardcoded value: "${match[0].slice(0, 70)}"`,
            location: `${file}:${lineNum}`,
          });
        }
      } catch {
        // Skip unreadable files
      }
    }

    return {
      name: "Stub Detection",
      passed: issues.length === 0,
      issues,
    };
  }

  // ── Detection Method 4: Stale Data ─────────────────────────────────

  private checkStaleData(): CheckResult {
    const issues: AuditIssue[] = [];

    // Check env var for last price timestamp (set by WebSocket feed)
    const lastPriceUpdate = process.env.LAST_PRICE_UPDATE_MS;
    if (lastPriceUpdate) {
      const age = Date.now() - parseInt(lastPriceUpdate, 10);
      if (age > 300_000) {
        // 5 minutes
        issues.push({
          severity: "HIGH",
          category: "stale-data",
          description: `Market price data is stale — last update ${Math.round(age / 1000)}s ago (threshold: 300s)`,
          location: "env:LAST_PRICE_UPDATE_MS",
        });
      }
    }

    // Check if WebSocket price context module is loaded and recent
    try {
      const priceCtxFile = join(this.projectRoot, "src/lib/ws/price-context.ts");
      if (existsSync(priceCtxFile)) {
        const stats = statSync(priceCtxFile);
        const fileAge = Date.now() - stats.mtimeMs;
        // This just confirms the module exists; actual price freshness is checked above
      }
    } catch {
      issues.push({
        severity: "MEDIUM",
        category: "stale-data",
        description: "WebSocket price-context module not found — live price data may be unavailable",
        location: "src/lib/ws/price-context.ts",
      });
    }

    return {
      name: "Stale Data Check",
      passed: issues.length === 0,
      issues,
    };
  }

  // ── Detection Method 5: False Alerts ───────────────────────────────

  private checkFalseAlerts(): CheckResult {
    const issues: AuditIssue[] = [];
    const files = this.collectSourceFiles();

    for (const file of files) {
      try {
        // Only scan alert-related files
        if (!file.includes("alert") && !file.includes("notif") && !file.includes("notify")) continue;

        const content = readFileSync(file, "utf-8");
        const lines = content.split("\n");

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const lineNum = i + 1;
          const trimmed = line.trim();
          if (trimmed.startsWith("//") || trimmed.startsWith("/*")) continue;

          if (/\b(test|fake|simulated|dummy)\s*(alert|signal|notification|message)\b/i.test(line)) {
            issues.push({
              severity: "HIGH",
              category: "false-alert",
              description: `Potentially false/deceptive alert message: "${trimmed.slice(0, 80)}"`,
              location: `${file}:${lineNum}`,
            });
          }
        }
      } catch {
        // Skip unreadable files
      }
    }

    return {
      name: "False Alert Detection",
      passed: issues.length === 0,
      issues,
    };
  }

  // ── Detection Method 6: Missing Integrations ───────────────────────

  private checkMissingIntegrations(): CheckResult {
    const issues: AuditIssue[] = [];

    // Check required env vars
    const requiredVars: Array<{ key: string; label: string; severity: AuditSeverity }> = [
      { key: "OPENAI_API_KEY", label: "OpenAI API Key", severity: "HIGH" },
      { key: "DATABASE_URL", label: "Database URL", severity: "HIGH" },
    ];

    for (const { key, label, severity } of requiredVars) {
      const val = getApiKey(key as any) || process.env[key];
      if (!val || val.trim().length === 0) {
        issues.push({
          severity,
          category: "missing-integration",
          description: `Required environment variable "${label}" (${key}) is not configured`,
          location: `env:${key}`,
        });
      }
    }

    // Check if key.env file exists as fallback
    const keyEnvPath = join(this.projectRoot, ".keys.env");
    if (!existsSync(keyEnvPath)) {
      issues.push({
        severity: "LOW",
        category: "missing-integration",
        description: "No .keys.env file found — API keys may need manual entry via Settings UI",
        location: ".keys.env",
      });
    }

    return {
      name: "Missing Integrations",
      passed: issues.filter((i) => i.severity !== "LOW").length === 0,
      issues,
    };
  }

  // ── Detection Method 7: Build Health ───────────────────────────────

  private checkBuildHealth(): CheckResult {
    const issues: AuditIssue[] = [];

    // Check tsconfig exists
    const tsconfigPath = join(this.projectRoot, "tsconfig.json");
    if (!existsSync(tsconfigPath)) {
      issues.push({
        severity: "CRITICAL",
        category: "build-health",
        description: "tsconfig.json not found — TypeScript compilation may be broken",
        location: "tsconfig.json",
      });
    }

    // Check if node_modules exists
    const nodeModulesPath = join(this.projectRoot, "node_modules");
    if (!existsSync(nodeModulesPath)) {
      issues.push({
        severity: "CRITICAL",
        category: "build-health",
        description: "node_modules not found — dependencies not installed",
        location: "node_modules/",
      });
    }

    // Check for dist/build output (Vite)
    const distPath = join(this.projectRoot, "dist");
    if (existsSync(distPath)) {
      try {
        const stats = statSync(distPath);
        const buildAge = Date.now() - stats.mtimeMs;
        if (buildAge > 86_400_000) {
          // 24 hours
          issues.push({
            severity: "LOW",
            category: "build-health",
            description: `Last build is over ${Math.round(buildAge / 3_600_000)}h old — rebuild recommended`,
            location: "dist/",
          });
        }
      } catch {
        // Can't stat dist
      }
    }

    // Check for .run directory (Vite dev server runtime)
    const runPath = join(this.projectRoot, ".run");
    if (existsSync(runPath)) {
      try {
        const serverLogPath = join(runPath, "server.log");
        if (existsSync(serverLogPath)) {
          const logContent = readFileSync(serverLogPath, "utf-8");
          const errorCount = (logContent.match(/error/i) || []).length;
          if (errorCount > 10) {
            issues.push({
              severity: "MEDIUM",
              category: "build-health",
              description: `Server log contains ${errorCount} error occurrences — check .run/server.log`,
              location: ".run/server.log",
            });
          }
        }
      } catch {
        // Can't read log
      }
    }

    // Check for .keys.env (needed for API keys)
    // Already checked above, don't duplicate

    return {
      name: "Build Health",
      passed: issues.filter((i) => i.severity === "CRITICAL").length === 0,
      issues,
    };
  }

  // ── Detection Method 8: Security Scan ──────────────────────────────

  private checkSecurity(): CheckResult {
    const issues: AuditIssue[] = [];
    const files = this.collectSourceFiles();

    for (const file of files) {
      try {
        const content = readFileSync(file, "utf-8");
        const lines = content.split("\n");

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const lineNum = i + 1;
          const trimmed = line.trim();

          // Skip comments
          if (trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) continue;

          // Check sensitive patterns
          for (const { pattern, label } of SENSITIVE_PATTERNS) {
            if (pattern.test(line)) {
              issues.push({
                severity: "CRITICAL",
                category: "security",
                description: `Exposed ${label} detected in source code`,
                location: `${file}:${lineNum}`,
              });
            }
          }

          // Check for insecure HTTP endpoints (not localhost)
          if (/https?:\/\/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/.test(line) && !line.includes("127.0.0.1") && !line.includes("localhost")) {
            issues.push({
              severity: "MEDIUM",
              category: "security",
              description: `Hardcoded IP endpoint — may indicate insecure configuration: "${trimmed.slice(0, 80)}"`,
              location: `${file}:${lineNum}`,
            });
          }

          // Check for disabled SSL verification
          if (/rejectUnauthorized\s*:\s*false/i.test(line) || /NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]0['"]/.test(line)) {
            issues.push({
              severity: "HIGH",
              category: "security",
              description: "TLS certificate verification disabled — man-in-the-middle risk",
              location: `${file}:${lineNum}`,
            });
          }
        }
      } catch {
        // Skip unreadable files
      }
    }

    return {
      name: "Security Scan",
      passed: issues.length === 0,
      issues,
    };
  }

  // ── Helpers ────────────────────────────────────────────────────────

  /** Collect all source files in the project. */
  private collectSourceFiles(): string[] {
    const files: string[] = [];
    const srcDir = join(this.projectRoot, "src");

    if (!existsSync(srcDir)) return files;

    try {
      this.walkDir(srcDir, files);
    } catch {
      // Unable to scan — no files collected
    }

    return files;
  }

  /** Recursively walk a directory collecting source files. */
  private walkDir(dir: string, files: string[]): void {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        if (EXCLUDE_DIRS.has(entry.name)) continue;
        // Skip hidden directories
        if (entry.name.startsWith(".")) continue;
        this.walkDir(fullPath, files);
      } else if (entry.isFile()) {
        const ext = entry.name.slice(entry.name.lastIndexOf("."));
        if (SCAN_EXTENSIONS.has(ext) || entry.name === ".env" || entry.name === ".keys.env") {
          files.push(fullPath);
        }
      }
    }
  }

  /** Generate human-readable recommendations from issues. */
  private generateRecommendations(issues: AuditIssue[]): string[] {
    const recs: string[] = [];
    const hasSecurity = issues.some((i) => i.category === "security" && i.severity === "CRITICAL");
    const hasStale = issues.some((i) => i.category === "stale-data" && i.severity === "HIGH");
    const hasMissing = issues.some((i) => i.category === "missing-integration" && i.severity === "HIGH");
    const hasMock = issues.some((i) => i.category === "mock-data");
    const hasPlaceholder = issues.some((i) => i.category === "placeholder");

    if (hasSecurity) {
      recs.push("CRITICAL: Rotate all exposed secrets immediately and remove them from source code. Use environment variables via .keys.env.");
    }
    if (hasStale) {
      recs.push("HIGH: Market data is stale. Check WebSocket connection to Binance and restart price feed if needed.");
    }
    if (hasMissing) {
      recs.push("HIGH: Configure required environment variables (OPENAI_API_KEY, DATABASE_URL) in Settings → API Keys or via .keys.env.");
    }
    if (hasMock) {
      recs.push("MEDIUM: Replace mock/randomized data with real market data sources. Audit all Math.random() usage in non-test files.");
    }
    if (hasPlaceholder) {
      recs.push("MEDIUM: Fill in placeholder values (TODOs, empty strings) with real configuration before deploying to production.");
    }
    if (issues.length === 0) {
      recs.push("✅ System is clean. All checks passed. No issues detected.");
    }

    return recs;
  }

  // ── GPT-4o Synthesis (async, uses BaseAgent.analyzeMarket) ─────────

  /** Build user prompt for GPT-4o audit synthesis. */
  protected buildUserPrompt(context: { report: AuditReport }): string {
    const r = context.report;
    const criticalIssues = r.issues.filter((i) => i.severity === "CRITICAL");
    const highIssues = r.issues.filter((i) => i.severity === "HIGH");

    const lines: string[] = [
      `System Audit Report — Score: ${r.score}/100`,
      `Timestamp: ${new Date(r.timestamp).toISOString()}`,
      `Passed Checks: ${r.passedChecks}/8 | Failed: ${r.failedChecks}/8`,
      ``,
      `Critical Issues (${criticalIssues.length}):`,
      ...criticalIssues.map((i) => `  - [${i.category}] ${i.description} (${i.location})`),
      ``,
      `High Issues (${highIssues.length}):`,
      ...highIssues.map((i) => `  - [${i.category}] ${i.description} (${i.location})`),
      ``,
      `Total Issues: ${r.issues.length}`,
      ``,
      `Based on this audit, what is the overall system health? What are the top 3 urgent actions?`,
    ];

    return lines.join("\n");
  }

  /**
   * Synthesize audit findings with GPT-4o for natural-language recommendations.
   */
  async synthesize(report: AuditReport): Promise<{
    direction: "LONG" | "SHORT" | "NEUTRAL";
    confidence: number;
    reasoning: string;
    topRisks: string[];
    urgentActions: string[];
    overallHealth: "healthy" | "warning" | "critical";
  }> {
    const agentReport = await this.analyzeMarket({ report });

    return {
      direction: agentReport.direction,
      confidence: agentReport.confidence,
      reasoning: agentReport.reasoning,
      topRisks: agentReport.data?.topRisks || [],
      urgentActions: agentReport.data?.urgentActions || [],
      overallHealth: agentReport.data?.overallHealth || "warning",
    };
  }
}
