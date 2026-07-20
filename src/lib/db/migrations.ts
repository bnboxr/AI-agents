// ── Database Migrations ──────────────────────────────────────────────
// Creates all 11 tables from the DB persistence plan.
// Uses CREATE TABLE IF NOT EXISTS for idempotency.
// Seeds singleton rows for trading_state (id=1) and risk_system_state (id=1).

import { sql, isDbAvailable } from "../db";

export async function runMigrations(): Promise<void> {
  if (!isDbAvailable()) {
    console.log("[DB] Skipping migrations — no database configured.");
    return;
  }

  console.log("[DB] Running migrations...");

  try {
    // ── Table 1: trades ───────────────────────────────────────────────
    await sql.query(`
      CREATE TABLE IF NOT EXISTS trades (
        id            TEXT PRIMARY KEY,
        chain_id      TEXT NOT NULL,
        token         TEXT NOT NULL,
        direction     TEXT NOT NULL CHECK (direction IN ('LONG', 'SHORT')),
        entry_price   DOUBLE PRECISION NOT NULL,
        current_price DOUBLE PRECISION,
        exit_price    DOUBLE PRECISION,
        size          DOUBLE PRECISION NOT NULL,
        leverage      DOUBLE PRECISION NOT NULL DEFAULT 1,
        pnl           DOUBLE PRECISION DEFAULT 0,
        pnl_pct       DOUBLE PRECISION DEFAULT 0,
        stop_loss     DOUBLE PRECISION,
        take_profit   DOUBLE PRECISION,
        status        TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'open', 'closed', 'cancelled')),
        ai_reasoning  TEXT,
        opened_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
        closed_at     TIMESTAMPTZ,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await sql.query(`CREATE INDEX IF NOT EXISTS idx_trades_status ON trades (status) WHERE status = 'open'`);

    // Add is_paper column for distinguishing paper vs live trades
    await sql.query(`ALTER TABLE trades ADD COLUMN IF NOT EXISTS is_paper BOOLEAN DEFAULT true`);
    await sql.query(`CREATE INDEX IF NOT EXISTS idx_trades_opened_at ON trades (opened_at DESC)`);
    await sql.query(`CREATE INDEX IF NOT EXISTS idx_trades_chain_token ON trades (chain_id, token)`);

    // ── Table 2: agent_reports ────────────────────────────────────────
    await sql.query(`
      CREATE TABLE IF NOT EXISTS agent_reports (
        id            BIGSERIAL PRIMARY KEY,
        agent_id      TEXT NOT NULL,
        role          TEXT NOT NULL,
        chain_id      TEXT,
        token         TEXT,
        direction     TEXT NOT NULL CHECK (direction IN ('LONG', 'SHORT', 'NEUTRAL')),
        confidence    SMALLINT NOT NULL CHECK (confidence >= 0 AND confidence <= 100),
        reasoning     TEXT NOT NULL,
        data          JSONB DEFAULT '{}',
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await sql.query(`CREATE INDEX IF NOT EXISTS idx_agent_reports_agent ON agent_reports (agent_id, created_at DESC)`);
    await sql.query(`CREATE INDEX IF NOT EXISTS idx_agent_reports_role ON agent_reports (role, created_at DESC)`);

    // ── Table 3: orchestrator_decisions ───────────────────────────────
    await sql.query(`
      CREATE TABLE IF NOT EXISTS orchestrator_decisions (
        id              BIGSERIAL PRIMARY KEY,
        action          TEXT NOT NULL CHECK (action IN ('BUY', 'SELL', 'HOLD', 'EXIT', 'WAIT')),
        confidence      SMALLINT NOT NULL CHECK (confidence >= 0 AND confidence <= 100),
        position_size   DOUBLE PRECISION NOT NULL DEFAULT 0,
        stop_loss       DOUBLE PRECISION,
        take_profit     DOUBLE PRECISION,
        reasoning       TEXT,
        chain_id        TEXT,
        token           TEXT,
        current_price   DOUBLE PRECISION,
        report_ids      BIGINT[],
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    // ── Table 4: agent_activities ─────────────────────────────────────
    await sql.query(`
      CREATE TABLE IF NOT EXISTS agent_activities (
        id            TEXT PRIMARY KEY,
        chain_id      TEXT NOT NULL,
        agent_name    TEXT NOT NULL,
        action        TEXT NOT NULL,
        type          TEXT NOT NULL CHECK (type IN ('trade', 'deposit', 'withdraw', 'scan', 'info')),
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await sql.query(`CREATE INDEX IF NOT EXISTS idx_agent_activities_chain ON agent_activities (chain_id, created_at DESC)`);

    // ── Table 5: agent_states ─────────────────────────────────────────
    await sql.query(`
      CREATE TABLE IF NOT EXISTS agent_states (
        chain_id        TEXT PRIMARY KEY,
        agent_name      TEXT NOT NULL,
        icon            TEXT NOT NULL DEFAULT '🤖',
        status          TEXT NOT NULL DEFAULT 'idle'
                          CHECK (status IN ('active', 'idle', 'scanning', 'error')),
        last_action     TEXT,
        last_action_at  TIMESTAMPTZ,
        next_scan_at    TIMESTAMPTZ,
        profit_total    DOUBLE PRECISION NOT NULL DEFAULT 0,
        transactions    INTEGER NOT NULL DEFAULT 0,
        strategies      TEXT[] DEFAULT '{}',
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    // ── Table 6: trading_state ────────────────────────────────────────
    await sql.query(`
      CREATE TABLE IF NOT EXISTS trading_state (
        id                    INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        capital               DOUBLE PRECISION NOT NULL DEFAULT 1000000,
        initial_capital       DOUBLE PRECISION NOT NULL DEFAULT 1000000,
        open_position         BOOLEAN NOT NULL DEFAULT FALSE,
        position_direction    TEXT CHECK (position_direction IN ('LONG', 'SHORT')),
        entry_price           DOUBLE PRECISION,
        current_price         DOUBLE PRECISION,
        pnl                   DOUBLE PRECISION NOT NULL DEFAULT 0,
        pnl_pct               DOUBLE PRECISION NOT NULL DEFAULT 0,
        consecutive_losses    INTEGER NOT NULL DEFAULT 0,
        consecutive_wins      INTEGER NOT NULL DEFAULT 0,
        total_trades          INTEGER NOT NULL DEFAULT 0,
        win_rate              DOUBLE PRECISION NOT NULL DEFAULT 50,
        anti_tilt_mode        BOOLEAN NOT NULL DEFAULT FALSE,
        probe_mode            BOOLEAN NOT NULL DEFAULT FALSE,
        updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    // Seed singleton row for trading_state
    await sql.query(`
      INSERT INTO trading_state (id, capital, initial_capital) VALUES (1, 1000000, 1000000)
      ON CONFLICT (id) DO NOTHING
    `);

    // ── Table 7: risk_states + risk_system_state ──────────────────────
    await sql.query(`
      CREATE TABLE IF NOT EXISTS risk_states (
        chain_id          TEXT PRIMARY KEY,
        agent_name        TEXT NOT NULL,
        peak_value        DOUBLE PRECISION NOT NULL,
        current_value     DOUBLE PRECISION NOT NULL,
        drawdown_pct      DOUBLE PRECISION NOT NULL DEFAULT 0,
        exposure_usd      DOUBLE PRECISION NOT NULL DEFAULT 0,
        volatility_pct    DOUBLE PRECISION NOT NULL DEFAULT 0,
        risk_score        SMALLINT NOT NULL CHECK (risk_score >= 1 AND risk_score <= 10),
        status            TEXT NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'paused', 'stopped')),
        pause_reason      TEXT,
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await sql.query(`
      CREATE TABLE IF NOT EXISTS risk_system_state (
        id                        INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        circuit_breaker_tripped   BOOLEAN NOT NULL DEFAULT FALSE,
        circuit_breaker_reason    TEXT,
        market_drop_pct           DOUBLE PRECISION NOT NULL DEFAULT 0,
        last_market_check         TIMESTAMPTZ,
        total_exposure            DOUBLE PRECISION NOT NULL DEFAULT 0,
        overall_risk_score        SMALLINT NOT NULL DEFAULT 5,
        updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    // Seed singleton row for risk_system_state
    await sql.query(`
      INSERT INTO risk_system_state (id) VALUES (1)
      ON CONFLICT (id) DO NOTHING
    `);

    // ── Table 8: agent_memory ─────────────────────────────────────────
    await sql.query(`
      CREATE TABLE IF NOT EXISTS agent_memory (
        id            BIGSERIAL PRIMARY KEY,
        agent_id      TEXT NOT NULL,
        memory_type   TEXT NOT NULL,
        chain_id      TEXT,
        token         TEXT,
        summary       TEXT NOT NULL,
        payload       JSONB NOT NULL DEFAULT '{}',
        importance    SMALLINT NOT NULL DEFAULT 5 CHECK (importance >= 1 AND importance <= 10),
        access_count  INTEGER NOT NULL DEFAULT 0,
        last_accessed_at TIMESTAMPTZ,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await sql.query(`CREATE INDEX IF NOT EXISTS idx_agent_memory_agent ON agent_memory (agent_id, memory_type, created_at DESC)`);
    await sql.query(`CREATE INDEX IF NOT EXISTS idx_agent_memory_importance ON agent_memory (importance DESC, created_at DESC)`);

    // ── Table 9: learning_state + orchestrator_weight_history ─────────
    await sql.query(`
      CREATE TABLE IF NOT EXISTS learning_state (
        id            BIGSERIAL PRIMARY KEY,
        agent_id      TEXT NOT NULL,
        metric_name   TEXT NOT NULL,
        metric_value  DOUBLE PRECISION NOT NULL,
        sample_size   INTEGER NOT NULL DEFAULT 0,
        window_start  TIMESTAMPTZ NOT NULL,
        window_end    TIMESTAMPTZ NOT NULL,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (agent_id, metric_name, window_start, window_end)
      )
    `);

    await sql.query(`
      CREATE TABLE IF NOT EXISTS orchestrator_weight_history (
        id            BIGSERIAL PRIMARY KEY,
        role          TEXT NOT NULL,
        weight        DOUBLE PRECISION NOT NULL,
        reason        TEXT,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    // ── Table 10: backtest_results + backtest_trades + backtest_equity ─
    await sql.query(`
      CREATE TABLE IF NOT EXISTS backtest_results (
        id              BIGSERIAL PRIMARY KEY,
        strategy        TEXT NOT NULL CHECK (strategy IN ('flash-loan-arbitrage', 'yield-optimizer', 'cross-chain')),
        time_range      TEXT NOT NULL CHECK (time_range IN ('7d', '30d', '90d')),
        chain_id        TEXT NOT NULL,
        initial_capital DOUBLE PRECISION NOT NULL,
        params          JSONB DEFAULT '{}',
        sharpe_ratio    DOUBLE PRECISION, max_drawdown DOUBLE PRECISION, win_rate DOUBLE PRECISION,
        total_return    DOUBLE PRECISION, profit_factor DOUBLE PRECISION, volatility DOUBLE PRECISION,
        total_trades    INTEGER, winning_trades INTEGER, losing_trades INTEGER,
        avg_win         DOUBLE PRECISION, avg_loss DOUBLE PRECISION,
        best_trade      DOUBLE PRECISION, worst_trade DOUBLE PRECISION,
        price_data_points INTEGER,
        started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        completed_at    TIMESTAMPTZ,
        status          TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed'))
      )
    `);

    await sql.query(`
      CREATE TABLE IF NOT EXISTS backtest_trades (
        id              BIGSERIAL PRIMARY KEY,
        backtest_id     BIGINT NOT NULL REFERENCES backtest_results(id) ON DELETE CASCADE,
        trade_index     INTEGER NOT NULL,
        type            TEXT NOT NULL CHECK (type IN ('buy', 'sell')),
        price           DOUBLE PRECISION NOT NULL,
        pnl             DOUBLE PRECISION, pnl_pct DOUBLE PRECISION, cumulative_pnl DOUBLE PRECISION NOT NULL,
        timestamp       TIMESTAMPTZ NOT NULL
      )
    `);

    await sql.query(`
      CREATE TABLE IF NOT EXISTS backtest_equity (
        id            BIGSERIAL PRIMARY KEY,
        backtest_id   BIGINT NOT NULL REFERENCES backtest_results(id) ON DELETE CASCADE,
        timestamp     TIMESTAMPTZ NOT NULL,
        equity        DOUBLE PRECISION NOT NULL
      )
    `);

    // ── Table 11: staking_snapshots ───────────────────────────────────
    await sql.query(`
      CREATE TABLE IF NOT EXISTS staking_snapshots (
        id            BIGSERIAL PRIMARY KEY,
        protocol_id   TEXT NOT NULL,
        apy           DOUBLE PRECISION NOT NULL,
        tvl           DOUBLE PRECISION,
        captured_at   TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    console.log("[DB] ✓ All 11 tables created/verified successfully.");
  } catch (err) {
    console.error("[DB] Migration failed:", err);
    throw err;
  }
}
