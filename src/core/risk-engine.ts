/**
 * Pure, deterministic risk engine.
 *
 * Percentages are decimal ratios: 0.01 means 1%. Monetary values are expressed
 * in the account quote currency (typically USDT). The caller owns persistence,
 * clocks, exchange balances and market-data validation.
 */

export type RiskProfileId = "safe" | "balanced" | "dynamic";
export type PositionDirection = "long" | "short";
export type TradeIntent = "open" | "increase" | "reduce" | "close";
export type RiskDecisionStatus = "approved" | "adjusted" | "rejected";
export type RiskReasonSeverity = "info" | "warning" | "blocking";

export interface RiskProfile {
  readonly id: RiskProfileId;
  readonly label: string;
  readonly riskPerTradePct: number;
  readonly maxPortfolioExposurePct: number;
  readonly maxAssetExposurePct: number;
  readonly maxOrderNotionalPct: number;
  readonly maxDailyLossPct: number;
  readonly maxDrawdownPct: number;
  readonly maxLeverage: number;
  readonly maxOpenPositions: number;
  readonly minRewardRiskRatio: number;
  readonly cashReservePct: number;
  readonly defaultRoundTripCostPct: number;
}

export interface OpenExposure {
  readonly symbol: string;
  readonly direction: PositionDirection;
  /** Absolute current notional, never a signed quantity. */
  readonly notional: number;
}

export interface PendingExposure {
  readonly symbol: string;
  readonly direction: PositionDirection;
  /** Absolute notional reserved by an opening/increasing order. */
  readonly notional: number;
}

export interface RiskAccountContext {
  readonly currentEquity: number;
  readonly dayStartEquity: number;
  readonly peakEquity: number;
  readonly availableQuoteBalance: number;
  /** Deposits are positive and withdrawals negative. */
  readonly netCashFlowToday?: number;
  readonly positions?: readonly OpenExposure[];
  readonly pendingExposures?: readonly PendingExposure[];
  readonly manualKillSwitch?: boolean;
}

export interface TradeCandidate {
  readonly symbol: string;
  readonly direction: PositionDirection;
  readonly intent: TradeIntent;
  readonly entryPrice: number;
  /** Required for open/increase, intentionally optional for reduce/close. */
  readonly stopPrice?: number;
  readonly takeProfitPrice?: number;
  readonly requestedNotional?: number;
  readonly leverage?: number;
  readonly minimumOrderNotional?: number;
  /** Expected entry + exit fees and slippage as a decimal ratio. */
  readonly estimatedRoundTripCostPct?: number;
}

export interface RiskReason {
  readonly code: string;
  readonly severity: RiskReasonSeverity;
  readonly message: string;
  readonly actual?: number;
  readonly limit?: number;
}

export interface RiskStatus {
  readonly halted: boolean;
  readonly dailyTradingPnl: number;
  readonly dailyLossPct: number;
  readonly drawdownPct: number;
  readonly reasons: readonly RiskReason[];
}

export interface RiskLimitsSnapshot {
  readonly riskBudget: number;
  readonly portfolioExposureLimit: number;
  readonly assetExposureLimit: number;
  readonly orderNotionalLimit: number;
  readonly deployableBuyingPower: number;
  readonly minimumOrderNotional: number;
}

export interface RiskMetricsSnapshot {
  readonly grossExposureBefore: number;
  readonly assetExposureBefore: number;
  readonly grossExposureAfter: number;
  readonly assetExposureAfter: number;
  readonly stopDistancePct?: number;
  readonly rewardRiskRatio?: number;
  readonly plannedLossAtStop: number;
  readonly plannedRiskPct: number;
}

export interface RiskDecision {
  readonly status: RiskDecisionStatus;
  readonly allowed: boolean;
  readonly profileId: RiskProfileId;
  readonly symbol: string;
  readonly approvedNotional: number;
  readonly approvedQuantity: number;
  readonly limits: RiskLimitsSnapshot;
  readonly metrics: RiskMetricsSnapshot;
  readonly riskStatus: RiskStatus;
  readonly reasons: readonly RiskReason[];
  /** Beginner-friendly summary suitable for an audit log or UI. */
  readonly explanation: string;
}

