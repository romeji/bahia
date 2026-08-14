import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { OkxPublicClient } from "../public-client";
import type { OkxTransport } from "../types";

function jsonResponse(body: unknown): Awaited<ReturnType<OkxTransport>> {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    text: async () => JSON.stringify(body),
  };
}

describe("OkxPublicClient", () => {
  it("uses the EEA endpoint and never sends private headers", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const transport: OkxTransport = async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({ code: "0", msg: "", data: [{ last: "100" }] });
    };
    const client = new OkxPublicClient({ transport });

    await client.getTicker("btc-usdt");

    assert.equal(
      calls[0]?.url,
      "https://eea.okx.com/api/v5/market/ticker?instId=BTC-USDT",
    );
    assert.equal(
      Object.hasOwn(calls[0]?.init.headers ?? {}, "OK-ACCESS-KEY"),
      false,
    );
    assert.equal(calls[0]?.init.cache, "no-store");
  });
});
