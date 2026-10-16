import { BigQuery } from '@google-cloud/bigquery';

import { config } from './config.js';
import type { ValidatedQuestion } from './types.js';


const CHUNK_SIZE = 500;
const bigquery = new BigQuery({ projectId: config.projectId });

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i=0; i<items.length; i+=size) {
    chunks.push(items.slice(i, i+size));
  }

  return chunks;
}

export async function getExistingHashes(hashes: string[]): Promise<Set<string>> {
  if (hashes.length === 0) return new Set();

  const existing = new Set<string>();
  for (const batch of chunk(hashes, 1000)) {
    const [rows] = await bigquery.query({
      query: `SELECT content_hash FROM \`${config.projectId}.${config.datasetId}.${config.questionsTable}\` WHERE content_hash IN UNNEST(@hashes)`,
      params: { hashes: batch },
      types: { hashes: ['STRING'] },
    });
    for (const row of rows) existing.add(row.content_hash as string);
  }

  return existing;
}


export interface QuestionInsertRow {
  question_id: string;
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_answer: string;
  explanation: string;
  subject: string;
  topic: string;
  subtopic: string | null;
  difficulty: string;
  question_type: string;
  image_url: string | null;
  marks: number;
  target_exams: string[];
  tags: string[] | null;
  is_premium: boolean;
  is_active: boolean;
  source_module: string;
  content_hash: string;
  created_at: string;
  updated_at: string;
  reviewed_by: string | null;
}

export function toInsertRow(q: ValidatedQuestion, questionId: string, contentHash: string, sourceModule: string): QuestionInsertRow {
  const now = new Date().toISOString();

  return {
    question_id: questionId,
    question_text: q.questionText,
    option_a: q.optionA,
    option_b: q.optionB,
    option_c: q.optionC,
    option_d: q.optionD,
    correct_answer: q.correctAnswer,
    explanation: q.explanation,
    subject: q.subject,
    topic: q.topic,
    subtopic: q.subtopic,
    difficulty: q.difficulty,
    question_type: q.questionType,
    image_url: q.imageUrl,
    marks: q.marks,
    target_exams: q.targetExams,
    tags: q.tags,
    is_premium: q.isPremium,
    is_active: true,
    source_module: sourceModule,
    content_hash: contentHash,
    created_at: now,
    updated_at: now,
    reviewed_by: null,
  };
}


export interface InsertFailure {
  row: QuestionInsertRow;
  reason: string;
}

export async function insertQuestionRows(rows: QuestionInsertRow[]): Promise<{ insertedCount: number; failures: InsertFailure[] }> {
  if (rows.length === 0) return { insertedCount: 0, failures: [] };

  const table = bigquery.dataset(config.datasetId).table(config.questionsTable);
  const failures: InsertFailure[] = [];
  let insertedCount = 0;

  for (const batch of chunk(rows, CHUNK_SIZE)) {
    try {
      await table.insert(
        batch.map((row) => ({ insertId: row.content_hash, json: row })),
        { raw: true }
      );
      insertedCount += batch.length;
    } catch (err) {
      const bqError = err as {
        name?: string;
        errors?: Array<{ row: unknown; errors: Array<{ message: string }> }>;
      };

      if (bqError.name === 'PartialFailureError' && bqError.errors) {
        for (const failure of bqError.errors) {
          const matched = batch.find(
            (r) => r.content_hash === (failure.row as { content_hash?: string })?.content_hash
          );
          if (matched) {
            failures.push({ row: matched, reason: failure.errors.map((e) => e.message).join('; ') });
          }
        }
        insertedCount += batch.length - bqError.errors.length;
      } else {
        for (const row of batch)
          failures.push({ row, reason: (err as Error).message ?? 'Unknown insert error' });
      }
    }
  }

  return { insertedCount, failures };
}
