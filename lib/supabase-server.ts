import { createClient } from "@supabase/supabase-js";

// This client uses the SECRET key — only import from server-side code
// (API routes in `src/app/api/`). Never import this into client components.

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;

if (!url || !secretKey) {
  throw new Error(
    "Missing Supabase environment variables. Check .env.local for NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY."
  );
}

export const supabaseAdmin = createClient(url, secretKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});
