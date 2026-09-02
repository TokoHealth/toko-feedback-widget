"use client";

import { useRef, useState } from "react";
import type {
  FeedbackContext,
  FeedbackPin,
  Locale,
  PagePosition,
  PendingAttachment,
} from "./types";
import { DIR, STRINGS } from "./i18n";
import { submitFeedback } from "./uploadFeedback";
import { useFeedbackSupabaseClient } from "./client";
import { BrushIcon, CloseIcon, PaperclipIcon } from "./icons";

interface FeedbackPanelProps {
  locale: Locale;
  ctx: FeedbackContext;
  selectedText?: string;
  elementSelector?: string;
  anchor?: { x: number; y: number } | null;
  position?: PagePosition;
  onClose: () => void;
  onRequestDraw: (currentComment: string) => void;
  onSubmitted?: (pin: FeedbackPin) => void;
  /** set by parent after a draw session finishes, to prefill attachment + note */
  initialAttachment?: PendingAttachment | null;
  initialComment?: string;
}

type Status = "idle" | "sending" | "sent" | "error";

export function FeedbackPanel({
  locale,
  ctx,
  selectedText,
  elementSelector,
  anchor,
  position,
  onClose,
  onRequestDraw,
  onSubmitted,
  initialAttachment = null,
  initialComment = "",
}: FeedbackPanelProps) {
  const t = STRINGS[locale];
  const dir = DIR[locale];
  const client = useFeedbackSupabaseClient();

  const [comment, setComment] = useState(initialComment);
  const [attachment, setAttachment] = useState<PendingAttachment | null>(
    initialAttachment
  );
  const [attachmentPreview, setAttachmentPreview] = useState<string | null>(
    initialAttachment ? URL.createObjectURL(initialAttachment.blob) : null
  );
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function setAttachmentFromBlob(blob: Blob, kind: PendingAttachment["kind"]) {
    setAttachment({ blob, kind });
    setAttachmentPreview(URL.createObjectURL(blob));
  }

  function handlePaste(e: React.ClipboardEvent) {
    for (const item of e.clipboardData.items) {
      if (item.type.startsWith("image/")) {
        const blob = item.getAsFile();
        if (blob) setAttachmentFromBlob(blob, "attachment");
        e.preventDefault();
        return;
      }
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) setAttachmentFromBlob(file, "attachment");
    e.target.value = "";
  }

  async function handleSend() {
    if (!comment.trim()) {
      setErrorMsg(t.commentRequired);
      return;
    }
    setErrorMsg(null);
    setStatus("sending");
    try {
      const pin = await submitFeedback(client, ctx, {
        selectedText,
        comment: comment.trim(),
        attachment: attachment ?? undefined,
        elementSelector,
        position,
      });
      onSubmitted?.(pin);
      setStatus("sent");
      setTimeout(onClose, 900);
    } catch {
      setStatus("error");
    }
  }

  const style: React.CSSProperties = anchor
    ? {
        position: "fixed",
        top: Math.min(anchor.y, window.innerHeight - 360),
        left: Math.min(Math.max(anchor.x - 160, 12), window.innerWidth - 332),
      }
    : {
        position: "fixed",
        insetInlineEnd: 16,
        bottom: 88,
      };

  return (
    <div
      dir={dir}
      style={style}
      className="z-[9998] w-[320px] rounded-2xl border border-black/10 bg-white p-4 text-neutral-900 shadow-2xl"
      onPaste={handlePaste}
    >
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">
          {selectedText ? t.panelTitleWithSelection : t.panelTitle}
        </h3>
        <button
          onClick={onClose}
          aria-label={t.cancel}
          className="grid h-6 w-6 place-items-center rounded-full text-neutral-400 hover:bg-neutral-100"
        >
          <CloseIcon />
        </button>
      </div>

      {selectedText && (
        <div className="mb-2">
          <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-neutral-400">
            {t.selectedTextLabel}
          </div>
          <blockquote
            dir="auto"
            className="max-h-20 overflow-auto rounded-lg bg-neutral-50 px-2.5 py-2 text-sm text-neutral-600"
          >
            “{selectedText}”
          </blockquote>
        </div>
      )}

      <textarea
        dir={dir}
        autoFocus
        rows={3}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder={t.commentPlaceholder}
        className="mb-2 w-full resize-none rounded-lg border border-neutral-200 px-2.5 py-2 text-sm outline-none focus:border-[#d97757]"
      />

      {attachmentPreview ? (
        <div className="relative mb-2 inline-block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={attachmentPreview}
            alt=""
            className="h-20 rounded-lg border border-neutral-200 object-cover"
          />
          <button
            onClick={() => {
              setAttachment(null);
              setAttachmentPreview(null);
            }}
            className="absolute -top-2 -end-2 grid h-5 w-5 place-items-center rounded-full bg-neutral-800 text-white"
            aria-label={t.removeAttachment}
          >
            <CloseIcon className="h-3 w-3" />
          </button>
        </div>
      ) : (
        <div className="mb-2 flex flex-wrap gap-1.5">
          <button
            onClick={() => onRequestDraw(comment)}
            className="flex items-center gap-1.5 rounded-full border border-neutral-200 px-2.5 py-1 text-xs text-neutral-600 hover:bg-neutral-50"
          >
            <BrushIcon className="shrink-0 text-neutral-400" />
            {t.drawOnScreenshot}
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 rounded-full border border-neutral-200 px-2.5 py-1 text-xs text-neutral-600 hover:bg-neutral-50"
          >
            <PaperclipIcon className="shrink-0 text-neutral-400" />
            {t.attachImage}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileChange}
          />
        </div>
      )}
      {!attachmentPreview && (
        <p className="mb-2 text-[11px] text-neutral-400">{t.pasteHint}</p>
      )}

      {errorMsg && <p className="mb-2 text-xs text-red-600">{errorMsg}</p>}
      {status === "sent" && (
        <p className="mb-2 text-xs text-emerald-600">{t.sent}</p>
      )}
      {status === "error" && (
        <p className="mb-2 text-xs text-red-600">{t.error}</p>
      )}

      <div className="flex justify-end gap-2">
        <button
          onClick={onClose}
          className="rounded-full px-3 py-1.5 text-sm text-neutral-500 hover:bg-neutral-100"
        >
          {t.cancel}
        </button>
        <button
          onClick={handleSend}
          disabled={status === "sending" || status === "sent"}
          className="rounded-full bg-[#d97757] px-4 py-1.5 text-sm font-medium text-white hover:bg-[#c9663f] disabled:opacity-50"
        >
          {status === "sending" ? t.sending : t.send}
        </button>
      </div>
    </div>
  );
}
