import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import { useCallback } from "react";
import { docsImageUrl, getGettingStarted } from "@/lib/api";
import { useAsync } from "@/hooks/useAsync";
import { Dialog } from "../Dialog/Dialog";
import styles from "./HelpDialog.module.css";

// Module-level, not inline in the component, so react-markdown doesn't get a fresh
// function identity (and remount its rendered elements) on every render.
const MARKDOWN_COMPONENTS: Components = {
  // Doc source keeps repo-relative paths (correct for viewing docs/GETTING_STARTED.md
  // on disk/GitHub) -- only the in-app render needs them rewritten to the backend that
  // actually serves them.
  img: ({ src, alt }) => (
    <img
      src={typeof src === "string" ? docsImageUrl(src.replace(/^images\//, "")) : src}
      alt={alt}
      className={styles.image}
    />
  ),
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
};

interface HelpDialogProps {
  open: boolean;
  onClose: () => void;
}

/** GETTING_STARTED.md is real markdown (headings, links, fenced code, images) — unlike
 * the narrow subset `renderMarkdown` handles (the backend's own generated context/
 * requirements/tasks files), so this pulls in a real parser rather than stretching that
 * one past what its docstring scopes it to. */
export function HelpDialog({ open, onClose }: HelpDialogProps) {
  const fetcher = useCallback(() => (open ? getGettingStarted() : Promise.resolve(null)), [open]);
  const { data } = useAsync(fetcher, [open]);

  return (
    <Dialog open={open} onClose={onClose} title="Getting Started" size="large">
      <div className={styles.markdown}>
        {data ? (
          <ReactMarkdown components={MARKDOWN_COMPONENTS}>{data.content}</ReactMarkdown>
        ) : (
          "Loading…"
        )}
      </div>
    </Dialog>
  );
}
