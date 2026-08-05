import { Asterisk, Terminal } from "lucide-react";
import type { ComponentType, CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AGENT_ACCENT_COLOR } from "@/lib/agentColors";
import { cn } from "@/lib/cn";
import styles from "../ModeSelect/ModeSelect.module.css";

export type AgentBackend = "claude" | "codex";

interface AgentOption {
  value: AgentBackend;
  label: string;
  description: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
}

// Record, not an array -- same reasoning as ModeSelect's MODES. Key order is render order
// (Claude, Codex).
const AGENTS: Record<AgentBackend, AgentOption> = {
  claude: { value: "claude", label: "Claude", description: "Anthropic's Claude Code CLI.", icon: Asterisk },
  codex: { value: "codex", label: "Codex", description: "OpenAI's Codex CLI.", icon: Terminal },
};

interface AgentSelectProps {
  value: AgentBackend;
  onChange: (agent: AgentBackend) => void;
  disabled?: boolean;
  /** Native tooltip on the trigger button -- e.g. explaining why it's disabled once a task
   * already exists. Browsers show `title` on hover even for a disabled button. */
  title?: string;
  /** Per-agent reason it can't be picked right now (not authenticated on this machine) --
   * keyed by whichever agent(s) are unavailable, absent entirely when both are available.
   * Disables that one option in the menu and shows the reason as its own tooltip, without
   * touching the trigger button itself (a still-available `value` stays fully usable). */
  unavailable?: Partial<Record<AgentBackend, string>>;
}

/** Agent picker for the new-task composer footer, styled identically to ModeSelect (shares
 * its .module.css) -- same portal/positioning mechanics, deliberately not extracted into a
 * shared base yet: two call sites is rule-of-three territory, not three. Locked in once a
 * task exists, same as ModeSelect -- a resumed session's session/thread id is only ever
 * valid against the backend that produced it. Fully controlled. */
export function AgentSelect({ value, onChange, disabled, title, unavailable }: AgentSelectProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ bottom: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const current = AGENTS[value];

  useEffect(() => {
    if (!open) return undefined;
    function handlePointerDown(e: MouseEvent) {
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (triggerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function toggleOpen() {
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPosition({ bottom: window.innerHeight - rect.top + 6, left: rect.left });
    }
    setOpen((o) => !o);
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={cn(styles.trigger, styles.agentRing)}
        // CSS custom properties aren't part of the CSSProperties type.
        // eslint-disable-next-line typescript/no-unsafe-type-assertion
        style={{ "--accent-color": AGENT_ACCENT_COLOR[value] } as CSSProperties}
        onClick={toggleOpen}
        disabled={disabled}
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        data-tour="agent-select"
      >
        <current.icon size={13} strokeWidth={1.75} />
        {current.label}
      </button>
      {open
        ? createPortal(
            <div
              ref={menuRef}
              className={styles.menu}
              role="menu"
              style={{ bottom: position.bottom, left: position.left }}
            >
              {Object.values(AGENTS).map((agent) => {
                const reason = unavailable?.[agent.value];
                return (
                  <button
                    key={agent.value}
                    type="button"
                    className={cn(styles.option, agent.value === value && styles.optionActive)}
                    role="menuitem"
                    aria-label={agent.label}
                    disabled={Boolean(reason)}
                    title={reason}
                    onClick={() => {
                      onChange(agent.value);
                      setOpen(false);
                    }}
                  >
                    <agent.icon size={13} strokeWidth={1.75} className={styles.optionIcon} />
                    <span className={styles.optionText}>
                      <span className={styles.optionLabel}>{agent.label}</span>
                      <span className={styles.optionDescription}>{reason ?? agent.description}</span>
                    </span>
                  </button>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
