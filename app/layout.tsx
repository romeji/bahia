import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://bahia-trading-lab-v2.vercel.app"),
  title: { default: "Bahia — Trading Lab", template: "%s · Bahia" },
  description: "Apprends, simule et évalue des stratégies crypto avec les données publiques OKX et des garde-fous explicables.",
  applicationName: "Bahia Trading Lab",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.png", apple: "/apple-icon.png" },
  openGraph: {
    title: "Bahia — Comprendre. Simuler. Décider.",
    description: "Un laboratoire de paper trading simple, guidé et transparent.",
    type: "website",
    locale: "fr_FR",
  },
  twitter: { card: "summary_large_image" },
  keywords: ["paper trading", "OKX", "bot crypto", "backtest", "gestion du risque"],
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#08090d" },
    { media: "(prefers-color-scheme: light)", color: "#08090d" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <body style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif' }}>
        {children}
      </body>
    </html>
  );
}
