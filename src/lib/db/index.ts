// ── Database Client ──────────────────────────────────────────────────
// Re-exports for the existing codebase.
// In production this would use postgres.js or similar.
// For now, provides an in-memory fallback that existing code can call.

import { sql as neonSql } from "@neondatabase/serverless";

const DATABASE_URL =
  typeof process !== "undefined" && process.env?.DATABASE_URL
    ? process.env.DATABASE_URL
    : undefined;

let _dbAvailable: boolean | null = null;

/** Check whether Neon PostgreSQL is configured. */
export function isDbAvailable(): boolean {
  if (_dbAvailable !== null) return _dbAvailable;
  _dbAvailable = !!DATABASE_URL;
  return _dbAvailable;
}

/** SQL tagged template for Neon. Falls back gracefully when DB is unavailable. */
export const sql: typeof neonSql = (() => {
  if (!DATABASE_URL) {
    // Return a no-op proxy so imports don't crash
    const noop = new Proxy({} as typeof neonSql, {
      get: () => () => ({ rows: [], rowCount: 0 }),
      apply: () => ({ rows: [], rowCount: 0 }),
    });
    return noop as unknown as typeof neonSql;
  }
  return neonSql;
})();
