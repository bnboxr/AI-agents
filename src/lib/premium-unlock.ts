// ── Premium Unlock Store (REAL server state) ─────────────────────────
// Records and checks premium signal unlocks. State is written ONLY by the
// Stripe webhook after signature verification of a real
// `checkout.session.completed` event — never by client input, never
// fabricated.
//
// Persistence: Neon Postgres (`premium_unlocks` table) when DATABASE_URL is
// configured. A process-local mirror of VERIFIED writes backs fast reads;
// it only ever contains entries that were durably written to the DB first.
//
// Integrity rules (owner hard rule):
//  - No DB configured → the webhook writer THROWS (503 → Stripe retries).
//    An unlock that cannot be durably recorded is not accepted silently.
//  - Read errors → false (locked). Fail closed; never unlock on error.

import { sql, isDbAvailable } from "~/lib/db";

// ── Schema (idempotent create, once per process) ────────────────────

let tableReady: Promise<void> | null = null;

function ensureTable(): Promise<void> {
  if (!tableReady) {
    tableReady = (async () => {
      await sql.query(`
        CREATE TABLE IF NOT EXISTS premium_unlocks (
          session_id        TEXT PRIMARY KEY,
          email             TEXT,
          stripe_session_id TEXT NOT NULL,
          amount_total      BIGINT NOT NULL DEFAULT 0,
          currency          TEXT NOT NULL DEFAULT 'usd',
          product           TEXT NOT NULL DEFAULT 'trading-signals',
          unlocked_at       TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      await sql.query(
        `CREATE INDEX IF NOT EXISTS idx_premium_unlocks_email ON premium_unlocks (email)`,
      );
    })();
  }
  return tableReady;
}

// ── In-process mirror of verified unlocks (DB writes succeeded first) ─

const mirrorSessionIds = new Set<string>();
const mirrorEmails = new Set<string>();

// ── Public API ───────────────────────────────────────────────────────

export interface PremiumUnlockInput {
  /** client_reference_id from the checkout session (our signals session). */
  sessionId?: string | null;
  /** customer email from the checkout session. */
  email?: string | null;
  /** Stripe checkout session id (cs_...). */
  stripeSessionId: string;
  amountTotal?: number;
  currency?: string;
  /** Which product the payment was for (default: trading-signals). */
  product?: string;
}

/**
 * Record a verified premium unlock. MUST only be called after webhook
 * signature verification succeeded.
 *
 * @throws when persistence is impossible (no DATABASE_URL) so the caller
 *         returns 503 and Stripe retries — the event is never dropped.
 */
export async function markPremiumUnlock(input: PremiumUnlockInput): Promise<void> {
  const sessionId = input.sessionId?.trim();
  const email = input.email?.trim().toLowerCase();
  if (!sessionId && !email) {
    throw new Error(
      "[stripe] markPremiumUnlock: checkout session has no client_reference_id and no customer_email — cannot attribute the unlock.",
    );
  }
  if (!isDbAvailable()) {
    throw new Error(
      "[stripe] Cannot persist premium unlock — DATABASE_URL not configured. Refusing to accept an event that cannot be durably recorded.",
    );
  }

  await ensureTable();

  // INSERT, updating on re-verification (idempotent webhook retries).
  const result = await sql.query(
    `INSERT INTO premium_unlocks (session_id, email, stripe_session_id, amount_total, currency, product)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (session_id) DO UPDATE SET
       email = EXCLUDED.email,
       stripe_session_id = EXCLUDED.stripe_session_id,
       amount_total = EXCLUDED.amount_total,
       currency = EXCLUDED.currency,
       product = EXCLUDED.product,
       unlocked_at = now()`,
    [
      sessionId || null,
      email || null,
      input.stripeSessionId,
      Math.round(input.amountTotal ?? 0),
      input.currency ?? "usd",
      input.product ?? "trading-signals",
    ],
  );

  // db.ts's sql wrapper can swallow driver errors (returns empty result) —
  // verify the write actually landed; otherwise surface the failure.
  if (!result || typeof result.rowCount !== "number" || result.rowCount < 1) {
    throw new Error(
      "[stripe] Premium unlock DB write returned no affected rows — refusing to accept the event. Stripe will retry.",
    );
  }

  // Mirrors are updated only after the durable write succeeded.
  if (sessionId) mirrorSessionIds.add(sessionId);
  if (email) mirrorEmails.add(email);
}

/**
 * Check whether a session/email has a REAL, webhook-verified premium unlock.
 * Reads the DB (source of truth); the in-process mirror accelerates the
 * common same-process case. On DB error → false (locked, fail closed).
 */
export async function hasPremiumUnlock(
  sessionId?: string | null,
  email?: string | null,
): Promise<boolean> {
  const sid = sessionId?.trim();
  const em = email?.trim().toLowerCase();

  // Fast path: mirror of verified, durably-written unlocks.
  if (sid && mirrorSessionIds.has(sid)) return true;
  if (em && mirrorEmails.has(em)) return true;

  if (!sid && !em) return false;
  if (!isDbAvailable()) {
    console.warn("[premium-unlock] DB not configured — premium check returns locked.");
    return false;
  }

  try {
    await ensureTable();
    const result = await sql.query(
      `SELECT 1 FROM premium_unlocks
       WHERE ($1::text IS NOT NULL AND session_id = $1)
          OR ($2::text IS NOT NULL AND email = $2)
       LIMIT 1`,
      [sid || null, em || null],
    );
    const unlocked = !!result && result.rowCount > 0;
    if (unlocked) {
      if (sid) mirrorSessionIds.add(sid);
      if (em) mirrorEmails.add(em);
    }
    return unlocked;
  } catch (err) {
    // Fail closed: a read error never unlocks.
    console.error("[premium-unlock] read error — returning locked:", err);
    return false;
  }
}