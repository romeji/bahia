"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { evaluateTrade, getRiskProfile, type RiskProfileId } from "@/src/core";

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
  change24h: number;
  timestamp: number;
  source: string;
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
}

interface Opportunity {
  id: string;
  kind: Strategy | "arbitrage";
  instrument: Instrument;
  title: string;
  action: string;
  reason: string;
  quality: "Faible" | "Moyenne" | "Bonne";
  estimatedCost: number;
  maxLoss: number;
  expiryMinutes: number;
  refused: boolean;
  refusalReason?: string;
  stopPct: number;
  targetPct: number;
}

const STORAGE_KEY = "bahia-lab-v2";
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
  today: { title: "Bonjour Jérôme", subtitle: "Où tu en es, ton risque et la prochaine action à examiner." },
  opportunities: { title: "Opportunités", subtitle: "Des scénarios expliqués, coûts et refus compris." },
  automations: { title: "Automatisations", subtitle: "Configure un comportement, jamais une promesse de rendement." },
  portfolio: { title: "Portefeuille", subtitle: "Réserve, positions et exposition en temps réel." },
  results: { title: "Résultats", subtitle: "Performance nette, frais et historique auditable." },
  more: { title: "Réglages", subtitle: "Connexions, sécurité et état réel des capacités." },
};

const nf = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nowDay = () => new Date().toISOString().slice(0, 10);
const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

function initialState(): LabState {
  return {
    cash: 100,
    startingEquity: 100,
    dayStartEquity: 100,
    dayKey: nowDay(),
    peakEquity: 100,
    positions: [],
    trades: [],
    activities: [{ id: uid(), at: new Date().toISOString(), title: "Laboratoire prêt", detail: "100 USDT fictifs. Spot uniquement, sans levier.", type: "info" }],
    equityCurve: [100],
    profile: "safe",
    strategy: "observe",
    botRunning: false,
    manualKillSwitch: false,
    beginner: true,
  };
}

function readState(): LabState {
  if (typeof window === "undefined") return initialState();
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<LabState> | null;
    if (!parsed) return initialState();
    return { ...initialState(), ...parsed, positions: parsed.positions ?? [], trades: parsed.trades ?? [], activities: parsed.activities ?? [], equityCurve: parsed.equityCurve ?? [100] };
  } catch { return initialState(); }
}

function marketName(instrument: Instrument) { return instrument.replace("-", " / "); }
function assetSymbol(instrument: Instrument) { return instrument.split("-")[0]; }
function assetClass(instrument: Instrument) { return instrument.startsWith("ETH") ? "eth" : instrument.startsWith("SOL") ? "sol" : ""; }
function assetGlyph(instrument: Instrument) { return instrument.startsWith("BTC") ? "₿" : instrument.startsWith("ETH") ? "Ξ" : "S"; }

