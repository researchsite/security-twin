import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Security Twin — Dashboard",
  description: "AI-powered security testing twin: live attack run dashboard",
  robots: "noindex,nofollow",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-gray-950 text-gray-100 font-mono">{children}</body>
    </html>
  );
}
