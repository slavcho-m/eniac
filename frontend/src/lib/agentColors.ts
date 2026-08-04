import type { AgentBackend } from "@/components/AgentSelect/AgentSelect";

/** Each agent's brand accent, as a reference to the solid (fully opaque) CSS var already
 * defined in tokens.css -- lets PromptInput's border ring read as "Claude" (terracotta) or
 * "Codex" (grey) in the agent's own full-strength color, not a translucent tint. */
export const AGENT_ACCENT_COLOR: Record<AgentBackend, string> = {
  claude: "var(--claude)",
  codex: "var(--codex)",
};