const SAFE_PROFILE: Readonly<RiskProfile> = Object.freeze({
  id: "safe",
  label: "Prudent",
  riskPerTradePct: 0.005,
  maxPortfolioExposurePct: 0.25,
  maxAssetExposurePct: 0.1,
  maxOrderNotionalPct: 0.1,
  maxDailyLossPct: 0.015,
  maxDrawdownPct: 0.06,
  maxLeverage: 1,
  maxOpenPositions: 3,
  minRewardRiskRatio: 1.5,
  cashReservePct: 0.4,
  defaultRoundTripCostPct: 0.002,
});

const BALANCED_PROFILE: Readonly<RiskProfile> = Object.freeze({
  id: "balanced",
  label: "Equilibre",
  riskPerTradePct: 0.01,
  maxPortfolioExposurePct: 0.5,
  maxAssetExposurePct: 0.2,
  maxOrderNotionalPct: 0.2,
  maxDailyLossPct: 0.03,
  maxDrawdownPct: 0.1,
  maxLeverage: 1,
  maxOpenPositions: 5,
  minRewardRiskRatio: 1.5,
  cashReservePct: 0.2,
  defaultRoundTripCostPct: 0.002,
});

const DYNAMIC_PROFILE: Readonly<RiskProfile> = Object.freeze({
  id: "dynamic",
  label: "Dynamique",
  riskPerTradePct: 0.015,
  maxPortfolioExposurePct: 0.7,
  maxAssetExposurePct: 0.3,
  maxOrderNotionalPct: 0.3,
  maxDailyLossPct: 0.05,
  maxDrawdownPct: 0.15,
  maxLeverage: 2,
  maxOpenPositions: 8,
  minRewardRiskRatio: 1.25,
  cashReservePct: 0.1,
  defaultRoundTripCostPct: 0.0025,
});

export const RISK_PROFILES: Readonly<Record<RiskProfileId, Readonly<RiskProfile>>> =
  Object.freeze({
    safe: SAFE_PROFILE,
    balanced: BALANCED_PROFILE,
    dynamic: DYNAMIC_PROFILE,
  });

const EPSILON = 1e-9;

export function getRiskProfile(id: RiskProfileId): Readonly<RiskProfile> {
  return RISK_PROFILES[id];
}

export function calculateRiskStatus(
  context: RiskAccountContext,
  profileOrId: RiskProfileId | Readonly<RiskProfile>,
): RiskStatus {
  const profile = resolveProfile(profileOrId);
  const reasons: RiskReason[] = [];

  if (!isPositive(context.currentEquity) || !isPositive(context.dayStartEquity) || !isPositive(context.peakEquity)) {
    reasons.push(reason("INVALID_ACCOUNT_STATE", "blocking", "Les valeurs de capital sont invalides."));
    return Object.freeze({
      halted: true,
      dailyTradingPnl: 0,
      dailyLossPct: 0,
      drawdownPct: 0,
      reasons: Object.freeze(reasons),
    });
  }

  const netCashFlow = finiteOrZero(context.netCashFlowToday);
  const dailyTradingPnl = context.currentEquity - context.dayStartEquity - netCashFlow;
  const dailyLossPct = Math.max(0, -dailyTradingPnl / context.dayStartEquity);
  const drawdownPct = Math.max(0, (context.peakEquity - context.currentEquity) / context.peakEquity);

  if (context.manualKillSwitch === true) {
    reasons.push(reason("MANUAL_KILL_SWITCH", "blocking", "Arret d'urgence manuel actif."));
  }
  if (dailyLossPct + EPSILON >= profile.maxDailyLossPct) {
    reasons.push(
      reason(
        "DAILY_LOSS_LIMIT_REACHED",
        "blocking",
        "La perte de trading du jour a atteint la limite du profil.",
        dailyLossPct,
        profile.maxDailyLossPct,
      ),
    );
  }
  if (drawdownPct + EPSILON >= profile.maxDrawdownPct) {
    reasons.push(
      reason(
        "MAX_DRAWDOWN_REACHED",
        "blocking",
        "Le recul depuis le plus haut du compte a atteint la limite du profil.",
        drawdownPct,
        profile.maxDrawdownPct,
      ),
    );
  }

  return Object.freeze({
    halted: reasons.some((item) => item.severity === "blocking"),
    dailyTradingPnl: round(dailyTradingPnl),
    dailyLossPct: round(dailyLossPct),
    drawdownPct: round(drawdownPct),
    reasons: Object.freeze(reasons),
  });
}

