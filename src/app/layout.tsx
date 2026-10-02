import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kolbe Vintage Platform",
  description: "Shared-core retail and wholesale fashion commerce platform.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
