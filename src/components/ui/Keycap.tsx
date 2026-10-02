export function Keycap({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={`inline-flex h-5 min-w-5 items-center justify-center rounded-[5px] border border-ink/15 bg-paper-2 px-1 font-mono text-xs font-bold leading-none text-ink-2 shadow-[0_1.5px_0_rgba(43,40,64,0.18)] ${className}`}
    >
      {children}
    </kbd>
  );
}
