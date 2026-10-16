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

export function getActivePeriodKeys(now: Date): string[] {
  return [
    `weekly_${getIsoWeekKey(now)}`,
    `monthly_${getMonthKey(now)}`,
    'allTime',
  ];
}

export function getPreviousWeeklyPeriodKey(now: Date): string {
  const sevenDaysAgo = new Date(now.getTime() - 7*24*60*60*1000);
  return `weekly_${getIsoWeekKey(sevenDaysAgo)}`;
}
