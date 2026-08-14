import {
  OkxApiError,
  OkxConfigurationError,
  OkxHttpError,
  OkxResponseError,
} from "./errors";
import type {
  OkxApiEnvelope,
  OkxHttpMethod,
  OkxRegion,
  OkxTransport,
} from "./types";

export const OKX_REST_BASE_URLS: Readonly<Record<OkxRegion, string>> = {
  eea: "https://eea.okx.com",
  global: "https://openapi.okx.com",
  us: "https://us.okx.com",
  tr: "https://tr.okx.com",
};

export interface OkxJsonRequest {
  region: OkxRegion;
  path: `/api/v5/${string}`;
  method: OkxHttpMethod;
  query?: URLSearchParams;
  body?: string;
  headers?: Record<string, string>;
  timeoutMs: number;
  transport: OkxTransport;
}

export const defaultOkxTransport: OkxTransport = (url, init) => fetch(url, init);

export function buildRequestPath(
  path: `/api/v5/${string}`,
  query?: URLSearchParams,
): string {
  const queryString = query?.toString();
  return queryString ? `${path}?${queryString}` : path;
}

export function validateTimeoutMs(value: number | undefined): number {
  const timeoutMs = value ?? 10_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 250 || timeoutMs > 60_000) {
    throw new OkxConfigurationError(
      "OKX request timeout must be an integer between 250 and 60000 ms",
    );
  }
  return timeoutMs;
}

export async function executeOkxJsonRequest<T>(
  request: OkxJsonRequest,
): Promise<T[]> {
  const requestPath = buildRequestPath(request.path, request.query);
  const url = `${OKX_REST_BASE_URLS[request.region]}${requestPath}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), request.timeoutMs);

  let response;
  try {
    response = await request.transport(url, {
      method: request.method,
      headers: {
        Accept: "application/json",
        ...(request.body ? { "Content-Type": "application/json" } : {}),
        ...request.headers,
      },
      body: request.body,
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  const rawBody = await response.text();
  if (!response.ok) {
    throw new OkxHttpError(
      response.status,
      response.statusText ?? "",
      rawBody.slice(0, 2_048),
    );
  }

  let envelope: OkxApiEnvelope<T>;
  try {
    envelope = JSON.parse(rawBody) as OkxApiEnvelope<T>;
  } catch (cause) {
    throw new OkxResponseError("OKX returned invalid JSON", { cause });
  }

  if (
    typeof envelope !== "object" ||
    envelope === null ||
    typeof envelope.code !== "string" ||
    !Array.isArray(envelope.data)
  ) {
    throw new OkxResponseError("OKX returned an unexpected response envelope");
  }
  if (envelope.code !== "0") {
    throw new OkxApiError(envelope.code, envelope.msg);
  }
  return envelope.data;
}