export function evaluateTrade(
  candidate: TradeCandidate,
  context: RiskAccountContext,
  profileOrId: RiskProfileId | Readonly<RiskProfile>,
): RiskDecision {
  const profile = resolveProfile(profileOrId);
  const exposuresError = validateExposures(context);
  const riskStatus = calculateRiskStatus(context, profile);
  const grossExposure = sumExposure(context.positions, context.pendingExposures);
  const assetExposure = sumAssetExposure(candidate.symbol, context.positions, context.pendingExposures);
  const directionalExposure = sumDirectionalExposure(
    candidate.symbol,
    candidate.direction,
    context.positions,
    context.pendingExposures,
  );
  const reduciblePositionExposure = sumPositionDirectionalExposure(
    candidate.symbol,
    candidate.direction,
    context.positions,
  );
  const minimumOrderNotional = candidate.minimumOrderNotional ?? 5;
  const limits = buildLimits(context, profile, minimumOrderNotional);

  const invalidCandidate = validateCandidateBase(candidate, minimumOrderNotional);
  if (exposuresError || invalidCandidate) {
    return rejectDecision(
      candidate,
      profile,
      riskStatus,
      limits,
      grossExposure,
      assetExposure,
      [reason("INVALID_INPUT", "blocking", exposuresError ?? invalidCandidate ?? "Entree invalide.")],
    );
  }

  // A kill switch must never prevent a risk-reducing exit.
  if (candidate.intent === "reduce" || candidate.intent === "close") {
    return evaluateReduction(
      candidate,
      context,
      profile,
      riskStatus,
      limits,
      grossExposure,
      assetExposure,
      reduciblePositionExposure,
    );
  }

  if (riskStatus.halted) {
    return rejectDecision(
      candidate,
      profile,
      riskStatus,
      limits,
      grossExposure,
      assetExposure,
      [...riskStatus.reasons],
    );
  }

  if (candidate.intent === "increase" && directionalExposure <= EPSILON) {
    return rejectDecision(
      candidate,
      profile,
      riskStatus,
      limits,
      grossExposure,
      assetExposure,
      [reason("NO_POSITION_TO_INCREASE", "blocking", "Aucune position existante ne correspond a cette augmentation.")],
    );
  }

  const leverage = candidate.leverage ?? 1;
  if (leverage > profile.maxLeverage + EPSILON) {
    return rejectDecision(
      candidate,
      profile,
      riskStatus,
      limits,
      grossExposure,
      assetExposure,
      [
        reason(
          "LEVERAGE_LIMIT_EXCEEDED",
          "blocking",
          "Le levier demande depasse la limite du profil.",
          leverage,
          profile.maxLeverage,
        ),
      ],
    );
  }

  const stopPrice = candidate.stopPrice as number;
  const stopGeometryError = validateStopGeometry(candidate.direction, candidate.entryPrice, stopPrice);
  if (stopGeometryError) {
    return rejectDecision(
      candidate,
      profile,
      riskStatus,
      limits,
      grossExposure,
      assetExposure,
      [reason("INVALID_STOP", "blocking", stopGeometryError)],
    );
  }

  const stopDistance = Math.abs(candidate.entryPrice - stopPrice);
  const stopDistancePct = stopDistance / candidate.entryPrice;
  const costPct = candidate.estimatedRoundTripCostPct ?? profile.defaultRoundTripCostPct;
  const lossPerUnit = stopDistance + candidate.entryPrice * costPct;
  const riskSizedNotional = (limits.riskBudget / lossPerUnit) * candidate.entryPrice;
  const rewardRiskRatio = calculateRewardRisk(candidate, stopDistance);

  if (candidate.takeProfitPrice !== undefined) {
    const targetError = validateTargetGeometry(candidate);
    if (targetError) {
      return rejectWithTradeMetrics(targetError, "INVALID_TARGET");
    }
    if ((rewardRiskRatio as number) + EPSILON < profile.minRewardRiskRatio) {
      return rejectWithTradeMetrics(
        "Le gain potentiel est trop faible par rapport a la perte jusqu'au stop.",
        "REWARD_RISK_TOO_LOW",
        rewardRiskRatio,
        profile.minRewardRiskRatio,
      );
    }
  }

  const openKeys = uniqueOpenExposureKeys(context);
  const candidateKey = exposureKey(candidate.symbol, candidate.direction);
  if (!openKeys.has(candidateKey) && openKeys.size >= profile.maxOpenPositions) {
    return rejectWithTradeMetrics(
      "Le nombre maximal de positions ouvertes est atteint.",
      "MAX_OPEN_POSITIONS_REACHED",
      openKeys.size,
      profile.maxOpenPositions,
    );
  }

  const desiredNotional = candidate.requestedNotional === undefined
    ? riskSizedNotional
    : Math.min(candidate.requestedNotional, riskSizedNotional);
  const totalCapacity = Math.max(0, limits.portfolioExposureLimit - grossExposure);
  const assetCapacity = Math.max(0, limits.assetExposureLimit - assetExposure);
  const approvedNotional = Math.max(
    0,
    Math.min(
      desiredNotional,
      totalCapacity,
      assetCapacity,
      limits.orderNotionalLimit,
      limits.deployableBuyingPower,
    ),
  );

  if (approvedNotional + EPSILON < minimumOrderNotional) {
    return rejectWithTradeMetrics(
      "Les limites de risque ne laissent pas assez de capacite pour l'ordre minimum.",
      "INSUFFICIENT_RISK_CAPACITY",
      approvedNotional,
      minimumOrderNotional,
    );
  }

  const reasons: RiskReason[] = [
    reason(
      "POSITION_SIZED_BY_STOP",
      "info",
      "La taille est calculee depuis le capital, le risque du profil et la distance au stop.",
      approvedNotional,
      riskSizedNotional,
    ),
  ];
  let adjusted = false;

  if (candidate.requestedNotional !== undefined && candidate.requestedNotional > riskSizedNotional + EPSILON) {
    adjusted = true;
    reasons.push(reason("RISK_BUDGET_APPLIED", "warning", "La taille demandee a ete reduite par le budget de perte maximal.", candidate.requestedNotional, riskSizedNotional));
  }
  adjusted = addBindingReason(reasons, adjusted, desiredNotional, totalCapacity, "PORTFOLIO_EXPOSURE_CAP_APPLIED", "Le plafond d'exposition totale a reduit l'ordre.");
  adjusted = addBindingReason(reasons, adjusted, desiredNotional, assetCapacity, "ASSET_EXPOSURE_CAP_APPLIED", "Le plafond d'exposition sur cet actif a reduit l'ordre.");
  adjusted = addBindingReason(reasons, adjusted, desiredNotional, limits.orderNotionalLimit, "ORDER_CAP_APPLIED", "La taille maximale d'un ordre a reduit l'ordre.");
  adjusted = addBindingReason(reasons, adjusted, desiredNotional, limits.deployableBuyingPower, "CASH_RESERVE_APPLIED", "La reserve de liquidites du profil a reduit l'ordre.");

  const approvedQuantity = approvedNotional / candidate.entryPrice;
  const plannedLossAtStop = approvedQuantity * lossPerUnit;
  const metrics = metricsSnapshot(
    grossExposure,
    assetExposure,
    grossExposure + approvedNotional,
    assetExposure + approvedNotional,
    plannedLossAtStop,
    context.currentEquity,
    stopDistancePct,
    rewardRiskRatio,
  );

  const status: RiskDecisionStatus = adjusted ? "adjusted" : "approved";
  return Object.freeze({
    status,
    allowed: true,
    profileId: profile.id,
    symbol: candidate.symbol,
    approvedNotional: round(approvedNotional),
    approvedQuantity: round(approvedQuantity),
    limits,
    metrics,
    riskStatus,
    reasons: Object.freeze(reasons),
    explanation: adjusted
      ? `Ordre autorise mais ramene a ${formatMoney(approvedNotional)} pour respecter le profil ${profile.label}.`
      : `Ordre autorise a ${formatMoney(approvedNotional)} avec une perte estimee au stop de ${formatMoney(plannedLossAtStop)}.`,
  });

  function rejectWithTradeMetrics(
    message: string,
    code: string,
    actual?: number,
    limit?: number,
  ): RiskDecision {
    return rejectDecision(
      candidate,
      profile,
      riskStatus,
      limits,
      grossExposure,
      assetExposure,
      [reason(code, "blocking", message, actual, limit)],
      stopDistancePct,
      rewardRiskRatio,
    );
  }
}

