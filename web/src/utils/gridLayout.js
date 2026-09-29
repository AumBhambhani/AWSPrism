/*
 * Tiny dependency-free grid layout engine for the dashboard.
 * Items are { id, x, y, w, h } in grid units (x/w across `cols`, y/h in rows).
 * Layout gravity is upward: compact() pulls every item as far up as it fits,
 * so there are never vertical gaps.
 */

export const GRID_COLS = 12;
export const ROW_PX = 12;   // height of one grid row unit (px)
export const GRID_MARGIN = 16; // px gutter between cells, both axes
export const MIN_W = 3;     // narrowest a widget may be resized

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

export function collides(a, b) {
  return (
    a.id !== b.id &&
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

/** Gravity toward the top-left: pull each item up, then left, until it settles. */
export function compact(items) {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const placed = [];
  for (const it of sorted) {
    let x = it.x;
    let y = it.y;
    let moved = true;
    while (moved) {
      moved = false;
      while (y > 0 && !placed.some((p) => collides({ ...it, x, y: y - 1 }, p))) { y--; moved = true; }
      while (x > 0 && !placed.some((p) => collides({ ...it, x: x - 1, y }, p))) { x--; moved = true; }
    }
    placed.push({ ...it, x, y });
  }
  // preserve caller's array order
  return items.map((it) => placed.find((p) => p.id === it.id));
}

/**
 * Resolve every overlap by ensuring each item settles into a collision-free slot.
 * `priorityId` (if provided) is locked in place and never displaced.
 */
export function resolveCollisions(items, priorityId) {
  const result = items.map((i) => ({ ...i }));
  const prio = priorityId ? result.find((i) => i.id === priorityId) : null;
  const nonPrio = priorityId ? result.filter((i) => i.id !== priorityId) : result;
  
  const placed = prio ? [prio] : [];
  const sorted = [...nonPrio].sort((a, b) => a.y - b.y || a.x - b.x);

  for (const it of sorted) {
    let x = it.x;
    let y = it.y;
    // If initially overlapping any placed item, push downward
    while (placed.some((p) => collides({ ...it, x, y }, p))) {
      y++;
    }
    // Pull upward and leftward as far as possible without collision
    let moved = true;
    while (moved) {
      moved = false;
      while (y > 0 && !placed.some((p) => collides({ ...it, x, y: y - 1 }, p))) {
        y--;
        moved = true;
      }
      while (x > 0 && !placed.some((p) => collides({ ...it, x: x - 1, y }, p))) {
        x--;
        moved = true;
      }
    }
    placed.push({ ...it, x, y });
  }

  return items.map((it) => placed.find((m) => m.id === it.id) || it);
}

/** Move `id` to (x, y); push whatever it lands on out of the way, then compact. */
export function moveItem(items, id, x, y) {
  const moving = items.find((i) => i.id === id);
  if (!moving) return items;
  const next = items.map((i) =>
    i.id === id
      ? { ...i, x: clamp(x, 0, GRID_COLS - moving.w), y: Math.max(0, y) }
      : i
  );
  return resolveCollisions(next, id);
}

export const MIN_H = 3;     // shortest a widget may be resized

/**
 * Resize `id` to `w` cols / `h` rows; reflow whatever it now overlaps, compact.
 */
export function resizeItem(items, id, w, h, minH = MIN_H) {
  const it = items.find((i) => i.id === id);
  if (!it) return items;
  const next = items.map((i) =>
    i.id === id
      ? { ...i, w: clamp(w, MIN_W, GRID_COLS - it.x), h: Math.max(minH, Math.round(h)) }
      : i
  );
  return resolveCollisions(next, id);
}

/** First free slot scanning top-to-bottom, left-to-right. */
export function firstFreeSlot(existing, w, h) {
  for (let y = 0; y < 5000; y++) {
    for (let x = 0; x <= GRID_COLS - w; x++) {
      const cand = { id: "__probe", x, y, w, h };
      if (!existing.some((e) => collides(cand, e))) return { x, y };
    }
  }
  return { x: 0, y: 0 };
}

/**
 * Build a full item list for `order`. Honours saved {x,y,w,h}; for widgets with
 * no saved height, uses the measured content height (`heights`, row units).
 * User-set heights win outright.
 */
export function buildLayout(order, saved, heights, defaultW, defaultH) {
  const placed = [];
  for (const id of order) {
    const s = saved[id];
    const w = clamp(s?.w || defaultW(id), MIN_W, GRID_COLS);
    const defH = typeof defaultH === "function" ? defaultH(id) : 9;
    const measuredH = heights[id] ? Math.max(MIN_H, heights[id]) : null;

    // Auto-fit height when the user hasn't resized this widget yet.
    const autoH = measuredH || defH;

    // Once the user explicitly resizes a widget, their height wins outright —
    // content scrolls inside the widget rather than forcing it back open.
    const h = s?.h ? Math.max(MIN_H, s.h) : autoH;

    const hasPos = s && Number.isFinite(s.x) && Number.isFinite(s.y);
    const pos = hasPos
      ? { x: clamp(s.x, 0, GRID_COLS - w), y: Math.max(0, s.y) }
      : firstFreeSlot(placed, w, h);
    placed.push({ id, x: pos.x, y: pos.y, w, h });
  }
  return resolveCollisions(placed, null);
}

/** Bottom edge of the layout in row units (for container height). */
export function layoutRows(items) {
  return items.reduce((m, it) => Math.max(m, it.y + it.h), 0);
}

/** Pixel geometry of one item given the current column width. */
export function itemBox(it, colW) {
  return {
    left: it.x * (colW + GRID_MARGIN),
    top: it.y * (ROW_PX + GRID_MARGIN),
    width: it.w * colW + (it.w - 1) * GRID_MARGIN,
    height: it.h * ROW_PX + (it.h - 1) * GRID_MARGIN,
  };
}

/** Column width in px for a container of `containerW`. */
export function colWidth(containerW) {
  return (containerW - (GRID_COLS - 1) * GRID_MARGIN) / GRID_COLS;
}

/** Pointer offset (px, relative to grid) → grid cell. */
export function pxToCell(px, py, colW) {
  return {
    x: Math.round(px / (colW + GRID_MARGIN)),
    y: Math.round(py / (ROW_PX + GRID_MARGIN)),
  };
}
