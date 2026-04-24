import type { Metadata } from "next";
import { AuthProvider } from "@/lib/auth-context";
import "./globals.css";

export const metadata: Metadata = {
  title: "StoryMatch",
  description: "The intelligent testimonial library for sales teams",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
