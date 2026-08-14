import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { OkxTransport } from "../types";
import { OkxDemoClient } from "../server/demo-client";
import {
  createOkxDemoAuthHeaders,
  signOkxRequest,
} from "../server/signature";

const credentials = {
  apiKey: "demo-key",
  secretKey: "22582BD0CFF14C41EDBF1AB98506286D",
  passphrase: "demo-passphrase",
};

function jsonResponse(body: unknown): Awaited<ReturnType<OkxTransport>> {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    text: async () => JSON.stringify(body),
  };
}

describe("OKX server signing", () => {
  it("matches a stable HMAC SHA-256 vector", () => {
    assert.equal(
      signOkxRequest(credentials.secretKey, {
        timestamp: "2020-12-08T09:08:57.715Z",
        method: "GET",
        requestPath: "/api/v5/account/balance?ccy=BTC",
      }),
      "HiZhvSfMtWJA3uUIVXV3a/bSXNPCWvYFXoGCVS8V4zY=",
    );
  });

  it("refuses to build authenticated headers for a withdrawal", () => {
    assert.throws(
      () =>
        createOkxDemoAuthHeaders(credentials, {
          timestamp: "2020-12-08T09:08:57.715Z",
          method: "POST",
          requestPath: "/api/v5/asset/withdrawal",
          body: "{}",
        }),
      /not allowlisted/,
    );
  });
});

describe("OkxDemoClient", () => {
  it("forces simulated trading and cash-only Spot orders", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const transport: OkxTransport = async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({
        code: "0",
        msg: "",
        data: [
          {
            ordId: "123",
            clOrdId: "bahia1",
            tag: "",
            sCode: "0",
            sMsg: "",
            ts: "1597026383085",
          },
        ],
      });
    };
    const client = new OkxDemoClient({
      credentials,
      transport,
      clock: () => new Date("2020-12-08T09:08:57.715Z"),
    });

    await client.placeSpotOrder({
      instrumentId: "btc-usdt",
      side: "buy",
      orderType: "limit",
      size: "0.001",
      price: "50000",
      clientOrderId: "bahia1",
    });

    const headers = calls[0]?.init.headers as Record<string, string>;
    assert.equal(calls[0]?.url, "https://eea.okx.com/api/v5/trade/order");
    assert.equal(headers["x-simulated-trading"], "1");
    assert.equal(headers["OK-ACCESS-KEY"], "demo-key");
    assert.equal(headers.expTime, "1607418542715");
    assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), {
      instId: "BTC-USDT",
      tdMode: "cash",
      side: "buy",
      ordType: "limit",
      sz: "0.001",
      px: "50000",
      clOrdId: "bahia1",
    });
  });

  it("blocks unsafe withdrawal permissions returned by OKX", async () => {
    const transport: OkxTransport = async () =>
      jsonResponse({
        code: "0",
        msg: "",
        data: [{ perm: "read_only,trade,withdraw", ip: "" }],
      });
    const client = new OkxDemoClient({ credentials, transport });

    await assert.rejects(
      () => client.verifyApiKeySafety(),
      /withdrawal permission/,
    );
  });
});
