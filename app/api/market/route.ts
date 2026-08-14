import { NextRequest } from "next/server";
import { OkxPublicClient } from "@/src/lib/okx";

const ALLOWED = new Set(["BTC-USDT", "ETH-USDT", "SOL-USDT"]);

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const instrument = (request.nextUrl.searchParams.get("instrument") ?? "BTC-USDT").toUpperCase();
  if (!ALLOWED.has(instrument)) {
    return Response.json({ error: "Marché non pris en charge" }, { status: 400 });
  }

  try {
    const client = new OkxPublicClient({ region: "global", timeoutMs: 5_000 });
    const [ticker] = await client.getTicker(instrument);
    if (!ticker) throw new Error("Ticker OKX absent");

    const price = Number(ticker.last);
    const open24h = Number(ticker.open24h);
    return Response.json({
      instrument,
      price,
      bid: Number(ticker.bidPx),
      ask: Number(ticker.askPx),
      open24h,
      high24h: Number(ticker.high24h),
      low24h: Number(ticker.low24h),
      volume24h: Number(ticker.volCcy24h),
      change24h: open24h > 0 ? ((price / open24h) - 1) * 100 : 0,
      timestamp: Number(ticker.ts),
      source: "OKX",
      environment: "public",
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("market_fetch_failed", { instrument, message: error instanceof Error ? error.message : "unknown" });
    return Response.json({ error: "Données OKX momentanément indisponibles" }, { status: 502 });
  }
}
