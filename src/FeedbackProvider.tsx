"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FeedbackPin, Locale, PagePosition } from "./types";
import { STRINGS } from "./i18n";
import { SupabaseClientContext } from "./client";
import { SelectionBubble } from "./SelectionBubble";
import { FeedbackPanel } from "./FeedbackPanel";
import { DrawOverlay } from "./DrawOverlay";
import { Pin } from "./Pin";
import { fetchPinsForPage, submitFeedback } from "./uploadFeedback";
import { ChatIcon } from "./icons";

interface FeedbackProviderProps {
  /** A Supabase client already pointed at the shared feedback project. */
  supabaseClient: SupabaseClient;
  /** Identifies which product this feedback came from, e.g. "toko-app". */
  product: string;
  environment?: string;
  createdByEmail?: string;
  locale?: Locale;
  children: React.ReactNode;
}

type UIState =
  | { mode: "idle" }
  | {
      mode: "bubble";
      text: string;
      anchor: { x: number; y: number };
      position: PagePosition;
    }
  | {
      mode: "panel";
      text?: string;
      anchor?: { x: number; y: number } | null;
      position?: PagePosition;
      draftComment: string;
    }
  | {
      mode: "draw";
      text?: string;
      anchor?: { x: number; y: number } | null;
      position?: PagePosition;
      draftComment: string;
    };

export function FeedbackProvider({
  supabaseClient,
  product,
  environment = "production",
  createdByEmail,
  locale = "en",
  children,
}: FeedbackProviderProps) {
  const [ui, setUi] = useState<UIState>({ mode: "idle" });
  const [toast, setToast] = useState<string | null>(null);
  const [pins, setPins] = useState<FeedbackPin[]>([]);
  const suppressNextClearRef = useRef(false);

  const ctx = { product, environment, createdByEmail };
  const t = STRINGS[locale];

  useEffect(() => {
    fetchPinsForPage(supabaseClient, product, window.location.href)
      .then(setPins)
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product]);

  useEffect(() => {
    function handleSelectionChange() {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || suppressNextClearRef.current) {
        return;
      }
      const text = selection.toString().trim();
      if (!text) return;

      const anchorEl =
        selection.anchorNode instanceof Element
          ? selection.anchorNode
          : selection.anchorNode?.parentElement;
      if (anchorEl?.closest("[data-feedback-ui]")) return;

      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;

      setUi({
        mode: "bubble",
        text,
        anchor: { x: rect.left + rect.width / 2, y: rect.top },
        position: {
          x: rect.left + rect.width / 2 + window.scrollX,
          y: rect.top + window.scrollY,
        },
      });
    }

    function handlePointerDown(e: PointerEvent) {
      const target = e.target as Element | null;
      if (target?.closest("[data-feedback-ui]")) return;
      setUi((prev) => (prev.mode === "bubble" ? { mode: "idle" } : prev));
    }

    document.addEventListener("selectionchange", handleSelectionChange);
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(id);
  }, [toast]);

  const close = useCallback(() => setUi({ mode: "idle" }), []);

  const openLauncherPanel = useCallback(() => {
    setUi({ mode: "panel", anchor: null, draftComment: "" });
  }, []);

  async function handleDrawSend({ blob, note }: { blob: Blob; note: string }) {
    if (ui.mode !== "draw") return;
    const comment = note.trim() || t.drawNotePlaceholder;
    try {
      const pin = await submitFeedback(supabaseClient, ctx, {
        selectedText: ui.text,
        comment,
        attachment: { blob, kind: "drawing" },
        position: ui.position,
      });
      if (pin.metadata?.position) setPins((prev) => [...prev, pin]);
      setToast(t.sent);
    } catch {
      setToast(t.error);
    }
    setUi({ mode: "idle" });
  }

  return (
    <SupabaseClientContext.Provider value={supabaseClient}>
      {children}

      {pins.map((pin, i) => (
        <Pin key={pin.id} pin={pin} number={i + 1} locale={locale} />
      ))}

      {ui.mode === "bubble" && (
        <SelectionBubble
          locale={locale}
          x={ui.anchor.x}
          y={ui.anchor.y}
          onClick={() => {
            suppressNextClearRef.current = true;
            const { text, anchor, position } = ui;
            setUi({ mode: "panel", text, anchor, position, draftComment: "" });
            setTimeout(() => {
              suppressNextClearRef.current = false;
            }, 0);
          }}
        />
      )}

      {ui.mode === "panel" && (
        <div data-feedback-ui>
          <FeedbackPanel
            locale={locale}
            ctx={ctx}
            selectedText={ui.text}
            anchor={ui.anchor}
            position={ui.position}
            initialComment={ui.draftComment}
            onClose={close}
            onSubmitted={(pin) => {
              if (pin.metadata?.position) setPins((prev) => [...prev, pin]);
            }}
            onRequestDraw={(currentComment) => {
              const { text, anchor, position } = ui;
              setUi({
                mode: "draw",
                text,
                anchor,
                position,
                draftComment: currentComment,
              });
            }}
          />
        </div>
      )}

      {ui.mode === "draw" && (
        <div data-feedback-ui>
          <DrawOverlay
            locale={locale}
            initialNote={ui.draftComment}
            onCancel={() => {
              const { text, anchor, position, draftComment } = ui;
              setUi({ mode: "panel", text, anchor, position, draftComment });
            }}
            onSend={handleDrawSend}
          />
        </div>
      )}

      {ui.mode === "idle" && (
        <button
          type="button"
          data-feedback-ui
          onClick={openLauncherPanel}
          className="fixed bottom-4 z-[9996] flex items-center gap-1.5 rounded-full bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white shadow-xl hover:bg-neutral-800"
          style={{ insetInlineEnd: 16 }}
        >
          <ChatIcon className="shrink-0" />
          {t.launcher}
        </button>
      )}

      {toast && (
        <div
          data-feedback-ui
          className="fixed bottom-20 z-[9999] rounded-full bg-neutral-900 px-4 py-2 text-sm text-white shadow-xl"
          style={{ insetInlineEnd: 16 }}
        >
          {toast}
        </div>
      )}
    </SupabaseClientContext.Provider>
  );
}
