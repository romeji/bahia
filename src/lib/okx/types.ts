export type OkxInstrumentType =
  | "SPOT"
  | "MARGIN"
  | "SWAP"
  | "FUTURES"
  | "OPTION";

export type OkxRegion = "eea" | "global" | "us" | "tr";

export type OkxHttpMethod = "GET" | "POST";

export interface OkxApiEnvelope<T> {
  code: string;
  msg: string;
  data: T[];
  inTime?: string;
  outTime?: string;
}

export interface OkxInstrument {
  instType: OkxInstrumentType;
  instId: string;
  state: string;
  baseCcy: string;
  quoteCcy: string;
  settleCcy: string;
  tickSz: string;
  lotSz: string;
  minSz: string;
  maxLmtSz: string;
  maxMktSz: string;
  maxLmtAmt?: string;
  maxMktAmt?: string;
  listTime: string;
  expTime: string;
  instFamily: string;
  uly: string;
}

export interface OkxTicker {
  instType: OkxInstrumentType;
  instId: string;
  last: string;
  lastSz: string;
  askPx: string;
  askSz: string;
  bidPx: string;
  bidSz: string;
  open24h: string;
  high24h: string;
  low24h: string;
  volCcy24h: string;
  vol24h: string;
  sodUtc0: string;
  sodUtc8: string;
  ts: string;
}

export interface OkxOrderBookLevel {
  price: string;
  size: string;
  liquidatedOrders: string;
  orderCount: string;
}

export interface OkxOrderBook {
  asks: [string, string, string, string][];
  bids: [string, string, string, string][];
  ts: string;
}

export type OkxCandle = readonly [
  timestamp: string,
  open: string,
  high: string,
  low: string,
  close: string,
  volume: string,
  volumeCurrency: string,
  volumeQuoteCurrency: string,
  confirmed: "0" | "1",
];

export interface OkxServerTime {
  ts: string;
}

export interface OkxAccountBalanceDetail {
  ccy: string;
  availBal: string;
  availEq: string;
  cashBal: string;
  eq: string;
  eqUsd: string;
  frozenBal: string;
  ordFrozen: string;
  uTime: string;
}

export interface OkxAccountBalance {
  adjEq: string;
  availEq: string;
  isoEq: string;
  details: OkxAccountBalanceDetail[];
  totalEq: string;
  uTime: string;
}

export interface OkxAccountConfiguration {
  acctLv: string;
  acctStpMode: string;
  autoLoan: boolean;
  enableSpotBorrow: boolean;
  ip: string;
  label: string;
  liquidationGear: string;
  perm: string;
  posMode: string;
  roleType: string;
  spotBorrowAutoRepay: boolean;
  type: string;
}

export type OkxSpotOrderSide = "buy" | "sell";
export type OkxSpotOrderType = "market" | "limit";
export type OkxTargetCurrency = "base_ccy" | "quote_ccy";

export interface OkxDemoSpotOrderRequest {
  instrumentId: string;
  side: OkxSpotOrderSide;
  orderType: OkxSpotOrderType;
  size: string;
  price?: string;
  targetCurrency?: OkxTargetCurrency;
  clientOrderId?: string;
  tag?: string;
}

export interface OkxOrderAck {
  ordId: string;
  clOrdId: string;
  tag: string;
  sCode: string;
  sMsg: string;
  ts: string;
}

export interface OkxOrder {
  instType: OkxInstrumentType;
  instId: string;
  ordId: string;
  clOrdId: string;
  tag: string;
  px: string;
  sz: string;
  ordType: string;
  side: OkxSpotOrderSide;
  posSide: string;
  tdMode: string;
  accFillSz: string;
  avgPx: string;
  state: string;
  fee: string;
  feeCcy: string;
  cTime: string;
  uTime: string;
}

export interface OkxCancelOrderRequest {
  instrumentId: string;
  orderId?: string;
  clientOrderId?: string;
}

export interface OkxOrderLookup {
  instrumentId: string;
  orderId?: string;
  clientOrderId?: string;
}

export interface OkxTransportResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly statusText?: string;
  text(): Promise<string>;
}

export type OkxTransport = (
  url: string,
  init: RequestInit,
) => Promise<OkxTransportResponse>;
