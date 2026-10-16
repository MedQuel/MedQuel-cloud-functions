const IST_OFFSET_MS = (5*60 + 30) * 60*1000;

export function toISTDateKey(date: Date): string {
  const shifted = new Date(date.getTime() + IST_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth()+1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');

  return `${y}-${m}-${d}`;
}

export function istDateKeyMinusOneDay(date: Date): string {
  return toISTDateKey(new Date(date.getTime() - 24*60*60*1000));
}
