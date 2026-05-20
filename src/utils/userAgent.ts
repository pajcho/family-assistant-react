/**
 * Lightweight User-Agent parser, just for labelling push-subscription
 * rows in the settings UI. Returns a short "Browser · OS" string —
 * e.g. "Chrome · macOS" or "Safari · iPhone". Detection order matters
 * (e.g. Edge advertises both "Edg/" and "Chrome/", so Edge must be
 * checked first).
 *
 * Intentionally not exhaustive — we only need enough resolution for the
 * user to recognise their own devices in the session list.
 */

export interface ParsedUserAgent {
  browser: string;
  os: string;
  /** Pretty label "Browser · OS", or just one of them when the other is unknown. */
  label: string;
}

const UNKNOWN = "Nepoznat uređaj";

function detectBrowser(ua: string): string {
  if (/Edg\//.test(ua)) return "Edge";
  if (/OPR\/|Opera\//.test(ua)) return "Opera";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Chrome\//.test(ua)) return "Chrome";
  // Safari's UA includes "Safari/" but so does Chrome's — Chrome was
  // already returned above, so anything left with "Safari/" is real Safari.
  if (/Safari\//.test(ua)) return "Safari";
  return "";
}

function detectOs(ua: string): string {
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  if (/Windows NT/.test(ua)) return "Windows";
  // "Mac OS X" appears in iOS UAs too — iPhone/iPad were already
  // matched above, so this branch is desktop only.
  if (/Mac OS X|Macintosh/.test(ua)) return "macOS";
  if (/Linux/.test(ua)) return "Linux";
  return "";
}

export function parseUserAgent(ua: string | null | undefined): ParsedUserAgent {
  const value = (ua ?? "").trim();
  if (!value) return { browser: "", os: "", label: UNKNOWN };
  const browser = detectBrowser(value);
  const os = detectOs(value);
  if (browser && os) return { browser, os, label: `${browser} · ${os}` };
  if (browser) return { browser, os: "", label: browser };
  if (os) return { browser: "", os, label: os };
  return { browser: "", os: "", label: UNKNOWN };
}
