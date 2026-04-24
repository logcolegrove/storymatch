"use client";

import { createClient } from "@supabase/supabase-js";

// This client uses the PUBLISHABLE key — safe to expose in the browser.
// All queries are protected by RLS policies in the database.

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

if (!url || !publishableKey) {
  throw new Error(
    "Missing Supabase environment variables. Check .env.local for NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY."
  );
}

export const supabaseBrowser = createClient(url, publishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
