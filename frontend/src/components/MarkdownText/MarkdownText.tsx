import { renderMarkdown } from "@/lib/renderMarkdown";
import styles from "./MarkdownText.module.css";

interface MarkdownTextProps {
  children: string;
}

/**
 * Renders an Assistant's `summary`/`reason` text (now written as markdown, per the prompt
 * contract) with the same code/heading/list typography as MarkdownPreviewCard's file
 * preview — but no card chrome (border/background/header) around it, since this sits
 * inline as running text rather than previewing a whole file.
 */
export function MarkdownText({ children }: MarkdownTextProps) {
  return <div className={styles.body}>{renderMarkdown(children)}</div>;
}
