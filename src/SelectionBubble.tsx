"use client";

import type { Locale } from "./types";
import { STRINGS } from "./i18n";
import { EditIcon } from "./icons";

interface SelectionBubbleProps {
  locale: Locale;
  x: number;
  y: number;
  onClick: () => void;
}

export function SelectionBubble({ locale, x, y, onClick }: SelectionBubbleProps) {
  const t = STRINGS[locale];
  return (
    <button
      type="button"
      data-feedback-ui
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      style={{
        position: "fixed",
        top: y,
        left: x,
        transform: "translate(-50%, -110%)",
      }}
      className="z-[9997] flex items-center gap-1.5 rounded-full bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white shadow-lg hover:bg-neutral-800"
    >
      <EditIcon className="shrink-0" />
      {t.suggestEdit}
    </button>
  );
}
