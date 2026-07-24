import type { MouseEventHandler, ReactNode } from "react";

type DocumentNumberButtonProps = {
  children: ReactNode;
  onClick: MouseEventHandler<HTMLButtonElement>;
  className?: string;
  ariaLabel?: string;
};

export function DocumentNumberButton({
  children,
  onClick,
  className = "",
  ariaLabel,
}: DocumentNumberButtonProps) {
  return (
    <button
      type="button"
      className={`max-w-full break-words text-left font-semibold text-foreground underline-offset-4 transition-colors hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${className}`}
      onClick={onClick}
      aria-label={ariaLabel}
    >
      {children}
    </button>
  );
}
