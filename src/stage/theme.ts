// Palette (GDD → Art direction). Roles keep one colour everywhere:
// amber = Column Depot accent / Pico, teal = read, ink = text, danger = errors.
export const COLORS = {
  ground: 0xdcd8ea,
  ink: 0x2b2840,
  amber: 0xf5b324,
  amberDark: 0xc98a0c,
  read: 0x2fb5a3,
  danger: 0xe5484d,
  paper: 0xfbf8f3,
  screen: 0x1d1b2e,
} as const;

/** Soft identity colour per column (aisle sign only). */
export const COLUMN_COLORS = ["#5b5fc7", "#e07a5f", "#3f9f62", "#c2559d", "#4f7fd0", "#b88a1e", "#7a5bc7", "#2a9d8f"];
