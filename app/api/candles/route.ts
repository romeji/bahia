import { NextRequest } from "next/server";
import { OkxPublicClient } from "@/src/lib/okx";

const ALLOWED = new Set(["BTC-USDT", "ETH-USDT", "SOL-USDT"]);
const BARS = new Set(["5m", "15m", "1H", "4H", "1D"]);

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const instrument = (request.nextUrl.searchParams.get("instrument") ?? "BTC-USDT").toUpperCase();
  const bar = request.nextUrl.searchParams.get("bar") ?? "1H";
  const rawLimit = Number(request.nextUrl.searchParams.get("limit") ?? 200);
  const limit = Number.isInteger(rawLimit) ? Math.min(300, Math.max(50, rawLimit)) : 200;
  if (!ALLOWED.has(instrument) || !BARS.has(bar)) {
    return Response.json({ error: "Paramètres historiques invalides" }, { status: 400 });
  }

  try {
    const client = new OkxPublicClient({ region: "global", timeoutMs: 7_000 });
    const rows = await client.getCandles(instrument, { bar, limit });
    const candles = rows.map((row) => ({
      timestamp: Number(row[0]), open: Number(row[1]), high: Number(row[2]),
      low: Number(row[3]), close: Number(row[4]), volume: Number(row[5]), confirmed: row[8] === "1",
    })).reverse();
    return Response.json({ instrument, bar, candles, source: "OKX" }, { headers: { "Cache-Control": "s-maxage=30, stale-while-revalidate=60" } });
  } catch (error) {
    console.error("candles_fetch_failed", { instrument, bar, message: error instanceof Error ? error.message : "unknown" });
    return Response.json({ error: "Historique OKX momentanément indisponible" }, { status: 502 });
  }
}
