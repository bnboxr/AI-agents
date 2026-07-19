// ── Database Client — Neon Serverless Postgres ──────────────────────
// Graceful fallback: if DATABASE_URL is missing, exports a no-op that
// returns empty arrays so the app works without a database.
//
// Uses @neondatabase/serverless (tagged-template SQL function).

import { neon } from "@neondatabase/serverless";

const databaseUrl = process.env.DATABASE_URL;

// Real client when DATABASE_URL is configured
const realSql = databaseUrl ? neon(databaseUrl) : null;

if (!databaseUrl) {
  console.warn(
    "[DB] DATABASE_URL not set — running without database persistence. Set DATABASE_URL to a Neon Postgres connection string to enable persistence.",
  );
}

/**
 * SQL query function. Uses Neon serverless when DATABASE_URL is set;
 * otherwise returns empty results for all queries (graceful degradation).
 *
 * Supports both tagged-template and direct query forms:
 *   sql`SELECT * FROM trades WHERE id = ${id}`
 *   sql.query('SELECT * FROM trades WHERE id = $1', [id])
 */
const _sql = Object.assign(
  // Tagged template form
  async (strings: TemplateStringsArray, ...values: unknown[]) => {
    if (!realSql) {
      return { rows: [] as Record<string, unknown>[], rowCount: 0 };
    }
    try {
      return await realSql(strings as unknown as TemplateStringsArray, ...values);
    } catch (err) {
      console.error("[DB] Query error:", err);
      return { rows: [] as Record<string, unknown>[], rowCount: 0 };
    }
  },
  {
    // Direct query form with parameterized placeholders
    query: async (
      queryText: string,
      params?: unknown[],
    ): Promise<{ rows: Record<string, unknown>[]; rowCount: number }> => {
      if (!realSql) {
        return { rows: [], rowCount: 0 };
      }
      try {
        return await realSql.query(queryText, params);
      } catch (err) {
        console.error("[DB] Query error:", err);
        return { rows: [], rowCount: 0 };
      }
    },
    /**
     * Returns true if the database is available.
     */
    isAvailable(): boolean {
      return realSql !== null;
    },
  },
);

export const sql = _sql;

/**
 * Returns true if the database connection is configured and available.
 */
export function isDbAvailable(): boolean {
  return realSql !== null;
}
