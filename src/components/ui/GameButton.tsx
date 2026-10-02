import type { ComponentProps } from "react";

type Variant = "primary" | "secondary" | "accent" | "ghost";
type Size = "sm" | "md" | "lg" | "icon";

// Tactile but quiet: solid fills, a 3px darker bottom edge that compresses on press.
const base =
  "relative inline-flex select-none items-center justify-center gap-2 rounded-xl font-display font-bold cursor-pointer " +
  "transition-[transform,box-shadow,background-color,border-color] duration-150 ease-out " +
  "active:translate-y-[2px] disabled:pointer-events-none disabled:opacity-45 " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo";

const variants: Record<Variant, string> = {
  // Amber with ink text: white on amber fails contrast
  primary: "bg-amber text-ink shadow-[0_3px_0_var(--amber-dark)] hover:bg-[#f8be3d] active:shadow-[0_1px_0_var(--amber-dark)]",
  accent: "bg-indigo text-white shadow-[0_3px_0_var(--indigo-dark)] hover:bg-[#6569d1] active:shadow-[0_1px_0_var(--indigo-dark)]",
  secondary:
    "border border-line bg-paper text-ink shadow-[0_3px_0_rgba(43,40,64,0.14)] hover:bg-white active:shadow-[0_1px_0_rgba(43,40,64,0.14)]",
  ghost: "text-ink-2 hover:text-ink hover:bg-ink/5",
};

const sizes: Record<Size, string> = {
  sm: "h-10 px-3.5 text-sm",
  md: "h-12 px-5 text-base",
  lg: "h-14 px-7 text-lg",
  icon: "size-11 text-xl",
};

type Props = { variant?: Variant; size?: Size };

export function gameButtonClass({ variant = "secondary", size = "md" }: Props = {}) {
  return `${base} ${variants[variant]} ${sizes[size]}`;
}

export function GameButton({ variant, size, className = "", ...rest }: Props & ComponentProps<"button">) {
  return <button type="button" className={`${gameButtonClass({ variant, size })} ${className}`} {...rest} />;
}
