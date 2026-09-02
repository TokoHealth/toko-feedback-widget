"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { FeedbackPin, Locale, PagePosition } from "./types";
import { STRINGS } from "./i18n";
import { SupabaseClientContext, feedbackClient } from "./client";
import { SelectionBubble } from "./SelectionBubble";
import { FeedbackPanel } from "./FeedbackPanel";
import { DrawOverlay } from "./DrawOverlay";
import { Pin } from "./Pin";
import { fetchPinsForPage, submitFeedback } from "./uploadFeedback";
import { ChatIcon } from "./icons";

interface FeedbackProviderProps {
  /** Optional. Defaults to the widget's own client, pointed at the shared
   *  feedback project -- pass one only to override it (tests, a fork). */
  supabaseClient?: SupabaseClient;
  /** Identifies which product this feedback came from, e.g. "toko-app". */
  product: string;
  /** Defaults to Vercel's VERCEL_ENV, else "production". */
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

// This package has no @types/node, and should not: it runs in a browser. The
// declaration is here only so the one expression below type-checks.
declare const process: { env: Record<string, string | undefined> };

/**
 * production / preview / development on Vercel; "production" anywhere else.
 *
 * Written as the literal `process.env.NEXT_PUBLIC_VERCEL_ENV` on purpose.
 * Bundlers substitute that exact expression at build time; behind an optional
 * chain or a destructure they do not, and it silently reads undefined in the
 * browser. When it is not substituted the identifier does not exist at all, so
 * the reference throws and the catch supplies the default.
 */
function defaultEnvironment(): string {
  try {
    return process.env.NEXT_PUBLIC_VERCEL_ENV ?? "production";
  } catch {
    return "production";
  }
}

export function FeedbackProvider({
  supabaseClient,
  product,
  environment = defaultEnvironment(),
  createdByEmail,
  locale = "en",
  children,
}: FeedbackProviderProps) {
  // Every consumer built the same client from the same two constants, which is
  // a property of this widget rather than of any of them.
  const client = supabaseClient ?? feedbackClient();
  const [ui, setUi] = useState<UIState>({ mode: "idle" });
  const [toast, setToast] = useState<string | null>(null);
  const [pins, setPins] = useState<FeedbackPin[]>([]);
  const suppressNextClearRef = useRef(false);
  const [portalNode, setPortalNode] = useState<HTMLElement | null>(null);

  const ctx = { product, environment, createdByEmail };
  const t = STRINGS[locale];

  // Rendered into its own node appended to <body> -- not wherever the host
  // happens to mount this provider -- so none of our UI ever becomes a DOM
  // sibling of the host's content. A sibling is enough to break it: sibling
  // combinators (`space-y-*`, `:nth-child`, `:first-child`) start counting
  // our elements, and our `position: fixed`/`absolute` elements pick up
  // whatever ancestor the host happens to nest us under as their containing
  // block if it has `transform`/`filter`/`contain`, instead of the viewport.
  useEffect(() => {
    const node = document.createElement("div");
    node.setAttribute("data-feedback-widget-root", "");
    document.body.appendChild(node);
    setPortalNode(node);
    return () => {
      document.body.removeChild(node);
    };
  }, []);

  useEffect(() => {
    fetchPinsForPage(client, product, window.location.href)
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
      const pin = await submitFeedback(client, ctx, {
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
    <SupabaseClientContext.Provider value={client}>
      {children}

      {portalNode &&
        createPortal(
          <>
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
                  setUi({
                    mode: "panel",
                    text,
                    anchor,
                    position,
                    draftComment: "",
                  });
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
                    if (pin.metadata?.position)
                      setPins((prev) => [...prev, pin]);
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
                    setUi({
                      mode: "panel",
                      text,
                      anchor,
                      position,
                      draftComment,
                    });
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
          </>,
          portalNode
        )}
    </SupabaseClientContext.Provider>
  );
}
