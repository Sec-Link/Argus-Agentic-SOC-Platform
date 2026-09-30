export const clampSidebarWidth = (width: number, available: number): number =>
  Math.max(Math.min(240, available * 0.4), Math.min(width, 600, available * 0.6));

export const getSidebarFontSize = (width: number): number =>
  Math.min(18, Math.max(14, Math.round(14 + (width - 280) / 80)));
