// ── Agent Network Graph Route ─────────────────────────────────────────
import { createFileRoute } from "@tanstack/react-router";
import { AgentNetworkGraph } from "~/components/AgentNetworkGraph";

export const Route = createFileRoute("/network")({
  component: NetworkPage,
});

function NetworkPage() {
  return (
    <div className="pt-14 pb-12 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-4">
        {/* ── Header ─────────────────────────────────────────── */}
        <section className="animate-fade-in">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-white flex items-center gap-2">
                <span>🔗</span> Agent Network Topology
                <span className="flex items-center gap-1 text-xs font-normal text-accent-green bg-accent-green/10 px-2 py-0.5 rounded-full border border-accent-green/20">
                  <span
                    className="inline-block w-[6px] h-[6px] rounded-full bg-accent-green animate-pulse-slow"
                  />
                  LIVE
                </span>
              </h1>
              <p className="text-gray-400 text-sm mt-1">
                29 AI agents · 5 rings ·{" "}
                <span className="text-accent-cyan">Master Orchestrator</span> at
                center · Zero human intervention
              </p>
            </div>
          </div>
        </section>

        {/* ── Network Graph ──────────────────────────────────── */}
        <section className="animate-fade-in-up">
          <div className="glass-card p-2 sm:p-4 overflow-hidden relative min-h-[600px]">
            <AgentNetworkGraph />
          </div>
        </section>

        {/* ── Stats Row ──────────────────────────────────────── */}
        <section className="grid grid-cols-2 sm:grid-cols-5 gap-3 animate-fade-in-up">
          {[
            { label: "Total Agents", value: "29", icon: "🤖" },
            { label: "Active", value: "19", icon: "🟢" },
            { label: "Connections", value: "87", icon: "🔗" },
            { label: "Rings", value: "3", icon: "🎯" },
            { label: "Uptime", value: "99.97%", icon: "⏱️" },
          ].map((stat) => (
            <div key={stat.label} className="card p-4 text-center">
              <span className="text-lg">{stat.icon}</span>
              <p className="text-xl font-bold text-white font-mono mt-1">
                {stat.value}
              </p>
              <p className="text-xs text-gray-400">{stat.label}</p>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
