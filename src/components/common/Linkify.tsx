import { Fragment } from "react";

import { linkifyParts } from "@/utils/linkify";

export type LinkifyProps = {
  text: string;
  /** Classes applied to each rendered `<a>`. Defaults to the standard link look. */
  linkClassName?: string;
};

const DEFAULT_LINK_CLASS =
  "text-blue-600 underline underline-offset-2 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300";

/**
 * Render plain text with bare URLs turned into real, clickable `<a>` links
 * (Todoist-style). Used for list-item titles, which are stored as plain
 * text — Markdown descriptions go through `MarkdownText`, which autolinks
 * on its own.
 *
 * Each link stops click propagation so tapping a URL inside a clickable row
 * opens the URL instead of the row's detail dialog.
 */
export function Linkify({ text, linkClassName }: LinkifyProps) {
  const parts = linkifyParts(text);
  return (
    <>
      {parts.map((part, index) =>
        part.type === "link" ? (
          <a
            key={index}
            href={part.href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => event.stopPropagation()}
            className={linkClassName ?? DEFAULT_LINK_CLASS}
          >
            {part.value}
          </a>
        ) : (
          <Fragment key={index}>{part.value}</Fragment>
        ),
      )}
    </>
  );
}
