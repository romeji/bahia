export function GET() {
  return Response.json({
    ok: true,
    service: "bahia-web",
    mode: "paper",
    capabilities: {
      okxPublic: true,
      paperTrading: true,
      okxDemo: Boolean(process.env.OKX_DEMO_API_KEY && process.env.OKX_DEMO_SECRET_KEY && process.env.OKX_DEMO_PASSPHRASE),
      liveTrading: false,
      durablePortfolio: Boolean(process.env.DATABASE_URL),
    },
    timestamp: new Date().toISOString(),
  }, { headers: { "Cache-Control": "no-store" } });
}
