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

  // Load current org for the authenticated user
  const loadOrg = async (userId: string) => {
    try {
      const { data, error } = await supabaseBrowser
        .from("org_members")
        .select("role, org_id, organizations(id, name)")
        .eq("user_id", userId)
        .limit(1)
        .maybeSingle();

      if (error || !data) {
        setOrg(null);
        return;
      }

      // Supabase returns the joined table as an object or array depending on the relation
      const orgData = Array.isArray(data.organizations)
        ? data.organizations[0]
        : data.organizations;

      if (orgData) {
        setOrg({
          id: orgData.id,
          name: orgData.name,
          role: data.role as "admin" | "sales",
        });
      } else {
        setOrg(null);
      }
    } catch (e) {
      console.error("Failed to load org:", e);
      setOrg(null);
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
      setUser(user);
      if (user) {
        await loadOrg(user.id);
      } else {
        setOrg(null);
      }
    } catch (e) {
      console.error("auth refresh failed:", e);
      setUser(null);
      setOrg(null);
    }
  };

  useEffect(() => {
    // Initial load
    refresh().finally(() => setLoading(false));

    // Listen to auth state changes
    const { data: { subscription } } = supabaseBrowser.auth.onAuthStateChange(
      async (_event, session) => {
        setUser(session?.user || null);
        if (session?.user) {
          await loadOrg(session.user.id);
        } else {
          setOrg(null);
        }
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
    await supabaseBrowser.auth.signOut();
    setUser(null);
    setOrg(null);
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
