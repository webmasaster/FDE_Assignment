import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "PEP Brands PO Portal",
  description: "Purchase order intake and approval portal"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
