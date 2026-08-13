import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Copy Component — Sitecore XM Cloud Pages",
  description:
    "Copy a component and everything nested inside it onto other pages, bringing its local datasources along and leaving shared ones shared.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
