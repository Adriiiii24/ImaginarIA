import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ImaginarIA — Socio creativo radical",
  description:
    "Un chat que no te da la respuesta obvia: desmonta la premisa que estabas dando por buena y cruza disciplinas para desbloquear la idea.",
  openGraph: {
    title: "ImaginarIA — Socio creativo radical",
    description:
      "Generación de ideas disruptivas y eliminación de bloqueos creativos.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#09090e",
  // La interfaz ocupa el alto exacto de la ventana; sin esto, el teclado de
  // iOS empuja el composer fuera de la pantalla.
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      {/* h-dvh y no h-screen: en moviles, 100vh incluye la barra del
          navegador y el composer queda por debajo del borde visible. */}
      <body className="flex h-dvh flex-col overflow-hidden">{children}</body>
    </html>
  );
}
