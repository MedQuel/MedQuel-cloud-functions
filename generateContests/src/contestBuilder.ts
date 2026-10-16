import { randomUUID } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';

import {
  DAILY_TITLE_TEMPLATES,
  LIVE_TITLE_TEMPLATES,
  CONTEST_TITLE_TEMPLATES,
  WEEKLY_TITLE_TEMPLATES,
} from './contestTitles.js';
import { computeEpReward } from './epReward.js';
import { randomInRange, pickFromArray } from './weightedRandom.js';
import type { ContestKind, ContestTemplate, ContestDifficulty } from './types.js';


const DEFAULT_CONTEST_JOIN_WINDOW_HRS = { minHrs: 48, maxHrs: 120 };
const FIXED_JOIN_WINDOW_HOURS: Partial<Record<ContestKind, number>> = {
  daily: 24,
  live: 6,
  weekly: 7*24,
};

function buildContestTitle(contestType: ContestKind, subject: string): string {
  if (contestType === 'weekly') return pickFromArray(WEEKLY_TITLE_TEMPLATES as string[]);

  const pool = contestType === 'daily'
    ? DAILY_TITLE_TEMPLATES
    : contestType === 'live' ? LIVE_TITLE_TEMPLATES : CONTEST_TITLE_TEMPLATES;

  return pickFromArray(pool as string[]).replace('{subject}', subject);
}

function resolveJoinWindowHours(contestType: ContestKind, template: ContestTemplate): number {
  if (contestType === 'contest') {
    const range = template.joinWindowRange ?? DEFAULT_CONTEST_JOIN_WINDOW_HRS;
    return randomInRange(range.minHrs, range.maxHrs);
  }

  return FIXED_JOIN_WINDOW_HOURS[contestType] ?? 24;
}

function deriveInitialStatus(startsAt: Date, now: Date): 'active' | 'scheduled' {
  return startsAt.getTime() <= now.getTime() ? 'active' : 'scheduled';
}


export interface BuiltContest {
  contestId: string;
  doc: Record<string, unknown>;
}

export function finalizeContestDoc(params: {
  template: ContestTemplate;
  subject: string;
  difficulty: ContestDifficulty;
  contestType: ContestKind;
  questionIds: string[];
  timeLimitSecs: number;
  startsAt: Date;
  endsAtOverride?: Date;
}): BuiltContest {
  const { template, subject, difficulty, contestType, questionIds, timeLimitSecs, startsAt } = params;

  const contestId = randomUUID();
  const joinWindowHours = resolveJoinWindowHours(contestType, template);
  const endsAt = params.endsAtOverride ?? new Date(startsAt.getTime()+joinWindowHours * 60*60*1000);

  const title = buildContestTitle(contestType, subject);
  const epReward = computeEpReward(template.epRewardFormula, difficulty, questionIds.length);

  return {
    contestId,
    doc: {
      contestId,
      title,
      subject,
      topics: [],
      contestType,
      difficulty,
      isPremium: template.isPremium,
      totalQuestions: questionIds.length,
      timeLimitSecs,
      markingScheme: template.markingScheme,
      epReward,
      passPercent: template.passPercent,
      questionIds,
      recommendedLevel: template.recommendedLevel,
      status: deriveInitialStatus(startsAt, new Date()),
      startsAt: Timestamp.fromDate(startsAt),
      endsAt: Timestamp.fromDate(endsAt),
      participantCount: 0,
      createdBy: 'factory',
      createdAt: Timestamp.now(),
      templateId: template.templateId,
      generatedBy: 'factory' as const,
    },
  };
}
