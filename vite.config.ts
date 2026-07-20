import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  server: {
    port: 3000,
    host: true,
    allowedHosts: true,
  },
  plugins: [
    tailwindcss(),
    tsConfigPaths({
      projects: ["./tsconfig.json"],
    }),
    tanstackStart(),
    viteReact(),
  ],
  ssr: {
    noExternal: [],
  },
  // Prevent Vite from trying to bundle Node.js builtins for client
  resolve: {
    alias: {
      "node:fs": "node:fs",
      "node:path": "node:path",
    },
  },
  build: {
    rollupOptions: {
      external: ["node:fs", "node:path"],
    },
  },
});
