import {
  defaultOkxTransport,
  executeOkxJsonRequest,
  validateTimeoutMs,
} from "./http";
import type {
  OkxCandle,
  OkxInstrument,
  OkxInstrumentType,
  OkxOrderBook,
  OkxRegion,
  OkxServerTime,
  OkxTicker,
  OkxTransport,
} from "./types";
import {
  normalizeInstrumentId,
  normalizeLimit,
} from "./validation";

const CANDLE_BARS = new Set([
  "1m",
  "3m",
  "5m",
  "15m",
  "30m",
  "1H",
  "2H",
  "4H",
  "6H",
  "12H",
  "1D",
  "2D",
  "3D",
  "1W",
  "1M",
]);

export interface OkxPublicClientOptions {
  region?: OkxRegion;
  transport?: OkxTransport;
  timeoutMs?: number;
}

export class OkxPublicClient {
  readonly #region: OkxRegion;
  readonly #transport: OkxTransport;
  readonly #timeoutMs: number;

  constructor(options: OkxPublicClientOptions = {}) {
    this.#region = options.region ?? "eea";
    this.#transport = options.transport ?? defaultOkxTransport;
    this.#timeoutMs = validateTimeoutMs(options.timeoutMs);
  }

  getServerTime(): Promise<OkxServerTime[]> {
    return this.#get("/api/v5/public/time");
  }

  getInstruments(
    instrumentType: OkxInstrumentType,
    instrumentId?: string,
  ): Promise<OkxInstrument[]> {
    const query = new URLSearchParams({ instType: instrumentType });
    if (instrumentId) {
      query.set("instId", normalizeInstrumentId(instrumentId, instrumentType));
    }
    return this.#get("/api/v5/public/instruments", query);
  }

  getTicker(instrumentId: string): Promise<OkxTicker[]> {
    const query = new URLSearchParams({
      instId: normalizeInstrumentId(instrumentId),
    });
    return this.#get("/api/v5/market/ticker", query);
  }

  getTickers(instrumentType: OkxInstrumentType): Promise<OkxTicker[]> {
    const query = new URLSearchParams({ instType: instrumentType });
    return this.#get("/api/v5/market/tickers", query);
  }

  getOrderBook(instrumentId: string, depth?: number): Promise<OkxOrderBook[]> {
    const query = new URLSearchParams({
      instId: normalizeInstrumentId(instrumentId),
      sz: String(
        normalizeLimit(depth, { min: 1, max: 400, fallback: 20 }),
      ),
    });
    return this.#get("/api/v5/market/books", query);
  }

  getCandles(
    instrumentId: string,
    options: { bar?: string; limit?: number } = {},
  ): Promise<OkxCandle[]> {
    const bar = options.bar ?? "15m";
    if (!CANDLE_BARS.has(bar)) {
      throw new TypeError(`Unsupported OKX candle bar: ${bar}`);
    }

    const query = new URLSearchParams({
      instId: normalizeInstrumentId(instrumentId),
      bar,
      limit: String(
        normalizeLimit(options.limit, { min: 1, max: 300, fallback: 100 }),
      ),
    });
    return this.#get("/api/v5/market/candles", query);
  }

  #get<T>(
    path: `/api/v5/${string}`,
    query?: URLSearchParams,
  ): Promise<T[]> {
    return executeOkxJsonRequest<T>({
      region: this.#region,
      path,
      query,
      method: "GET",
      timeoutMs: this.#timeoutMs,
      transport: this.#transport,
    });
  }
}

