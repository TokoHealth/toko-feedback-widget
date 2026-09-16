// Turns a feedback row into Linear's IssueCreateInput. No I/O.

export type FeedbackRow = {
  id: string;
  product: string;
  environment: string;
  url: string;
  page_title: string | null;
  comment: string;
  selected_text: string | null;
  created_by_email: string | null;
  screenshot_path: string | null;
  annotated_image_path: string | null;
  linear_attempts: number;
};

export type IssueInput = {
  id: string;
  teamId: string;
  title: string;
  description: string;
};

const TITLE_MAX = 80;
const TEXT_MAX = 10_000;

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1) + "…";
}

// For single-line values inside Markdown: no line breaks, links or images.
function inline(text: string): string {
  return text.replace(/\s+/g, " ").replace(/[\\[\]()<>!`*_]/g, "\\$&");
}

function quote(text: string): string {
  return truncate(text, TEXT_MAX).split("\n").map((line) => `> ${line}`).join("\n");
}

// Ends every description. Duplicate recovery checks for it, because anon
// callers can choose a row id that matches someone else's issue.
export function rowMarker(id: string): string {
  return `Feedback row \`${id}\``;
}

export function publicImageUrl(supabaseUrl: string, path: string): string {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return `${supabaseUrl}/storage/v1/object/public/feedback-attachments/${encoded}`;
}

export function buildIssueInput(
  row: FeedbackRow,
  opts: { teamId: string; supabaseUrl: string },
): IssueInput {
  const firstLine = row.comment.trim().split("\n")[0];
  const title = truncate(`[${row.product}] ${firstLine}`.replace(/\s+/g, " "), TITLE_MAX);

  const parts = [quote(row.comment)];
  if (row.selected_text) parts.push(`**Selected text**\n\n${quote(row.selected_text)}`);
  parts.push(
    [
      `**Reporter:** ${inline(row.created_by_email ?? "unknown")}`,
      `**Environment:** ${inline(row.environment)}`,
      `**Page:** [${inline(row.page_title || row.url)}](<${row.url.replace(/[\s<>\\]/g, encodeURIComponent)}>)`,
    ].join("  \n"),
  );
  for (const [label, path] of [["Screenshot", row.screenshot_path], ["Drawing", row.annotated_image_path]]) {
    if (path) parts.push(`![${label}](<${publicImageUrl(opts.supabaseUrl, path)}>)`);
  }
  parts.push(rowMarker(row.id));

  return { id: row.id, teamId: opts.teamId, title, description: parts.join("\n\n") };
}
