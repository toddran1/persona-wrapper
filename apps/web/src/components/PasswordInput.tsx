import { useState } from "react";
import { passwordStrengthScore, type PasswordStrength } from "@persona/shared";

const STRENGTH_LABELS: Record<PasswordStrength, string> = {
  0: "",
  1: "Too short",
  2: "Fair",
  3: "Good",
  4: "Strong"
};

export function PasswordStrengthMeter({ password }: { password: string }) {
  if (!password) return null;
  const score = passwordStrengthScore(password);
  return (
    <span className={`password-strength password-strength-${score}`} role="status" aria-label={`Password strength: ${STRENGTH_LABELS[score]}`}>
      <span className="password-strength-bars" aria-hidden="true">
        {([1, 2, 3, 4] as const).map((bar) => (
          <span key={bar} className={`password-strength-bar${bar <= score ? " password-strength-bar-filled" : ""}`} />
        ))}
      </span>
      <span className="password-strength-label">{STRENGTH_LABELS[score]}</span>
    </span>
  );
}

type PasswordInputProps = {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  placeholder?: string | undefined;
  autoComplete?: string | undefined;
  disabled?: boolean | undefined;
  testId?: string | undefined;
  showStrength?: boolean;
};

export function PasswordInput({
  value,
  onChange,
  ariaLabel,
  placeholder,
  autoComplete,
  disabled,
  testId,
  showStrength = false
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  return (
    <span className="password-field">
      <span className="password-field-shell">
        <input
          type={visible ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          aria-label={ariaLabel}
          data-testid={testId}
          autoComplete={autoComplete}
          disabled={disabled}
        />
        <button
          type="button"
          className="password-field-toggle"
          aria-label={visible ? `Hide ${ariaLabel.toLowerCase()}` : `Show ${ariaLabel.toLowerCase()}`}
          aria-pressed={visible}
          onClick={() => setVisible((current) => !current)}
        >
          {visible ? "Hide" : "Show"}
        </button>
      </span>
      {showStrength ? <PasswordStrengthMeter password={value} /> : null}
    </span>
  );
}
