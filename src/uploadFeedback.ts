import type { SupabaseClient } from "@supabase/supabase-js";
import type { FeedbackContext, FeedbackPin, FeedbackSubmission } from "./types";

const BUCKET = "feedback-attachments";
const TABLE = "feedback_items";

export async function submitFeedback(
  client: SupabaseClient,
  ctx: FeedbackContext,
  submission: FeedbackSubmission
): Promise<FeedbackPin> {
  let screenshotPath: string | null = null;
  let annotatedImagePath: string | null = null;

  if (submission.attachment) {
    const path = `${ctx.product}/${crypto.randomUUID()}.png`;
    const { error: uploadError } = await client.storage
      .from(BUCKET)
      .upload(path, submission.attachment.blob, {
        contentType: submission.attachment.blob.type || "image/png",
        upsert: false,
      });
    if (uploadError) throw uploadError;

    if (submission.attachment.kind === "drawing") {
      annotatedImagePath = path;
    } else {
      screenshotPath = path;
    }
  }

  const { data, error: insertError } = await client
    .from(TABLE)
    .insert({
      created_by_email: ctx.createdByEmail ?? null,
      product: ctx.product,
      environment: ctx.environment,
      url: window.location.href,
      page_title: document.title,
      selected_text: submission.selectedText ?? null,
      comment: submission.comment,
      screenshot_path: screenshotPath,
      annotated_image_path: annotatedImagePath,
      element_selector: submission.elementSelector ?? null,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        dpr: window.devicePixelRatio,
      },
      user_agent: navigator.userAgent,
      metadata: submission.position ? { position: submission.position } : {},
    })
    .select(
      "id, created_at, created_by_email, comment, selected_text, status, screenshot_path, annotated_image_path, metadata"
    )
    .single();
  if (insertError) throw insertError;
  return data as FeedbackPin;
}

export async function fetchPinsForPage(
  client: SupabaseClient,
  product: string,
  url: string
): Promise<FeedbackPin[]> {
  const { data, error } = await client
    .from(TABLE)
    .select(
      "id, created_at, created_by_email, comment, selected_text, status, screenshot_path, annotated_image_path, metadata"
    )
    .eq("product", product)
    .eq("url", url)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return ((data as FeedbackPin[]) ?? []).filter((row) => row.metadata?.position);
}

export function publicUrlFor(client: SupabaseClient, path: string | null) {
  if (!path) return null;
  return client.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}
