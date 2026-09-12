import { createContext, useContext } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// The shared feedback project -- Toko Internal. This is a property of the
// WIDGET, not of each app that installs it: the whole point is that every
// product's feedback lands in one inbox, so there is only ever one right
// answer here and no reason to make each consumer supply it.
//
// It points at a project that exists for internal tooling and NOTHING ELSE.
// The previous target was Toko Studio's own application database, which meant
// deleting that product's project silently took the feedback inbox for every
// other product with it -- and left no trace, because the table had been
// created by hand in the dashboard. The schema now lives in
// supabase/migrations/ so that can't happen twice.
//
// The key is a PUBLISHABLE one -- designed to be served to browsers, and it
// grants exactly one thing: writing a row into the feedback table. Every
// consumer already ships it to the browser anyway; carrying it here just means
// they no longer have to know that.
const FEEDBACK_URL = "https://xgyjsepvuybmdlwbbdth.supabase.co";
const FEEDBACK_PUBLISHABLE_KEY = "sb_publishable_zju7LgG8i9hnKdz89nuw8g_qUjpJ9IX";

let builtIn: SupabaseClient | null = null;

/**
 * The widget's own client, created once per tab.
 *
 * Callers may still pass their own to <FeedbackProvider supabaseClient={...}>
 * -- useful in tests, or to point a fork at a different project -- but they no
 * longer have to.
 */
export function feedbackClient(): SupabaseClient {
  // One per tab. A fresh client per render opens a new realtime connection
  // every time.
  builtIn ??= createClient(FEEDBACK_URL, FEEDBACK_PUBLISHABLE_KEY);
  return builtIn;
}

export const SupabaseClientContext = createContext<SupabaseClient | null>(null);

export function useFeedbackSupabaseClient(): SupabaseClient {
  // Falls back to the built-in client rather than throwing: with the provider
  // supplying one by default there is no configuration left to get wrong, so
  // an exception here would only ever fire for a component rendered outside
  // the provider -- which the context default already handles.
  return useContext(SupabaseClientContext) ?? feedbackClient();
}
