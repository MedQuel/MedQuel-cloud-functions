export type Difficulty = 'easy' | 'medium' | 'hard';
export type QuestionType = 'mcq' | 'assertion_reason' | 'match' | 'image_based' | 'clinical';

export interface ValidatedQuestion {
  questionText: string;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  correctAnswer: 'A' | 'B' | 'C' | 'D';
  explanation: string;
  subject: string;
  topic: string;
  subtopic: string | null;
  difficulty: Difficulty;
  questionType: QuestionType;
  imageUrl: string | null;
  marks: number;
  targetExams: string[];
  tags: string[];
  isPremium: boolean;
}

export interface RowValidationResult {
  rowNumber: number;
  status: 'valid' | 'rejected';
  data?: ValidatedQuestion;
  errors: string[];
  warnings: string[];
}

export interface IngestionSummary {
  sourceFile: string;
  totalRows: number;
  validCount: number;
  rejectedCount: number;
  results: RowValidationResult[];
}
