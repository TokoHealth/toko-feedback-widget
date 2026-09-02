"use client";

import { toCanvas } from "html-to-image";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Locale } from "./types";
import { DIR, STRINGS } from "./i18n";
import { UndoIcon } from "./icons";

type Point = { x: number; y: number };
type Stroke = Point[];

interface DrawOverlayProps {
  locale: Locale;
  initialNote?: string;
  onCancel: () => void;
  onSend: (result: { blob: Blob; note: string }) => void;
}

const STROKE_COLOR = "#e0342d";
const STROKE_WIDTH = 5;

export function DrawOverlay({
  locale,
  initialNote = "",
  onCancel,
  onSend,
}: DrawOverlayProps) {
  const t = STRINGS[locale];
  const dir = DIR[locale];

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const baseImageRef = useRef<HTMLCanvasElement | null>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const redoRef = useRef<Stroke[]>([]);
  const drawingRef = useRef<Stroke | null>(null);

  const [note, setNote] = useState(initialNote);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [historyTick, setHistoryTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // hide our own overlay is not mounted yet at capture time, so document.body is clean
      const canvas = await toCanvas(document.body, {
        pixelRatio: 1,
        cacheBust: true,
        filter: (node) =>
          !(node instanceof Element && node.hasAttribute("data-feedback-ui")),
      });
      if (cancelled) return;
      baseImageRef.current = canvas;
      const target = canvasRef.current;
      if (target) {
        target.width = canvas.width;
        target.height = canvas.height;
        const ctx = target.getContext("2d");
        ctx?.drawImage(canvas, 0, 0);
      }
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const base = baseImageRef.current;
    if (!canvas || !base) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(base, 0, 0);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = STROKE_COLOR;
    ctx.lineWidth = STROKE_WIDTH;
    for (const stroke of strokesRef.current) {
      if (stroke.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(stroke[0].x, stroke[0].y);
      for (const p of stroke.slice(1)) ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
  }, []);

  function toCanvasPoint(e: React.PointerEvent<HTMLCanvasElement>): Point {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    drawingRef.current = [toCanvasPoint(e)];
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    drawingRef.current.push(toCanvasPoint(e));
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx || drawingRef.current.length < 2) return;
    const pts = drawingRef.current;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = STROKE_COLOR;
    ctx.lineWidth = STROKE_WIDTH;
    ctx.beginPath();
    ctx.moveTo(pts[pts.length - 2].x, pts[pts.length - 2].y);
    ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
    ctx.stroke();
  }

  function handlePointerUp() {
    if (!drawingRef.current) return;
    if (drawingRef.current.length > 1) {
      strokesRef.current.push(drawingRef.current);
      redoRef.current = [];
      setHistoryTick((n) => n + 1);
    }
    drawingRef.current = null;
  }

  function undo() {
    const last = strokesRef.current.pop();
    if (last) redoRef.current.push(last);
    redraw();
    setHistoryTick((n) => n + 1);
  }

  function redo() {
    const next = redoRef.current.pop();
    if (next) strokesRef.current.push(next);
    redraw();
    setHistoryTick((n) => n + 1);
  }

  async function handleSend() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setBusy(true);
    canvas.toBlob((blob) => {
      setBusy(false);
      if (blob) onSend({ blob, note });
    }, "image/png");
  }

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col bg-black/85">
      <div className="flex-1 overflow-auto p-4">
        {!ready && (
          <div className="flex h-full items-center justify-center text-white/80 text-sm">
            {locale === "he" ? "מכין צילום מסך…" : "Preparing screenshot…"}
          </div>
        )}
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          className="mx-auto max-w-full touch-none rounded-lg shadow-2xl"
          style={{ display: ready ? "block" : "none" }}
        />
      </div>

      <div className="pointer-events-none flex justify-center pb-6">
        <div
          dir={dir}
          className="pointer-events-auto flex w-[min(640px,92vw)] items-center gap-2 rounded-full bg-[#2a2a28] px-3 py-2 shadow-xl"
        >
          <button
            type="button"
            onClick={undo}
            disabled={strokesRef.current.length === 0}
            aria-label={t.undo}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-white/70 hover:bg-white/10 disabled:opacity-30"
          >
            <UndoIcon />
          </button>
          <button
            type="button"
            onClick={redo}
            disabled={redoRef.current.length === 0}
            aria-label={t.redo}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-white/70 hover:bg-white/10 disabled:opacity-30"
          >
            <UndoIcon flip />
          </button>
          <input
            dir={dir}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t.drawNotePlaceholder}
            className="min-w-0 flex-1 bg-transparent text-sm text-white placeholder-white/40 outline-none"
          />
          <button
            type="button"
            onClick={onCancel}
            className="shrink-0 rounded-full px-3 py-1.5 text-sm text-white/70 hover:bg-white/10"
          >
            {t.cancel}
          </button>
          <button
            type="button"
            onClick={handleSend}
            disabled={!ready || busy}
            className="shrink-0 rounded-full bg-[#d97757] px-4 py-1.5 text-sm font-medium text-white hover:bg-[#c9663f] disabled:opacity-50"
          >
            {busy ? t.sending : t.send}
          </button>
        </div>
      </div>
      {/* keep re-render tied to history so undo/redo buttons enable/disable correctly */}
      <span className="hidden">{historyTick}</span>
    </div>
  );
}
