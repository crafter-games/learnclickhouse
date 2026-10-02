/** Column Depot wordmark: a little bar chart (columns!) and "Column" + yellow "Depot". */
export function Logo() {
  return (
    <span className="inline-flex items-center gap-2.5">
      <span className="grid size-9 place-items-center rounded-[9px] bg-amber shadow-[0_2px_0_var(--amber-dark)]" aria-hidden>
        <svg viewBox="0 0 20 20" className="size-5">
          <rect x="2.5" y="10" width="3" height="7.5" rx="1" fill="#121214" />
          <rect x="7" y="3" width="3" height="14.5" rx="1" fill="#121214" />
          <rect x="11.5" y="7" width="3" height="10.5" rx="1" fill="#121214" />
          <rect x="16" y="5" width="2" height="12.5" rx="1" fill="#121214" opacity="0.55" />
        </svg>
      </span>
      <span className="font-display text-lg font-bold tracking-tight max-sm:sr-only">
        Column <span className="text-amber">Depot</span>
      </span>
    </span>
  );
}
