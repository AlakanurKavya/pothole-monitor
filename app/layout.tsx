import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Road Condition Monitoring System",
  description:
    "AI-Driven Autonomous Pothole Detection and Road Condition Monitoring System",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
