"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import StoryMatchApp from "./StoryMatchApp";

export default function Home() {
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/signin");
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "#f7f7f8",
        fontFamily: "'Instrument Sans', system-ui, sans-serif",
        fontSize: 13,
        color: "#6b6b78",
      }}>
        Loading...
      </div>
    );
  }

  if (!user) return null; // redirecting

  return <StoryMatchApp />;
}
