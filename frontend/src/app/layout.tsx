import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { ToastProvider } from "@/components/Toast";
import "./globals.css";

const poppins = localFont({
  src: [
    { path: "../../public/fonts/poppins-300-latin.woff2", weight: "300", style: "normal" },
    { path: "../../public/fonts/poppins-400-latin.woff2", weight: "400", style: "normal" },
    { path: "../../public/fonts/poppins-500-latin.woff2", weight: "500", style: "normal" },
    { path: "../../public/fonts/poppins-600-latin.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-poppins",
  display: "swap",
});

export const metadata: Metadata = {
  title: "CFO Command Centre",
  description:
    "CFO Command Centre — South NSW Conference finance workspace.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={poppins.variable}>
      <body className={poppins.className}>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
