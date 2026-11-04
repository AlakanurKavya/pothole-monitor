"use client";

import dynamic from "next/dynamic";
import type { AiDetection, PotholeLocation } from "@/lib/types";

const Inner = dynamic(() => import("@/components/PotholeMap").then((m) => m.PotholeMap), {
  ssr: false,
  loading: () => <div className="h-[540px] grid place-items-center border bg-white">Loading map…</div>,
});

export function PotholeMapClient(props: {
  locations: PotholeLocation[];
  detections: AiDetection[];
  imageUrls: Record<string, string>;
}) {
  return <Inner {...props} />;
}
