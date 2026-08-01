import { Button } from "../Button/Button";
import { PromptInput } from "../PromptInput/PromptInput";

interface FeedbackFormProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  placeholder?: string;
  disabled?: boolean;
}

/** The shared shape for "reject with feedback" forms: a right-aligned Cancel sitting above
 * the prompt textarea, not below it — Cancel dismisses the form itself, so it reads as
 * acting on the form from outside it, rather than as another thing you'd type into. */
export function FeedbackForm({ value, onChange, onSubmit, onCancel, placeholder, disabled }: FeedbackFormProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Button variant="secondary" onClick={onCancel} disabled={disabled}>
          Cancel
        </Button>
      </div>
      <PromptInput placeholder={placeholder} value={value} onChange={onChange} onSubmit={onSubmit} disabled={disabled} />
    </div>
  );
}
