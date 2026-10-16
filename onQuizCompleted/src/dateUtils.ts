const IST_OFFSET_MS = (5*60 + 30) * 60*1000;

export function getIsoWeekKey(date: Date): string {
  const istShifted = new Date(date.getTime() + IST_OFFSET_MS);
  const d = new Date(
    Date.UTC(
      istShifted.getUTCFullYear(),
      istShifted.getUTCMonth(),
      istShifted.getUTCDate()
    )
  );

  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate()+4 - dayNum);

  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime()-yearStart.getTime()) / 86400000+1) / 7);

  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

export function getMonthKey(date: Date): string {
  const istShifted = new Date(date.getTime() + IST_OFFSET_MS);

  const y = istShifted.getUTCFullYear();
  const m = String(istShifted.getUTCMonth()+1).padStart(2, '0');

  return `${y}-${m}`;
}

export function toISTDateKey(date: Date): string {
  const shifted = new Date(date.getTime() + IST_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth()+1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');

  return `${y}-${m}-${d}`;
}
