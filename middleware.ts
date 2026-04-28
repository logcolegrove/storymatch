import { NextResponse, NextRequest } from "next/server";

// Set an anonymous visitor cookie on every /s/* request so we can distinguish
// distinct viewers of the same share link (e.g. detect whether a recipient
// forwarded the link to additional people). The cookie is just a random ID —
// no PII, no cross-site tracking, scoped to this domain.

function generateVisitorId(): string {
  // Web Crypto — works in the Edge runtime where this middleware executes.
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

export function middleware(req: NextRequest) {
  if (!req.nextUrl.pathname.startsWith("/s/")) {
    return NextResponse.next();
  }

  // If the visitor already has an ID, leave it alone.
  if (req.cookies.get("sm_visitor_id")?.value) {
    return NextResponse.next();
  }

  const res = NextResponse.next();
  res.cookies.set("sm_visitor_id", generateVisitorId(), {
    maxAge: 60 * 60 * 24 * 365 * 2, // 2 years
    httpOnly: false, // client JS needs to read this to include in event POSTs
    sameSite: "lax",
    path: "/",
  });
  return res;
}

export const config = {
  matcher: ["/s/:path*"],
};
