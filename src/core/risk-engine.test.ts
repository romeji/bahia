import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  RISK_PROFILES,
  calculateRiskStatus,
  evaluateTrade,
  type RiskAccountContext,
  type TradeCandidate,
} from "./risk-engine.ts";

const HEALTHY_ACCOUNT: RiskAccountContext = Object.freeze({
  currentEquity: 10_000,
  dayStartEquity: 10_000,
  peakEquity: 10_000,
  availableQuoteBalance: 10_000,
  positions: Object.freeze([]),
  pendingExposures: Object.freeze([]),
});

const LONG_CANDIDATE: TradeCandidate = Object.freeze({
  symbol: "BTC-USDT",
  direction: "long",
  intent: "open",
  entryPrice: 100,
  stopPrice: 98,
  takeProfitPrice: 103,
  leverage: 1,
  estimatedRoundTripCostPct: 0,
});

describe("risk profiles", () => {
  test("safe is stricter than balanced, which is stricter than dynamic", () => {
    assert.ok(RISK_PROFILES.safe.riskPerTradePct < RISK_PROFILES.balanced.riskPerTradePct);
    assert.ok(RISK_PROFILES.balanced.riskPerTradePct < RISK_PROFILES.dynamic.riskPerTradePct);
    assert.ok(RISK_PROFILES.safe.maxPortfolioExposurePct < RISK_PROFILES.balanced.maxPortfolioExposurePct);
    assert.ok(RISK_PROFILES.balanced.maxPortfolioExposurePct < RISK_PROFILES.dynamic.maxPortfolioExposurePct);
  });
});

describe("position sizing", () => {
  test("sizes from the stop loss and then applies the per-asset cap", () => {
    const decision = evaluateTrade(LONG_CANDIDATE, HEALTHY_ACCOUNT, "safe");

    // Risk sizing alone gives 2,500 USDT, but Safe caps one asset at 10% equity.
    assert.equal(decision.allowed, true);
    assert.equal(decision.status, "adjusted");
    assert.equal(decision.approvedNotional, 1_000);
    assert.equal(decision.approvedQuantity, 10);
    assert.equal(decision.metrics.plannedLossAtStop, 20);
    assert.equal(decision.metrics.plannedRiskPct, 0.002);
    assert.ok(decision.reasons.some((item) => item.code === "ASSET_EXPOSURE_CAP_APPLIED"));
  });

  test("reduces an oversized user request to the loss budget", () => {
    const decision = evaluateTrade(
      { ...LONG_CANDIDATE, requestedNotional: 9_000 },
      HEALTHY_ACCOUNT,
      "balanced",
    );

    assert.equal(decision.allowed, true);
    assert.equal(decision.status, "adjusted");
    assert.equal(decision.approvedNotional, 2_000);
    assert.ok(decision.reasons.some((item) => item.code === "RISK_BUDGET_APPLIED"));
  });

  test("works for a beginner account funded with 100 USDT", () => {
    const decision = evaluateTrade(
      { ...LONG_CANDIDATE, entryPrice: 10, stopPrice: 9.8, takeProfitPrice: 10.3 },
      {
        currentEquity: 100,
        dayStartEquity: 100,
        peakEquity: 100,
        availableQuoteBalance: 100,
      },
      "safe",
    );

    assert.equal(decision.allowed, true);
    assert.equal(decision.approvedNotional, 10);
    assert.ok(decision.metrics.plannedLossAtStop <= decision.limits.riskBudget);
  });
});

