import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/cn";

export type MarkdownTextProps = {
  content: string;
  /** Extra classes for the wrapping <div>. */
  className?: string;
};

/**
 * Renders user-supplied markdown (list / item descriptions) with a small,
 * project-local set of element overrides.
 *
 * We don't use the `@tailwindcss/typography` plugin — the surface area is
 * narrow (a handful of formatted paragraphs), so a few Tailwind utility
 * classes per element get us a consistent look without dragging in a
 * full prose stylesheet.
 *
 * `react-markdown` strips raw HTML by default so this is XSS-safe even
 * though the markdown text originates from user input.
 *
 * `remark-gfm` adds GitHub-flavoured extras (task lists, tables, ~~strikethrough~~,
 * autolinks) which match what users will paste from a chat or notes app.
 */
export function MarkdownText({ content, className }: MarkdownTextProps) {
  return (
    <div
      className={cn(
        "text-sm leading-relaxed text-gray-700 dark:text-gray-300",
        // Reset the dialog's overall vertical rhythm — markdown blocks get
        // their own breathing room from the component overrides below.
        "space-y-2",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="leading-relaxed">{children}</p>,
          h1: ({ children }) => (
            <h1 className="text-base font-semibold text-gray-900 dark:text-gray-100">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{children}</h3>
          ),
          ul: ({ children }) => <ul className="list-disc space-y-1 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5">{children}</ol>,
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 underline underline-offset-2 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
            >
              {children}
            </a>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold text-gray-900 dark:text-gray-100">{children}</strong>
          ),
          em: ({ children }) => <em className="italic">{children}</em>,
          code: ({ children }) => (
            <code className="rounded bg-gray-100 px-1 py-0.5 text-xs font-mono text-gray-800 dark:bg-gray-700 dark:text-gray-200">
              {children}
            </code>
          ),
          pre: ({ children }) => (
            <pre className="overflow-x-auto rounded-md bg-gray-100 p-3 text-xs font-mono text-gray-800 dark:bg-gray-900 dark:text-gray-200">
              {children}
            </pre>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-gray-300 pl-3 italic text-gray-600 dark:border-gray-600 dark:text-gray-400">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="border-gray-200 dark:border-gray-700" />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

/**
 * Reduce a markdown string to a single-line preview suitable for
 * truncation with CSS `truncate`. We strip the most common syntax noise
 * (`#`, `*`, leading list bullets, surrounding emphasis chars) so the
 * preview reads as plain prose rather than as raw markdown.
 *
 * Edge cases (table rows, code blocks, links) intentionally degrade to
 * the raw text — the popup gives the user the formatted view; the
 * preview just needs to hint that a description exists.
 */
export function previewLine(description: string | null | undefined): string {
  if (!description) return "";
  const firstLine = description.split(/\r?\n/).find((line) => line.trim().length > 0);
  if (!firstLine) return "";
  return firstLine
    .replace(/^\s*[-*+]\s+/, "")
    .replace(/^\s*#{1,6}\s+/, "")
    .replace(/^\s*>\s+/, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/_(.+?)_/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/\[(.+?)\]\(.+?\)/g, "$1")
    .trim();
}
