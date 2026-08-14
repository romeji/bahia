export interface PerformanceTrade {
  readonly pnl: number;
  readonly entryFee?: number;
  readonly exitFee?: number;
  readonly openedAt: string;
  readonly closedAt: string;
}

export interface PerformanceStats {
  readonly totalTrades: number;
  readonly winningTrades: number;
  readonly losingTrades: number;
  readonly flatTrades: number;
  readonly winRatePct: number | null;
  readonly netPnl: number;
  readonly grossProfit: number;
  readonly grossLoss: number;
  readonly averageTrade: number;
  readonly averageWin: number;
  readonly averageLoss: number;
  readonly payoffRatio: number | null;
  readonly profitFactor: number | null;
  readonly expectancy: number;
  readonly breakEvenWinRatePct: number | null;
  readonly bestTrade: number | null;
  readonly worstTrade: number | null;
  readonly maxConsecutiveWins: number;
  readonly maxConsecutiveLosses: number;
  readonly averageHoldingMinutes: number | null;
  readonly totalFees: number;
  readonly maxDrawdownPct: number;
  readonly maxDrawdownAmount: number;
  readonly recoveryFactor: number | null;
  readonly returnPct: number;
  readonly sampleQuality: "insuffisant" | "limite" | "exploitable";
}

const round = (value: number, digits = 8) => {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};

export function calculatePerformanceStats(
  trades: readonly PerformanceTrade[],
  startingEquity: number,
  currentEquity: number,
): PerformanceStats {
  const validTrades = trades.filter((trade) => Number.isFinite(trade.pnl));
  const chronological = [...validTrades].sort(
    (left, right) => Date.parse(left.closedAt) - Date.parse(right.closedAt),
  );
  const wins = validTrades.filter((trade) => trade.pnl > 0);
  const losses = validTrades.filter((trade) => trade.pnl < 0);
  const flatTrades = validTrades.length - wins.length - losses.length;
  const grossProfit = wins.reduce((total, trade) => total + trade.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((total, trade) => total + trade.pnl, 0));
  const netPnl = validTrades.reduce((total, trade) => total + trade.pnl, 0);
  const averageWin = wins.length ? grossProfit / wins.length : 0;
  const averageLoss = losses.length ? grossLoss / losses.length : 0;
  const winRate = validTrades.length ? wins.length / validTrades.length : null;
  const expectancy = winRate === null
    ? 0
    : winRate * averageWin - (1 - winRate) * averageLoss;
  const durations = validTrades
    .map((trade) => (Date.parse(trade.closedAt) - Date.parse(trade.openedAt)) / 60_000)
    .filter((duration) => Number.isFinite(duration) && duration >= 0);

  let equity = startingEquity;
  let peak = startingEquity;
  let maxDrawdownAmount = 0;
  let maxDrawdownPct = 0;
  let currentWins = 0;
  let currentLosses = 0;
  let maxConsecutiveWins = 0;
  let maxConsecutiveLosses = 0;

  for (const trade of chronological) {
    equity += trade.pnl;
    peak = Math.max(peak, equity);
    const drawdownAmount = Math.max(0, peak - equity);
    maxDrawdownAmount = Math.max(maxDrawdownAmount, drawdownAmount);
    maxDrawdownPct = Math.max(maxDrawdownPct, peak > 0 ? drawdownAmount / peak * 100 : 0);

    if (trade.pnl > 0) {
      currentWins += 1;
      currentLosses = 0;
      maxConsecutiveWins = Math.max(maxConsecutiveWins, currentWins);
    } else if (trade.pnl < 0) {
      currentLosses += 1;
      currentWins = 0;
      maxConsecutiveLosses = Math.max(maxConsecutiveLosses, currentLosses);
    }
  }

  return Object.freeze({
    totalTrades: validTrades.length,
    winningTrades: wins.length,
    losingTrades: losses.length,
    flatTrades,
    winRatePct: winRate === null ? null : round(winRate * 100),
    netPnl: round(netPnl),
    grossProfit: round(grossProfit),
    grossLoss: round(grossLoss),
    averageTrade: validTrades.length ? round(netPnl / validTrades.length) : 0,
    averageWin: round(averageWin),
    averageLoss: round(averageLoss),
    payoffRatio: losses.length ? round(averageWin / averageLoss) : null,
    profitFactor: losses.length ? round(grossProfit / grossLoss) : null,
    expectancy: round(expectancy),
    breakEvenWinRatePct: averageWin + averageLoss > 0
      ? round(averageLoss / (averageWin + averageLoss) * 100)
      : null,
    bestTrade: validTrades.length ? round(Math.max(...validTrades.map((trade) => trade.pnl))) : null,
    worstTrade: validTrades.length ? round(Math.min(...validTrades.map((trade) => trade.pnl))) : null,
    maxConsecutiveWins,
    maxConsecutiveLosses,
    averageHoldingMinutes: durations.length
      ? round(durations.reduce((total, duration) => total + duration, 0) / durations.length)
      : null,
    totalFees: round(validTrades.reduce(
      (total, trade) => total + (trade.entryFee ?? 0) + (trade.exitFee ?? 0),
      0,
    )),
    maxDrawdownPct: round(maxDrawdownPct),
    maxDrawdownAmount: round(maxDrawdownAmount),
    recoveryFactor: maxDrawdownAmount > 0 ? round(netPnl / maxDrawdownAmount) : null,
    returnPct: startingEquity > 0 ? round((currentEquity / startingEquity - 1) * 100) : 0,
    sampleQuality: validTrades.length >= 30
      ? "exploitable"
      : validTrades.length >= 10 ? "limite" : "insuffisant",
  });
}