describe("hard risk controls", () => {
  test("rejects a long trade whose stop is above entry", () => {
    const decision = evaluateTrade(
      { ...LONG_CANDIDATE, stopPrice: 101 },
      HEALTHY_ACCOUNT,
      "safe",
    );

    assert.equal(decision.allowed, false);
    assert.equal(decision.reasons[0]?.code, "INVALID_STOP");
  });

  test("halts new risk once the true daily loss limit is reached", () => {
    const context = {
      ...HEALTHY_ACCOUNT,
      currentEquity: 9_700,
    };
    const status = calculateRiskStatus(context, "balanced");
    const decision = evaluateTrade(LONG_CANDIDATE, context, "balanced");

    assert.equal(status.dailyLossPct, 0.03);
    assert.equal(status.halted, true);
    assert.equal(decision.allowed, false);
    assert.ok(decision.reasons.some((item) => item.code === "DAILY_LOSS_LIMIT_REACHED"));
  });

  test("removes deposits and withdrawals from daily trading PnL", () => {
    const deposit = calculateRiskStatus(
      {
        ...HEALTHY_ACCOUNT,
        currentEquity: 10_500,
        netCashFlowToday: 500,
      },
      "safe",
    );
    const withdrawal = calculateRiskStatus(
      {
        ...HEALTHY_ACCOUNT,
        currentEquity: 9_500,
        netCashFlowToday: -500,
      },
      "safe",
    );

    assert.equal(deposit.dailyTradingPnl, 0);
    assert.equal(deposit.dailyLossPct, 0);
    assert.equal(withdrawal.dailyTradingPnl, 0);
    assert.equal(withdrawal.dailyLossPct, 0);
  });

  test("manual kill switch blocks new positions", () => {
    const decision = evaluateTrade(
      LONG_CANDIDATE,
      { ...HEALTHY_ACCOUNT, manualKillSwitch: true },
      "dynamic",
    );

    assert.equal(decision.allowed, false);
    assert.ok(decision.reasons.some((item) => item.code === "MANUAL_KILL_SWITCH"));
  });

  test("manual kill switch still permits a close order", () => {
    const decision = evaluateTrade(
      {
        symbol: "BTC-USDT",
        direction: "long",
        intent: "close",
        entryPrice: 100,
      },
      {
        ...HEALTHY_ACCOUNT,
        manualKillSwitch: true,
        positions: [{ symbol: "BTC-USDT", direction: "long", notional: 800 }],
      },
      "safe",
    );

    assert.equal(decision.allowed, true);
    assert.equal(decision.approvedNotional, 800);
    assert.equal(decision.metrics.grossExposureAfter, 0);
    assert.ok(decision.reasons.some((item) => item.code === "RISK_REDUCTION_ALLOWED"));
  });

  test("a close order never treats a pending entry as a reducible position", () => {
    const decision = evaluateTrade(
      {
        symbol: "BTC-USDT",
        direction: "long",
        intent: "close",
        entryPrice: 100,
      },
      {
        ...HEALTHY_ACCOUNT,
        positions: [{ symbol: "BTC-USDT", direction: "long", notional: 400 }],
        pendingExposures: [{ symbol: "BTC-USDT", direction: "long", notional: 600 }],
      },
      "safe",
    );

    assert.equal(decision.allowed, true);
    assert.equal(decision.approvedNotional, 400);
    assert.equal(decision.metrics.grossExposureAfter, 600);
  });

  test("counts pending exposure before approving another order", () => {
    const decision = evaluateTrade(
      LONG_CANDIDATE,
      {
        ...HEALTHY_ACCOUNT,
        pendingExposures: [{ symbol: "BTC-USDT", direction: "long", notional: 1_000 }],
      },
      "safe",
    );

    assert.equal(decision.allowed, false);
    assert.equal(decision.reasons[0]?.code, "INSUFFICIENT_RISK_CAPACITY");
  });

  test("rejects a target below the profile reward/risk ratio", () => {
    const decision = evaluateTrade(
      { ...LONG_CANDIDATE, takeProfitPrice: 102 },
      HEALTHY_ACCOUNT,
      "balanced",
    );

    assert.equal(decision.allowed, false);
    assert.equal(decision.reasons[0]?.code, "REWARD_RISK_TOO_LOW");
  });
});
