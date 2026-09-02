import { createContext, useContext } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

export const SupabaseClientContext = createContext<SupabaseClient | null>(null);

export function useFeedbackSupabaseClient(): SupabaseClient {
  const client = useContext(SupabaseClientContext);
  if (!client) {
    throw new Error(
      "toko-feedback-widget: no Supabase client found. Make sure this component is rendered inside <FeedbackProvider supabaseClient={...}>."
    );
  }
  return client;
}
