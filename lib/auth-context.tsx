"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from "react";
import { supabaseBrowser } from "./supabase-browser";
import type { User } from "@supabase/supabase-js";

export interface Org {
  id: string;
  name: string;
}

export interface OrgMembership extends Org {
  role: "admin" | "sales";
}

interface AuthContextValue {
  user: User | null;
  org: OrgMembership | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (
    email: string,
    password: string,
    inviteToken?: string
  ) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [org, setOrg] = useState<OrgMembership | null>(null);
  const [loading, setLoading] = useState(true);

  // Read the Supabase auth token directly from localStorage. We deliberately
  // avoid supabaseBrowser.auth.getSession() (and any supabase-js method that
  // calls it internally, including .rpc()) because it acquires an internal
  // lock that can deadlock OR fire before localStorage finishes restoring
  // the session. Same pattern as authHeaders() in StoryMatchApp.tsx — this
  // is the codebase's blessed way to attach auth.
  const readSupabaseToken = (): string | null => {
    if (typeof window === "undefined") return null;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith("sb-") && key.endsWith("-auth-token")) {
          const raw = localStorage.getItem(key);
          if (!raw) continue;
          try {
            const parsed = JSON.parse(raw);
            const token = parsed?.access_token || parsed?.currentSession?.access_token;
            if (token) return token as string;
          } catch {}
        }
      }
    } catch {}
    return null;
  };

  // Load current org for the authenticated user.
  //
  // Goes through fetch() directly with the localStorage-read token rather
  // than supabaseBrowser.rpc(). This avoids a race where supabase-js's
  // internal getSession() runs before the cached session has finished
  // restoring, sending the RPC with no auth header. PostgREST then runs
  // current_user_org_details() with auth.uid() = null and returns []
  // — which silently set org=null and made the admin rail disappear.
  const loadOrg = async (userId: string) => {
    void userId; // The function uses auth.uid() server-side; param kept for call-site clarity.
    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
      const apikey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
      const token = readSupabaseToken();
      if (!token) {
        // No token yet — don't clear org; trust a later auth event to retry.
        console.warn("loadOrg: no auth token in localStorage yet, skipping");
        return;
      }
      const r = await fetch(`${url}/rest/v1/rpc/current_user_org_details`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": apikey,
          "Authorization": `Bearer ${token}`,
        },
        body: "{}",
      });

      if (!r.ok) {
        console.error("loadOrg HTTP error:", r.status, await r.text());
        return; // don't clobber on transient failures
      }

      const rows = (await r.json()) as Array<{ org_id: string; org_name: string; role: string }>;
      if (!Array.isArray(rows) || rows.length === 0) {
        // Empty response with a valid token is unusual — log so we can see it.
        console.warn("loadOrg: RPC returned empty rows", rows);
        return; // again, don't clobber on a maybe-transient empty result
      }

      const first = rows[0];
      setOrg({
        id: first.org_id,
        name: first.org_name,
        role: first.role as "admin" | "sales",
      });
    } catch (e) {
      console.error("Failed to load org:", e);
      // don't clobber org state on transient errors
    }
  };

  const refresh = async () => {
    try {
      // Time-bound this call. If the Supabase lock hangs for any reason,
      // we want to fail open ("no user") rather than keep the app stuck on
      // the loading screen forever.
      const getUserPromise = supabaseBrowser.auth.getUser();
      const timeout = new Promise<{ data: { user: null } }>((resolve) =>
        setTimeout(() => resolve({ data: { user: null } }), 5000)
      );
      const { data: { user } } = (await Promise.race([getUserPromise, timeout])) as { data: { user: User | null } };
      // Only update state when getUser returned a definitive user. If it timed out
      // (user === null from the timeout fallback) we must NOT clear state here,
      // because onAuthStateChange may have already populated user/org from the
      // cached session — clearing would race-overwrite that good state and
      // hide the admin rail. SIGNED_OUT events still come through onAuthStateChange.
      if (user) {
        setUser(user);
        await loadOrg(user.id);
      }
    } catch (e) {
      console.error("auth refresh failed:", e);
      // Same reasoning: don't clobber state on transient errors.
    }
  };

  useEffect(() => {
    // Initial load
    refresh().finally(() => setLoading(false));

    // Listen to auth state changes.
    //
    // IMPORTANT: only clear user/org on an explicit SIGNED_OUT event. Some
    // auth events (transient INITIAL_SESSION before localStorage finishes
    // restoring, mid-flight TOKEN_REFRESHED, etc.) can fire with a null
    // session even though the user is genuinely logged in. Treating those
    // as logout would race with an earlier successful loadOrg call and
    // leave org=null — that was the "admin rail disappears in normal Chrome
    // but works in incognito/with DevTools open" bug.
    const { data: { subscription } } = supabaseBrowser.auth.onAuthStateChange(
      async (event, session) => {
        if (event === "SIGNED_OUT") {
          setUser(null);
          setOrg(null);
          return;
        }
        if (session?.user) {
          setUser(session.user);
          await loadOrg(session.user.id);
        }
        // Any other null-session event: ignore. Trust prior good state.
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabaseBrowser.auth.signInWithPassword({
      email,
      password,
    });
    return { error: error?.message || null };
  };

  const signUp = async (
    email: string,
    password: string,
    inviteToken?: string
  ) => {
    // Sign-up goes through our API route so we can validate the invite token server-side
    try {
      const r = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, inviteToken }),
      });
      const result = await r.json();
      if (!r.ok) return { error: result.error || "Sign-up failed" };

      // After signup, immediately sign in
      const { error: signInError } = await supabaseBrowser.auth.signInWithPassword({
        email,
        password,
      });
      if (signInError) return { error: signInError.message };

      return { error: null };
    } catch (e) {
      return { error: (e as Error).message };
    }
  };

  const signOut = async () => {
    // Clear local state FIRST so the UI updates and the auth gate redirects
    // even if supabase.auth.signOut() hangs (it has been observed to do so
    // under the same lock conditions that affect getUser — see handoff §10.1).
    setUser(null);
    setOrg(null);
    // Fire-and-forget the actual sign out. SIGNED_OUT event will also fire
    // and is handled by the listener above for any additional cleanup.
    supabaseBrowser.auth.signOut().catch((e) => {
      console.error("auth.signOut failed:", e);
    });
  };

  return (
    <AuthContext.Provider
      value={{ user, org, loading, signIn, signUp, signOut, refresh }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
