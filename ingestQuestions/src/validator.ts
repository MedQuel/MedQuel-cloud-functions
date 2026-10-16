import type { Difficulty, QuestionType, ValidatedQuestion, RowValidationResult } from './types.js';


const VALID_ANSWERS = ['A', 'B', 'C', 'D'];
const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];
const QUESTION_TYPES: QuestionType[] = ['mcq', 'assertion_reason', 'match', 'image_based', 'clinical'];

function toText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return String(value);
  return String(value).trim();
}
function toOptionalText(value: unknown): string | null {
  const text = toText(value);
  return text.length > 0 ? text : null;
}
function parseDelimitedList(value: unknown, fieldName: string, warnings: string[]): string[] {
  const text = toText(value);
  if (!text) return [];

  const items = text.split(/[,|]/).map((item) => item.trim()).filter(Boolean);

  if (items.length === 0) {
    warnings.push(`${fieldName} had content but no items parsed out of it. Raw value: ${text}`);
  }

  return items;
}
function parseBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  const text = toText(value).toLowerCase();
  return text === 'true' || text === '1' || text === 'yes';
}


export function validateRow(fields: Record<string, unknown>, rowNumber: number): RowValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const questionText = toText(fields.questionText);
  const optionA = toText(fields.optionA);
  const optionB = toText(fields.optionB);
  const optionC = toText(fields.optionC);
  const optionD = toText(fields.optionD);
  const subject = toText(fields.subject);
  const topic = toText(fields.topic);
  const rawExplanation = toText(fields.explanation);

  if (!questionText) errors.push('questionText is required');
  if (!optionA) errors.push('optionA is required');
  if (!optionB) errors.push('optionB is required');
  if (!optionC) errors.push('optionC is required');
  if (!optionD) errors.push('optionD is required');
  if (!subject) errors.push('subject is required');
  if (!topic) errors.push('topic is required');

  const correctAnswerRaw = toText(fields.correctAnswer).toUpperCase();
  if (!VALID_ANSWERS.includes(correctAnswerRaw)) {
    errors.push(`correctAnswer must be one of A/B/C/D, got "${correctAnswerRaw || '(empty)'}"`);
  }

  if (!rawExplanation) warnings.push('explanation is empty — flagged for review');

  const difficultyRaw = toText(fields.difficulty).toLowerCase();
  if (!DIFFICULTIES.includes(difficultyRaw as Difficulty)) {
    errors.push(`difficulty must be one of easy/medium/hard, got "${difficultyRaw || '(empty)'}"`);
  }

  let questionTypeRaw = toText(fields.questionType).toLowerCase();
  if (!questionTypeRaw) {
    questionTypeRaw = 'mcq';
    warnings.push('questionType was empty — defaulted to mcq');
  }
  if (!QUESTION_TYPES.includes(questionTypeRaw as QuestionType)) {
    errors.push(`questionType "${questionTypeRaw}" is not a recognized type`);
  }

  const imageUrl = toOptionalText(fields.imageUrl);
  if (questionTypeRaw === 'image_based' && !imageUrl) errors.push('imageUrl is required when questionType is image_based');
  if (imageUrl?.includes('drive.google.com')) {
    warnings.push('imageUrl points to Google Drive — should be a Firebase Storage path instead');
  }

  let marks = 4;
  const marksRaw = fields.marks;
  if (marksRaw !== null && marksRaw !== undefined && toText(marksRaw) !== '') {
    const parsed = Number(marksRaw);
    if (Number.isFinite(parsed) && parsed > 0) marks = Math.round(parsed);
    else warnings.push(`marks value "${toText(marksRaw)}" is invalid — defaulted to 4`);
  }

  const targetExams = parseDelimitedList(fields.targetExams, 'targetExams', warnings);
  const tags = parseDelimitedList(fields.tags, 'tags', warnings);
  const isPremium = parseBoolean(fields.isPremium);

  if (errors.length > 0) return { rowNumber, status: 'rejected', errors, warnings };

  const data: ValidatedQuestion = {
    questionText,
    optionA,
    optionB,
    optionC,
    optionD,
    correctAnswer: correctAnswerRaw as 'A' | 'B' | 'C' | 'D',
    explanation: rawExplanation,
    subject,
    topic,
    subtopic: toOptionalText(fields.subtopic),
    difficulty: difficultyRaw as Difficulty,
    questionType: questionTypeRaw as QuestionType,
    imageUrl,
    marks,
    targetExams,
    tags,
    isPremium,
  };

  return { rowNumber, status: 'valid', data, errors, warnings };
}
