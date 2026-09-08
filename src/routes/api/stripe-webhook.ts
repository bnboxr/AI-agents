// ── Stripe Premium Webhook ───────────────────────────────────────────
// Server-side verification of `checkout.session.completed` events for the
// HSMC Trading Signals product (real payment link already live, PR #71).
//
// Flow:
//   1. STRIPE_WEBHOOK_SECRET is REQUIRED — without it the route refuses
//      (throws): unverified events are never accepted and never unlock.
//   2. Signature verified with raw HMAC over the raw body
//      (stripe-signature.ts) — invalid ⇒ 400.
//   3. `checkout.session.completed` + `payment_status === "paid"` and a
//      client_reference_id / customer_email ⇒ markPremiumUnlock (DB).
//      Persistence failure ⇒ 503 so Stripe retries (event is never dropped).
//
// Webhook delivery URL (set in Stripe Dashboard):
//   https://<host>/api/stripe-webhook   — event: checkout.session.completed
// (exact host: owner decision; the payment link product lives on Stripe).
//
// Security notes:
//   - The deposit checkout (src/routes/deposit.tsx) creates sessions WITHOUT
//     client_reference_id/customer_email, so a deposit completion can never
//     grant signal premium — the attribution field is the discriminator.
//   - premium-unlock.ts persists to Neon Postgres and fails closed on error.

import { requireEnv } from "~/lib/env-guard";
import { verifyStripeSignature } from "~/lib/stripe-signature";
import { markPremiumUnlock } from "~/lib/premium-unlock";

export interface StripeCheckoutSession {
  id?: string;
  client_reference_id?: string | null;
  customer_email?: string | null;
  payment_status?: string;
  amount_total?: number;
  currency?: string;
}

interface StripeEvent {
  type?: string;
  data?: { object?: StripeCheckoutSession };
}

/**
 * Handle a Stripe webhook POST. Returns an HTTP Response with the proper
 * status for Stripe's retry semantics.
 *
 * @throws only when STRIPE_WEBHOOK_SECRET is absent (misconfiguration) —
 *         the caller maps that to 500 so the operator sees it immediately.
 */
export async function handleStripeWebhook(req: Request): Promise<Response> {
  // 1) Secret required. NEVER accept an unverifiable event.
  const webhookSecret = requireEnv("STRIPE_WEBHOOK_SECRET");

  if (req.method !== "POST") {
    return Response.json(
      { error: "Method not allowed — Stripe webhooks are POST." },
      { status: 405 },
    );
  }

  // 2) Raw body (signature is over the exact bytes, not a re-serialization).
  const rawBody = await req.text();
  const signature = req.headers.get("stripe-signature");
  if (!verifyStripeSignature(rawBody, signature, webhookSecret)) {
    console.warn("[stripe-webhook] Signature verification FAILED — event rejected.");
    return Response.json({ error: "Invalid signature" }, { status: 400 });
  }

  // 3) Parse + validate the event.
  let event: StripeEvent;
  try {
    event = JSON.parse(rawBody) as StripeEvent;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!event || typeof event !== "object" || !event.type) {
    return Response.json({ error: "Malformed event" }, { status: 400 });
  }

  // Ack non-relevant events (200 stops Stripe retries for them).
  if (event.type !== "checkout.session.completed") {
    return Response.json({ received: true, ignored: event.type }, { status: 200 });
  }

  const session = event.data?.object ?? {};
  // Only grant on confirmed paid payments (async payment methods may emit
  // this event with payment_status "processing" — not paid yet).
  if (session.payment_status !== "paid") {
    console.warn(
      `[stripe-webhook] checkout.session.completed with payment_status="${session.payment_status}" — not granting premium.`,
    );
    return Response.json({ received: true, ignored: "not paid" }, { status: 200 });
  }
  if (!session.id) {
    return Response.json({ error: "Missing session id" }, { status: 400 });
  }

  // 4) Attribute + persist. Failures THROW → caller returns 503 → retry.
  try {
    await markPremiumUnlock({
      sessionId: session.client_reference_id || null,
      email: session.customer_email || null,
      stripeSessionId: session.id,
      amountTotal: session.amount_total,
      currency: session.currency,
      product: "trading-signals",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[stripe-webhook] unlock persistence failed:", message);
    return Response.json(
      { error: "Unlock persistence failed — retry later", detail: message },
      { status: 503 },
    );
  }

  console.log(
    `[stripe-webhook] ✅ Premium unlocked for client_reference_id=${session.client_reference_id ?? "-"} email=${session.customer_email ?? "-"} (session ${session.id})`,
  );
  return Response.json({ received: true }, { status: 200 });
}

/**
 * Framework API-route loader (GET). The production POST path is registered
 * in serve.ts (Bun.serve) so the raw body + Stripe-Signature header reach
 * `handleStripeWebhook` untouched by TanStack's server-fn serialization.
 */
export async function loader(): Promise<Response> {
  return Response.json(
    { error: "POST only — Stripe delivers webhooks as POST." },
    { status: 405 },
  );
}