import type { Weekday } from './planUtils.js';
import type { ValidatedGeminiSession } from './studyPlanOutputValidation.js';


const FALLBACK_QUESTION_COUNT = 15;
const FALLBACK_DIFFICULTY = 'medium' as const;

export function generateFallbackWeekSessions(
  daysPerWeek: Weekday[],
  sessionsPerDay: number,
  prioritySubjects: string[]
): ValidatedGeminiSession[] {
  if (prioritySubjects.length === 0) {
    throw new Error('generateFallbackWeekSessions requires at least one subject.');
  }

  const sessions: ValidatedGeminiSession[] = [];
  let cursor = 0;

  for (const day of daysPerWeek) {
    for (let slot=0; slot<sessionsPerDay; slot++) {
      const subject = prioritySubjects[cursor % prioritySubjects.length]!;
      cursor += 1;

      sessions.push({
        dayOfWeek: day,
        sessionType: 'quiz',
        subject,
        topic: 'Mixed review',
        questionCount: FALLBACK_QUESTION_COUNT,
        difficulty: FALLBACK_DIFFICULTY,
      });
    }
  }

  return sessions;
}