export function TradingApp() {
  const [view, setView] = useState<ViewId>("today");
  const [state, setState] = useState<LabState>(initialState);
  const [markets, setMarkets] = useState<Partial<Record<Instrument, MarketData>>>({});
  const [marketError, setMarketError] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [online, setOnline] = useState(true);
  const [filter, setFilter] = useState<"all" | Strategy | "arbitrage">("all");
  const [selected, setSelected] = useState<Opportunity | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [btResult, setBtResult] = useState<BacktestResult | null>(null);
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

  useEffect(() => { if (hydrated) localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }, [state, hydrated]);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2800);
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
    } catch { setMarketError(true); }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const initialFetch = window.setTimeout(() => void fetchMarkets(), 0);
    const timer = setInterval(() => void fetchMarkets(), 8_000);
    return () => {
      window.clearTimeout(initialFetch);
      clearInterval(timer);
    };
  }, [fetchMarkets, hydrated]);

  const equity = useMemo(() => state.cash + state.positions.reduce((sum, position) => sum + position.quantity * (markets[position.instrument]?.price ?? position.entryPrice), 0), [state.cash, state.positions, markets]);
  const unrealized = useMemo(() => state.positions.reduce((sum, position) => sum + position.quantity * ((markets[position.instrument]?.price ?? position.entryPrice) - position.entryPrice), 0), [state.positions, markets]);
  const realized = useMemo(() => state.trades.reduce((sum, trade) => sum + trade.pnl, 0), [state.trades]);
  const totalFees = useMemo(() => state.trades.reduce((sum, trade) => sum + trade.entryFee + trade.exitFee, 0) + state.positions.reduce((sum, position) => sum + position.entryFee, 0), [state.trades, state.positions]);
  const exposure = Math.max(0, equity - state.cash);
  const exposurePct = equity > 0 ? (exposure / equity) * 100 : 0;
  const pnlPct = ((equity / state.startingEquity) - 1) * 100;
  const wins = state.trades.filter((trade) => trade.pnl > 0);
  const winRate = state.trades.length ? (wins.length / state.trades.length) * 100 : null;
  const drawdown = state.peakEquity > 0 ? Math.max(0, ((state.peakEquity - equity) / state.peakEquity) * 100) : 0;

  useEffect(() => {
    if (!hydrated) return;
    const accountingTimer = window.setTimeout(() => {
      setState((current) => {
        const nextDay = nowDay();
        const resetDay = current.dayKey !== nextDay;
        const nextPeak = Math.max(current.peakEquity, equity);
        const lastCurve = current.equityCurve.at(-1) ?? current.startingEquity;
        const append = Math.abs(lastCurve - equity) >= 0.005;
        if (!resetDay && nextPeak === current.peakEquity && !append) return current;
        return { ...current, dayKey: nextDay, dayStartEquity: resetDay ? equity : current.dayStartEquity, peakEquity: nextPeak, equityCurve: append ? [...current.equityCurve.slice(-119), equity] : current.equityCurve };
      });
    }, 0);
    return () => window.clearTimeout(accountingTimer);
  }, [equity, hydrated]);

  const addActivity = useCallback((title: string, detail: string, type: ActivityItem["type"] = "info") => {
    setState((current) => ({ ...current, activities: [{ id: uid(), at: new Date().toISOString(), title, detail, type }, ...current.activities].slice(0, 100) }));
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
        activities: [{ id: uid(), at: trade.closedAt, title: `${assetSymbol(position.instrument)} vendu`, detail: `${reason} · P&L net ${pnl >= 0 ? "+" : ""}${nf.format(pnl)} USDT`, type: "trade" as const }, ...current.activities].slice(0, 100),
      };
    });
    showToast("Position fictive clôturée");
  }, [markets, showToast]);

  useEffect(() => {
    if (!hydrated || !Object.keys(markets).length) return;
    state.positions.forEach((position) => {
      const price = markets[position.instrument]?.price;
      if (!price) return;
      if (price <= position.stopPrice) closePosition(position.id, "Stop loss déclenché");
      else if (price >= position.takeProfitPrice) closePosition(position.id, "Take profit atteint");
    });
  }, [markets, hydrated, state.positions, closePosition]);

  const opportunities = useMemo(() => buildOpportunities(markets, state, equity), [markets, state, equity]);
  const visibleOpportunities = filter === "all" ? opportunities : opportunities.filter((item) => item.kind === filter);

  const decisionFor = useCallback((opportunity: Opportunity) => {
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
      positions: state.positions.map((position) => ({ symbol: position.instrument, direction: "long" as const, notional: position.quantity * (markets[position.instrument]?.price ?? position.entryPrice) })),
      manualKillSwitch: state.manualKillSwitch,
    }, state.profile);
  }, [markets, state, equity]);

  const executePaper = useCallback((opportunity: Opportunity) => {
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
      id: uid(), instrument: opportunity.instrument, quantity, entryPrice: execution, notional,
      stopPrice: market.price * (1 - opportunity.stopPct / 100), takeProfitPrice: market.price * (1 + opportunity.targetPct / 100),
      openedAt: new Date().toISOString(), entryFee: fee, reason: opportunity.reason,
    };
    setState((current) => ({
      ...current,
      cash: current.cash - notional,
      positions: [...current.positions, position],
      activities: [{ id: uid(), at: position.openedAt, title: `${assetSymbol(position.instrument)} acheté en paper`, detail: `${nf.format(notional)} USDT · perte planifiée ${nf.format(decision.metrics.plannedLossAtStop)} USDT`, type: "trade" as const }, ...current.activities].slice(0, 100),
    }));
    setSelected(null);
    showToast("Ordre fictif exécuté — aucun argent réel");
  }, [markets, decisionFor, state.cash, showToast]);

  const resetLab = () => {
    if (!window.confirm("Effacer toutes les positions et l’historique fictifs de ce navigateur ?")) return;
    setState(initialState());
    setBtResult(null);
    showToast("Laboratoire réinitialisé");
  };

  const toggleBeginner = () => setState((current) => ({ ...current, beginner: !current.beginner }));
  const setCurrentView = (next: ViewId) => { setView(next); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const topOpportunity = opportunities.find((item) => !item.refused);

  const runBacktest = async () => {
    setBtLoading(true);
    try {
      const result = await simpleBacktest(state.strategy === "grid" ? "grid" : "trend");
      setBtResult(result);
      addActivity("Backtest terminé", `${result.trades} trades · résultat ${result.returnPct >= 0 ? "+" : ""}${nf.format(result.returnPct)} %`, "info");
    } catch { showToast("Impossible de charger l’historique OKX"); }
    finally { setBtLoading(false); }
  };

  if (!hydrated) return <div className="app"><main className="main"><div className="card empty"><strong>Bahia se prépare…</strong></div></main></div>;

  return (
    <div className={`app ${state.beginner ? "beginner" : "advanced"}`}>
      {!online && <div className="offline">Hors ligne — données en lecture seulement, aucune action autorisée.</div>}
      <Sidebar view={view} setView={setCurrentView} beginner={state.beginner} toggleBeginner={toggleBeginner} />
      <main className="main">
        <header className="topbar">
          <div><p className="eyebrow">{new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}</p><h1>{VIEW_COPY[view].title} {view === "today" && <span className="positive">✦</span>}</h1><p>{VIEW_COPY[view].subtitle}</p></div>
          <div className="topActions">
            <div className="feedStatus"><span className="dot" /><span><small>DONNÉES</small><strong>{marketError ? "OKX indisponible" : Object.keys(markets).length ? "OKX public · live" : "Connexion…"}</strong></span></div>
            <button className="button ghost" onClick={() => setCurrentView("more")}>Aide</button>
            <button className="button primary" disabled={!topOpportunity} onClick={() => topOpportunity && setSelected(topOpportunity)}>Examiner une action</button>
          </div>
        </header>

        {view === "today" && <TodayView state={state} equity={equity} pnlPct={pnlPct} exposurePct={exposurePct} drawdown={drawdown} realized={realized} unrealized={unrealized} winRate={winRate} markets={markets} opportunities={opportunities} setView={setCurrentView} />}
        {view === "opportunities" && <OpportunitiesView opportunities={visibleOpportunities} filter={filter} setFilter={setFilter} setSelected={setSelected} beginner={state.beginner} />}
        {view === "automations" && <AutomationsView state={state} setState={setState} runBacktest={runBacktest} btLoading={btLoading} btResult={btResult} showToast={showToast} />}
        {view === "portfolio" && <PortfolioView state={state} equity={equity} exposurePct={exposurePct} markets={markets} closePosition={closePosition} />}
        {view === "results" && <ResultsView state={state} equity={equity} realized={realized} unrealized={unrealized} totalFees={totalFees} drawdown={drawdown} winRate={winRate} />}
        {view === "more" && <MoreView state={state} setState={setState} resetLab={resetLab} />}
      </main>
      <MobileNav view={view} setView={setCurrentView} />
      {selected && <ScenarioDrawer opportunity={selected} market={markets[selected.instrument]} decision={decisionFor(selected)} online={online} close={() => setSelected(null)} execute={() => executePaper(selected)} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

function Sidebar({ view, setView, beginner, toggleBeginner }: { view: ViewId; setView: (view: ViewId) => void; beginner: boolean; toggleBeginner: () => void }) {
  return <aside className="sidebar"><div className="brand"><span className="brandMark">B</span><span><strong>BAHIA</strong><small>TRADING LAB</small></span></div><nav className="nav" aria-label="Navigation principale">{NAV.map((item) => <button key={item.id} className={`navButton ${view === item.id ? "active" : ""}`} onClick={() => setView(item.id)}><span className="navIcon">{item.icon}</span>{item.label}</button>)}</nav><div className="sidebarBottom"><div className="environmentCard"><span className="dot" /><span><small>ENVIRONNEMENT</small><strong>PAPER TRADING</strong><em>Argent 100 % fictif</em></span></div><div className="beginnerControl"><span><strong>Mode débutant</strong><small>Explications guidées</small></span><button className={`switch ${beginner ? "on" : ""}`} aria-label="Activer le mode débutant" aria-pressed={beginner} onClick={toggleBeginner} /></div></div></aside>;
}

function MobileNav({ view, setView }: { view: ViewId; setView: (view: ViewId) => void }) {
  const items = NAV.filter((item) => item.id !== "results");
  return <nav className="mobileNav" aria-label="Navigation mobile">{items.map((item) => <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => setView(item.id)}><span>{item.icon}</span><small>{item.label}</small></button>)}</nav>;
}

interface TodayProps { state: LabState; equity: number; pnlPct: number; exposurePct: number; drawdown: number; realized: number; unrealized: number; winRate: number | null; markets: Partial<Record<Instrument, MarketData>>; opportunities: Opportunity[]; setView: (view: ViewId) => void; }
function TodayView({ state, equity, pnlPct, exposurePct, drawdown, realized, unrealized, winRate, markets, opportunities, setView }: TodayProps) {
  const top = opportunities.find((item) => !item.refused);
  const curve = [...state.equityCurve, equity].slice(-60);
  return <section className="view">
    {state.beginner && <div className="beginnerGuide"><span>1</span><div><strong>Ton laboratoire en une phrase</strong><p>Tu disposes de {nf.format(equity)} USDT fictifs. Ton risque utilisé est de {nf.format(exposurePct)} % et Bahia {top ? "a trouvé un scénario à examiner" : "attend une situation plus nette"}.</p></div><button onClick={() => setView("opportunities")}>Voir les opportunités →</button></div>}
    <div className="grid metrics"><Metric label="Capital fictif" value={nf.format(equity)} unit="USDT" foot={`${pnlPct >= 0 ? "+" : ""}${nf.format(pnlPct)} % depuis le départ`} tone={pnlPct >= 0 ? "positive" : "negative"}/><Metric label="Risque utilisé" value={nf.format(exposurePct)} unit="%" foot={`${nf.format(state.cash)} USDT en réserve`}/><Metric label="Résultat total" value={`${realized + unrealized >= 0 ? "+" : ""}${nf.format(realized + unrealized)}`} unit="USDT" foot="Réalisé + non réalisé" tone={realized + unrealized >= 0 ? "positive" : "negative"}/>{!state.beginner && <><Metric label="Taux de réussite" value={winRate === null ? "—" : nf.format(winRate)} unit={winRate === null ? "" : "%"} foot={`${state.trades.length} trades clôturés`}/><Metric label="Drawdown max" value={nf.format(drawdown)} unit="%" foot="Depuis le dernier sommet" tone={drawdown > 3 ? "negative" : "neutral"}/></>}</div>
    <div className="grid contentGrid"><article className="card"><div className="cardHead"><div><strong>Performance du portefeuille</strong><small>Frais et glissement inclus</small></div><span className="badge">SESSION</span></div><EquityChart values={curve}/><div className="chartLabels"><span>Début</span><span>Valeur actuelle : {nf.format(equity)} USDT</span></div></article><article className="card"><div className="cardHead"><div><strong>Marchés suivis</strong><small>Prix publics OKX</small></div><button className="textButton" onClick={() => setView("opportunities")}>Tout voir →</button></div><MarketList markets={markets}/></article></div>
    <div className="grid lowerGrid"><article className="card"><div className="cardHead"><div><strong>✦ Coach débutant</strong><small>Lecture simple et prudente</small></div><span className="score">{state.manualKillSwitch ? 45 : state.positions.length ? 82 : 94}</span></div><div className="cardBody"><div className="coachItem"><i>•</i><span>{top ? top.reason : "Aucun signal ne justifie encore les coûts et le risque."}</span></div><div className="coachItem"><i>•</i><span>{state.cash / equity >= .5 ? "Ta réserve USDT reste confortable." : "Ta réserve USDT est sous 50 % : évite d’augmenter l’exposition."}</span></div><div className="coachItem"><i>•</i><span>Ne rien faire reste une décision valide.</span></div></div></article><article className="card"><div className="cardHead"><div><strong>Analyse automatique</strong><small>Surveille et propose, sans ordre réel</small></div><span className={`badge ${state.botRunning ? "good" : ""}`}>{state.botRunning ? "ACTIVE" : "ARRÊTÉE"}</span></div><div className="cardBody"><div className="summaryList"><span>Stratégie<b>{strategyLabel(state.strategy)}</b></span><span>Profil<b>{getRiskProfile(state.profile).label}</b></span><span>Positions<b>{state.positions.length}</b></span></div><button className="button primary wide" onClick={() => setView("automations")}>{state.botRunning ? "Gérer l’automatisation" : "Configurer l’analyse"}</button></div></article><article className="card"><div className="cardHead"><div><strong>Protections</strong><small>Appliquées avant toute action</small></div><span>🛡</span></div><div className="cardBody"><ul className="guardrails"><li>Spot uniquement</li><li>Levier désactivé</li><li>Stop obligatoire</li><li>Sortie autorisée pendant l’arrêt</li></ul></div></article></div>
  </section>;
}

function Metric({ label, value, unit, foot, tone = "" }: { label: string; value: string; unit?: string; foot: string; tone?: string }) { return <article className="card metric"><span className="metricLabel">{label.toUpperCase()}</span><strong className={`metricValue ${tone}`}>{value} {unit && <small>{unit}</small>}</strong><span className="metricFoot">{foot}</span></article>; }

function EquityChart({ values }: { values: number[] }) {
  const min = Math.min(...values), max = Math.max(...values), range = max - min || 1;
  const points = values.map((value, index) => `${(index / Math.max(1, values.length - 1)) * 100},${92 - ((value - min) / range) * 76}`).join(" ");
  const area = `0,100 ${points} 100,100`;
  return <div className="chartWrap"><svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={`Courbe du portefeuille de ${nf.format(values[0])} à ${nf.format(values.at(-1) ?? values[0])} USDT`}><defs><linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#7656f6" stopOpacity=".28"/><stop offset="1" stopColor="#7656f6" stopOpacity="0"/></linearGradient></defs>{[25,50,75].map((y) => <line key={y} x1="0" x2="100" y1={y} y2={y} className="chartGrid"/>)}<polygon points={area} className="chartArea"/><polyline points={points} className="chartLine"/><circle cx="100" cy={92 - (((values.at(-1) ?? min) - min) / range) * 76} r="1.7" className="chartPoint"/></svg></div>;
}

function MarketList({ markets }: { markets: Partial<Record<Instrument, MarketData>> }) { return <div className="marketList">{INSTRUMENTS.map((instrument) => { const market = markets[instrument]; return <div className="marketRow" key={instrument}><div className="asset"><span className={`assetIcon ${assetClass(instrument)}`}>{assetGlyph(instrument)}</span><span><strong>{assetSymbol(instrument)}</strong><small>{marketName(instrument)}</small></span></div><span className="marketPrice"><strong>{market ? nf.format(market.price) : "—"}</strong><small>USDT</small></span><span className={`marketMove ${(market?.change24h ?? 0) >= 0 ? "positive" : "negative"}`}>{market ? `${market.change24h >= 0 ? "+" : ""}${nf.format(market.change24h)} %` : "—"}</span></div>; })}</div>; }

function OpportunitiesView({ opportunities, filter, setFilter, setSelected, beginner }: { opportunities: Opportunity[]; filter: string; setFilter: (filter: "all" | Strategy | "arbitrage") => void; setSelected: (item: Opportunity) => void; beginner: boolean }) {
  const filters: Array<["all" | Strategy | "arbitrage", string]> = beginner ? [["all","Tout"],["observe","Observer"],["dca","Investir progressivement"],["rebalance","Rééquilibrer"]] : [["all","Tout"],["dca","DCA"],["rebalance","Rééquilibrage"],["grid","Grid"],["trend","Tendance"],["arbitrage","Arbitrage"]];
  return <section className="view"><div className="sectionHead"><div><p className="eyebrow">MOTEUR D’OPPORTUNITÉS</p><h2>Agir seulement si l’avantage couvre le risque</h2><p>Chaque scénario est comparé aux coûts et à l’option « ne rien faire ».</p></div><span className="statusPill"><span className="dot"/>Analyse active</span></div><div className="opportunityFilters">{filters.map(([id,label]) => <button key={id} className={`chip ${filter === id ? "active" : ""}`} onClick={() => setFilter(id)}>{label}</button>)}</div><div className="grid opportunityGrid">{opportunities.map((item) => <OpportunityCard key={item.id} item={item} open={() => setSelected(item)}/>)}</div></section>;
}

function OpportunityCard({ item, open }: { item: Opportunity; open: () => void }) { return <article className={`card opportunityCard ${item.refused ? "refused" : ""}`}><div className="opportunityTop"><span className="opportunityKind">{kindLabel(item.kind).toUpperCase()} · {assetSymbol(item.instrument)}</span><span className="quality">Éléments {item.quality.toLowerCase()}</span></div><h3>{item.title}</h3><p>{item.action}</p><div className="reasonBox"><strong>Pourquoi ? </strong>{item.reason}</div><div className="opportunityFacts"><span>Perte maximale planifiée <b>{nf.format(item.maxLoss)} USDT</b></span><span>Coûts estimés <b>{nf.format(item.estimatedCost)} USDT</b></span><span>Validité <b>{item.expiryMinutes} min</b></span></div>{item.refused && <div className="warning"><strong>Bahia refuse l’action</strong><br/>{item.refusalReason}</div>}<div className="opportunityActions"><button className="button ghost small">Ne rien faire</button><button className="button primary small" disabled={item.refused} onClick={open}>Voir le scénario</button></div></article>; }

function AutomationsView({ state, setState, runBacktest, btLoading, btResult, showToast }: { state: LabState; setState: React.Dispatch<React.SetStateAction<LabState>>; runBacktest: () => void; btLoading: boolean; btResult: BacktestResult | null; showToast: (message: string) => void }) {
  const profile = getRiskProfile(state.profile);
  const strategies: Array<[Strategy,string,string]> = [["observe","Observer","Aucun ordre, seulement des alertes."],["dca","Investir progressivement","Petits achats espacés dans le temps."],["rebalance","Rééquilibrer","Remettre les actifs dans leurs proportions."],["grid","Grid prudent","Acheter/vendre dans une plage latérale."],["trend","Tendance","Suivre un mouvement déjà confirmé."]];
  const visible = state.beginner ? strategies.slice(0,3) : strategies;
  return <section className="view"><div className="sectionHead"><div><p className="eyebrow">CONFIGURATION GUIDÉE</p><h2>Une automatisation, trois choix clairs</h2><p>En mode débutant, Bahia analyse et demande ta validation avant toute simulation.</p></div><span className="statusPill">PAPER UNIQUEMENT</span></div><div className="grid automationLayout"><article className="card formCard"><div className="step"><span>1</span><div><strong>Choisis ton intention</strong><small>Elle détermine les outils proposés.</small></div></div><div className="optionGrid">{visible.map(([id,label,description]) => <button key={id} className={`option ${state.strategy === id ? "active" : ""}`} onClick={() => setState((current) => ({ ...current, strategy: id }))}><strong>{label}</strong><small>{description}</small></button>)}</div><div className="step"><span>2</span><div><strong>Choisis ton niveau de prudence</strong><small>Le moteur peut toujours réduire ou refuser un ordre.</small></div></div><div className="optionGrid">{(["safe","balanced","dynamic"] as RiskProfileId[]).map((id) => { const p = getRiskProfile(id); return <button key={id} className={`option ${state.profile === id ? "active" : ""}`} onClick={() => setState((current) => ({ ...current, profile: id }))}><strong>{p.label}</strong><small>{nf.format(p.riskPerTradePct*100)} % / action · {nf.format(p.maxPortfolioExposurePct*100)} % exposé max</small></button>; })}</div><div className="step"><span>3</span><div><strong>Teste avant d’activer</strong><small>Historique OKX, frais et glissement simplifiés.</small></div></div><button className="button ghost wide" onClick={() => void runBacktest()} disabled={btLoading}>{btLoading ? "Backtest en cours…" : "Lancer un backtest rapide"}</button>{btResult && <div className="explain"><strong>Résultat indicatif</strong><br/>{btResult.trades} trades · {btResult.returnPct >= 0 ? "+" : ""}{nf.format(btResult.returnPct)} % · drawdown {nf.format(btResult.maxDrawdownPct)} %. Comparaison buy-and-hold : {btResult.holdReturnPct >= 0 ? "+" : ""}{nf.format(btResult.holdReturnPct)} %.</div>}<button className="button primary wide" onClick={() => { setState((current) => ({ ...current, botRunning: !current.botRunning })); showToast(state.botRunning ? "Analyse automatique arrêtée" : "Analyse automatique démarrée — aucun ordre réel"); }}>{state.botRunning ? "Arrêter l’analyse automatique" : "Démarrer l’analyse automatique"}</button></article><article className="card previewCard"><p className="eyebrow">RÉSUMÉ EN LANGAGE SIMPLE</p><h3>{strategyLabel(state.strategy)} · {profile.label}</h3><p>{state.strategy === "observe" ? "Bahia surveille les marchés et explique les scénarios sans acheter." : "Bahia cherche uniquement les situations compatibles avec ce comportement et tes protections."}</p><div className="riskRows"><span>Perte maximale / action <b>{nf.format(profile.riskPerTradePct*100)} %</b></span><span>Perte quotidienne maximale <b>{nf.format(profile.maxDailyLossPct*100)} %</b></span><span>Exposition totale maximale <b>{nf.format(profile.maxPortfolioExposurePct*100)} %</b></span><span>Levier <b className="positive">Désactivé en V1</b></span></div><div className="warning"><strong>État réel</strong><p>L’analyse continue uniquement lorsque l’application est ouverte. Le worker 24/7 et OKX Demo restent verrouillés tant que le stockage serveur n’est pas connecté.</p></div></article></div></section>;
}

function PortfolioView({ state, equity, exposurePct, markets, closePosition }: { state: LabState; equity: number; exposurePct: number; markets: Partial<Record<Instrument, MarketData>>; closePosition: (id: string, reason: string) => void }) {
  const values = INSTRUMENTS.map((instrument) => state.positions.filter((p) => p.instrument === instrument).reduce((sum,p) => sum + p.quantity*(markets[instrument]?.price ?? p.entryPrice),0));
  const cashPct = equity ? state.cash/equity*100 : 100;
  return <section className="view"><div className="sectionHead"><div><p className="eyebrow">PORTEFEUILLE FICTIF</p><h2>Ta réserve avant tes positions</h2><p>Les prix sont réévalués avec les dernières données reçues.</p></div><span className="statusPill">{nf.format(exposurePct)} % exposé</span></div><div className="grid portfolioGrid"><article className="card"><div className="cardHead"><div><strong>Allocation actuelle</strong><small>{nf.format(equity)} USDT au total</small></div></div><div className="allocation"><div className="allocationBar"><i style={{width:`${equity?values[0]/equity*100:0}%`}}/><i style={{width:`${equity?values[1]/equity*100:0}%`}}/><i style={{width:`${Math.max(0,cashPct)}%`}}/></div><div className="allocationLegend"><span>● BTC {nf.format(equity?values[0]/equity*100:0)} %</span><span>● ETH {nf.format(equity?values[1]/equity*100:0)} %</span><span>● USDT {nf.format(cashPct)} %</span></div></div></article><article className="card"><div className="cardHead"><div><strong>Réserve disponible</strong><small>Non engagée dans une position</small></div></div><div className="cardBody"><strong className="metricValue">{nf.format(state.cash)} <small>USDT</small></strong><p className="neutral">En mode débutant, Bahia cherche à conserver au moins 40 % de réserve.</p></div></article></div><article className="card"><div className="cardHead"><div><strong>Positions ouvertes</strong><small>Stops et objectifs appliqués automatiquement dans cette session</small></div><span className="badge">{state.positions.length}</span></div><div className="positions">{state.positions.length ? state.positions.map((p) => { const price=markets[p.instrument]?.price??p.entryPrice; const pnl=p.quantity*(price-p.entryPrice)-p.entryFee; return <div className="position" key={p.id}><div className="positionHead"><strong>{marketName(p.instrument)}</strong><b className={pnl>=0?"positive":"negative"}>{pnl>=0?"+":""}{nf.format(pnl)} USDT</b></div><div className="positionData"><span>Entrée<b>{nf.format(p.entryPrice)}</b></span><span>Actuel<b>{nf.format(price)}</b></span><span>Stop<b>{nf.format(p.stopPrice)}</b></span><span>Objectif<b>{nf.format(p.takeProfitPrice)}</b></span></div><button className="button ghost wide" onClick={() => closePosition(p.id,"Clôture manuelle")}>Clôturer en paper</button></div>;}) : <div className="empty"><strong>Aucune position</strong>Bahia ne force jamais une entrée.</div>}</div></article></section>;
}

function ResultsView({ state, equity, realized, unrealized, totalFees, drawdown, winRate }: { state: LabState; equity: number; realized: number; unrealized: number; totalFees: number; drawdown: number; winRate: number|null }) {
  const gains=state.trades.filter(t=>t.pnl>0).reduce((s,t)=>s+t.pnl,0), losses=Math.abs(state.trades.filter(t=>t.pnl<0).reduce((s,t)=>s+t.pnl,0));
  return <section className="view"><div className="sectionHead"><div><p className="eyebrow">RÉSULTATS NETS</p><h2>Mesurer avant de conclure</h2><p>Un petit échantillon ne permet jamais de juger une stratégie.</p></div><span className="statusPill">PAPER</span></div><div className="grid metrics"><Metric label="P&L total" value={`${realized+unrealized>=0?"+":""}${nf.format(realized+unrealized)}`} unit="USDT" foot={`Capital ${nf.format(equity)} USDT`} tone={realized+unrealized>=0?"positive":"negative"}/><Metric label="Taux de réussite" value={winRate===null?"—":nf.format(winRate)} unit={winRate===null?"":"%"} foot={`${state.trades.length} trades clôturés`}/><Metric label="Drawdown" value={nf.format(drawdown)} unit="%" foot="Depuis le plus haut" tone={drawdown>3?"negative":"neutral"}/>{!state.beginner&&<><Metric label="Profit factor" value={losses?nf.format(gains/losses):gains?"∞":"—"} foot="Gains bruts / pertes brutes"/><Metric label="Frais simulés" value={nf.format(totalFees)} unit="USDT" foot="Entrées et sorties"/></>}</div><article className="card tableCard"><div className="cardHead"><div><strong>Historique auditable</strong><small>Prix, raison et résultat après frais</small></div></div><div className="tableScroll"><table><thead><tr><th>Date</th><th>Marché</th><th>Entrée</th><th>Sortie</th><th>Raison</th><th>P&L net</th></tr></thead><tbody>{state.trades.length?state.trades.map((t)=><tr key={t.id}><td>{new Date(t.closedAt).toLocaleString("fr-FR")}</td><td>{marketName(t.instrument)}</td><td>{nf.format(t.entryPrice)}</td><td>{nf.format(t.exitPrice)}</td><td>{t.closeReason}</td><td className={t.pnl>=0?"positive":"negative"}>{t.pnl>=0?"+":""}{nf.format(t.pnl)} USDT</td></tr>):<tr><td colSpan={6}><div className="empty"><strong>Aucun trade clôturé</strong>Le rapport se remplira après une simulation complète.</div></td></tr>}</tbody></table></div></article></section>;
}

function MoreView({ state, setState, resetLab }: { state: LabState; setState: React.Dispatch<React.SetStateAction<LabState>>; resetLab: () => void }) {
  const toggleKill=()=>setState((current)=>({...current,manualKillSwitch:!current.manualKillSwitch,botRunning:current.manualKillSwitch?current.botRunning:false}));
  return <section className="view"><div className="sectionHead"><div><p className="eyebrow">TRANSPARENCE TECHNIQUE</p><h2>Ce qui fonctionne vraiment</h2><p>Les capacités incomplètes restent visibles et verrouillées.</p></div></div><div className="settingsGrid grid"><div className="capabilities"><Capability ok title="Données publiques OKX" text="Tickers et historiques BTC, ETH et SOL via le serveur Bahia." status="ACTIF"/><Capability ok title="Paper trading" text="Sizing, stop, objectif, frais, glissement et journal local." status="ACTIF"/><Capability title="Stockage serveur 24/7" text="PostgreSQL et worker durable non encore connectés." status="À CONNECTER"/><Capability title="OKX Demo authentifié" text="Client serveur prêt ; clés Demo et coffre-fort absents." status="VERROUILLÉ"/><Capability title="Trading réel" text="Interdit jusqu’aux validations de risque, sécurité et conformité." status="VERROUILLÉ"/></div><article className="card formCard"><p className="eyebrow">SÉCURITÉ</p><h3>Arrêt d’urgence</h3><p className="neutral">Il empêche toute nouvelle entrée. Les sorties restent permises afin de réduire le risque.</p><button className={`button wide ${state.manualKillSwitch?"primary":"danger"}`} onClick={toggleKill}>{state.manualKillSwitch?"Réarmer le paper trading":"Activer l’arrêt d’urgence"}</button><hr style={{border:0,borderTop:"1px solid var(--line)",margin:"24px 0"}}/><h3>Données locales</h3><p className="neutral">Cette première tranche conserve encore le portefeuille fictif dans ce navigateur.</p><button className="button danger wide" onClick={resetLab}>Réinitialiser le laboratoire</button></article></div></section>;
}

function Capability({ ok=false,title,text,status }: { ok?:boolean;title:string;text:string;status:string }) { return <article className="card capability"><span className={`capIcon ${ok?"":"wait"}`}>{ok?"✓":"!"}</span><div><strong>{title}</strong><p>{text}</p></div><span className={`badge ${ok?"good":"warn"}`}>{status}</span></article>; }

function ScenarioDrawer({ opportunity, market, decision, online, close, execute }: { opportunity: Opportunity; market?: MarketData; decision: ReturnType<typeof evaluateTrade>|null; online:boolean; close:()=>void;execute:()=>void }) {
  return <div className="drawerBackdrop" role="presentation" onMouseDown={(e)=>{if(e.currentTarget===e.target)close();}}><aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="scenario-title"><button className="drawerClose" onClick={close} aria-label="Fermer">×</button><p className="eyebrow">APERÇU AVANT CONFIRMATION</p><h2 id="scenario-title">{opportunity.title}</h2><p>{opportunity.action}</p><div className="explain"><strong>Pourquoi Bahia propose cela ?</strong><br/>{opportunity.reason}</div><div className="scenario"><span>Environnement <b>PAPER · fictif</b></span><span>Prix observé <b>{market?`${nf.format(market.price)} USDT`:"Indisponible"}</b></span><span>Montant autorisé <b>{decision?.allowed?`${nf.format(decision.approvedNotional)} USDT`:"Refusé"}</b></span><span>Perte planifiée au stop <b className="negative">{decision?.allowed?`${nf.format(decision.metrics.plannedLossAtStop)} USDT`:"—"}</b></span><span>Coûts aller-retour estimés <b>{nf.format(opportunity.estimatedCost)} USDT</b></span><span>Levier <b>1× · désactivé</b></span></div>{decision&&<div className={decision.allowed?"explain":"warning"}><strong>{decision.allowed?"Contrôle de risque validé":"Action refusée"}</strong><br/>{decision.explanation}</div>}<div className="warning"><strong>Alternative : ne rien faire</strong><p>Tu conserves ta réserve USDT et évites les frais. Cette option est toujours disponible.</p></div><div className="drawerActions"><button className="button ghost" onClick={close}>Ne rien faire</button><button className="button primary" disabled={!online||!decision?.allowed} onClick={execute}>Confirmer l’ordre fictif</button></div></aside></div>;
}

function buildOpportunities(markets: Partial<Record<Instrument, MarketData>>, state: LabState, equity: number): Opportunity[] {
  const result: Opportunity[]=[];
  const btc=markets["BTC-USDT"], eth=markets["ETH-USDT"];
  const btcValue=state.positions.filter(p=>p.instrument==="BTC-USDT").reduce((s,p)=>s+p.quantity*(btc?.price??p.entryPrice),0);
  const targetValue=equity*.1;
  if(btc) result.push({id:"rebalance-btc",kind:"rebalance",instrument:"BTC-USDT",title:"Rééquilibrer vers Bitcoin",action:`Acheter jusqu’à ${nf.format(Math.max(0,targetValue-btcValue))} USDT pour revenir à une allocation prudente.`,reason:btcValue<targetValue*.7?"Bitcoin est nettement sous sa cible de 10 % du portefeuille.":"L’allocation Bitcoin est déjà proche de sa cible.",quality:btcValue<targetValue*.7?"Bonne":"Faible",estimatedCost:.03,maxLoss:.25,expiryMinutes:30,refused:btcValue>=targetValue*.7,refusalReason:"L’écart d’allocation est trop faible après prise en compte des frais.",stopPct:2,targetPct:4});
  if(eth) result.push({id:"dca-eth",kind:"dca",instrument:"ETH-USDT",title:"Investir progressivement sur Ethereum",action:"Examiner un petit achat fractionné plutôt qu’engager tout le capital.",reason:`ETH évolue de ${eth.change24h>=0?"+":""}${nf.format(eth.change24h)} % sur 24 h. Le DCA réduit le risque de mauvais timing, pas le risque de baisse.`,quality:Math.abs(eth.change24h)<6?"Moyenne":"Faible",estimatedCost:.03,maxLoss:.25,expiryMinutes:60,refused:Math.abs(eth.change24h)>8,refusalReason:"La volatilité quotidienne est trop élevée pour une entrée débutant.",stopPct:2.5,targetPct:4});
  if(btc) result.push({id:"grid-btc",kind:"grid",instrument:"BTC-USDT",title:"Grid spot prudent",action:"Acheter et vendre par petites étapes dans une plage latérale.",reason:Math.abs(btc.change24h)<2.2?"Le mouvement sur 24 h reste contenu, ce qui correspond davantage à un marché en range.":"Le marché semble trop directionnel pour un grid prudent.",quality:Math.abs(btc.change24h)<1.5?"Bonne":"Moyenne",estimatedCost:.08,maxLoss:.4,expiryMinutes:15,refused:state.beginner||Math.abs(btc.change24h)>=2.2,refusalReason:state.beginner?"Le grid est réservé au mode avancé.":"Le prix risque de sortir trop vite de la plage.",stopPct:3,targetPct:4.8});
  if(btc) result.push({id:"trend-btc",kind:"trend",instrument:"BTC-USDT",title:"Suivre une tendance confirmée",action:"Attendre une confirmation supplémentaire avant une entrée spot.",reason:btc.change24h>1.5?"Le mouvement 24 h est positif, mais une seule mesure ne suffit pas à confirmer une tendance.":"Le momentum actuel n’est pas assez net.",quality:btc.change24h>2.5?"Moyenne":"Faible",estimatedCost:.03,maxLoss:.25,expiryMinutes:10,refused:btc.change24h<=1.5,refusalReason:"Bahia attend un signal plus net au lieu de forcer un trade.",stopPct:2,targetPct:4});
  result.push({id:"arbitrage-watch",kind:"arbitrage",instrument:"BTC-USDT",title:"Arbitrage entre plateformes",action:"Surveiller un écart de prix net après tous les coûts.",reason:"Un prix différent ne constitue pas encore un profit : il faut déduire frais, spread, transferts, latence et rééquilibrage.",quality:"Faible",estimatedCost:.25,maxLoss:.5,expiryMinutes:1,refused:true,refusalReason:"Aucun second exchange et aucun capital prépositionné ne sont encore connectés.",stopPct:1,targetPct:2});
  return result;
}

function strategyLabel(strategy: Strategy){return ({observe:"Observation",dca:"DCA adaptatif",rebalance:"Rééquilibrage",grid:"Grid prudent",trend:"Tendance"} as Record<Strategy,string>)[strategy];}
function kindLabel(kind: Opportunity["kind"]){return kind==="arbitrage"?"Arbitrage":strategyLabel(kind);}

interface BacktestResult{trades:number;returnPct:number;maxDrawdownPct:number;holdReturnPct:number;}
async function simpleBacktest(strategy:"trend"|"grid"):Promise<BacktestResult>{
  const response=await fetch("/api/candles?instrument=BTC-USDT&bar=1H&limit=240",{cache:"no-store"});
  if(!response.ok)throw new Error("candles unavailable");
  const data=await response.json() as {candles:Array<{close:number}>};
  const closes=data.candles.map(c=>c.close);let cash=100,qty=0,trades=0,peak=100,maxDd=0;
  for(let i=24;i<closes.length;i++){const price=closes[i],fast=closes.slice(i-6,i).reduce((a,b)=>a+b,0)/6,slow=closes.slice(i-24,i).reduce((a,b)=>a+b,0)/24;const deviation=(price-slow)/slow;const buy=strategy==="trend"?fast>slow*1.002:deviation<-.012;const sell=strategy==="trend"?fast<slow*.998:deviation>.008;if(buy&&!qty){const fee=cash*.001;qty=(cash-fee)/(price*1.0005);cash=0;}else if(sell&&qty){cash=qty*(price*.9995)*.999;qty=0;trades++;}const eq=cash+qty*price;peak=Math.max(peak,eq);maxDd=Math.max(maxDd,(peak-eq)/peak*100);}
  const final=cash+qty*(closes.at(-1)??closes[0])*.999;return{trades,returnPct:(final/100-1)*100,maxDrawdownPct:maxDd,holdReturnPct:(closes.at(-1)!/closes[0]-1)*100};
}
