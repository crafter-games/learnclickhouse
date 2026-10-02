import { Warehouse } from "@phosphor-icons/react/dist/ssr";

export function Logo() {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="grid size-9 place-items-center rounded-lg bg-amber text-ink shadow-[0_2px_0_var(--amber-dark)]">
        <Warehouse size={20} weight="fill" />
      </span>
      <span className="font-display text-lg font-extrabold tracking-tight max-sm:sr-only">Column Depot</span>
    </span>
  );
}
