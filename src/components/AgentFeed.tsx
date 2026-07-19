"use client";

import { useState, useEffect } from "react";
import type { AgentActivity } from "~/lib/agent-activity";

interface AgentFeedProps {
  activities: AgentActivity[];
}

export function AgentFeed({ activities }: AgentFeedProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  const fmtTime = (ts: number): string => {
    const diff = Date.now() - ts;
    if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const typeStyles: Record<string, string> = {
    trade: "text-accent-green",
    deposit: "text-accent-blue",
    withdraw: "text-accent-yellow",
    scan: "text-accent-cyan",
    info: "text-gray-400",
  };

  const typeBadges: Record<string, string> = {
    trade: "badge-green",
    deposit: "badge-blue",
    withdraw: "badge-yellow",
    scan: "badge-cyan",
    info: "",
  };

  if (!mounted) return null;

  return (
    <div className="glass-card p-6 animate-fade-in">
      <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-4 flex items-center gap-2">
        <span className="text-accent-cyan">▸</span> Agent Activity Feed
        <span className="ml-auto text-xs text-gray-400 font-normal normal-case">
          {activities.length} events
        </span>
      </h2>

      {activities.length === 0 ? (
        <div className="py-8 text-center text-gray-400">
          <span className="text-3xl block mb-2">🤖</span>
          <p className="text-sm">No agent activity recorded yet</p>
          <p className="text-xs mt-1 text-gray-400">Agents are initializing and will begin scanning soon</p>
        </div>
      ) : (
        <div className="space-y-0.5 max-h-[400px] overflow-y-auto pr-2">
          {activities.slice(0, 50).map((activity) => (
            <div
              key={activity.id}
              className="flex items-start gap-3 py-2 px-3 rounded-lg hover:bg-dark-hover/50 transition-colors group"
            >
              {/* Type indicator */}
              <span className={`mt-0.5 text-sm shrink-0 ${typeStyles[activity.type] || "text-gray-400"}`}>
                {activity.type === "trade"
                  ? "💱"
                  : activity.type === "deposit"
                  ? "📥"
                  : activity.type === "withdraw"
                  ? "📤"
                  : activity.type === "scan"
                  ? "🔍"
                  : "📋"}
              </span>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-semibold text-white">{activity.agentName}</span>
                  {activity.type !== "info" && (
                    <span className={`badge text-[0.625rem] ${typeBadges[activity.type] || ""}`}>
                      {activity.type}
                    </span>
                  )}
                  <span className="text-[0.625rem] text-gray-400 text-mono-sm">{fmtTime(activity.timestamp)}</span>
                </div>
                <p className="text-xs text-gray-300 mt-0.5 leading-relaxed">{activity.action}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Feed pulse indicator */}
      <div className="mt-4 pt-3 border-t border-dark-border flex items-center gap-2">
        <span className="status-dot-online animate-pulse-slow"></span>
        <span className="text-[0.625rem] text-gray-400">Live monitoring active — updates in real-time via WebSocket</span>
      </div>
    </div>
  );
}
