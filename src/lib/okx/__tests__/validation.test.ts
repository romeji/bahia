import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  normalizeInstrumentId,
  normalizePositiveDecimal,
  normalizeSpotInstrumentId,
  requireExactlyOneOrderIdentifier,
} from "../validation";

describe("OKX instrument validation", () => {
  it("normalizes a Spot instrument", () => {
    assert.equal(normalizeSpotInstrumentId(" btc-usdt "), "BTC-USDT");
  });

  it("accepts validated derivatives without weakening Spot validation", () => {
    assert.equal(
      normalizeInstrumentId("BTC-USDT-SWAP", "SWAP"),
      "BTC-USDT-SWAP",
    );
    assert.throws(
      () => normalizeSpotInstrumentId("BTC-USDT-SWAP"),
      /BASE-QUOTE/,
    );
  });

  it("rejects path and query injection", () => {
    assert.throws(() => normalizeSpotInstrumentId("BTC-USDT?x=1"));
    assert.throws(() => normalizeSpotInstrumentId("BTC/USDT"));
  });

  it("keeps decimal precision and rejects exponent notation", () => {
    assert.equal(
      normalizePositiveDecimal("0.00001000", "size"),
      "0.00001000",
    );
    assert.throws(() => normalizePositiveDecimal("1e-5", "size"));
    assert.throws(() => normalizePositiveDecimal("0", "size"));
  });

  it("requires exactly one order identifier", () => {
    assert.deepEqual(requireExactlyOneOrderIdentifier({ orderId: "123" }), {
      ordId: "123",
    });
    assert.throws(() => requireExactlyOneOrderIdentifier({}), /exactly one/);
    assert.throws(
      () =>
        requireExactlyOneOrderIdentifier({
          orderId: "123",
          clientOrderId: "bahia1",
        }),
      /exactly one/,
    );
  });
});
