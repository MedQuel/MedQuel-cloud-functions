import { BigQuery } from '@google-cloud/bigquery';
import { config } from './config.js';


const bigquery = new BigQuery({ projectId: config.projectId });

export async function countQuestions(subject: string, difficulty: string, includePremium: boolean): Promise<number> {
  const query = `
    SELECT COUNT(*) AS cnt
    FROM \`${config.projectId}.${config.datasetId}.questions\`
    WHERE subject = @subject
      AND difficulty = @difficulty
      AND is_active = TRUE
      AND (is_premium = FALSE OR @includePremium = TRUE)
  `;
  const [rows] = await bigquery.query({
    query,
    params: { subject, difficulty, includePremium },
    types: { subject: 'STRING', difficulty: 'STRING', includePremium: 'BOOL' },
  });

  return Number(rows[0]?.cnt ?? 0);
}

export async function fetchRandomQuestionIds(subject: string, difficulty: string, includePremium: boolean, count: number): Promise<string[]> {
  const query = `
    SELECT question_id
    FROM \`${config.projectId}.${config.datasetId}.questions\`
    WHERE subject = @subject
      AND difficulty = @difficulty
      AND is_active = TRUE
      AND (is_premium = FALSE OR @includePremium = TRUE)
    ORDER BY RAND()
    LIMIT @count
  `;
  const [rows] = await bigquery.query({
    query,
    params: { subject, difficulty, includePremium, count },
    types: { subject: 'STRING', difficulty: 'STRING', includePremium: 'BOOL', count: 'INT64' },
  });

  return rows.map((r) => r.question_id as string);
}
