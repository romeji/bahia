import { NextRequest } from "next/server";
import { calculateMarketAnalysis } from "@/src/core";
import { OkxPublicClient } from "@/src/lib/okx";

const ALLOWED = new Set(["BTC-USDT", "ETH-USDT", "SOL-USDT"]);

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const instrument = (request.nextUrl.searchParams.get("instrument") ?? "BTC-USDT").toUpperCase();
  if (!ALLOWED.has(instrument)) {
    return Response.json({ error: "Marché non pris en charge" }, { status: 400 });
  }

  try {
    const client = new OkxPublicClient({ region: "global", timeoutMs: 7_000 });
    const rows = await client.getCandles(instrument, { bar: "1H", limit: 120 });
    const candles = rows.map((row) => ({
      timestamp: Number(row[0]),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5]),
      confirmed: row[8] === "1",
    })).reverse();
    const analysis = calculateMarketAnalysis(candles);

    return Response.json(
      { instrument, ...analysis, source: "OKX", timeframe: "1H" },
      { headers: { "Cache-Control": "s-maxage=45, stale-while-revalidate=120" } },
    );
  } catch (error) {
    console.error("analysis_fetch_failed", {
      instrument,
      message: error instanceof Error ? error.message : "unknown",
    });
    return Response.json(
      { error: "Analyse de marché momentanément indisponible" },
      { status: 502 },
    );
  }
}

