"use client";

import { useState } from "react";
import type { FeedbackPin, FeedbackStatus, Locale } from "./types";
import { DIR, STRINGS } from "./i18n";
import { publicUrlFor } from "./uploadFeedback";
import { useFeedbackSupabaseClient } from "./client";
import { CloseIcon } from "./icons";

const STATUS_COLOR: Record<FeedbackStatus, string> = {
  open: "#d97757",
  in_progress: "#3b82f6",
  resolved: "#10b981",
  wont_fix: "#9ca3af",
};

interface PinProps {
  pin: FeedbackPin;
  number: number;
  locale: Locale;
}

export function Pin({ pin, number, locale }: PinProps) {
  const [open, setOpen] = useState(false);
  const client = useFeedbackSupabaseClient();
  const t = STRINGS[locale];
  const dir = DIR[locale];
  const position = pin.metadata?.position;
  if (!position) return null;

  const imageUrl = publicUrlFor(client, pin.annotated_image_path ?? pin.screenshot_path);

  return (
    <div
      data-feedback-ui
      style={{
        position: "absolute",
        left: position.x,
        top: position.y,
        transform: "translate(-50%, -50%)",
      }}
      className="z-[9995]"
    >
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={pin.comment}
          style={{ backgroundColor: STATUS_COLOR[pin.status] }}
          className="grid h-6 w-6 place-items-center rounded-full border-2 border-white text-[11px] font-semibold text-white shadow-md ring-1 ring-black/10"
        >
          {number}
        </button>

        {open && (
          <div
            dir={dir}
            style={{
              position: "absolute",
              top: "calc(100% + 8px)",
              insetInlineStart: 0,
            }}
            className="w-64 rounded-xl border border-black/10 bg-white p-3 text-neutral-900 shadow-2xl"
          >
            <div className="mb-1.5 flex items-start justify-between gap-2">
              <span
                style={{ color: STATUS_COLOR[pin.status] }}
                className="text-[11px] font-semibold uppercase tracking-wide"
              >
                {pin.status.replace("_", " ")}
              </span>
              <button
                onClick={() => setOpen(false)}
                className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-neutral-400 hover:bg-neutral-100"
              >
                <CloseIcon className="h-3 w-3" />
              </button>
            </div>

            {imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={imageUrl}
                alt=""
                className="mb-2 h-24 w-full rounded-lg border border-neutral-100 object-cover"
              />
            )}

            {pin.selected_text && (
              <blockquote
                dir="auto"
                className="mb-1.5 rounded-md bg-neutral-50 px-2 py-1 text-xs text-neutral-500"
              >
                “{pin.selected_text}”
              </blockquote>
            )}

            <p dir="auto" className="mb-1.5 text-sm text-neutral-800">
              {pin.comment}
            </p>

            <div className="flex items-center justify-between text-[11px] text-neutral-400">
              <span>{pin.created_by_email ?? "—"}</span>
              <span>{new Date(pin.created_at).toLocaleDateString()}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
