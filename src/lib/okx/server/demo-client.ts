import { OkxApiError, OkxConfigurationError, OkxValidationError } from "../errors";
import {
  buildRequestPath,
  defaultOkxTransport,
  executeOkxJsonRequest,
  validateTimeoutMs,
} from "../http";
import type {
  OkxAccountBalance,
  OkxAccountConfiguration,
  OkxCancelOrderRequest,
  OkxDemoSpotOrderRequest,
  OkxInstrument,
  OkxOrder,
  OkxOrderAck,
  OkxOrderLookup,
  OkxRegion,
  OkxTransport,
} from "../types";
import {
  normalizeClientOrderId,
  normalizeCurrency,
  normalizeLimit,
  normalizeOrderTag,
  normalizePositiveDecimal,
  normalizeSpotInstrumentId,
  requireExactlyOneOrderIdentifier,
} from "../validation";
import {
  createOkxDemoAuthHeaders,
  type OkxDemoCredentials,
  validateDemoCredentials,
} from "./signature";

export interface OkxDemoClientOptions {
  credentials: OkxDemoCredentials;
  region?: OkxRegion;
  transport?: OkxTransport;
  timeoutMs?: number;
  orderExpiryMs?: number;
  clock?: () => Date;
}

export interface OkxDemoSafetyStatus {
  simulatedTrading: true;
  readPermission: boolean;
  tradePermission: boolean;
  withdrawalPermission: false;
  ipAllowlistConfigured: boolean;
}

type JsonObject = Record<string, string>;

function validateOrderExpiryMs(value: number | undefined): number {
  const expiryMs = value ?? 5_000;
  if (!Number.isInteger(expiryMs) || expiryMs < 1_000 || expiryMs > 30_000) {
    throw new OkxConfigurationError(
      "OKX Demo order expiry must be between 1000 and 30000 ms",
    );
  }
  return expiryMs;
}

function assertSuccessfulOrderAcks(acknowledgements: OkxOrderAck[]): void {
  const failed = acknowledgements.find((ack) => ack.sCode !== "0");
  if (failed) {
    throw new OkxApiError(failed.sCode, failed.sMsg);
  }
}

export class OkxDemoClient {
  readonly #credentials: Readonly<OkxDemoCredentials>;
  readonly #region: OkxRegion;
  readonly #transport: OkxTransport;
  readonly #timeoutMs: number;
  readonly #orderExpiryMs: number;
  readonly #clock: () => Date;

  constructor(options: OkxDemoClientOptions) {
    this.#credentials = validateDemoCredentials(options.credentials);
    this.#region = options.region ?? "eea";
    this.#transport = options.transport ?? defaultOkxTransport;
    this.#timeoutMs = validateTimeoutMs(options.timeoutMs);
    this.#orderExpiryMs = validateOrderExpiryMs(options.orderExpiryMs);
    this.#clock = options.clock ?? (() => new Date());
  }

  getBalances(currencies: string[] = []): Promise<OkxAccountBalance[]> {
    if (currencies.length > 20) {
      throw new OkxValidationError("OKX accepts at most 20 currencies per balance request");
    }
    const query = new URLSearchParams();
    if (currencies.length > 0) {
      query.set("ccy", currencies.map(normalizeCurrency).join(","));
    }
    return this.#request("GET", "/api/v5/account/balance", query);
  }

  getAccountConfiguration(): Promise<OkxAccountConfiguration[]> {
    return this.#request("GET", "/api/v5/account/config");
  }

  async verifyApiKeySafety(): Promise<OkxDemoSafetyStatus> {
    const [configuration] = await this.getAccountConfiguration();
    if (!configuration) {
      throw new OkxConfigurationError("OKX returned no account configuration");
    }

    const permissions = new Set(
      configuration.perm
        .split(",")
        .map((permission) => permission.trim().toLowerCase())
        .filter(Boolean),
    );
    if (permissions.has("withdraw")) {
      throw new OkxConfigurationError(
        "Unsafe OKX API key: withdrawal permission must be removed",
      );
    }

    return {
      simulatedTrading: true,
      readPermission: permissions.has("read_only"),
      tradePermission: permissions.has("trade"),
      withdrawalPermission: false,
      ipAllowlistConfigured: configuration.ip.trim().length > 0,
    };
  }

