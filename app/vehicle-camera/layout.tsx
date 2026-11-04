import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Vehicle Camera Pairing",
  referrer: "no-referrer",
};

export default function VehicleCameraLayout({ children }: { children: React.ReactNode }) {
  return children;
}