function evaluateReduction(
  candidate: TradeCandidate,
  context: RiskAccountContext,
  profile: Readonly<RiskProfile>,
  riskStatus: RiskStatus,
  limits: RiskLimitsSnapshot,
  grossExposure: number,
  assetExposure: number,
  directionalExposure: number,
): RiskDecision {
  if (directionalExposure <= EPSILON) {
    return rejectDecision(
      candidate,
      profile,
      riskStatus,
      limits,
      grossExposure,
      assetExposure,
      [reason("NO_POSITION_TO_REDUCE", "blocking", "Aucune exposition correspondante ne peut etre reduite.")],
    );
  }

  const desired = candidate.intent === "close" && candidate.requestedNotional === undefined
    ? directionalExposure
    : candidate.requestedNotional ?? directionalExposure;
  const approvedNotional = Math.min(desired, directionalExposure);
  const adjusted = approvedNotional + EPSILON < desired;
  const reasons: RiskReason[] = [
    reason(
      "RISK_REDUCTION_ALLOWED",
      "info",
      riskStatus.halted
        ? "La sortie reste autorisee pendant l'arret d'urgence afin de reduire le risque."
        : "Cette operation reduit l'exposition existante.",
    ),
  ];
  if (adjusted) {
    reasons.push(reason("REDUCTION_CAPPED_TO_POSITION", "warning", "La reduction est limitee a l'exposition existante.", desired, directionalExposure));
  }

  return Object.freeze({
    status: adjusted ? "adjusted" : "approved",
    allowed: true,
    profileId: profile.id,
    symbol: candidate.symbol,
    approvedNotional: round(approvedNotional),
    approvedQuantity: round(approvedNotional / candidate.entryPrice),
    limits,
    metrics: metricsSnapshot(
      grossExposure,
      assetExposure,
      Math.max(0, grossExposure - approvedNotional),
      Math.max(0, assetExposure - approvedNotional),
      0,
      context.currentEquity,
    ),
    riskStatus,
    reasons: Object.freeze(reasons),
    explanation: `Reduction autorisee: l'exposition baisse de ${formatMoney(approvedNotional)}.`,
  });
}