  getSpotInstruments(instrumentId?: string): Promise<OkxInstrument[]> {
    const query = new URLSearchParams({ instType: "SPOT" });
    if (instrumentId) {
      query.set("instId", normalizeSpotInstrumentId(instrumentId));
    }
    return this.#request("GET", "/api/v5/account/instruments", query);
  }

  async placeSpotOrder(request: OkxDemoSpotOrderRequest): Promise<OkxOrderAck[]> {
    const body: JsonObject = {
      instId: normalizeSpotInstrumentId(request.instrumentId),
      tdMode: "cash",
      side: request.side,
      ordType: request.orderType,
      sz: normalizePositiveDecimal(request.size, "Order size"),
    };

    if (request.orderType === "limit") {
      if (!request.price) {
        throw new OkxValidationError("A limit order requires a price");
      }
      if (request.targetCurrency) {
        throw new OkxValidationError(
          "targetCurrency is only valid for Spot market orders",
        );
      }
      body.px = normalizePositiveDecimal(request.price, "Limit price");
    } else if (request.price !== undefined) {
      throw new OkxValidationError("A market order cannot specify a price");
    }

    if (request.targetCurrency) {
      body.tgtCcy = request.targetCurrency;
    }
    if (request.clientOrderId) {
      body.clOrdId = normalizeClientOrderId(request.clientOrderId);
    }
    if (request.tag) {
      body.tag = normalizeOrderTag(request.tag);
    }

    const acknowledgements = await this.#request<OkxOrderAck>(
      "POST",
      "/api/v5/trade/order",
      undefined,
      JSON.stringify(body),
      true,
    );
    assertSuccessfulOrderAcks(acknowledgements);
    return acknowledgements;
  }

  async cancelSpotOrder(request: OkxCancelOrderRequest): Promise<OkxOrderAck[]> {
    const identifiers = requireExactlyOneOrderIdentifier(request);
    const body = JSON.stringify({
      instId: normalizeSpotInstrumentId(request.instrumentId),
      ...identifiers,
    });
    const acknowledgements = await this.#request<OkxOrderAck>(
      "POST",
      "/api/v5/trade/cancel-order",
      undefined,
      body,
      true,
    );
    assertSuccessfulOrderAcks(acknowledgements);
    return acknowledgements;
  }

  getOrder(request: OkxOrderLookup): Promise<OkxOrder[]> {
    const query = new URLSearchParams({
      instId: normalizeSpotInstrumentId(request.instrumentId),
    });
    const identifiers = requireExactlyOneOrderIdentifier(request);
    if (identifiers.ordId) {
      query.set("ordId", identifiers.ordId);
    } else if (identifiers.clOrdId) {
      query.set("clOrdId", identifiers.clOrdId);
    }
    return this.#request("GET", "/api/v5/trade/order", query);
  }

  getOpenSpotOrders(instrumentId?: string): Promise<OkxOrder[]> {
    const query = new URLSearchParams({ instType: "SPOT" });
    if (instrumentId) {
      query.set("instId", normalizeSpotInstrumentId(instrumentId));
    }
    return this.#request("GET", "/api/v5/trade/orders-pending", query);
  }

  getSpotOrderHistory(
    instrumentId?: string,
    limit?: number,
  ): Promise<OkxOrder[]> {
    const query = new URLSearchParams({
      instType: "SPOT",
      limit: String(
        normalizeLimit(limit, { min: 1, max: 100, fallback: 50 }),
      ),
    });
    if (instrumentId) {
      query.set("instId", normalizeSpotInstrumentId(instrumentId));
    }
    return this.#request("GET", "/api/v5/trade/orders-history", query);
  }

  #request<T>(
    method: "GET" | "POST",
    path: `/api/v5/${string}`,
    query?: URLSearchParams,
    body?: string,
    expiringOrder = false,
  ): Promise<T[]> {
    const now = this.#clock();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
      throw new OkxConfigurationError("OKX clock returned an invalid date");
    }

    const requestPath = buildRequestPath(path, query);
    const timestamp = now.toISOString();
    const headers = createOkxDemoAuthHeaders(this.#credentials, {
      timestamp,
      method,
      requestPath,
      body,
    });
    if (expiringOrder) {
      headers.expTime = String(now.getTime() + this.#orderExpiryMs);
    }

    return executeOkxJsonRequest<T>({
      region: this.#region,
      path,
      query,
      method,
      body,
      headers,
      timeoutMs: this.#timeoutMs,
      transport: this.#transport,
    });
  }
}
