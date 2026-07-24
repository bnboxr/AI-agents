import { createAPIFileRoute } from "@tanstack/react-start/api";

const startTime = Date.now();

export const Route = createAPIFileRoute("/api/health")({
  GET: async () => {
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const chains = {
      ethereum: "active",
      polygon: "active",
      solana: "active",
      xrp: "active",
      tron: "active",
      cosmos: "active",
    };

    return Response.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      uptime: `${uptime}s`,
      chains,
      agents: 29,
      version: "3.0.0-terminal",
    });
  },
});
