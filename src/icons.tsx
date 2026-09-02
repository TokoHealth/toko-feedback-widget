type IconProps = { className?: string };

const base = {
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none" as const,
};

export function EditIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path
        d="M4 20.5 4.9 16.6C5.02 16.08 5.29 15.6 5.68 15.22L15.7 5.2C16.5 4.4 17.8 4.4 18.6 5.2L18.8 5.4C19.6 6.2 19.6 7.5 18.8 8.3L8.78 18.32C8.4 18.71 7.92 18.98 7.4 19.1L3.5 20"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M14 6.9 17.1 10"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function BrushIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path
        d="M9.5 14.5 4 20"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9.06 14.06c-1.06-1.06-1.06-2.78 0-3.84l7.15-7.15c.98-.98 2.56-.98 3.54 0l.18.18c.98.98.98 2.56 0 3.54l-7.15 7.15c-1.06 1.06-2.78 1.06-3.84 0Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path
        d="M4 20c1.8.4 4.4-.2 4.9-2.2.3-1.2-.6-2.4-1.9-2.4-1 0-1.7.7-2 1.6C4.6 18.2 4 20 4 20Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function PaperclipIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path
        d="M17.5 10.5 9.9 18.1a3.5 3.5 0 0 1-4.95-4.95l8.49-8.49a2.5 2.5 0 0 1 3.54 3.54l-8.13 8.13a1.5 1.5 0 0 1-2.12-2.12l7.42-7.42"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ChatIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path
        d="M4 12c0-4.42 3.58-8 8-8s8 3.58 8 8-3.58 8-8 8c-1.1 0-2.15-.2-3.11-.58L4 20l1.02-3.89A7.94 7.94 0 0 1 4 12Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function CloseIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path
        d="M6 6l12 12M18 6 6 18"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function UndoIcon({
  className,
  flip = false,
}: IconProps & { flip?: boolean }) {
  return (
    <svg
      {...base}
      className={className}
      style={{ transform: flip ? "scaleX(-1)" : undefined }}
    >
      <path
        d="M9 7L4 12L9 17"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4 12H15C17.7614 12 20 14.2386 20 17C20 19.7614 17.7614 22 15 22H12"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
