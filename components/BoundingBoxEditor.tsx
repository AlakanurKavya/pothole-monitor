"use client";

import { useEffect, useRef, useState } from "react";
import type { BBox } from "@/lib/types";

export function BoundingBoxEditor({
  imageUrl,
  aiBox,
  value,
  onChange,
  editable,
  overlayBox,
}: {
  imageUrl: string;
  aiBox: BBox;
  value: BBox;
  onChange: (box: BBox) => void;
  editable: boolean;
  overlayBox?: BBox | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [drag, setDrag] = useState<"move" | "br" | null>(null);

  useEffect(() => {
    const img = new Image();
    img.src = imageUrl;
    img.onload = () => {
      imgRef.current = img;
      draw();
    };
  }, [imageUrl, value, overlayBox, aiBox, editable]);

  function draw() {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;
    const maxW = 860;
    const scale = Math.min(1, maxW / img.width);
    canvas.width = img.width * scale;
    canvas.height = img.height * scale;
    const width = canvas.width;
    const height = canvas.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const g = ctx;
    g.drawImage(img, 0, 0, width, height);

    function rect(box: BBox, color: string, label: string) {
      g.strokeStyle = color;
      g.lineWidth = 3;
      g.strokeRect(box.x * width, box.y * height, box.w * width, box.h * height);
      g.fillStyle = color;
      g.font = "12px sans-serif";
      g.fillText(label, box.x * width + 4, box.y * height + 16);
    }

    rect(aiBox, "#38bdf8", "AI");
    if (overlayBox) rect(overlayBox, "#22c55e", "GOV");
    if (editable) {
      rect(value, "#f59e0b", "CORRECTED");
      const hx = (value.x + value.w) * width;
      const hy = (value.y + value.h) * height;
      g.fillStyle = "#f59e0b";
      g.fillRect(hx - 6, hy - 6, 12, 12);
    }
  }

  function toBox(e: React.MouseEvent) {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const r = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) / r.width,
      y: (e.clientY - r.top) / r.height,
    };
  }

  return (
    <canvas
      ref={canvasRef}
      className="max-w-full border border-slate-400 bg-black cursor-crosshair"
      onMouseDown={(e) => {
        if (!editable) return;
        const p = toBox(e);
        const brx = value.x + value.w;
        const bry = value.y + value.h;
        if (Math.abs(p.x - brx) < 0.03 && Math.abs(p.y - bry) < 0.03) setDrag("br");
        else setDrag("move");
      }}
      onMouseMove={(e) => {
        if (!editable || !drag) return;
        const p = toBox(e);
        if (drag === "br") {
          onChange({
            ...value,
            w: Math.max(0.04, p.x - value.x),
            h: Math.max(0.04, p.y - value.y),
          });
        } else {
          onChange({ ...value, x: Math.min(0.9, Math.max(0, p.x - value.w / 2)), y: Math.min(0.9, Math.max(0, p.y - value.h / 2)) });
        }
      }}
      onMouseUp={() => setDrag(null)}
      onMouseLeave={() => setDrag(null)}
    />
  );
}