function rejectDecision(
  candidate: TradeCandidate,
  profile: Readonly<RiskProfile>,
  riskStatus: RiskStatus,
  limits: RiskLimitsSnapshot,
  grossExposure: number,
  assetExposure: number,
  reasons: readonly RiskReason[],
  stopDistancePct?: number,
  rewardRiskRatio?: number,
): RiskDecision {
  const firstReason = reasons[0]?.message ?? "Ordre refuse par le moteur de risque.";
  return Object.freeze({
    status: "rejected",
    allowed: false,
    profileId: profile.id,
    symbol: candidate.symbol,
    approvedNotional: 0,
    approvedQuantity: 0,
    limits,
    metrics: metricsSnapshot(
      grossExposure,
      assetExposure,
      grossExposure,
      assetExposure,
      0,
      0,
      stopDistancePct,
      rewardRiskRatio,
    ),
    riskStatus,
    reasons: Object.freeze([...reasons]),
    explanation: `Ordre refuse: ${firstReason}`,
  });
}

function buildLimits(
  context: RiskAccountContext,
  profile: Readonly<RiskProfile>,
  minimumOrderNotional: number,
): RiskLimitsSnapshot {
  const equity = isPositive(context.currentEquity) ? context.currentEquity : 0;
  const available = isNonNegative(context.availableQuoteBalance) ? context.availableQuoteBalance : 0;
  const reserveAmount = equity * profile.cashReservePct;
  const deployableCash = Math.max(0, available - reserveAmount);

  return Object.freeze({
    riskBudget: round(equity * profile.riskPerTradePct),
    portfolioExposureLimit: round(equity * profile.maxPortfolioExposurePct),
    assetExposureLimit: round(equity * profile.maxAssetExposurePct),
    orderNotionalLimit: round(equity * profile.maxOrderNotionalPct),
    deployableBuyingPower: round(deployableCash * profile.maxLeverage),
    minimumOrderNotional: round(minimumOrderNotional),
  });
}

