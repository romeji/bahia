import { createHmac } from "node:crypto";

import { OkxConfigurationError, OkxValidationError } from "../errors";
import type { OkxHttpMethod } from "../types";

export interface OkxDemoCredentials {
  apiKey: string;
  secretKey: string;
  passphrase: string;
}

export interface OkxSigningInput {
  timestamp: string;
  method: OkxHttpMethod;
  requestPath: string;
  body?: string;
}

const SAFE_DEMO_REQUESTS = new Set([
  "GET /api/v5/account/balance",
  "GET /api/v5/account/config",
  "GET /api/v5/account/instruments",
  "GET /api/v5/trade/fills",
  "GET /api/v5/trade/order",
  "GET /api/v5/trade/orders-history",
  "GET /api/v5/trade/orders-pending",
  "POST /api/v5/trade/cancel-order",
  "POST /api/v5/trade/order",
]);

function requireSecret(value: string, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new OkxConfigurationError(`${label} is missing`);
  }
  if (value.length > 512 || /[\r\n]/.test(value)) {
    throw new OkxConfigurationError(`${label} is malformed`);
  }
  return value;
}

export function validateDemoCredentials(
  credentials: OkxDemoCredentials,
): Readonly<OkxDemoCredentials> {
  if (!credentials || typeof credentials !== "object") {
    throw new OkxConfigurationError("OKX Demo credentials are missing");
  }

  return Object.freeze({
    apiKey: requireSecret(credentials.apiKey, "OKX Demo API key"),
    secretKey: requireSecret(credentials.secretKey, "OKX Demo secret key"),
    passphrase: requireSecret(credentials.passphrase, "OKX Demo passphrase"),
  });
}

export function validateSigningInput(input: OkxSigningInput): OkxSigningInput {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input.timestamp)) {
    throw new OkxValidationError(
      "OKX timestamp must be an ISO 8601 UTC timestamp with milliseconds",
    );
  }
  if (!input.requestPath.startsWith("/api/v5/")) {
    throw new OkxValidationError("OKX request path must start with /api/v5/");
  }
  if (
    input.requestPath.includes("://") ||
    input.requestPath.includes("#") ||
    /[\r\n]/.test(input.requestPath)
  ) {
    throw new OkxValidationError("OKX request path is malformed");
  }
  if (input.method !== "GET" && input.method !== "POST") {
    throw new OkxValidationError("Unsupported OKX HTTP method");
  }
  return input;
}

export function buildOkxPrehash(input: OkxSigningInput): string {
  const checked = validateSigningInput(input);
  return `${checked.timestamp}${checked.method}${checked.requestPath}${checked.body ?? ""}`;
}

export function signOkxRequest(
  secretKey: string,
  input: OkxSigningInput,
): string {
  const secret = requireSecret(secretKey, "OKX secret key");
  return createHmac("sha256", secret)
    .update(buildOkxPrehash(input), "utf8")
    .digest("base64");
}

export function assertSafeDemoRequest(
  method: OkxHttpMethod,
  requestPath: string,
): void {
  const pathWithoutQuery = requestPath.split("?", 1)[0];
  if (!SAFE_DEMO_REQUESTS.has(`${method} ${pathWithoutQuery}`)) {
    throw new OkxValidationError(
      `OKX Demo endpoint is not allowlisted: ${method} ${pathWithoutQuery}`,
    );
  }
}

export function createOkxDemoAuthHeaders(
  credentials: OkxDemoCredentials,
  input: OkxSigningInput,
): Record<string, string> {
  const checkedCredentials = validateDemoCredentials(credentials);
  assertSafeDemoRequest(input.method, input.requestPath);

  return {
    "OK-ACCESS-KEY": checkedCredentials.apiKey,
    "OK-ACCESS-SIGN": signOkxRequest(checkedCredentials.secretKey, input),
    "OK-ACCESS-TIMESTAMP": input.timestamp,
    "OK-ACCESS-PASSPHRASE": checkedCredentials.passphrase,
    "x-simulated-trading": "1",
  };
}
