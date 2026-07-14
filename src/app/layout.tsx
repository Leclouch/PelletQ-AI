import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-plus-jakarta",
});

// Favicon & app icon pakai konvensi file Next.js: src/app/icon.png dan
// src/app/apple-icon.png terdeteksi otomatis — tak perlu metadata.icons.
export const metadata: Metadata = {
  title: "PelletQ-AI — Formulasi Pakan Lele Otomatis",
  description: "Sistem AI untuk formulasi pakan ikan lele berbasis SNI 01-4087-2006",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id" className={`${plusJakarta.variable} h-full`}>
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
