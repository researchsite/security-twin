import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Security Twin",
  description: "AI-powered security testing — find IDOR, SSRF, and auth bugs automatically",
  robots: "noindex,nofollow",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-gray-950 text-gray-100 font-mono antialiased">
        <nav className="flex items-center gap-6 border-b border-gray-900 px-5 py-2.5 text-xs text-gray-600">
          <Link href="/" className="font-semibold text-gray-400 hover:text-white">
            Security Twin
          </Link>
          <Link href="/memory" className="hover:text-gray-300">memory</Link>
          <Link href={`/runs/demo-2024-idor`} className="hover:text-gray-300">demo run</Link>
        </nav>
        {children}
      </body>
    </html>
  );
}
