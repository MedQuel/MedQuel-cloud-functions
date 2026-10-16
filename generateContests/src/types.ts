import type { Timestamp } from 'firebase-admin/firestore';


export type ContestKind = 'daily' | 'live' | 'contest' | 'weekly';
export type ContestDifficulty = 'easy' | 'medium' | 'hard';
export type TemplateKind = 'rotation' | 'grand_championship';

export interface DifficultyWeights {
  easy: number;
  medium: number;
  hard: number;
}
export interface ContestTypeMix {
  daily: number;
  live: number;
  contest: number;
}
export interface QuestionCountRange {
  min: number;
  max: number;
}
export interface DurationRangeSecs {
  minSecs: number;
  maxSecs: number;
}
export interface MarkingScheme {
  correct: number;
  wrong: number;
  skipped: number;
}
export interface EpRewardFormula {
  base: number;
  perQuestion: number;
  difficultyMultiplier: DifficultyWeights;
}

export interface ContestTemplate {
  templateId: string;
  name: string;
  templateKind: TemplateKind;
  isActive: boolean;
  subjectPool: string[];
  difficultyWeights: DifficultyWeights;
  questionCountRange: QuestionCountRange;
  durationRange: DurationRangeSecs;
  joinWindowRange: { minHrs: number; maxHrs: number } | null;
  contestTypeMix: ContestTypeMix;
  isPremium: boolean;
  markingScheme: MarkingScheme;
  passPercent: number;
  epRewardFormula: EpRewardFormula;
  recommendedLevel: string | null;
  generationIntervalHrs: number;
  lastGeneratedAt: Timestamp | null;
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