function metricsSnapshot(
  grossBefore: number,
  assetBefore: number,
  grossAfter: number,
  assetAfter: number,
  plannedLoss: number,
  equity: number,
  stopDistancePct?: number,
  rewardRiskRatio?: number,
): RiskMetricsSnapshot {
  const result: RiskMetricsSnapshot = {
    grossExposureBefore: round(grossBefore),
    assetExposureBefore: round(assetBefore),
    grossExposureAfter: round(grossAfter),
    assetExposureAfter: round(assetAfter),
    plannedLossAtStop: round(plannedLoss),
    plannedRiskPct: equity > 0 ? round(plannedLoss / equity) : 0,
    ...(stopDistancePct === undefined ? {} : { stopDistancePct: round(stopDistancePct) }),
    ...(rewardRiskRatio === undefined ? {} : { rewardRiskRatio: round(rewardRiskRatio) }),
  };
  return Object.freeze(result);
}

function resolveProfile(profileOrId: RiskProfileId | Readonly<RiskProfile>): Readonly<RiskProfile> {
  return typeof profileOrId === "string" ? getRiskProfile(profileOrId) : profileOrId;
}

function validateCandidateBase(candidate: TradeCandidate, minimumOrderNotional: number): string | undefined {
  if (candidate.symbol.trim().length === 0) return "Le symbole est obligatoire.";
  if (!isPositive(candidate.entryPrice)) return "Le prix d'entree doit etre strictement positif.";
  if (!isPositive(minimumOrderNotional)) return "Le montant minimum d'ordre doit etre positif.";
  if (candidate.requestedNotional !== undefined && !isPositive(candidate.requestedNotional)) return "La taille demandee doit etre positive.";
  if (candidate.leverage !== undefined && (!isPositive(candidate.leverage) || candidate.leverage < 1)) return "Le levier doit etre superieur ou egal a 1.";
  if (candidate.estimatedRoundTripCostPct !== undefined && !isNonNegative(candidate.estimatedRoundTripCostPct)) return "Le cout estime ne peut pas etre negatif.";
  if ((candidate.intent === "open" || candidate.intent === "increase") && !isPositive(candidate.stopPrice)) return "Un stop est obligatoire pour ouvrir ou augmenter une position.";
  return undefined;
}

