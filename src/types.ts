export type Locale = "en" | "he";

export type FeedbackStatus = "open" | "in_progress" | "resolved" | "wont_fix";

export interface FeedbackContext {
  product: string;
  environment: string;
  createdByEmail?: string;
}

export interface PendingAttachment {
  blob: Blob;
  /** "drawing" -> stored as annotated_image_path, "attachment" -> stored as screenshot_path */
  kind: "drawing" | "attachment";
}

export interface PagePosition {
  x: number;
  y: number;
}

export interface FeedbackSubmission {
  selectedText?: string;
  comment: string;
  attachment?: PendingAttachment;
  elementSelector?: string;
  position?: PagePosition;
}

export interface FeedbackPin {
  id: string;
  created_at: string;
  created_by_email: string | null;
  comment: string;
  selected_text: string | null;
  status: FeedbackStatus;
  screenshot_path: string | null;
  annotated_image_path: string | null;
  metadata: { position?: PagePosition } | null;
}
