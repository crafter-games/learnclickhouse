// Palette (GDD → Art direction). Roles keep one colour everywhere:
// amber = Column Depot accent / Pico, teal = read, ink = text, danger = errors.
export const COLORS = {
  ground: 0xdcd8ea,
  ink: 0x2b2840,
  amber: 0xf3ea4a,
  amberDark: 0xb3ab25,
  read: 0x3ddbb8,
  danger: 0xe5484d,
  paper: 0xfbf8f3,
  screen: 0x1d1b2e,
} as const;

/** Soft identity colour per column (aisle sign only). */
export const COLUMN_COLORS = ["#8a8cff", "#ff8a65", "#5ee08a", "#ff7ac6", "#5fb4ff", "#ffb547", "#b48cff", "#4fd1c5"];
