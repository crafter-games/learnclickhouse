import type { ComponentProps } from "react";

type Variant = "primary" | "secondary" | "accent" | "ghost";
type Size = "sm" | "md" | "lg" | "icon";

// Tactile but quiet: solid fills, a 3px darker bottom edge that compresses on press.
const base =
  "relative inline-flex select-none items-center justify-center gap-2 rounded-[10px] font-display font-bold tracking-tight cursor-pointer " +
  "transition-[transform,box-shadow,background-color,border-color] duration-150 ease-out " +
  "active:translate-y-[2px] disabled:pointer-events-none disabled:opacity-45 " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo";

const variants: Record<Variant, string> = {
  // Amber with ink text: white on amber fails contrast
  primary: "bg-amber text-on-amber shadow-[0_3px_0_var(--amber-dark),0_0_24px_-6px_rgba(250,255,105,0.55)] hover:bg-[#fdff8e] active:shadow-[0_1px_0_var(--amber-dark)]",
  accent: "bg-indigo text-on-amber shadow-[0_3px_0_var(--indigo-dark)] hover:bg-[#a2a4ff] active:shadow-[0_1px_0_var(--indigo-dark)]",
  secondary:
    "border border-white/10 bg-paper-2 text-ink shadow-[0_3px_0_rgba(0,0,0,0.45)] hover:border-amber/50 hover:bg-[#2b2d36] active:shadow-[0_1px_0_rgba(0,0,0,0.45)]",
  ghost: "text-ink-2 hover:text-ink hover:bg-white/5",
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
