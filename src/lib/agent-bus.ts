// Agent Bus — server-side event emitter that bridges orchestrator events
// to WebSocket clients. Imported by serve.ts (to broadcast) and by the
// orchestrator dispatcher (to emit). Simple typed pub/sub with no deps.

import type { AgentStatus, AgentScanResult } from "./agent-runner";
import type { AgentActivity } from "./agent-activity";

// ── Event types ─────────────────────────────────────────────────────

export interface AgentBusEvents {
  scan_started: { chainId: string; agentName: string; timestamp: number };
  scan_completed: { chainId: string; agentName: string; opportunitiesFound: number; durationMs: number; success: boolean };
  opportunity_found: { chainId: string; agentName: string; opportunity: AgentScanResult["opportunities"][0] };
  agent_status_change: { chainId: string; status: AgentStatus };
  activity: { activity: AgentActivity };
  heartbeat: { timestamp: number };
  news_sentiment: { chainId: string; token: string; overallSentiment: number; confidence: number; direction: "LONG" | "SHORT" | "NEUTRAL"; headlineCount: number; summary: string; timestamp: number };
}

export type AgentBusEvent = keyof AgentBusEvents;
type Handler<T extends AgentBusEvent> = (payload: AgentBusEvents[T]) => void;

// ── Bus implementation ──────────────────────────────────────────────

class AgentBus {
  private handlers = new Map<AgentBusEvent, Set<Handler<any>>>();

  on<T extends AgentBusEvent>(event: T, handler: Handler<T>): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
    return () => this.handlers.get(event)?.delete(handler);
  }

  emit<T extends AgentBusEvent>(event: T, payload: AgentBusEvents[T]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const handler of set) {
      try {
        handler(payload);
      } catch (err) {
        console.error(`[AgentBus] Error in ${event} handler:`, err);
      }
    }
  }
}

// Singleton
export const agentBus = new AgentBus();
