import { OkxValidationError } from "./errors";
import type { OkxInstrumentType } from "./types";

const INSTRUMENT_TOKEN = /^[A-Z0-9]{1,24}$/;
const POSITIVE_DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const CURRENCY = /^[A-Z0-9]{2,20}$/;
const ORDER_ID = /^\d{1,32}$/;
const CLIENT_ORDER_ID = /^[A-Za-z0-9]{1,32}$/;
const ORDER_TAG = /^[A-Za-z0-9]{1,16}$/;

function fail(message: string): never {
  throw new OkxValidationError(message);
}

export function normalizeInstrumentId(
  value: string,
  expectedType?: OkxInstrumentType,
): string {
  if (typeof value !== "string") {
    return fail("Instrument ID must be a string");
  }

  const instrumentId = value.trim().toUpperCase();
  if (instrumentId.length < 3 || instrumentId.length > 80) {
    return fail("Instrument ID has an invalid length");
  }

  const parts = instrumentId.split("-");
  if (parts.some((part) => !INSTRUMENT_TOKEN.test(part))) {
    return fail("Instrument ID contains unsupported characters");
  }

  switch (expectedType) {
    case "SPOT":
    case "MARGIN":
      if (parts.length !== 2) {
        return fail(`${expectedType} instruments must use BASE-QUOTE`);
      }
      break;
    case "SWAP":
      if (parts.length !== 3 || parts[2] !== "SWAP") {
        return fail("SWAP instruments must use BASE-QUOTE-SWAP");
      }
      break;
    case "FUTURES":
      if (parts.length !== 3 || !/^\d{6,8}$/.test(parts[2])) {
        return fail("FUTURES instruments must end with an expiry date");
      }
      break;
    case "OPTION":
      if (
        parts.length !== 5 ||
        !/^\d{6,8}$/.test(parts[2]) ||
        !/^\d+(?:\.\d+)?$/.test(parts[3]) ||
        !/^[CP]$/.test(parts[4])
      ) {
        return fail("OPTION instrument format is invalid");
      }
      break;
    default:
      if (parts.length < 2 || parts.length > 5) {
        return fail("Instrument ID format is invalid");
      }
  }

  return instrumentId;
}

export function normalizeSpotInstrumentId(value: string): string {
  return normalizeInstrumentId(value, "SPOT");
}

export function normalizeCurrency(value: string): string {
  if (typeof value !== "string") {
    return fail("Currency must be a string");
  }

  const currency = value.trim().toUpperCase();
  if (!CURRENCY.test(currency)) {
    return fail("Currency code is invalid");
  }
  return currency;
}

export function normalizePositiveDecimal(value: string, fieldName: string): string {
  if (typeof value !== "string") {
    return fail(`${fieldName} must be a decimal string`);
  }

  const decimal = value.trim();
  if (
    decimal.length > 64 ||
    !POSITIVE_DECIMAL.test(decimal) ||
    /^0(?:\.0+)?$/.test(decimal)
  ) {
    return fail(`${fieldName} must be strictly positive without exponent notation`);
  }
  return decimal;
}

export function normalizeOrderId(value: string): string {
  const orderId = value?.trim();
  if (!ORDER_ID.test(orderId)) {
    return fail("Order ID is invalid");
  }
  return orderId;
}

export function normalizeClientOrderId(value: string): string {
  const clientOrderId = value?.trim();
  if (!CLIENT_ORDER_ID.test(clientOrderId)) {
    return fail("Client order ID must be 1-32 alphanumeric characters");
  }
  return clientOrderId;
}

export function normalizeOrderTag(value: string): string {
  const tag = value?.trim();
  if (!ORDER_TAG.test(tag)) {
    return fail("Order tag must be 1-16 alphanumeric characters");
  }
  return tag;
}

export function normalizeLimit(
  value: number | undefined,
  { min = 1, max, fallback }: { min?: number; max: number; fallback: number },
): number {
  const limit = value ?? fallback;
  if (!Number.isInteger(limit) || limit < min || limit > max) {
    return fail(`Limit must be an integer between ${min} and ${max}`);
  }
  return limit;
}

export function requireExactlyOneOrderIdentifier(input: {
  orderId?: string;
  clientOrderId?: string;
}): { ordId?: string; clOrdId?: string } {
  const hasOrderId = input.orderId !== undefined;
  const hasClientOrderId = input.clientOrderId !== undefined;
  if (hasOrderId === hasClientOrderId) {
    return fail("Provide exactly one of orderId or clientOrderId");
  }

  return hasOrderId
    ? { ordId: normalizeOrderId(input.orderId!) }
    : { clOrdId: normalizeClientOrderId(input.clientOrderId!) };
}

