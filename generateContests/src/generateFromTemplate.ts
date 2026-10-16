import type { Firestore } from 'firebase-admin/firestore';

import { getIsoWeekWindowIST } from './epReward.js';
import { finalizeContestDoc } from './contestBuilder.js';
import type { ContestTemplate, ContestDifficulty } from './types.js';
import { countQuestions, fetchRandomQuestionIds } from './bigquery.js';
import { randomInRange, pickFromArray, weightedRandomKey } from './weightedRandom.js';


const MAX_SUBJECT_ATTEMPTS = 5;
export interface GenerationOutcome {
  templateId: string;
  status: 'created' | 'skipped_insufficient_questions';
  contestId?: string;
  subject?: string;
  difficulty?: ContestDifficulty;
}

function floorToHour(d: Date): Date {
  return new Date(Math.floor(d.getTime()/3_600_000) * 3_600_000);
}

async function pickSubjectWithEnoughQuestions(
  subjectPool: string[],
  difficulty: ContestDifficulty,
  isPremium: boolean,
  questionCount: number,
  logPrefix: string
): Promise<{ subject: string; questionIds: string[] } | null> {
  const attempted = new Set<string>();

  for (let i=0; i<MAX_SUBJECT_ATTEMPTS; i++) {
    const remaining = subjectPool.filter((s) => !attempted.has(s));
    if (remaining.length === 0) break;

    const subject = pickFromArray(remaining);
    attempted.add(subject);

    const count = await countQuestions(subject, difficulty, isPremium);
    if (count >= questionCount) {
      const questionIds = await fetchRandomQuestionIds(subject, difficulty, isPremium, questionCount);
      return { subject, questionIds };
    }
    console.log(`${logPrefix} ${subject}/${difficulty} has only ${count}/${questionCount} questions — trying another subject.`);
  }

  console.warn(`${logPrefix} no subject in pool had enough ${difficulty} questions after ${attempted.size} attempt(s) — skipping this tick.`);
  return null;
}


export async function generateRotationContest(template: ContestTemplate, db: Firestore): Promise<GenerationOutcome> {
  const logPrefix = `[generateContests] "${template.templateId}":`;

  const difficulty = weightedRandomKey(template.difficultyWeights) as ContestDifficulty;
  const contestType = weightedRandomKey(template.contestTypeMix) as 'daily' | 'live' | 'contest';
  const questionCount = randomInRange(template.questionCountRange.min, template.questionCountRange.max);
  const timeLimitSecs = randomInRange(template.durationRange.minSecs, template.durationRange.maxSecs);

  const picked = await pickSubjectWithEnoughQuestions(
    template.subjectPool,
    difficulty,
    template.isPremium,
    questionCount,
    logPrefix
  );
  if (!picked) return { templateId: template.templateId, status: 'skipped_insufficient_questions' };

  const { doc, contestId } = finalizeContestDoc({
    template,
    subject: picked.subject,
    difficulty,
    contestType,
    questionIds: picked.questionIds,
    timeLimitSecs,
    startsAt: floorToHour(new Date()),
  });

  await db.collection('contests').doc(contestId).set(doc);
  console.log(`${logPrefix} created ${contestId} — ${picked.subject}/${difficulty}, ${picked.questionIds.length}q, EP ${doc.epReward}.`);

  return {
    templateId: template.templateId,
    status: 'created',
    contestId,
    subject: picked.subject,
    difficulty,
  };
}

export async function generateGrandChampionshipContest(template: ContestTemplate, db: Firestore): Promise<GenerationOutcome> {
  const logPrefix = `[generateWeeklyChampionship] "${template.templateId}":`;

  const difficulty = weightedRandomKey(template.difficultyWeights) as ContestDifficulty;
  const questionCount = randomInRange(template.questionCountRange.min, template.questionCountRange.max);
  const timeLimitSecs = randomInRange(template.durationRange.minSecs, template.durationRange.maxSecs);

  const picked = await pickSubjectWithEnoughQuestions(
    template.subjectPool,
    difficulty,
    template.isPremium,
    questionCount,
    logPrefix
  );
  if (!picked) return { templateId: template.templateId, status: 'skipped_insufficient_questions' };

  const { mondayStart, sundayEnd } = getIsoWeekWindowIST(new Date());

  const { doc, contestId } = finalizeContestDoc({
    template,
    subject: picked.subject,
    difficulty,
    contestType: 'weekly',
    questionIds: picked.questionIds,
    timeLimitSecs,
    startsAt: floorToHour(mondayStart),
    endsAtOverride: sundayEnd,
  });

  await db.collection('contests').doc(contestId).set(doc);
  console.log(`${logPrefix} created ${contestId} — ${picked.subject}/${difficulty}, ${picked.questionIds.length}q.`);

  return {
    templateId: template.templateId,
    status: 'created',
    contestId,
    subject: picked.subject,
    difficulty,
  };
}
