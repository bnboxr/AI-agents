import { createServerFn } from "@tanstack/react-start";

const startTime = Date.now();

export const healthCheck = createServerFn().handler(async () => {
  const uptime = Math.floor((Date.now() - startTime) / 1000);
  return {
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: `${uptime}s`,
    chains: { ethereum: "active", polygon: "active", solana: "active", xrp: "active", tron: "active", cosmos: "active" },
    agents: 29,
    version: "3.0.0-terminal",
  };
});