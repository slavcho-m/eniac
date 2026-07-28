import { useEffect, useState } from "react";
import { useMastermindAssistants } from "@/hooks/useMastermindAssistants";
import type { Mastermind } from "@/types/api";
import { Button } from "../Button/Button";
import { Dialog } from "../Dialog/Dialog";
import { FileListItem } from "../FileListItem/FileListItem";

interface AssistantPickerProps {
  open: boolean;
  onClose: () => void;
  mastermind: Mastermind;
  currentAssistant: string;
  onConfirm: (assistant: string) => void;
  confirming?: boolean;
}

/** Lets the user run a different Assistant than the one the Mastermind recommended for the
 * next pending task item — the backend's approve-assistant override param has been ready
 * since it was built, this is the picker UI for it. Only offers Assistants that actually
 * have a prompt file configured (see backend's GET /agents/masterminds/{id}/assistants). */
export function AssistantPicker({
  open,
  onClose,
  mastermind,
  currentAssistant,
  onConfirm,
  confirming = false,
}: AssistantPickerProps) {
  const { data: assistants } = useMastermindAssistants(mastermind);
  const [selected, setSelected] = useState(currentAssistant);

  useEffect(() => {
    if (open) setSelected(currentAssistant);
  }, [open, currentAssistant]);

  const selectedConfigured = assistants?.find((a) => a.name === selected)?.configured ?? false;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Choose Assistant"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={confirming}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => onConfirm(selected)}
            disabled={confirming || !selectedConfigured}
          >
            {confirming ? "Starting…" : `Run ${selected} Assistant`}
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {(assistants ?? []).map((assistant) => (
          <FileListItem
            key={assistant.name}
            name={assistant.name}
            meta={assistant.name === currentAssistant ? "Currently assigned" : undefined}
            badge={assistant.configured ? undefined : { variant: "neutral", label: "Not configured" }}
            active={assistant.name === selected}
            onClick={assistant.configured ? () => setSelected(assistant.name) : undefined}
          />
        ))}
      </div>
    </Dialog>
  );
}
