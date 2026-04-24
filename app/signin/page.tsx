"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import Link from "next/link";

export default function SignInPage() {
  const router = useRouter();
  const { signIn, user, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // If already logged in, redirect to home
  useEffect(() => {
    if (!loading && user) router.replace("/");
  }, [user, loading, router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error } = await signIn(email, password);
    setSubmitting(false);
    if (error) setError(error);
    else router.replace("/");
  };

  return (
    <div style={{
      minHeight: "100vh",
      display: "grid",
      placeItems: "center",
      background: "#f7f7f8",
      fontFamily: "'Instrument Sans', system-ui, sans-serif",
      padding: 20,
    }}>
      <div style={{
        width: "100%",
        maxWidth: 380,
        background: "#fff",
        borderRadius: 14,
        padding: 32,
        boxShadow: "0 4px 24px rgba(0,0,0,.06)",
        border: "1px solid #eaeaed",
      }}>
        <div style={{
          fontFamily: "'Newsreader', Georgia, serif",
          fontSize: 26,
          fontWeight: 500,
          letterSpacing: -0.5,
          marginBottom: 6,
          color: "#1a1a1f",
        }}>
          Welcome back
        </div>
        <div style={{ fontSize: 13, color: "#6b6b78", marginBottom: 22 }}>
          Sign in to StoryMatch
        </div>

        <form onSubmit={submit}>
          <label style={labelStyle}>Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
            style={inputStyle}
            placeholder="you@company.com"
          />

          <label style={labelStyle}>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={inputStyle}
            placeholder="Your password"
          />

          {error && (
            <div style={{
              fontSize: 12,
              color: "#c23030",
              background: "#fff5f5",
              border: "1px solid #ffdddd",
              borderRadius: 7,
              padding: "8px 10px",
              marginBottom: 14,
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            style={{
              width: "100%",
              padding: "11px",
              borderRadius: 9,
              border: "none",
              background: "#6d28d9",
              color: "#fff",
              fontFamily: "inherit",
              fontSize: 14,
              fontWeight: 700,
              cursor: submitting ? "wait" : "pointer",
              opacity: submitting ? 0.6 : 1,
              marginBottom: 16,
            }}
          >
            {submitting ? "Signing in..." : "Sign in"}
          </button>
        </form>

        <div style={{ fontSize: 12, color: "#6b6b78", textAlign: "center" }}>
          New to StoryMatch?{" "}
          <Link href="/signup" style={{ color: "#6d28d9", fontWeight: 600, textDecoration: "none" }}>
            Create an account
          </Link>
        </div>
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 10,
  textTransform: "uppercase",
  letterSpacing: 1,
  color: "#8888a0",
  fontWeight: 700,
  marginBottom: 5,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 8,
  border: "1.5px solid #eaeaed",
  background: "#fff",
  color: "#1a1a1f",
  fontFamily: "inherit",
  fontSize: 14,
  marginBottom: 14,
  boxSizing: "border-box",
};
