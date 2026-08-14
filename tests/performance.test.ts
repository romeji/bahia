import test from "node:test";
import assert from "node:assert/strict";
import { calculateMarketAnalysis } from "../src/core/market-analysis.ts";
import { calculatePerformanceStats } from "../src/core/performance.ts";

const trade = (pnl: number, day: number, minutes = 60) => ({
  pnl,
  entryFee: 0.01,
  exitFee: 0.01,
  openedAt: new Date(Date.UTC(2026, 0, day, 10)).toISOString(),
  closedAt: new Date(Date.UTC(2026, 0, day, 10, minutes)).toISOString(),
});

test("calcule les statistiques nettes, les séries et le drawdown", () => {
  const stats = calculatePerformanceStats(
    [trade(2, 1), trade(-1, 2), trade(-2, 3), trade(4, 4)],
    100,
    103,
  );
  assert.equal(stats.totalTrades, 4);
  assert.equal(stats.winRatePct, 50);
  assert.equal(stats.profitFactor, 2);
  assert.equal(stats.payoffRatio, 2);
  assert.equal(stats.expectancy, 0.75);
  assert.equal(stats.maxConsecutiveLosses, 2);
  assert.equal(stats.maxDrawdownAmount, 3);
  assert.equal(stats.totalFees, 0.08);
  assert.equal(stats.sampleQuality, "insuffisant");
});

test("gère un historique vide sans NaN ni fausse certitude", () => {
  const stats = calculatePerformanceStats([], 100, 100);
  assert.equal(stats.winRatePct, null);
  assert.equal(stats.profitFactor, null);
  assert.equal(stats.breakEvenWinRatePct, null);
  assert.equal(stats.returnPct, 0);
});

test("qualifie un échantillon de trente trades", () => {
  const trades = Array.from({ length: 30 }, (_, index) => trade(index % 2 ? 1 : -0.5, index + 1));
  assert.equal(calculatePerformanceStats(trades, 100, 107.5).sampleQuality, "exploitable");
});

test("analyse une série haussière de bougies horaires", () => {
  const candles = Array.from({ length: 80 }, (_, index) => {
    const close = 100 + index * 0.45;
    return {
      timestamp: Date.UTC(2026, 0, 1, index),
      open: close - 0.2,
      high: close + 0.5,
      low: close - 0.5,
      close,
      volume: 10,
      confirmed: true,
    };
  });
  const analysis = calculateMarketAnalysis(candles);
  assert.equal(analysis.trend, "haussière");
  assert.equal(analysis.regime, "tendance");
  assert.equal(analysis.dataPoints, 80);
  assert.ok(analysis.rsi14 > 70);
  assert.ok(analysis.riskScore >= 0 && analysis.riskScore <= 100);
});

test("classe un marché parfaitement plat avec un RSI neutre", () => {
  const candles = Array.from({ length: 60 }, (_, index) => ({
    timestamp: Date.UTC(2026, 0, 1, index),
    open: 100,
    high: 100,
    low: 100,
    close: 100,
    volume: 10,
    confirmed: true,
  }));
  const analysis = calculateMarketAnalysis(candles);
  assert.equal(analysis.rsi14, 50);
});

test("refuse une analyse avec trop peu de données", () => {
  assert.throws(() => calculateMarketAnalysis([]), /50 bougies/);
});
