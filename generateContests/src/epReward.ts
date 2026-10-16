import type { EpRewardFormula, ContestDifficulty } from './types.js';


const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

export function computeEpReward(
  formula: EpRewardFormula,
  difficulty: ContestDifficulty,
  questionCount: number
): number {
  const raw = (formula.base+formula.perQuestion*questionCount) * formula.difficultyMultiplier[difficulty];
  return Math.max(0, Math.round(raw));
}

// Monday 00:00 IST through Sunday 23:59:59 IST of the week containing `now`.
export function getIsoWeekWindowIST(now: Date): { mondayStart: Date, sundayEnd: Date } {
  const istNow = new Date(now.getTime() + IST_OFFSET_MS);
  const day = istNow.getUTCDay() || 7;

  const istMidnight = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate()));
  const mondayIstMidnight = new Date(istMidnight.getTime() - (day-1)*24*60*60*1000);
  const sundayIstEnd = new Date(mondayIstMidnight.getTime() + 7*24*60*60*1000-1000);

  return {
    mondayStart: new Date(mondayIstMidnight.getTime() - IST_OFFSET_MS),
    sundayEnd: new Date(sundayIstEnd.getTime() - IST_OFFSET_MS),
  };
}
