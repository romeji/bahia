"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  calculatePerformanceStats,
  evaluateTrade,
  getRiskProfile,
  type PerformanceStats,
  type RiskProfileId,
} from "@/src/core";

type ViewId = "today" | "opportunities" | "automations" | "portfolio" | "results" | "more";
type Instrument = "BTC-USDT" | "ETH-USDT" | "SOL-USDT";
type Strategy = "observe" | "dca" | "rebalance" | "grid" | "trend";

interface MarketData {
  instrument: Instrument;
  price: number;
  bid: number;
  ask: number;
  open24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  change24h: number;
  timestamp: number;
  source: string;
}

interface MarketInsight {
  instrument: Instrument;
  price: number;
  sma20: number;
  sma50: number;
  rsi14: number;
  atr14Pct: number;
  realizedVolatilityPct: number;
  trend: "haussière" | "baissière" | "neutre";
  regime: "tendance" | "range" | "volatile" | "indéterminé";
  riskScore: number;
  dataPoints: number;
  latestTimestamp: number;
  explanation: string;
  source: string;
  timeframe: string;
}

interface PaperPosition {
  id: string;
  instrument: Instrument;
  quantity: number;
  entryPrice: number;
  notional: number;
  stopPrice: number;
  takeProfitPrice: number;
  openedAt: string;
  entryFee: number;
  reason: string;
}

interface ClosedTrade extends PaperPosition {
  exitPrice: number;
  closedAt: string;
  exitFee: number;
  pnl: number;
  closeReason: string;
}

interface ActivityItem {
  id: string;
  at: string;
  title: string;
  detail: string;
  type: "info" | "trade" | "risk";
}

interface LabState {
  cash: number;
  startingEquity: number;
  dayStartEquity: number;
  dayKey: string;
  peakEquity: number;
  positions: PaperPosition[];
  trades: ClosedTrade[];
  activities: ActivityItem[];
  equityCurve: number[];
  profile: RiskProfileId;
  strategy: Strategy;
  botRunning: boolean;
  manualKillSwitch: boolean;
  beginner: boolean;
  scanCount: number;
  lastScanAt?: string;
}

interface Opportunity {
  id: string;
  kind: Strategy | "arbitrage";
  instrument: Instrument;
  title: string;
  action: string;
  reason: string;
  quality: "Faible" | "Moyenne" | "Bonne";
  score: number;
  conditions: string[];
  estimatedCost: number;
  maxLoss: number;
  expiryMinutes: number;
  refused: boolean;
  refusalReason?: string;
  stopPct: number;
  targetPct: number;
  executable: boolean;
}

interface BacktestResult {
  trades: number;
  wins: number;
  returnPct: number;
  maxDrawdownPct: number;
  holdReturnPct: number;
  profitFactor: number | null;
  expectancy: number;
  finalEquity: number;
}

const STORAGE_KEY = "bahia-lab-v3";
const LEGACY_STORAGE_KEY = "bahia-lab-v2";
const INSTRUMENTS: Instrument[] = ["BTC-USDT", "ETH-USDT", "SOL-USDT"];
const NAV: Array<{ id: ViewId; label: string; icon: string }> = [
  { id: "today", label: "Aujourd’hui", icon: "⌂" },
  { id: "opportunities", label: "Opportunités", icon: "✦" },
  { id: "automations", label: "Automatisations", icon: "◉" },
  { id: "portfolio", label: "Portefeuille", icon: "◫" },
  { id: "results", label: "Résultats", icon: "↗" },
  { id: "more", label: "Plus", icon: "•••" },
];
const VIEW_COPY: Record<ViewId, { title: string; subtitle: string }> = {
  today: { title: "Bonjour Jérôme", subtitle: "Le point clair sur ton capital fictif, le risque et la prochaine étape." },
  opportunities: { title: "Opportunités", subtitle: "Des scénarios explicables, filtrés par le risque et les coûts." },
  automations: { title: "Automatisations", subtitle: "Construis, teste, puis observe avant de laisser agir." },
  portfolio: { title: "Portefeuille", subtitle: "Réserve, positions, stops et allocation en temps réel." },
  results: { title: "Résultats", subtitle: "Des statistiques utiles, sans masquer la taille de l’échantillon." },
  more: { title: "Centre de contrôle", subtitle: "Données, sécurité, sauvegarde et limites réelles de la plateforme." },
};

const nf = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat("fr-FR", { notation: "compact", maximumFractionDigits: 1 });
const nowDay = () => new Date().toISOString().slice(0, 10);
const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const marketName = (instrument: Instrument) => instrument.replace("-", " / ");
const assetSymbol = (instrument: Instrument) => instrument.split("-")[0];
const assetClass = (instrument: Instrument) => instrument.startsWith("ETH") ? "eth" : instrument.startsWith("SOL") ? "sol" : "";
const assetGlyph = (instrument: Instrument) => instrument.startsWith("BTC") ? "₿" : instrument.startsWith("ETH") ? "Ξ" : "S";
const signed = (value: number) => `${value >= 0 ? "+" : ""}${nf.format(value)}`;

function initialState(): LabState {
  return {
    cash: 100,
    startingEquity: 100,
    dayStartEquity: 100,
    dayKey: nowDay(),
    peakEquity: 100,
    positions: [],
    trades: [],
    activities: [{
      id: uid(),
      at: new Date().toISOString(),
      title: "Laboratoire prêt",
      detail: "100 USDT fictifs · spot uniquement · aucun levier.",
      type: "info",
    }],
    equityCurve: [100],
    profile: "safe",
    strategy: "observe",
    botRunning: false,
    manualKillSwitch: false,
    beginner: true,
    scanCount: 0,
  };
}

function readState(): LabState {
  if (typeof window === "undefined") return initialState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
    const parsed = JSON.parse(raw ?? "null") as Partial<LabState> | null;
    if (!parsed) return initialState();
    return {
      ...initialState(),
      ...parsed,
      positions: parsed.positions ?? [],
      trades: parsed.trades ?? [],
      activities: parsed.activities ?? [],
      equityCurve: parsed.equityCurve?.length ? parsed.equityCurve : [100],
      scanCount: parsed.scanCount ?? 0,
    };
  } catch {
    return initialState();
  }
}

