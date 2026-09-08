// ── Stripe Webhook Signature Verification ────────────────────────────
// Pure, dependency-free verification of the `Stripe-Signature` header using
// node:crypto (raw HMAC-SHA256 — no `stripe` npm package required).
//
// Stripe signs the raw request body: `signed_payload = "<timestamp>.<body>"`
// and sends `Stripe-Signature: t=<timestamp>,v1=<hmac_hex>,...`.
//
// We verify:
//   1. the header exists and contains a `v1` value;
//   2. the signature matches HMAC-SHA256(webhookSecret, t + "." + rawBody);
//   3. the timestamp is fresh (≤ tolerance, default 300s — Stripe's guidance).
//
// Comparison is constant-time (timingSafeEqual). Any failure returns false —
// the webhook route then refuses the event (never unlock unverified).

import { createHmac, timingSafeEqual } from "node:crypto";

export const STRIPE_SIGNATURE_TOLERANCE_SEC = 300;

function hmacSha256Hex(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Verify a Stripe webhook signature against the raw request body.
 *
 * @param rawBody   the RAW request body as received (never re-serialized —
 *                  Stripe signs exactly the bytes on the wire)
 * @param signatureHeader the value of the `Stripe-Signature` request header
 * @param webhookSecret   STRIPE_WEBHOOK_SECRET (the `whsec_...` value)
 * @param nowSec    epoch seconds (injectable for tests)
 * @returns true when the event is authenticated and fresh
 */
export function verifyStripeSignature(
  rawBody: string,
  signatureHeader: string | null,
  webhookSecret: string,
  nowSec: number = Math.floor(Date.now() / 1000),
): boolean {
  if (!signatureHeader) return false;

  const parts = new Map<string, string>();
  for (const kv of signatureHeader.split(",")) {
    const idx = kv.indexOf("=");
    if (idx <= 0) continue;
    parts.set(kv.slice(0, idx).trim(), kv.slice(idx + 1).trim());
  }
  const t = parts.get("t");
  const v1 = parts.get("v1");
  if (!t || !v1) return false;

  // Freshness: reject replay of old events.
  const ts = Number(t);
  if (!Number.isFinite(ts) || Math.abs(nowSec - ts) > STRIPE_SIGNATURE_TOLERANCE_SEC) {
    return false;
  }

  const signedPayload = `${t}.${rawBody}`;
  const expected = hmacSha256Hex(webhookSecret, signedPayload);
  return safeEqual(expected, v1);
}