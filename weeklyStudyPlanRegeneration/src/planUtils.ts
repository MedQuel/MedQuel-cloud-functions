const IST_OFFSET_MS = (5*60 + 30) * 60*1000;
const MIN_ATTEMPTS_FOR_SUBJECT_HIGHLIGHT = 5;

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export const WEEKDAY_OFFSET: Record<Weekday, number> = {
  mon: 0,
  tue: 1,
  wed: 2,
  thu: 3,
  fri: 4,
  sat: 5,
  sun: 6,
};

export const VALID_SPECIALTIES = [
  'Anatomy', 'Anesthesiology', 'Biochemistry', 'Community Medicine',
  'Dermatology', 'ENT', 'Forensic Medicine & Toxicology', 'Gynaecology & Obstetrics',
  'Medicine', 'Microbiology', 'Ophthalmology', 'Orthopedics', 'Pathology',
  'Pediatrics', 'Pharmacology', 'Physiology', 'Psychiatry', 'Radiology', 'Surgery'
];

const QUIZ_XP_BASE_BY_DIFFICULTY: Record<'easy' | 'medium' | 'hard', number> = {
  easy: 15,
  medium: 25,
  hard: 35,
};
const READ_SESSION_XP_REWARD = 5;
const REFERENCE_QUESTION_COUNT = 15;
const READ_SESSION_DISCLAIMER = 'Quick revision summary: always verify against your textbook or faculty before relying on this for exam prep.';

interface SubjectStatEntry {
  attempted: number;
  correct: number;
}


export function toISTDateKey(date: Date): string {
  const shifted = new Date(date.getTime() + IST_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth()+1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');

  return `${y}-${m}-${d}`;
}
export function addDaysToDateKey(dateKey: string, days: number): string {
  const base = new Date(`${dateKey}T00:00:00.000Z`);
  return toISTDateKey(new Date(base.getTime()+days * 24*60*60*1000));
}

function computeSubjectPerformance(subjectStats: Record<string, SubjectStatEntry>) {
  return Object.entries(subjectStats)
    .filter(([, s]) => (s?.attempted ?? 0) > 0)
    .map(([subject, s]) => ({
      subject,
      accuracy: Math.round((s.correct/s.attempted)*10000) / 100,
      totalAttempted: s.attempted,
    }))
    .sort((a, b) => b.accuracy - a.accuracy);
}
export function computeWeakSubjectsContext(userData: FirebaseFirestore.DocumentData): { subject: string; accuracy: number }[] {
  const subjectStats = userData.stats?.subjectStats ?? {};
  return computeSubjectPerformance(subjectStats)
    .filter((s) => s.totalAttempted >= MIN_ATTEMPTS_FOR_SUBJECT_HIGHLIGHT)
    .slice()
    .reverse()
    .slice(0, 5)
    .map((s) => ({ subject: s.subject, accuracy: s.accuracy }));
}

export function computeSubjectPriority(userData: FirebaseFirestore.DocumentData, previousPriority: string[]): string[] {
  const weak = computeWeakSubjectsContext(userData);
  if (weak.length > 0) return weak.map((w) => w.subject);
  if (previousPriority.length > 0) return previousPriority;
  if (userData.specialties?.length > 0) return userData.specialties;
  if (userData.contentScope === 'focused' && userData.focusSubjects?.length > 0) return userData.focusSubjects;

  return [...VALID_SPECIALTIES];
}

function computeQuizXpReward(difficulty: 'easy' | 'medium' | 'hard', questionCount: number): number {
  return Math.max(
    1,
    Math.round(QUIZ_XP_BASE_BY_DIFFICULTY[difficulty] * (questionCount/REFERENCE_QUESTION_COUNT))
  );
}
export function computeWeeklyXpTarget(sessions: { xpReward: number }[]): number {
  return sessions.reduce((sum, s) => sum+s.xpReward, 0);
}


export function materializeSessions(validated: any[], weekStartDateKey: string) {
  const weekStart = new Date(`${weekStartDateKey}T00:00:00.000Z`);
  return validated.map((s, index) => {
    const offsetDays = WEEKDAY_OFFSET[s.dayOfWeek as Weekday];
    const scheduledDate = toISTDateKey(new Date(weekStart.getTime()+offsetDays * 24*60*60*1000));
    const sessionId = `w-${weekStartDateKey}-${index}`;

    if (s.sessionType === 'quiz') {
      return {
        sessionId,
        sessionType: 'quiz',
        subject: s.subject,
        topic: s.topic,
        scheduledDate,
        questionCount: s.questionCount,
        difficulty: s.difficulty,
        xpReward: computeQuizXpReward(s.difficulty, s.questionCount),
        status: 'pending',
        linkedQuizSessionId: null,
        completedAt: null,
      };
    }

    return {
      sessionId,
      sessionType: 'read',
      subject: s.subject,
      topic: s.topic,
      scheduledDate,
      title: s.title,
      content: s.content,
      disclaimer: READ_SESSION_DISCLAIMER,
      estimatedMinutes: s.estimatedMinutes,
      xpReward: READ_SESSION_XP_REWARD,
      status: 'pending',
      completedAt: null,
    };
  });
}
