export function weightedRandomKey<T extends string>(weights: Record<T, number>): T {
  const entries = Object.entries(weights) as [T, number][];
  const total = entries.reduce((sum, [, w]) => sum + Math.max(w, 0), 0);

  if (total <= 0) {
    const keys = entries.map(([k]) => k);
    return keys[Math.floor(Math.random() * keys.length)];
  }

  let r = Math.random() * total;
  for (const [key, weight] of entries) {
    r -= Math.max(weight, 0);
    if (r <= 0) return key;
  }

  return entries[entries.length-1][0];
}

export function randomInRange(min: number, max: number): number {
  if (max <= min) return min;
  return Math.floor(Math.random() * (max-min+1)) + min;
}

export function pickFromArray<T>(items: T[]): T {
  if (items.length === 0) throw new Error('Cannot pick from an empty array');
  return items[Math.floor(Math.random() * items.length)];
}
