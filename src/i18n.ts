import type { Locale } from "./types";

export const DIR: Record<Locale, "ltr" | "rtl"> = {
  en: "ltr",
  he: "rtl",
};

export const STRINGS = {
  en: {
    suggestEdit: "Suggest edit",
    launcher: "Feedback",
    panelTitleWithSelection: "Suggest an edit",
    panelTitle: "Send feedback",
    selectedTextLabel: "Selected text",
    commentPlaceholder: "What should change, and why?",
    drawOnScreenshot: "Draw on screenshot",
    attachImage: "Attach image",
    pasteHint: "Tip: paste a screenshot with ⌘V / Ctrl+V",
    cancel: "Cancel",
    send: "Send",
    sending: "Sending…",
    sent: "Feedback sent — thank you!",
    error: "Couldn't send feedback. Try again.",
    removeAttachment: "Remove",
    drawNotePlaceholder: "Add a note to your drawing",
    undo: "Undo",
    redo: "Redo",
    commentRequired: "Add a short comment before sending.",
  },
  he: {
    suggestEdit: "הצע עריכה",
    launcher: "משוב",
    panelTitleWithSelection: "הצעת עריכה",
    panelTitle: "שליחת משוב",
    selectedTextLabel: "טקסט מסומן",
    commentPlaceholder: "מה צריך לשנות, ולמה?",
    drawOnScreenshot: "צייר על צילום מסך",
    attachImage: "צרף תמונה",
    pasteHint: "טיפ: הדבק צילום מסך עם ⌘V / Ctrl+V",
    cancel: "ביטול",
    send: "שליחה",
    sending: "שולח…",
    sent: "המשוב נשלח — תודה!",
    error: "שליחת המשוב נכשלה. נסו שוב.",
    removeAttachment: "הסר",
    drawNotePlaceholder: "הוסף הערה לציור",
    undo: "בטל",
    redo: "בצע שוב",
    commentRequired: "הוסיפו הערה קצרה לפני השליחה.",
  },
} satisfies Record<Locale, Record<string, string>>;

export function detectLocale(): Locale {
  if (typeof document === "undefined") return "en";
  return document.documentElement.lang?.toLowerCase().startsWith("he")
    ? "he"
    : "en";
}
