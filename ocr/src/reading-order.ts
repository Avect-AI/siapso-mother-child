// SPDX-License-Identifier: MIT
// The boxes read, put back into lines of the page: boxes whose centres are
// at the same height along the page's own angle (a tilted photo) form a
// line, read left to right; lines are read top to bottom. Pure.

export interface ReadBox {
  text: string;
  cx: number;
  cy: number;
  w: number;
  h: number;
  angle: number;
}

/** The lines of the page, top to bottom, each the texts of its boxes left to right. */
export function readingOrder(boxes: readonly ReadBox[]): string[] {
  const kept = boxes.filter((box) => box.text.trim() !== '');
  if (kept.length === 0) return [];
  // The page's angle: the median angle of the long boxes (text lines, not specks).
  const angles = kept
    .filter((box) => box.w > 3 * box.h)
    .map((box) => box.angle)
    .sort((a, b) => a - b);
  const page = angles.length > 0 ? (angles[Math.floor(angles.length / 2)] ?? 0) : 0;
  const cos = Math.cos(page);
  const sin = Math.sin(page);
  const items = kept
    .map((box) => ({
      text: box.text.trim(),
      h: box.h,
      u: box.cx * cos + box.cy * sin,
      v: -box.cx * sin + box.cy * cos,
    }))
    .sort((a, b) => a.v - b.v);
  const rows: { v: number; h: number; items: typeof items }[] = [];
  for (const item of items) {
    // Same line: centres closer than half the smaller height.
    const row = rows.find((r) => Math.abs(r.v - item.v) < 0.5 * Math.min(r.h, item.h));
    if (row === undefined) {
      rows.push({ v: item.v, h: item.h, items: [item] });
    } else {
      row.items.push(item);
      row.v = (row.v * (row.items.length - 1) + item.v) / row.items.length;
    }
  }
  return rows
    .sort((a, b) => a.v - b.v)
    .map((row) =>
      row.items
        .sort((a, b) => a.u - b.u)
        .map((item) => item.text)
        .join(' '),
    );
}
