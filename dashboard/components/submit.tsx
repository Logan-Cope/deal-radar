"use client";
import { useFormStatus } from "react-dom";

type Props = {
  children: React.ReactNode;
  className?: string;
  pendingLabel?: string;
  disabled?: boolean;
  formAction?: (formData: FormData) => Promise<void>;
};

/** A submit button that shows its form is working and cannot be pressed twice. */
export function Submit({ children, className = "btn", pendingLabel, disabled, formAction }: Props) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={disabled || pending} aria-busy={pending} formAction={formAction}>
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}
