import { VALID_SPECIALTIES } from './planUtils.js';
import { WEEKDAYS, type Weekday } from './planUtils.js';


const MIN_QUESTION_COUNT = 5;
const MAX_QUESTION_COUNT = 30;
const VALID_DIFFICULTIES = ['easy', 'medium', 'hard'];
const READ_CONTENT_MIN_CHARS = 40;
const READ_CONTENT_MAX_CHARS = 700;
const MAX_TITLE_LENGTH = 80;
const MAX_ESTIMATED_MINUTES = 15;
const MAX_TOTAL_SESSIONS = 40;

const VALID_SUBJECT_SET = new Set<string>(VALID_SPECIALTIES);
const VALID_WEEKDAY_SET = new Set<string>(WEEKDAYS);

export interface ValidatedGeminiSession {
  dayOfWeek: Weekday;
  sessionType: 'quiz' | 'read';
  subject: string;
  topic: string;
  questionCount?: number;
  difficulty?: 'easy' | 'medium' | 'hard';
  title?: string;
  content?: string;
  estimatedMinutes?: number;
}


export function validateGeminiStudyPlanOutput(
  raw: unknown,
  allowedDays: Weekday[],
  sessionsPerDayCap: number
): ValidatedGeminiSession[] | null {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as any).sessions)) {
    return null;
  }

  const sessions = (raw as any).sessions as unknown[];
  if (sessions.length === 0 || sessions.length > MAX_TOTAL_SESSIONS) {
    return null;
  }

  const allowedDaySet = new Set(allowedDays);
  const perDayCount = new Map<string, number>();
  const validated: ValidatedGeminiSession[] = [];

  for (const raw of sessions) {
    const s = raw as Record<string, unknown>;

    if (typeof s.dayOfWeek !== 'string' || !VALID_WEEKDAY_SET.has(s.dayOfWeek)) return null;
    if (!allowedDaySet.has(s.dayOfWeek as Weekday)) return null;
    if (s.sessionType !== 'quiz' && s.sessionType !== 'read') return null;
    if (typeof s.subject !== 'string' || !VALID_SUBJECT_SET.has(s.subject)) return null;
    if (typeof s.topic !== 'string' || s.topic.trim().length === 0 || s.topic.length > 100) return null;

    const dayCount = (perDayCount.get(s.dayOfWeek) ?? 0) + 1;
    if (dayCount > sessionsPerDayCap) return null;
    perDayCount.set(s.dayOfWeek, dayCount);

    if (s.sessionType === 'quiz') {
      const questionCount = Math.trunc(Number(s.questionCount));
      if (!Number.isFinite(questionCount) || questionCount < MIN_QUESTION_COUNT || questionCount > MAX_QUESTION_COUNT) return null;
      if (typeof s.difficulty !== 'string' || !VALID_DIFFICULTIES.includes(s.difficulty)) return null;

      validated.push({
        dayOfWeek: s.dayOfWeek as Weekday,
        sessionType: 'quiz',
        subject: s.subject,
        topic: s.topic.trim(),
        questionCount,
        difficulty: s.difficulty as 'easy' | 'medium' | 'hard',
      });
    } else {
      if (typeof s.title !== 'string' || s.title.trim().length === 0 || s.title.length > MAX_TITLE_LENGTH) return null;
      if (typeof s.content !== 'string') return null;

      const content = s.content.trim();
      if (content.length < READ_CONTENT_MIN_CHARS || content.length > READ_CONTENT_MAX_CHARS) return null;

      const rawMinutes = Math.trunc(Number(s.estimatedMinutes));
      const estimatedMinutes = Number.isFinite(rawMinutes) && rawMinutes > 0
        ? Math.min(rawMinutes, MAX_ESTIMATED_MINUTES)
        : 5;

      validated.push({
        dayOfWeek: s.dayOfWeek as Weekday,
        sessionType: 'read',
        subject: s.subject,
        topic: s.topic.trim(),
        title: s.title.trim(),
        content,
        estimatedMinutes,
      });
    }
  }

  return validated;
}