export function TradingApp() {
  const [view, setView] = useState<ViewId>("today");
  const [state, setState] = useState<LabState>(initialState);
  const [markets, setMarkets] = useState<Partial<Record<Instrument, MarketData>>>({});
  const [insights, setInsights] = useState<Partial<Record<Instrument, MarketInsight>>>({});
  const [marketError, setMarketError] = useState(false);
  const [analysisError, setAnalysisError] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [online, setOnline] = useState(true);
  const [filter, setFilter] = useState<"all" | Strategy | "arbitrage">("all");
  const [selected, setSelected] = useState<Opportunity | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [btResult, setBtResult] = useState<BacktestResult | null>(null);
  const [btInstrument, setBtInstrument] = useState<Instrument>("BTC-USDT");
  const [btLoading, setBtLoading] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const hydrationTimer = window.setTimeout(() => {
      setState(readState());
      setHydrated(true);
      setOnline(navigator.onLine);
    }, 0);
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    return () => {
      window.clearTimeout(hydrationTimer);
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => {
    if (hydrated) localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state, hydrated]);

  useEffect(() => {
    if (!selected) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selected]);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }, []);

  const fetchMarkets = useCallback(async () => {
    if (!navigator.onLine) return;
    try {
      const responses = await Promise.all(INSTRUMENTS.map(async (instrument) => {
        const response = await fetch(`/api/market?instrument=${instrument}`, { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<MarketData>;
      }));
      setMarkets(Object.fromEntries(responses.map((item) => [item.instrument, item])));
      setMarketError(false);
    } catch {
      setMarketError(true);
    }
  }, []);

  const fetchInsights = useCallback(async () => {
    if (!navigator.onLine) return;
    try {
      const responses = await Promise.all(INSTRUMENTS.map(async (instrument) => {
        const response = await fetch(`/api/analysis?instrument=${instrument}`, { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<MarketInsight>;
      }));
      setInsights(Object.fromEntries(responses.map((item) => [item.instrument, item])));
      setAnalysisError(false);
      setState((current) => current.botRunning ? {
        ...current,
        scanCount: current.scanCount + 1,
        lastScanAt: new Date().toISOString(),
      } : current);
    } catch {
      setAnalysisError(true);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const initialFetch = window.setTimeout(() => void fetchMarkets(), 0);
    const timer = window.setInterval(() => void fetchMarkets(), 8_000);
    return () => {
      window.clearTimeout(initialFetch);
      window.clearInterval(timer);
    };
  }, [fetchMarkets, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    const initialFetch = window.setTimeout(() => void fetchInsights(), 0);
    const timer = window.setInterval(() => void fetchInsights(), 60_000);
    return () => {
      window.clearTimeout(initialFetch);
      window.clearInterval(timer);
    };
  }, [fetchInsights, hydrated]);

  const equity = useMemo(() => state.cash + state.positions.reduce(
    (sum, position) => sum + position.quantity * (markets[position.instrument]?.price ?? position.entryPrice),
    0,
  ), [state.cash, state.positions, markets]);
  const unrealized = useMemo(() => state.positions.reduce(
    (sum, position) => sum + position.quantity * ((markets[position.instrument]?.price ?? position.entryPrice) - position.entryPrice) - position.entryFee,
    0,
  ), [state.positions, markets]);
  const realized = useMemo(() => state.trades.reduce((sum, trade) => sum + trade.pnl, 0), [state.trades]);
  const exposure = Math.max(0, equity - state.cash);
  const exposurePct = equity > 0 ? exposure / equity * 100 : 0;
  const pnlPct = state.startingEquity > 0 ? (equity / state.startingEquity - 1) * 100 : 0;
  const performance = useMemo(
    () => calculatePerformanceStats(state.trades, state.startingEquity, equity),
    [state.trades, state.startingEquity, equity],
  );

  useEffect(() => {
    if (!hydrated) return;
    const timer = window.setTimeout(() => {
      setState((current) => {
        const nextDay = nowDay();
        const resetDay = current.dayKey !== nextDay;
        const nextPeak = Math.max(current.peakEquity, equity);
        const lastCurve = current.equityCurve.at(-1) ?? current.startingEquity;
        const append = Math.abs(lastCurve - equity) >= 0.005;
        if (!resetDay && nextPeak === current.peakEquity && !append) return current;
        return {
          ...current,
          dayKey: nextDay,
          dayStartEquity: resetDay ? equity : current.dayStartEquity,
          peakEquity: nextPeak,
          equityCurve: append ? [...current.equityCurve.slice(-179), equity] : current.equityCurve,
        };
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [equity, hydrated]);

  const addActivity = useCallback((title: string, detail: string, type: ActivityItem["type"] = "info") => {
    setState((current) => ({
      ...current,
      activities: [{ id: uid(), at: new Date().toISOString(), title, detail, type }, ...current.activities].slice(0, 120),
    }));
  }, []);

  const closePosition = useCallback((positionId: string, reason: string) => {
    setState((current) => {
      const position = current.positions.find((item) => item.id === positionId);
      if (!position) return current;
      const marketPrice = markets[position.instrument]?.price ?? position.entryPrice;
      const exitPrice = marketPrice * 0.9995;
      const gross = position.quantity * exitPrice;
      const exitFee = gross * 0.001;
      const pnl = gross - exitFee - position.notional;
      const trade: ClosedTrade = { ...position, exitPrice, exitFee, pnl, closedAt: new Date().toISOString(), closeReason: reason };
      return {
        ...current,
        cash: current.cash + gross - exitFee,
        positions: current.positions.filter((item) => item.id !== positionId),
        trades: [trade, ...current.trades],
        activities: [{
          id: uid(),
          at: trade.closedAt,
          title: `${assetSymbol(position.instrument)} vendu`,
          detail: `${reason} · P&L net ${signed(pnl)} USDT`,
          type: "trade" as const,
        }, ...current.activities].slice(0, 120),
      };
    });
    showToast("Position fictive clôturée et journalisée");
  }, [markets, showToast]);

  useEffect(() => {
    if (!hydrated || !Object.keys(markets).length) return;
    const timers: number[] = [];
    for (const position of state.positions) {
      const price = markets[position.instrument]?.price;
      if (!price) continue;
      if (price <= position.stopPrice) timers.push(window.setTimeout(() => closePosition(position.id, "Stop loss déclenché"), 0));
      else if (price >= position.takeProfitPrice) timers.push(window.setTimeout(() => closePosition(position.id, "Take profit atteint"), 0));
    }
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [markets, hydrated, state.positions, closePosition]);

  const opportunities = useMemo(
    () => buildOpportunities(markets, insights, state, equity),
    [markets, insights, state, equity],
  );
  const visibleOpportunities = filter === "all"
    ? opportunities
    : opportunities.filter((item) => item.kind === filter);

  const decisionFor = useCallback((opportunity: Opportunity) => {
    if (!opportunity.executable) return null;
    const market = markets[opportunity.instrument];
    if (!market) return null;
    const profile = getRiskProfile(state.profile);
    return evaluateTrade({
      symbol: opportunity.instrument,
      direction: "long",
      intent: "open",
      entryPrice: market.ask || market.price,
      stopPrice: market.price * (1 - opportunity.stopPct / 100),
      takeProfitPrice: market.price * (1 + opportunity.targetPct / 100),
      requestedNotional: Math.min(state.cash, equity * profile.maxOrderNotionalPct),
      leverage: 1,
      minimumOrderNotional: 5,
      estimatedRoundTripCostPct: 0.003,
    }, {
      currentEquity: equity,
      dayStartEquity: state.dayStartEquity,
      peakEquity: state.peakEquity,
      availableQuoteBalance: state.cash,
      positions: state.positions.map((position) => ({
        symbol: position.instrument,
        direction: "long" as const,
        notional: position.quantity * (markets[position.instrument]?.price ?? position.entryPrice),
      })),
      manualKillSwitch: state.manualKillSwitch,
    }, state.profile);
  }, [markets, state, equity]);

  const executePaper = useCallback((opportunity: Opportunity) => {
    if (!opportunity.executable) {
      addActivity("Observation enregistrée", `${opportunity.title} · aucun capital engagé`);
      setSelected(null);
      showToast("Plan d’observation enregistré — aucun achat simulé");
      return;
    }
    const market = markets[opportunity.instrument];
    const decision = decisionFor(opportunity);
    if (!market || !decision?.allowed) {
      showToast(decision?.explanation ?? "Marché indisponible");
      return;
    }
    const notional = Math.min(decision.approvedNotional, state.cash);
    const execution = (market.ask || market.price) * 1.0005;
    const fee = notional * 0.001;
    const quantity = (notional - fee) / execution;
    const position: PaperPosition = {
      id: uid(),
      instrument: opportunity.instrument,
      quantity,
      entryPrice: execution,
      notional,
      stopPrice: market.price * (1 - opportunity.stopPct / 100),
      takeProfitPrice: market.price * (1 + opportunity.targetPct / 100),
      openedAt: new Date().toISOString(),
      entryFee: fee,
      reason: opportunity.reason,
    };
    setState((current) => ({
      ...current,
      cash: current.cash - notional,
      positions: [...current.positions, position],
      activities: [{
        id: uid(),
        at: position.openedAt,
        title: `${assetSymbol(position.instrument)} acheté en paper`,
        detail: `${nf.format(notional)} USDT · perte planifiée ${nf.format(decision.metrics.plannedLossAtStop)} USDT`,
        type: "trade" as const,
      }, ...current.activities].slice(0, 120),
    }));
    setSelected(null);
    showToast("Ordre fictif exécuté — aucun argent réel");
  }, [markets, decisionFor, state.cash, showToast, addActivity]);

  const resetLab = () => {
    if (!window.confirm("Effacer les positions, résultats et réglages fictifs de ce navigateur ?")) return;
    setState(initialState());
    setBtResult(null);
    showToast("Laboratoire réinitialisé");
  };

  const exportCsv = () => {
    const header = ["date", "marche", "entree", "sortie", "quantite", "frais_entree", "frais_sortie", "pnl_net", "raison"];
    const rows = state.trades.map((trade) => [
      trade.closedAt,
      trade.instrument,
      trade.entryPrice,
      trade.exitPrice,
      trade.quantity,
      trade.entryFee,
      trade.exitFee,
      trade.pnl,
      trade.closeReason.replaceAll('"', '""'),
    ]);
    const csv = [header, ...rows].map((row) => row.map((cell) => `"${cell}"`).join(",")).join("\n");
    downloadFile(`bahia-trades-${nowDay()}.csv`, csv, "text/csv;charset=utf-8");
    showToast("Journal CSV exporté");
  };

  const exportBackup = () => {
    downloadFile(`bahia-backup-${nowDay()}.json`, JSON.stringify({ version: 3, exportedAt: new Date().toISOString(), state }, null, 2), "application/json");
    showToast("Sauvegarde locale exportée");
  };

  const runBacktest = async () => {
    if (state.strategy === "observe") {
      showToast("Choisis d’abord DCA, Rééquilibrage, Grid ou Tendance");
      return;
    }
    setBtLoading(true);
    try {
      const result = await simpleBacktest(state.strategy, btInstrument);
      setBtResult(result);
      addActivity("Backtest terminé", `${btInstrument} · ${result.trades} trades · résultat ${signed(result.returnPct)} %`);
    } catch {
      showToast("Impossible de charger l’historique OKX");
    } finally {
      setBtLoading(false);
    }
  };

  const setCurrentView = (next: ViewId) => {
    setView(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const topOpportunity = opportunities.find((item) => !item.refused && item.executable);
  const setupSteps = [
    Object.keys(markets).length === INSTRUMENTS.length,
    state.strategy !== "observe",
    btResult !== null,
    state.positions.length + state.trades.length > 0,
  ];

  if (!hydrated) {
    return <div className="loadingScreen"><Image src="/bahia-mascot.png" alt="" width={96} height={96} priority/><strong>Bahia prépare ton laboratoire…</strong></div>;
  }

  return (
    <div className={`app ${state.beginner ? "beginner" : "advanced"}`}>
      {!online && <div className="offline">Hors ligne — consultation locale uniquement, nouvelles actions bloquées.</div>}
      <Sidebar view={view} setView={setCurrentView} beginner={state.beginner} toggleBeginner={() => setState((current) => ({ ...current, beginner: !current.beginner }))}/>
      <main className="main">
        <header className="topbar">
          <div className="topTitle"><p className="eyebrow">{new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}</p><h1>{VIEW_COPY[view].title} {view === "today" && <span className="accent">✦</span>}</h1><p>{VIEW_COPY[view].subtitle}</p></div>
          <div className="topActions">
            <div className={`feedStatus ${marketError ? "bad" : ""}`}><span className="statusDot"/><span><small>DONNÉES</small><strong>{marketError ? "OKX indisponible" : Object.keys(markets).length ? "OKX · direct" : "Connexion…"}</strong></span></div>
            <button type="button" className="button ghost" onClick={() => setCurrentView("more")}>Comprendre</button>
            <button type="button" className="button primary" disabled={!topOpportunity} onClick={() => topOpportunity && setSelected(topOpportunity)}>Examiner l’action</button>
          </div>
        </header>

        {view === "today" && <TodayView state={state} equity={equity} pnlPct={pnlPct} exposurePct={exposurePct} realized={realized} unrealized={unrealized} markets={markets} insights={insights} analysisError={analysisError} opportunities={opportunities} setupSteps={setupSteps} setView={setCurrentView}/>}
        {view === "opportunities" && <OpportunitiesView opportunities={visibleOpportunities} filter={filter} setFilter={setFilter} setSelected={setSelected} beginner={state.beginner} dismiss={(item) => { addActivity("Scénario ignoré", `${item.title} · aucune action prise`); showToast("Bonne décision : ne rien faire est toujours permis"); }}/>}
        {view === "automations" && <AutomationsView state={state} setState={setState} insights={insights} runBacktest={runBacktest} btInstrument={btInstrument} setBtInstrument={setBtInstrument} btLoading={btLoading} btResult={btResult} showToast={showToast}/>}
        {view === "portfolio" && <PortfolioView state={state} equity={equity} exposurePct={exposurePct} markets={markets} closePosition={closePosition}/>}
        {view === "results" && <ResultsView state={state} equity={equity} unrealized={unrealized} performance={performance} exportCsv={exportCsv}/>}
        {view === "more" && <MoreView state={state} setState={setState} resetLab={resetLab} exportBackup={exportBackup}/>}
      </main>
      <MobileNav view={view} setView={setCurrentView}/>
      {selected && <ScenarioDrawer opportunity={selected} market={markets[selected.instrument]} insight={insights[selected.instrument]} decision={decisionFor(selected)} online={online} close={() => setSelected(null)} execute={() => executePaper(selected)}/>}
      {toast && <div className="toast" role="status" aria-live="polite">{toast}</div>}
    </div>
  );
}

function Sidebar({ view, setView, beginner, toggleBeginner }: { view: ViewId; setView: (view: ViewId) => void; beginner: boolean; toggleBeginner: () => void }) {
  return <aside className="sidebar"><div className="brand"><span className="brandMark"><Image src="/bahia-mascot.png" alt="" width={34} height={34}/></span><span><strong>BAHIA</strong><small>TRADING LAB</small></span></div><nav className="nav" aria-label="Navigation principale">{NAV.map((item) => <button type="button" key={item.id} className={`navButton ${view === item.id ? "active" : ""}`} aria-current={view === item.id ? "page" : undefined} onClick={() => setView(item.id)}><span className="navIcon">{item.icon}</span>{item.label}</button>)}</nav><div className="sidebarBottom"><div className="environmentCard"><span className="statusDot"/><span><small>ENVIRONNEMENT</small><strong>PAPER TRADING</strong><em>100 % fictif</em></span></div><div className="beginnerControl"><span><strong>Mode débutant</strong><small>{beginner ? "Guidage activé" : "Détails avancés"}</small></span><button type="button" className={`switch ${beginner ? "on" : ""}`} aria-label="Activer le mode débutant" aria-pressed={beginner} onClick={toggleBeginner}/></div></div></aside>;
}

function MobileNav({ view, setView }: { view: ViewId; setView: (view: ViewId) => void }) {
  return <nav className="mobileNav" aria-label="Navigation mobile">{NAV.map((item) => <button type="button" key={item.id} className={view === item.id ? "active" : ""} aria-current={view === item.id ? "page" : undefined} onClick={() => setView(item.id)}><span>{item.icon}</span><small>{item.label === "Automatisations" ? "Bots" : item.label}</small></button>)}</nav>;
}

interface TodayProps {
  state: LabState;
  equity: number;
  pnlPct: number;
  exposurePct: number;
  realized: number;
  unrealized: number;
  markets: Partial<Record<Instrument, MarketData>>;
  insights: Partial<Record<Instrument, MarketInsight>>;
  analysisError: boolean;
  opportunities: Opportunity[];
  setupSteps: boolean[];
  setView: (view: ViewId) => void;
}

function TodayView({ state, equity, pnlPct, exposurePct, realized, unrealized, markets, insights, analysisError, opportunities, setupSteps, setView }: TodayProps) {
  const top = opportunities.find((item) => !item.refused);
  const completed = setupSteps.filter(Boolean).length;
  const nextCopy = !setupSteps[0] ? "Connecter les données" : !setupSteps[1] ? "Choisir une stratégie" : !setupSteps[2] ? "Tester sur l’historique" : !setupSteps[3] ? "Simuler une première action" : "Analyser les résultats";
  const nextView: ViewId = !setupSteps[1] || !setupSteps[2] ? "automations" : !setupSteps[3] ? "opportunities" : "results";
  return <section className="view">
    <article className="missionCard"><div className="missionMascot"><Image src="/bahia-mascot.png" alt="Mascotte Bahia" width={118} height={118} priority/></div><div className="missionCopy"><span className="eyebrow">MISSION DU JOUR · ÉTAPE {Math.min(completed + 1, 4)}/4</span><h2>{completed === 4 ? "Ton laboratoire est opérationnel" : nextCopy}</h2><p>{top ? "Bahia surveille les marchés et a trouvé un scénario à examiner." : "Aucune entrée n’est suffisamment claire pour le moment. Attendre est une action valide."}</p><div className="progressTrack" aria-label={`${completed} étapes terminées sur 4`}><i style={{ width: `${completed / 4 * 100}%` }}/></div></div><button type="button" className="button primary" onClick={() => setView(nextView)}>{completed === 4 ? "Voir mon bilan" : "Continuer"}</button></article>
    <div className="grid metrics"><Metric label="Capital fictif" value={nf.format(equity)} unit="USDT" foot={`${signed(pnlPct)} % depuis le départ`} tone={pnlPct >= 0 ? "positive" : "negative"}/><Metric label="Résultat net" value={signed(realized + unrealized)} unit="USDT" foot={`${nf.format(realized)} réalisé · ${nf.format(unrealized)} latent`} tone={realized + unrealized >= 0 ? "positive" : "negative"}/><Metric label="Exposition" value={nf.format(exposurePct)} unit="%" foot={`${nf.format(state.cash)} USDT disponibles`}/><Metric label="Protections" value={state.manualKillSwitch ? "ARRÊT" : "ACTIVES"} foot={state.manualKillSwitch ? "Nouvelles entrées bloquées" : "Stop · taille · réserve"} tone={state.manualKillSwitch ? "negative" : "positive"}/></div>
    <div className="grid contentGrid"><article className="card chartCard"><div className="cardHead"><div><strong>Performance du portefeuille</strong><small>Après frais et glissement simulés</small></div><span className="badge">SESSION</span></div><EquityChart values={[...state.equityCurve, equity].slice(-90)}/><div className="chartLabels"><span>Départ {nf.format(state.startingEquity)}</span><span>Maintenant {nf.format(equity)} USDT</span></div></article><article className="card"><div className="cardHead"><div><strong>Marchés suivis</strong><small>Prix publics OKX actualisés</small></div><button type="button" className="textButton" onClick={() => setView("opportunities")}>Analyser →</button></div><MarketList markets={markets} insights={insights}/></article></div>
    <div className="grid lowerGrid"><MarketPulse insights={insights} error={analysisError}/><article className="card"><div className="cardHead"><div><strong>Analyse automatique</strong><small>Surveille et explique, sans ordre réel</small></div><span className={`badge ${state.botRunning ? "good" : ""}`}>{state.botRunning ? "ACTIVE" : "EN PAUSE"}</span></div><div className="cardBody"><div className="summaryList"><span>Stratégie<b>{strategyLabel(state.strategy)}</b></span><span>Profil<b>{getRiskProfile(state.profile).label}</b></span><span>Scans<b>{state.scanCount}</b></span></div><p className="neutral smallCopy">{state.lastScanAt ? `Dernière analyse ${new Date(state.lastScanAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}` : "L’analyse démarrera quand tu l’activeras."}</p><button type="button" className="button primary wide" onClick={() => setView("automations")}>{state.botRunning ? "Gérer l’analyse" : "Configurer"}</button></div></article><article className="card"><div className="cardHead"><div><strong>Garde-fous</strong><small>Appliqués avant chaque simulation</small></div><span className="shield">◇</span></div><div className="cardBody"><ul className="guardrails"><li>Spot uniquement</li><li>Aucun levier</li><li>Stop obligatoire</li><li>Réserve protégée</li><li>Sortie toujours possible</li></ul></div></article></div>
  </section>;
}

function Metric({ label, value, unit, foot, tone = "" }: { label: string; value: string; unit?: string; foot: string; tone?: string }) {
  return <article className="card metric"><span className="metricLabel">{label.toUpperCase()}</span><strong className={`metricValue ${tone}`}>{value} {unit && <small>{unit}</small>}</strong><span className="metricFoot">{foot}</span></article>;
}

function EquityChart({ values }: { values: number[] }) {
  const safeValues = values.length > 1 ? values : [values[0] ?? 100, values[0] ?? 100];
  const min = Math.min(...safeValues);
  const max = Math.max(...safeValues);
  const padding = Math.max((max - min) * 0.2, 0.2);
  const low = min - padding;
  const high = max + padding;
  const range = high - low || 1;
  const points = safeValues.map((value, index) => `${index / Math.max(1, safeValues.length - 1) * 100},${92 - (value - low) / range * 76}`).join(" ");
  return <div className="chartWrap"><svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={`Courbe du portefeuille de ${nf.format(safeValues[0])} à ${nf.format(safeValues.at(-1) ?? safeValues[0])} USDT`}><defs><linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#9b82ff" stopOpacity=".32"/><stop offset="1" stopColor="#9b82ff" stopOpacity="0"/></linearGradient></defs>{[25, 50, 75].map((y) => <line key={y} x1="0" x2="100" y1={y} y2={y} className="chartGrid"/>)}<polygon points={`0,100 ${points} 100,100`} className="chartArea"/><polyline points={points} className="chartLine"/></svg></div>;
}

function MarketList({ markets, insights }: { markets: Partial<Record<Instrument, MarketData>>; insights: Partial<Record<Instrument, MarketInsight>> }) {
  return <div className="marketList">{INSTRUMENTS.map((instrument) => {
    const market = markets[instrument];
    const insight = insights[instrument];
    return <div className="marketRow" key={instrument}><div className="asset"><span className={`assetIcon ${assetClass(instrument)}`}>{assetGlyph(instrument)}</span><span><strong>{assetSymbol(instrument)}</strong><small>{insight ? `${insight.regime} · RSI ${Math.round(insight.rsi14)}` : marketName(instrument)}</small></span></div><span className="marketPrice"><strong>{market ? nf.format(market.price) : "—"}</strong><small>{market ? compact.format(market.volume24h) : ""} USDT</small></span><span className={`marketMove ${(market?.change24h ?? 0) >= 0 ? "positive" : "negative"}`}>{market ? `${market.change24h >= 0 ? "+" : ""}${nf.format(market.change24h)} %` : "—"}</span></div>;
  })}</div>;
}

function MarketPulse({ insights, error }: { insights: Partial<Record<Instrument, MarketInsight>>; error: boolean }) {
  const btc = insights["BTC-USDT"];
  return <article className="card"><div className="cardHead"><div><strong>✦ Lecture du marché</strong><small>Indicateurs descriptifs, pas une prédiction</small></div><span className={`score ${btc && btc.riskScore < 65 ? "calm" : ""}`}>{btc?.riskScore ?? "—"}</span></div><div className="cardBody">{error ? <p className="negative">Analyse temporairement indisponible.</p> : btc ? <><div className="signalGrid"><span>Tendance<b>{btc.trend}</b></span><span>Régime<b>{btc.regime}</b></span><span>RSI 14<b>{nf.format(btc.rsi14)}</b></span><span>Amplitude ATR<b>{nf.format(btc.atr14Pct)} %</b></span></div><p className="coachText">{btc.explanation}</p></> : <div className="skeletonLine">Calcul des indicateurs…</div>}</div></article>;
}

function OpportunitiesView({ opportunities, filter, setFilter, setSelected, beginner, dismiss }: { opportunities: Opportunity[]; filter: string; setFilter: (filter: "all" | Strategy | "arbitrage") => void; setSelected: (item: Opportunity) => void; beginner: boolean; dismiss: (item: Opportunity) => void }) {
  const filters: Array<["all" | Strategy | "arbitrage", string]> = beginner
    ? [["all", "Tout"], ["observe", "Observer"], ["dca", "Investir progressivement"], ["rebalance", "Rééquilibrer"]]
    : [["all", "Tout"], ["dca", "DCA"], ["rebalance", "Rééquilibrage"], ["grid", "Grid"], ["trend", "Tendance"], ["arbitrage", "Arbitrage"]];
  return <section className="view"><div className="sectionHead"><div><p className="eyebrow">MOTEUR MULTIFACTEUR</p><h2>Comprendre avant d’agir</h2><p>Prix, tendance, RSI, volatilité, coûts et capacité de risque sont vérifiés séparément.</p></div><span className="statusPill"><span className="statusDot"/>Analyse en direct</span></div><div className="educationStrip"><strong>Comment lire le score ?</strong><span>Il mesure la qualité des éléments disponibles, jamais la probabilité de gagner.</span></div><div className="opportunityFilters">{filters.map(([id, label]) => <button type="button" key={id} className={`chip ${filter === id ? "active" : ""}`} onClick={() => setFilter(id)}>{label}</button>)}</div><div className="grid opportunityGrid">{opportunities.map((item) => <OpportunityCard key={item.id} item={item} open={() => setSelected(item)} dismiss={() => dismiss(item)}/>)}</div></section>;
}

function OpportunityCard({ item, open, dismiss }: { item: Opportunity; open: () => void; dismiss: () => void }) {
  return <article className={`card opportunityCard ${item.refused ? "refused" : ""}`}><div className="opportunityTop"><span className="opportunityKind">{kindLabel(item.kind).toUpperCase()} · {assetSymbol(item.instrument)}</span><span className={`quality q${Math.floor(item.score / 25)}`}>{item.score}/100</span></div><h3>{item.title}</h3><p>{item.action}</p><div className="conditionList">{item.conditions.map((condition) => <span key={condition}>✓ {condition}</span>)}</div><div className="reasonBox"><strong>Lecture Bahia</strong><p>{item.reason}</p></div><div className="opportunityFacts"><span>Perte maximale planifiée <b>{nf.format(item.maxLoss)} USDT</b></span><span>Coûts estimés <b>{nf.format(item.estimatedCost)} USDT</b></span><span>Fenêtre d’analyse <b>{item.expiryMinutes} min</b></span></div>{item.refused && <div className="warning"><strong>Action refusée</strong><p>{item.refusalReason}</p></div>}<div className="opportunityActions"><button type="button" className="button ghost small" onClick={dismiss}>Ignorer</button><button type="button" className="button primary small" disabled={item.refused} onClick={open}>{item.executable ? "Examiner" : "Voir le plan"}</button></div></article>;
}

function AutomationsView({ state, setState, insights, runBacktest, btInstrument, setBtInstrument, btLoading, btResult, showToast }: { state: LabState; setState: React.Dispatch<React.SetStateAction<LabState>>; insights: Partial<Record<Instrument, MarketInsight>>; runBacktest: () => void; btInstrument: Instrument; setBtInstrument: (instrument: Instrument) => void; btLoading: boolean; btResult: BacktestResult | null; showToast: (message: string) => void }) {
  const profile = getRiskProfile(state.profile);
  const strategies: Array<[Strategy, string, string]> = [
    ["observe", "Observer", "Aucun ordre, seulement des analyses expliquées."],
    ["dca", "Investir progressivement", "Petites entrées espacées pour éviter le tout-ou-rien."],
    ["rebalance", "Rééquilibrer", "Ramener le portefeuille vers une allocation cible."],
    ["grid", "Grid prudent", "Simuler des achats et ventes dans une zone latérale."],
    ["trend", "Suivre la tendance", "N’agir que si plusieurs éléments confirment le mouvement."],
  ];
  const visible = state.beginner ? strategies.slice(0, 3) : strategies;
  return <section className="view"><div className="sectionHead"><div><p className="eyebrow">ATELIER SANS CODE</p><h2>Construire en trois décisions</h2><p>Chaque réglage affiche son impact avant activation.</p></div><span className="statusPill">PAPER UNIQUEMENT</span></div><div className="grid automationLayout"><article className="card formCard"><WizardStep number="1" title="Que veux-tu faire ?" text="Choisis l’intention, pas un jargon technique."/><div className="optionGrid">{visible.map(([id, label, description]) => <button type="button" key={id} className={`option ${state.strategy === id ? "active" : ""}`} aria-pressed={state.strategy === id} onClick={() => setState((current) => ({ ...current, strategy: id }))}><strong>{label}</strong><small>{description}</small></button>)}</div><WizardStep number="2" title="Combien de risque acceptes-tu ?" text="Le moteur peut encore réduire ou refuser une action."/><div className="optionGrid profiles">{(["safe", "balanced", "dynamic"] as RiskProfileId[]).map((id) => { const item = getRiskProfile(id); return <button type="button" key={id} className={`option ${state.profile === id ? "active" : ""}`} aria-pressed={state.profile === id} onClick={() => setState((current) => ({ ...current, profile: id }))}><strong>{item.label}</strong><small>{nf.format(item.riskPerTradePct * 100)} % risqué · {nf.format(item.maxPortfolioExposurePct * 100)} % exposé max</small></button>; })}</div><WizardStep number="3" title="Teste sur des données historiques" text="Ce test inclut frais et glissement, mais ne prédit pas le futur."/><label className="field">Marché du test<select value={btInstrument} onChange={(event) => setBtInstrument(event.target.value as Instrument)}>{INSTRUMENTS.map((instrument) => <option value={instrument} key={instrument}>{marketName(instrument)}</option>)}</select></label><button type="button" className="button ghost wide" onClick={() => void runBacktest()} disabled={btLoading}>{btLoading ? "Calcul du test…" : state.strategy === "observe" ? "Choisir une stratégie pour tester" : "Lancer le backtest"}</button>{btResult && <BacktestCard result={btResult}/>}<button type="button" className="button primary wide" onClick={() => { setState((current) => ({ ...current, botRunning: !current.botRunning })); showToast(state.botRunning ? "Analyse automatique mise en pause" : "Analyse activée dans cet onglet — aucun ordre réel"); }}>{state.botRunning ? "Mettre l’analyse en pause" : "Activer l’analyse automatique"}</button></article><article className="card previewCard"><div className="botPortrait"><Image src="/bahia-mascot.png" alt="Mascotte Bahia" width={126} height={126}/><span className={`pulseBadge ${state.botRunning ? "on" : ""}`}>{state.botRunning ? "SURVEILLE" : "EN PAUSE"}</span></div><p className="eyebrow">TON PLAN EN LANGAGE SIMPLE</p><h3>{strategyLabel(state.strategy)} · {profile.label}</h3><p>{strategyExplanation(state.strategy)}</p><div className="riskRows"><span>Perte maximale / action <b>{nf.format(profile.riskPerTradePct * 100)} %</b></span><span>Perte quotidienne maximale <b>{nf.format(profile.maxDailyLossPct * 100)} %</b></span><span>Exposition totale maximale <b>{nf.format(profile.maxPortfolioExposurePct * 100)} %</b></span><span>Réserve minimale <b>{nf.format(profile.cashReservePct * 100)} %</b></span><span>Régime BTC actuel <b>{insights["BTC-USDT"]?.regime ?? "calcul…"}</b></span></div><div className="warning"><strong>Limite de cette version</strong><p>L’analyse tourne quand l’application est ouverte. Un worker durable et OKX Demo restent nécessaires pour fonctionner réellement 24/7.</p></div></article></div></section>;
}

function WizardStep({ number, title, text }: { number: string; title: string; text: string }) {
  return <div className="step"><span>{number}</span><div><strong>{title}</strong><small>{text}</small></div></div>;
}

function BacktestCard({ result }: { result: BacktestResult }) {
  const beatsBenchmark = result.returnPct > result.holdReturnPct;
  return <div className="backtestResult"><div className="backtestHero"><span>Résultat simulé<strong className={result.returnPct >= 0 ? "positive" : "negative"}>{signed(result.returnPct)} %</strong></span><span>Capital final<strong>{nf.format(result.finalEquity)} USDT</strong></span></div><div className="signalGrid"><span>Trades<b>{result.trades}</b></span><span>Réussite<b>{result.trades ? nf.format(result.wins / result.trades * 100) : "—"} %</b></span><span>Drawdown<b>{nf.format(result.maxDrawdownPct)} %</b></span><span>Profit factor<b>{result.profitFactor === null ? "—" : nf.format(result.profitFactor)}</b></span></div><p className={beatsBenchmark ? "positive" : "neutral"}>{beatsBenchmark ? "✓ Sur cette période, le test dépasse le simple achat-conservation." : "Le simple achat-conservation fait mieux sur cette période."}</p></div>;
}

function PortfolioView({ state, equity, exposurePct, markets, closePosition }: { state: LabState; equity: number; exposurePct: number; markets: Partial<Record<Instrument, MarketData>>; closePosition: (id: string, reason: string) => void }) {
  const values = INSTRUMENTS.map((instrument) => state.positions.filter((position) => position.instrument === instrument).reduce((sum, position) => sum + position.quantity * (markets[instrument]?.price ?? position.entryPrice), 0));
  const cashPct = equity ? state.cash / equity * 100 : 100;
  const riskAtStops = state.positions.reduce((sum, position) => sum + position.quantity * Math.max(0, position.entryPrice - position.stopPrice) + position.entryFee, 0);
  return <section className="view"><div className="sectionHead"><div><p className="eyebrow">PORTEFEUILLE FICTIF</p><h2>Voir le capital avant les positions</h2><p>Chaque position affiche sa sortie prévue et son risque restant.</p></div><span className="statusPill">{nf.format(exposurePct)} % exposé</span></div><div className="grid metrics"><Metric label="Valeur totale" value={nf.format(equity)} unit="USDT" foot="Réserve + positions"/><Metric label="Réserve" value={nf.format(state.cash)} unit="USDT" foot={`${nf.format(cashPct)} % non engagé`}/><Metric label="Risque aux stops" value={nf.format(riskAtStops)} unit="USDT" foot="Perte planifiée approximative" tone={riskAtStops > equity * .03 ? "negative" : "neutral"}/><Metric label="Positions" value={String(state.positions.length)} foot={`${getRiskProfile(state.profile).maxOpenPositions} maximum pour ce profil`}/></div><div className="grid portfolioGrid"><article className="card"><div className="cardHead"><div><strong>Allocation actuelle</strong><small>Répartition par valeur de marché</small></div></div><div className="allocation"><div className="allocationBar">{values.map((value, index) => <i key={INSTRUMENTS[index]} style={{ width: `${equity ? value / equity * 100 : 0}%` }}/>) }<i className="cash" style={{ width: `${Math.max(0, cashPct)}%` }}/></div><div className="allocationLegend">{INSTRUMENTS.map((instrument, index) => <span key={instrument}>● {assetSymbol(instrument)} {nf.format(equity ? values[index] / equity * 100 : 0)} %</span>)}<span>● USDT {nf.format(cashPct)} %</span></div></div></article><article className="card"><div className="cardHead"><div><strong>Lecture simple</strong><small>Ce que cette allocation implique</small></div></div><div className="cardBody"><p className="coachText">{cashPct >= 60 ? "Ta réserve domine : tu conserves beaucoup de flexibilité pour de futurs scénarios." : cashPct >= 30 ? "Ton allocation reste diversifiée, mais surveille le risque cumulé aux stops." : "Ta réserve est faible : Bahia bloquera ou réduira probablement la prochaine entrée."}</p><div className="explain"><strong>Pourquoi garder du cash ?</strong><p>Une réserve évite de devoir vendre une position au mauvais moment et limite la concentration.</p></div></div></article></div><article className="card"><div className="cardHead"><div><strong>Positions ouvertes</strong><small>Actualisées avec les prix OKX</small></div><span className="badge">{state.positions.length}</span></div><div className="positions">{state.positions.length ? state.positions.map((position) => { const price = markets[position.instrument]?.price ?? position.entryPrice; const pnl = position.quantity * (price - position.entryPrice) - position.entryFee; const distanceToStop = (price / position.stopPrice - 1) * 100; return <div className="position" key={position.id}><div className="positionHead"><div className="asset"><span className={`assetIcon ${assetClass(position.instrument)}`}>{assetGlyph(position.instrument)}</span><span><strong>{marketName(position.instrument)}</strong><small>Ouverte {new Date(position.openedAt).toLocaleString("fr-FR")}</small></span></div><b className={pnl >= 0 ? "positive" : "negative"}>{signed(pnl)} USDT</b></div><div className="positionData"><span>Entrée<b>{nf.format(position.entryPrice)}</b></span><span>Actuel<b>{nf.format(price)}</b></span><span>Stop<b>{nf.format(position.stopPrice)}</b></span><span>Objectif<b>{nf.format(position.takeProfitPrice)}</b></span><span>Marge au stop<b>{nf.format(distanceToStop)} %</b></span></div><button type="button" className="button ghost wide" onClick={() => closePosition(position.id, "Clôture manuelle")}>Clôturer la simulation</button></div>; }) : <div className="empty"><Image src="/bahia-mascot.png" alt="" width={72} height={72}/><strong>Aucune position ouverte</strong><span>Bahia ne force jamais une entrée.</span></div>}</div></article></section>;
}

function ResultsView({ state, equity, unrealized, performance, exportCsv }: { state: LabState; equity: number; unrealized: number; performance: PerformanceStats; exportCsv: () => void }) {
  const byAsset = INSTRUMENTS.map((instrument) => {
    const trades = state.trades.filter((trade) => trade.instrument === instrument);
    return { instrument, count: trades.length, pnl: trades.reduce((sum, trade) => sum + trade.pnl, 0), wins: trades.filter((trade) => trade.pnl > 0).length };
  });
  const qualityCopy = performance.sampleQuality === "exploitable" ? "Échantillon exploitable" : performance.sampleQuality === "limite" ? "Échantillon encore limité" : "Trop peu de trades pour conclure";
  return <section className="view"><div className="sectionHead"><div><p className="eyebrow">ANALYTIQUE NETTE</p><h2>Mesurer sans se raconter d’histoire</h2><p>Les résultats incluent frais et glissement simulés.</p></div><button type="button" className="button ghost" onClick={exportCsv} disabled={!state.trades.length}>Exporter le CSV</button></div><div className={`sampleBanner ${performance.sampleQuality}`}><strong>{qualityCopy}</strong><span>{performance.totalTrades}/30 trades minimum recommandés avant une comparaison sérieuse.</span><i><b style={{ width: `${Math.min(100, performance.totalTrades / 30 * 100)}%` }}/></i></div><div className="grid metrics"><Metric label="P&L total" value={signed(performance.netPnl + unrealized)} unit="USDT" foot={`Capital ${nf.format(equity)} USDT`} tone={performance.netPnl + unrealized >= 0 ? "positive" : "negative"}/><Metric label="Taux de réussite" value={performance.winRatePct === null ? "—" : nf.format(performance.winRatePct)} unit={performance.winRatePct === null ? "" : "%"} foot={`${performance.winningTrades} gagnants · ${performance.losingTrades} perdants`}/><Metric label="Profit factor" value={performance.profitFactor === null ? "—" : nf.format(performance.profitFactor)} foot="Gains bruts / pertes brutes"/><Metric label="Espérance / trade" value={signed(performance.expectancy)} unit="USDT" foot="Moyenne probabilisée" tone={performance.expectancy >= 0 ? "positive" : "negative"}/></div><div className="grid analyticsGrid"><article className="card statsCard"><div className="cardHead"><div><strong>Qualité de la stratégie</strong><small>Statistiques de comportement</small></div></div><div className="statsRows"><Stat label="Gain moyen" value={`${signed(performance.averageWin)} USDT`}/><Stat label="Perte moyenne" value={`-${nf.format(performance.averageLoss)} USDT`}/><Stat label="Ratio gain / perte" value={performance.payoffRatio === null ? "—" : nf.format(performance.payoffRatio)}/><Stat label="Taux de réussite à l’équilibre" value={performance.breakEvenWinRatePct === null ? "—" : `${nf.format(performance.breakEvenWinRatePct)} %`}/><Stat label="Meilleur trade" value={performance.bestTrade === null ? "—" : `${signed(performance.bestTrade)} USDT`}/><Stat label="Pire trade" value={performance.worstTrade === null ? "—" : `${signed(performance.worstTrade)} USDT`}/></div></article><article className="card statsCard"><div className="cardHead"><div><strong>Risque réalisé</strong><small>Ce que le parcours a réellement subi</small></div></div><div className="statsRows"><Stat label="Drawdown réalisé" value={`${nf.format(performance.maxDrawdownPct)} %`}/><Stat label="Drawdown en valeur" value={`${nf.format(performance.maxDrawdownAmount)} USDT`}/><Stat label="Série de pertes max" value={`${performance.maxConsecutiveLosses} trade(s)`}/><Stat label="Série de gains max" value={`${performance.maxConsecutiveWins} trade(s)`}/><Stat label="Durée moyenne" value={formatDuration(performance.averageHoldingMinutes)}/><Stat label="Frais cumulés" value={`${nf.format(performance.totalFees)} USDT`}/></div></article></div><article className="card tableCard"><div className="cardHead"><div><strong>Résultats par actif</strong><small>Repère rapidement où la méthode fonctionne ou échoue</small></div></div><div className="tableScroll"><table><thead><tr><th>Actif</th><th>Trades</th><th>Réussite</th><th>P&L net</th></tr></thead><tbody>{byAsset.map((item) => <tr key={item.instrument}><td>{marketName(item.instrument)}</td><td>{item.count}</td><td>{item.count ? nf.format(item.wins / item.count * 100) : "—"} {item.count ? "%" : ""}</td><td className={item.pnl >= 0 ? "positive" : "negative"}>{signed(item.pnl)} USDT</td></tr>)}</tbody></table></div></article><article className="card tableCard"><div className="cardHead"><div><strong>Journal auditable</strong><small>Prix, durée, raison et résultat net</small></div></div><div className="tableScroll"><table><thead><tr><th>Date</th><th>Marché</th><th>Durée</th><th>Entrée</th><th>Sortie</th><th>Raison</th><th>P&L net</th></tr></thead><tbody>{state.trades.length ? state.trades.map((trade) => <tr key={trade.id}><td>{new Date(trade.closedAt).toLocaleString("fr-FR")}</td><td>{marketName(trade.instrument)}</td><td>{formatDuration((Date.parse(trade.closedAt) - Date.parse(trade.openedAt)) / 60_000)}</td><td>{nf.format(trade.entryPrice)}</td><td>{nf.format(trade.exitPrice)}</td><td>{trade.closeReason}</td><td className={trade.pnl >= 0 ? "positive" : "negative"}>{signed(trade.pnl)} USDT</td></tr>) : <tr><td colSpan={7}><div className="empty"><strong>Aucun trade clôturé</strong><span>Le journal se remplira après une simulation complète.</span></div></td></tr>}</tbody></table></div></article><ActivityLog items={state.activities}/></section>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return <span><small>{label}</small><b>{value}</b></span>;
}

function ActivityLog({ items }: { items: ActivityItem[] }) {
  return <article className="card"><div className="cardHead"><div><strong>Journal des décisions</strong><small>Les actions et les refus restent visibles</small></div><span className="badge">{items.length}</span></div><div className="activityList">{items.slice(0, 12).map((item) => <div className={`activity ${item.type}`} key={item.id}><i/><div><strong>{item.title}</strong><p>{item.detail}</p></div><time>{new Date(item.at).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</time></div>)}</div></article>;
}

function MoreView({ state, setState, resetLab, exportBackup }: { state: LabState; setState: React.Dispatch<React.SetStateAction<LabState>>; resetLab: () => void; exportBackup: () => void }) {
  const toggleKill = () => setState((current) => ({ ...current, manualKillSwitch: !current.manualKillSwitch, botRunning: current.manualKillSwitch ? current.botRunning : false }));
  return <section className="view"><div className="sectionHead"><div><p className="eyebrow">TRANSPARENCE TECHNIQUE</p><h2>Ce qui fonctionne, ce qui reste verrouillé</h2><p>Aucune fonction future n’est maquillée en fonction active.</p></div></div><div className="capabilities"><Capability ok title="Cotations publiques OKX" text="Prix BTC, ETH et SOL actualisés via le serveur Bahia." status="EN DIRECT"/><Capability ok title="Analyse multifactorielle" text="Tendance, RSI, ATR, volatilité, régime et score de risque." status="ACTIF"/><Capability ok title="Paper trading réaliste" text="Sizing, stops, objectifs, frais, glissement, journal et export CSV." status="ACTIF"/><Capability title="Stockage serveur 24/7" text="Le portefeuille reste local à cet appareil tant que la base durable n’est pas connectée." status="À CONSTRUIRE"/><Capability title="OKX Demo authentifié" text="Le connecteur serveur est prêt, mais les clés Demo ne sont pas configurées sur Vercel." status="VERROUILLÉ"/><Capability title="Trading réel" text="Bloqué jusqu’aux validations sécurité, conformité et période Demo concluante." status="VERROUILLÉ"/></div><div className="grid settingsGrid"><article className="card formCard"><p className="eyebrow">SÉCURITÉ</p><h3>Arrêt d’urgence</h3><p className="neutral">Bloque toutes les nouvelles entrées. Les clôtures restent autorisées pour réduire le risque.</p><button type="button" className={`button wide ${state.manualKillSwitch ? "primary" : "danger"}`} onClick={toggleKill}>{state.manualKillSwitch ? "Réarmer le paper trading" : "Activer l’arrêt d’urgence"}</button><div className="divider"/><h3>Sauvegarde locale</h3><p className="neutral">Exporte une copie lisible de ton portefeuille, tes réglages et ton journal.</p><button type="button" className="button ghost wide" onClick={exportBackup}>Exporter ma sauvegarde JSON</button><button type="button" className="button danger wide" onClick={resetLab}>Réinitialiser le laboratoire</button></article><article className="card formCard"><p className="eyebrow">PASSAGE AU RÉEL</p><h3>La rampe de sécurité</h3><ol className="roadmap"><li className="done"><b>Paper local</b><span>Comprendre l’interface et valider les garde-fous.</span></li><li><b>OKX Demo</b><span>Tester plusieurs semaines avec un worker 24/7.</span></li><li><b>Audit sécurité</b><span>Clés sans retrait, chiffrement, alertes et reprise après incident.</span></li><li><b>Réel limité</b><span>Petit capital, limites strictes et arrêt manuel.</span></li></ol></article></div><article className="card glossary"><div className="cardHead"><div><strong>Mini-dictionnaire</strong><small>Les cinq notions à connaître avant tout bot</small></div></div><div className="glossaryGrid"><Glossary term="Drawdown" text="Baisse maximale depuis un sommet du portefeuille."/><Glossary term="Profit factor" text="Gains bruts divisés par les pertes brutes. Au-dessus de 1 ne suffit pas à conclure."/><Glossary term="Espérance" text="Gain ou perte moyen attendu par trade selon l’historique observé."/><Glossary term="RSI" text="Mesure de momentum entre 0 et 100, pas un ordre d’achat ou de vente."/><Glossary term="Arbitrage" text="Acheter moins cher ailleurs et revendre plus cher, après tous les coûts et délais."/></div></article><div className="legalNote"><strong>Important</strong><p>Bahia est un outil d’apprentissage et d’aide à la décision. Les performances passées, les scores et les backtests ne garantissent aucun rendement futur.</p></div></section>;
}

function Capability({ ok = false, title, text, status }: { ok?: boolean; title: string; text: string; status: string }) {
  return <article className="card capability"><span className={`capIcon ${ok ? "" : "wait"}`}>{ok ? "✓" : "!"}</span><div><strong>{title}</strong><p>{text}</p></div><span className={`badge ${ok ? "good" : "warn"}`}>{status}</span></article>;
}

function Glossary({ term, text }: { term: string; text: string }) {
  return <div><strong>{term}</strong><p>{text}</p></div>;
}

function ScenarioDrawer({ opportunity, market, insight, decision, online, close, execute }: { opportunity: Opportunity; market?: MarketData; insight?: MarketInsight; decision: ReturnType<typeof evaluateTrade> | null; online: boolean; close: () => void; execute: () => void }) {
  return <div className="drawerBackdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) close(); }}><aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="scenario-title"><button type="button" className="drawerClose" onClick={close} aria-label="Fermer">×</button><div className="drawerBrand"><Image src="/bahia-mascot.png" alt="" width={54} height={54}/><div><p className="eyebrow">VÉRIFICATION AVANT ACTION</p><span>{opportunity.executable ? "Ordre 100 % fictif" : "Plan sans ordre"}</span></div></div><h2 id="scenario-title">{opportunity.title}</h2><p>{opportunity.action}</p><div className="scoreExplain"><strong>Score d’éléments {opportunity.score}/100</strong><p>Ce score décrit les conditions observées. Il ne prédit pas le résultat.</p></div><div className="scenario"><span>Environnement <b>PAPER · fictif</b></span><span>Prix observé <b>{market ? `${nf.format(market.price)} USDT` : "Indisponible"}</b></span><span>Régime <b>{insight?.regime ?? "indisponible"}</b></span><span>RSI 14 <b>{insight ? nf.format(insight.rsi14) : "—"}</b></span><span>Montant autorisé <b>{opportunity.executable ? (decision?.allowed ? `${nf.format(decision.approvedNotional)} USDT` : "Refusé") : "0 USDT"}</b></span><span>Perte planifiée au stop <b className="negative">{decision?.allowed ? `${nf.format(decision.metrics.plannedLossAtStop)} USDT` : "0 USDT"}</b></span><span>Ratio gain / risque <b>{decision?.metrics.rewardRiskRatio ? nf.format(decision.metrics.rewardRiskRatio) : "—"}</b></span><span>Coûts aller-retour <b>{nf.format(opportunity.estimatedCost)} USDT</b></span></div>{decision && <div className={decision.allowed ? "explain" : "warning"}><strong>{decision.allowed ? "Contrôle de risque validé" : "Action refusée"}</strong><p>{decision.explanation}</p></div>}<div className="warning"><strong>Option zéro risque</strong><p>Ne rien faire conserve les liquidités et évite tous les frais. Cette option est toujours correcte.</p></div><div className="drawerActions"><button type="button" className="button ghost" onClick={close}>{opportunity.executable ? "Ne rien faire" : "Fermer"}</button><button type="button" className="button primary" disabled={opportunity.executable ? (!online || !decision?.allowed) : false} onClick={execute}>{opportunity.executable ? "Simuler l’achat" : "Enregistrer ce plan"}</button></div></aside></div>;
}

function buildOpportunities(markets: Partial<Record<Instrument, MarketData>>, insights: Partial<Record<Instrument, MarketInsight>>, state: LabState, equity: number): Opportunity[] {
  const btc = markets["BTC-USDT"];
  const eth = markets["ETH-USDT"];
  const btcInsight = insights["BTC-USDT"];
  const ethInsight = insights["ETH-USDT"];
  if (!btc || !eth) return [];
  const cashRatio = equity > 0 ? state.cash / equity : 0;
  const btcValue = state.positions.filter((position) => position.instrument === "BTC-USDT").reduce((sum, position) => sum + position.quantity * btc.price, 0);
  const btcWeight = equity > 0 ? btcValue / equity : 0;
  const dcaAllowed = cashRatio >= 0.55 && (btcInsight?.rsi14 ?? 50) < 70 && !state.manualKillSwitch;
  const rebalanceAllowed = btcWeight < 0.08 && cashRatio > 0.5 && !state.manualKillSwitch;
  const trendAllowed = btcInsight?.trend === "haussière" && btcInsight.rsi14 >= 50 && btcInsight.rsi14 <= 70 && btcInsight.riskScore < 72 && !state.manualKillSwitch;
  const gridAllowed = ethInsight?.regime === "range" && ethInsight.riskScore < 68 && !state.manualKillSwitch;
  const baseLoss = Math.max(0.05, equity * getRiskProfile(state.profile).riskPerTradePct);
  return [
    {
      id: "observe-btc", kind: "observe", instrument: "BTC-USDT", title: "Attendre avec un plan", action: "Surveiller BTC sans engager de capital tant que les éléments restent contradictoires.", reason: btcInsight?.explanation ?? "L’historique est encore en cours de calcul.", quality: "Bonne", score: 88, conditions: ["Aucun frais", "Capital préservé", "Alerte réévaluée chaque minute"], estimatedCost: 0, maxLoss: 0, expiryMinutes: 60, refused: false, stopPct: 2, targetPct: 4, executable: false,
    },
    {
      id: "dca-btc", kind: "dca", instrument: "BTC-USDT", title: "Fractionner une petite entrée", action: "Simuler une première tranche limitée au lieu d’investir les 100 USDT d’un coup.", reason: dcaAllowed ? "La réserve est suffisante et le RSI n’indique pas de surchauffe extrême." : "Bahia protège la réserve ou attend que le momentum se normalise.", quality: dcaAllowed ? "Bonne" : "Faible", score: dcaAllowed ? 76 : 39, conditions: [`Réserve ${nf.format(cashRatio * 100)} %`, `RSI ${nf.format(btcInsight?.rsi14 ?? 0)}`, "Taille calculée par le stop"], estimatedCost: 0.03, maxLoss: baseLoss, expiryMinutes: 30, refused: !dcaAllowed, refusalReason: state.manualKillSwitch ? "L’arrêt d’urgence est actif." : "Réserve insuffisante ou marché trop tendu pour cette entrée.", stopPct: 2, targetPct: 4, executable: true,
    },
    {
      id: "rebalance-btc", kind: "rebalance", instrument: "BTC-USDT", title: "Rapprocher BTC de la cible", action: "Simuler un ajustement vers une cible prudente de 10 % du portefeuille.", reason: `BTC représente ${nf.format(btcWeight * 100)} % du portefeuille fictif contre une cible pédagogique de 10 %.`, quality: rebalanceAllowed ? "Moyenne" : "Faible", score: rebalanceAllowed ? 68 : 34, conditions: [`Écart cible ${nf.format(Math.max(0, 10 - btcWeight * 100))} pts`, "Réserve > 50 %", "Aucun levier"], estimatedCost: 0.03, maxLoss: baseLoss, expiryMinutes: 60, refused: !rebalanceAllowed, refusalReason: state.manualKillSwitch ? "L’arrêt d’urgence est actif." : "L’allocation est déjà proche de la cible ou la réserve est trop faible.", stopPct: 2.5, targetPct: 4.5, executable: true,
    },
    {
      id: "grid-eth", kind: "grid", instrument: "ETH-USDT", title: "Tester un marché en range", action: "Simuler une entrée de grille uniquement si ETH reste dans une zone latérale mesurable.", reason: ethInsight?.explanation ?? "Le régime ETH n’est pas encore calculé.", quality: gridAllowed ? "Moyenne" : "Faible", score: gridAllowed ? 64 : 28, conditions: [`Régime ${ethInsight?.regime ?? "inconnu"}`, `ATR ${nf.format(ethInsight?.atr14Pct ?? 0)} %`, "Coûts inclus"], estimatedCost: 0.04, maxLoss: baseLoss, expiryMinutes: 15, refused: !gridAllowed, refusalReason: "Une grille est refusée hors range ou lorsque la volatilité est trop élevée.", stopPct: 2.2, targetPct: 3.8, executable: true,
    },
    {
      id: "trend-btc", kind: "trend", instrument: "BTC-USDT", title: "Suivre une tendance confirmée", action: "Entrer seulement si tendance, momentum et risque convergent.", reason: btcInsight?.explanation ?? "Les indicateurs sont encore en cours de calcul.", quality: trendAllowed ? "Bonne" : "Faible", score: trendAllowed ? 81 : 31, conditions: [`Tendance ${btcInsight?.trend ?? "inconnue"}`, `Risque ${btcInsight?.riskScore ?? "—"}/100`, `RSI ${nf.format(btcInsight?.rsi14 ?? 0)}`], estimatedCost: 0.03, maxLoss: baseLoss, expiryMinutes: 10, refused: !trendAllowed, refusalReason: "Les trois confirmations nécessaires ne sont pas réunies.", stopPct: 2, targetPct: 4, executable: true,
    },
    {
      id: "arbitrage-watch", kind: "arbitrage", instrument: "BTC-USDT", title: "Arbitrage interplateformes", action: "Comparer deux carnets et n’agir que si l’écart net dépasse tous les coûts.", reason: "Un écart affiché n’est pas un profit : frais, spread, transferts, latence et rééquilibrage doivent être déduits.", quality: "Faible", score: 12, conditions: ["Deux plateformes requises", "Capital prépositionné requis", "Latence mesurée requise"], estimatedCost: 0.25, maxLoss: 0.5, expiryMinutes: 1, refused: true, refusalReason: "Aucun second exchange ni capital prépositionné ne sont connectés. Le scanner reste donc honnêtement verrouillé.", stopPct: 1, targetPct: 2, executable: false,
    },
  ];
}

function strategyLabel(strategy: Strategy) {
  return ({ observe: "Observation", dca: "DCA adaptatif", rebalance: "Rééquilibrage", grid: "Grid prudent", trend: "Tendance" } as Record<Strategy, string>)[strategy];
}

function strategyExplanation(strategy: Strategy) {
  return ({
    observe: "Bahia analyse les marchés et t’explique pourquoi agir ou attendre, sans ouvrir de position.",
    dca: "Bahia fractionne les entrées pour éviter de dépendre d’un seul prix, tout en protégeant une réserve.",
    rebalance: "Bahia compare l’allocation réelle à une cible et ne propose que les ajustements suffisamment importants.",
    grid: "Bahia cherche un marché latéral et refuse la grille lorsque le mouvement devient trop directionnel ou volatil.",
    trend: "Bahia exige que tendance, momentum et budget de risque soient alignés avant de proposer une entrée.",
  } as Record<Strategy, string>)[strategy];
}

function kindLabel(kind: Opportunity["kind"]) {
  return kind === "arbitrage" ? "Arbitrage" : strategyLabel(kind);
}

function formatDuration(minutes: number | null) {
  if (minutes === null || !Number.isFinite(minutes)) return "—";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  if (minutes < 1440) return `${nf.format(minutes / 60)} h`;
  return `${nf.format(minutes / 1440)} j`;
}

function downloadFile(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function simpleBacktest(strategy: Exclude<Strategy, "observe">, instrument: Instrument): Promise<BacktestResult> {
  const response = await fetch(`/api/candles?instrument=${instrument}&bar=1H&limit=300`, { cache: "no-store" });
  if (!response.ok) throw new Error("candles unavailable");
  const data = await response.json() as { candles: Array<{ close: number }> };
  const closes = data.candles.map((candle) => candle.close).filter((value) => Number.isFinite(value) && value > 0);
  if (closes.length < 60) throw new Error("not enough candles");
  let cash = 100;
  let quantity = 0;
  let entryValue = 0;
  let trades = 0;
  let wins = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  let peak = 100;
  let maxDrawdown = 0;
  const outcomes: number[] = [];
  const enter = (price: number, fraction = 1) => {
    const budget = cash * fraction;
    if (budget < 1) return;
    const fee = budget * 0.001;
    const bought = (budget - fee) / (price * 1.0005);
    quantity += bought;
    entryValue += budget;
    cash -= budget;
  };
  const exit = (price: number) => {
    if (!quantity) return;
    const proceeds = quantity * (price * 0.9995) * 0.999;
    const pnl = proceeds - entryValue;
    cash += proceeds;
    quantity = 0;
    entryValue = 0;
    trades += 1;
    outcomes.push(pnl);
    if (pnl > 0) { wins += 1; grossProfit += pnl; } else { grossLoss += Math.abs(pnl); }
  };
  for (let index = 50; index < closes.length; index += 1) {
    const price = closes[index];
    const fast = closes.slice(index - 8, index).reduce((sum, value) => sum + value, 0) / 8;
    const slow = closes.slice(index - 36, index).reduce((sum, value) => sum + value, 0) / 36;
    const deviation = (price - slow) / slow;
    if (strategy === "dca" && index % 24 === 0 && cash >= 5) enter(price, 0.2);
    if (strategy === "trend" && fast > slow * 1.003 && !quantity) enter(price);
    if (strategy === "trend" && fast < slow * 0.998 && quantity) exit(price);
    if (strategy === "grid" && deviation < -0.012 && !quantity) enter(price);
    if (strategy === "grid" && deviation > 0.008 && quantity) exit(price);
    if (strategy === "rebalance" && deviation < -0.015 && !quantity) enter(price, 0.25);
    if (strategy === "rebalance" && deviation > 0.012 && quantity) exit(price);
    const current = cash + quantity * price;
    peak = Math.max(peak, current);
    maxDrawdown = Math.max(maxDrawdown, peak > 0 ? (peak - current) / peak * 100 : 0);
  }
  if (quantity) exit(closes.at(-1) as number);
  const finalEquity = cash;
  return {
    trades,
    wins,
    returnPct: (finalEquity / 100 - 1) * 100,
    maxDrawdownPct: maxDrawdown,
    holdReturnPct: (closes.at(-1) as number) / closes[0] * 100 - 100,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
    expectancy: outcomes.length ? outcomes.reduce((sum, value) => sum + value, 0) / outcomes.length : 0,
    finalEquity,
  };
}
