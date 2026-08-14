export interface CandleSample {
  readonly timestamp: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume?: number;
  readonly confirmed?: boolean;
}

export type MarketTrend = "haussière" | "baissière" | "neutre";
export type MarketRegime = "tendance" | "range" | "volatile" | "indéterminé";

export interface MarketAnalysis {
  readonly price: number;
  readonly sma20: number;
  readonly sma50: number;
  readonly rsi14: number;
  readonly atr14Pct: number;
  readonly realizedVolatilityPct: number;
  readonly trend: MarketTrend;
  readonly regime: MarketRegime;
  readonly riskScore: number;
  readonly dataPoints: number;
  readonly latestTimestamp: number;
  readonly explanation: string;
}

const average = (values: readonly number[]) =>
  values.reduce((total, value) => total + value, 0) / Math.max(values.length, 1);

const round = (value: number, digits = 4) => {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};

export function calculateMarketAnalysis(candles: readonly CandleSample[]): MarketAnalysis {
  const valid = candles.filter((candle) =>
    [candle.timestamp, candle.open, candle.high, candle.low, candle.close]
      .every((value) => Number.isFinite(value))
    && candle.close > 0
    && candle.high >= candle.low,
  );

  if (valid.length < 50) {
    throw new RangeError("Au moins 50 bougies valides sont nécessaires.");
  }

  const ordered = [...valid].sort((left, right) => left.timestamp - right.timestamp);
  const closes = ordered.map((candle) => candle.close);
  const price = closes.at(-1) as number;
  const sma20 = average(closes.slice(-20));
  const sma50 = average(closes.slice(-50));

  const changes = closes.slice(-15).slice(1).map((close, index) => close - closes.slice(-15)[index]);
  const gains = changes.map((change) => Math.max(0, change));
  const losses = changes.map((change) => Math.max(0, -change));
  const averageGain = average(gains);
  const averageLoss = average(losses);
  const rsi14 = averageLoss === 0
    ? (averageGain === 0 ? 50 : 100)
    : 100 - 100 / (1 + averageGain / averageLoss);

  const recent = ordered.slice(-15);
  const trueRanges = recent.slice(1).map((candle, index) => {
    const previousClose = recent[index].close;
    return Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previousClose),
      Math.abs(candle.low - previousClose),
    );
  });
  const atr14Pct = average(trueRanges) / price * 100;

  const logReturns = closes.slice(-73).slice(1).map((close, index) =>
    Math.log(close / closes.slice(-73)[index]),
  );
  const meanReturn = average(logReturns);
  const variance = average(logReturns.map((value) => (value - meanReturn) ** 2));
  const realizedVolatilityPct = Math.sqrt(variance) * Math.sqrt(24 * 365) * 100;

  const trendGap = (sma20 / sma50 - 1) * 100;
  const trend: MarketTrend = trendGap > 0.6
    ? "haussière"
    : trendGap < -0.6 ? "baissière" : "neutre";
  const regime: MarketRegime = atr14Pct > 2.2
    ? "volatile"
    : trend === "neutre" ? "range" : "tendance";
  const riskScore = Math.round(Math.min(100, Math.max(0,
    25 + atr14Pct * 15 + Math.abs(rsi14 - 50) * 0.7 + (regime === "volatile" ? 20 : 0),
  )));
  const explanation = regime === "volatile"
    ? "Les variations récentes sont fortes : Bahia réduit la taille et évite les entrées impulsives."
    : trend === "haussière"
      ? "La moyenne courte reste au-dessus de la moyenne longue, sans garantir la poursuite du mouvement."
      : trend === "baissière"
        ? "La moyenne courte reste sous la moyenne longue : la priorité est la préservation du capital."
        : "Le marché évolue surtout en range : attendre ou fractionner est plus prudent qu’anticiper une cassure.";

  return Object.freeze({
    price: round(price),
    sma20: round(sma20),
    sma50: round(sma50),
    rsi14: round(rsi14, 2),
    atr14Pct: round(atr14Pct, 2),
    realizedVolatilityPct: round(realizedVolatilityPct, 2),
    trend,
    regime,
    riskScore,
    dataPoints: ordered.length,
    latestTimestamp: ordered.at(-1)?.timestamp ?? 0,
    explanation,
  });
}
