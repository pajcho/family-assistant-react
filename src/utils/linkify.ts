/**
 * A run of plain text, or a detected URL ready to render as an `<a>`.
 */
export type LinkPart =
  | { type: "text"; value: string }
  | { type: "link"; value: string; href: string };

// Bare http(s):// or www. URLs, grabbed up to the next whitespace/angle
// bracket. Trailing sentence punctuation is peeled off afterwards in
// `splitTrailing`, so e.g. "https://x.com." links only "https://x.com".
const URL_REGEX = /(?:https?:\/\/|www\.)[^\s<>]+/gi;

/** Peel trailing sentence punctuation / an unbalanced ")" off a matched URL. */
function splitTrailing(raw: string): { core: string; trailing: string } {
  let core = raw;
  let trailing = "";
  while (core.length > 0) {
    const last = core[core.length - 1];
    const isPunct = ".,;:!?'\"".includes(last);
    // A ")" only belongs to the URL when it balances a "(" inside it
    // (e.g. a Wikipedia "..._(disambiguation)" link). Otherwise it's the
    // closing paren of a "URL (note)" title and should stay as text.
    const isUnbalancedParen = last === ")" && !core.includes("(");
    if (!isPunct && !isUnbalancedParen) break;
    trailing = last + trailing;
    core = core.slice(0, -1);
  }
  return { core, trailing };
}

/**
 * Turn a bare URL into a safe absolute href, or `null` when it doesn't look
 * like a real dotted host. The host check rejects noise like a stray "www."
 * or "http://localhost" so we don't render dead links inside titles.
 */
function toHref(url: string): string | null {
  const candidate = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  try {
    const { hostname } = new URL(candidate);
    if (!/\.[a-z]{2,}$/i.test(hostname)) return null;
    return candidate;
  } catch {
    return null;
  }
}

/**
 * Split plain text into alternating text / link parts, detecting bare
 * http(s):// and www. URLs (Todoist-style autolinking).
 *
 * Used for list-item *titles*, which are stored as plain text. Descriptions
 * go through Markdown instead (`MarkdownText` autolinks via remark-gfm), so
 * this is intentionally title-only.
 */
export function linkifyParts(text: string): LinkPart[] {
  const parts: LinkPart[] = [];
  if (!text) return parts;

  let lastIndex = 0;
  for (const match of text.matchAll(URL_REGEX)) {
    const start = match.index ?? 0;
    const raw = match[0];
    const { core, trailing } = splitTrailing(raw);
    const href = toHref(core);

    // Not a real URL - leave it folded into the surrounding text (its
    // characters get picked up by the next slice / the trailing tail).
    if (!href) continue;

    if (start > lastIndex) {
      parts.push({ type: "text", value: text.slice(lastIndex, start) });
    }
    parts.push({ type: "link", value: core, href });
    if (trailing) parts.push({ type: "text", value: trailing });
    lastIndex = start + raw.length;
  }

  if (lastIndex < text.length) {
    parts.push({ type: "text", value: text.slice(lastIndex) });
  }
  return parts;
}
