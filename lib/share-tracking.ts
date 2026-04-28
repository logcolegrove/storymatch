// Shared helpers for the share-tracking feature.

import { createHash } from "crypto";

// Hash an IP into a short, server-side-salted digest. Used both for self-view
// detection (compare visitor's hash against share's sender_ip_hash) and as a
// rough device-level identifier for events.
export function hashIp(ip: string): string {
  return createHash("sha256")
    .update(ip + "|storymatch-share")
    .digest("hex")
    .slice(0, 16);
}

// User-agent patterns that indicate a bot, link-preview scanner, or email
// security gateway — NOT a real human prospect. Skip these events so the
// dashboard isn't polluted with noise from Outlook safelinks, Slack
// previews, Microsoft/Google/Mimecast/Proofpoint scanners, etc.
const BOT_PATTERNS = /\b(bot|crawl|spider|scraper|fetcher|preview|scanner|safelinks|whatsapp|telegrambot|slackbot|discordbot|linkedinbot|twitterbot|facebookexternalhit|skypeuripreview|outlookmobile|mimecast|barracuda|proofpoint|symantec|trend\s*micro|forcepoint|cisco|panda|kaspersky)\b/i;

export function isBotUserAgent(ua: string | null | undefined): boolean {
  if (!ua) return false;
  return BOT_PATTERNS.test(ua);
}