function validateExposures(context: RiskAccountContext): string | undefined {
  if (!isNonNegative(context.availableQuoteBalance)) return "Le solde disponible est invalide.";
  for (const item of [...(context.positions ?? []), ...(context.pendingExposures ?? [])]) {
    if (item.symbol.trim().length === 0 || !isNonNegative(item.notional)) {
      return "Une exposition existante est invalide.";
    }
  }
  return undefined;
}

function validateStopGeometry(direction: PositionDirection, entry: number, stop: number): string | undefined {
  if (direction === "long" && stop >= entry) return "Pour une position Long, le stop doit etre sous le prix d'entree.";
  if (direction === "short" && stop <= entry) return "Pour une position Short, le stop doit etre au-dessus du prix d'entree.";
  return undefined;
}

function validateTargetGeometry(candidate: TradeCandidate): string | undefined {
  const target = candidate.takeProfitPrice as number;
  if (!isPositive(target)) return "L'objectif de gain doit etre positif.";
  if (candidate.direction === "long" && target <= candidate.entryPrice) return "Pour une position Long, l'objectif doit etre au-dessus de l'entree.";
  if (candidate.direction === "short" && target >= candidate.entryPrice) return "Pour une position Short, l'objectif doit etre sous l'entree.";
  return undefined;
}

function calculateRewardRisk(candidate: TradeCandidate, stopDistance: number): number | undefined {
  if (candidate.takeProfitPrice === undefined) return undefined;
  return Math.abs(candidate.takeProfitPrice - candidate.entryPrice) / stopDistance;
}

function sumExposure(
  positions: readonly OpenExposure[] = [],
  pending: readonly PendingExposure[] = [],
): number {
  return [...positions, ...pending].reduce((total, item) => total + Math.abs(item.notional), 0);
}

function sumAssetExposure(
  symbol: string,
  positions: readonly OpenExposure[] = [],
  pending: readonly PendingExposure[] = [],
): number {
  return [...positions, ...pending]
    .filter((item) => item.symbol === symbol)
    .reduce((total, item) => total + Math.abs(item.notional), 0);
}

function sumDirectionalExposure(
  symbol: string,
  direction: PositionDirection,
  positions: readonly OpenExposure[] = [],
  pending: readonly PendingExposure[] = [],
): number {
  return [...positions, ...pending]
    .filter((item) => item.symbol === symbol && item.direction === direction)
    .reduce((total, item) => total + Math.abs(item.notional), 0);
}

function sumPositionDirectionalExposure(
  symbol: string,
  direction: PositionDirection,
  positions: readonly OpenExposure[] = [],
): number {
  return positions
    .filter((item) => item.symbol === symbol && item.direction === direction)
    .reduce((total, item) => total + Math.abs(item.notional), 0);
}

function uniqueOpenExposureKeys(context: RiskAccountContext): Set<string> {
  return new Set(
    [...(context.positions ?? []), ...(context.pendingExposures ?? [])]
      .filter((item) => item.notional > EPSILON)
      .map((item) => exposureKey(item.symbol, item.direction)),
  );
}

function exposureKey(symbol: string, direction: PositionDirection): string {
  return `${symbol}:${direction}`;
}

function addBindingReason(
  reasons: RiskReason[],
  adjusted: boolean,
  desired: number,
  capacity: number,
  code: string,
  message: string,
): boolean {
  if (capacity + EPSILON < desired) {
    reasons.push(reason(code, "warning", message, desired, Math.max(0, capacity)));
    return true;
  }
  return adjusted;
}

function reason(
  code: string,
  severity: RiskReasonSeverity,
  message: string,
  actual?: number,
  limit?: number,
): RiskReason {
  return Object.freeze({
    code,
    severity,
    message,
    ...(actual === undefined ? {} : { actual: round(actual) }),
    ...(limit === undefined ? {} : { limit: round(limit) }),
  });
}

function finiteOrZero(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) ? value : 0;
}

function isPositive(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value > 0;
}

function isNonNegative(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value >= 0;
}

function round(value: number, digits = 8): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function formatMoney(value: number): string {
  return `${round(value, 2).toFixed(2)} USDT`;
}
