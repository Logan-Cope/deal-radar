import type { Metadata, Viewport } from "next";
import { Archivo } from "next/font/google";
import "./globals.css";

const archivo = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font-archivo", display: "swap" });

export const metadata: Metadata = {
  title: "deal-radar",
  description: "Software finds underpriced pieces and checks each one against what other sellers are asking. A person approves every buy.",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = { themeColor: "#e4e9e3" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={archivo.variable}>
      <body>{children}</body>
    </html>
  );
}
