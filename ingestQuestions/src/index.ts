import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Storage } from '@google-cloud/storage';
import functions from '@google-cloud/functions-framework';
import type { CloudEvent } from '@google-cloud/functions-framework';

import { config } from './config.js';
import { parseAndValidate } from './parser.js';
import { computeContentHash } from './hash.js';
import { checkImagesInBatches } from './imageCheck.js';
import { writeIngestionReport } from './firestoreReport.js';
import { getExistingHashes, insertQuestionRows, toInsertRow, type QuestionInsertRow } from './bigquery.js';


interface StorageObjectData {
  bucket: string;
  name: string;
  contentType?: string;
}

const storage = new Storage({ projectId: config.projectId });

functions.cloudEvent<StorageObjectData>(
  'ingestQuestions',
  async (cloudEvent: CloudEvent<StorageObjectData>) => {
    const data = cloudEvent.data;
    if (!data) {
      console.error('Received event with no data payload');
      return;
    }

    const { bucket, name } = data;
    if (!name.startsWith(config.uploadPrefix) || !name.toLowerCase().endsWith('.xlsx')) {
      console.log(`Ignoring object outside scope: ${name}`);
      return;
    }

    const jobId = randomUUID();
    const startedAt = new Date().toISOString();
    const sourceModule = path.basename(name, '.xlsx');

    console.log(`[${jobId}] Parsing started: ${name}`);
    const fileStream = storage.bucket(bucket).file(name).createReadStream();
    const results = await parseAndValidate(fileStream);

    const rejectedRows = results.filter((r) => r.status === 'rejected').map((r) => ({ row: r.rowNumber, errors: r.errors }));

    const validEntries = results
      .filter((r) => r.status === 'valid' && r.data)
      .map((r) => ({
        rowNumber: r.rowNumber,
        data: r.data!,
        hash: computeContentHash(r.data!.questionText),
      }));

    // In-batch dedup
    const seenInBatch = new Set<string>();
    const duplicateRows: Array<{ row: number; contentHash: string }> = [];
    const uniqueEntries = validEntries.filter((entry) => {
      if (seenInBatch.has(entry.hash)) {
        duplicateRows.push({ row: entry.rowNumber, contentHash: entry.hash });
        return false;
      }
      seenInBatch.add(entry.hash);
      return true;
    });

    // Cross-table dedup
    const existingHashes = await getExistingHashes(uniqueEntries.map((e) => e.hash));
    const dedupedEntries = uniqueEntries.filter((entry) => {
      if (existingHashes.has(entry.hash)) {
        duplicateRows.push({ row: entry.rowNumber, contentHash: entry.hash });
        return false;
      }
      return true;
    });

    // Image existence check
    const imageCheckResults = await checkImagesInBatches(
      dedupedEntries.map((e) => ({
        rowNumber: e.rowNumber,
        data: e.data,
        hash: e.hash,
        imageUrl: e.data.imageUrl,
        questionType: e.data.questionType,
      }))
    );

    const imageCheckFailures: Array<{ row: number; imageUrl: string }> = [];
    const toInsert: QuestionInsertRow[] = [];

    for (const { entry, ok } of imageCheckResults) {
      if (!ok) {
        imageCheckFailures.push({ row: entry.rowNumber, imageUrl: entry.imageUrl! });
        continue;
      }
      toInsert.push(toInsertRow(entry.data, randomUUID(), entry.hash, sourceModule));
    }

    const { insertedCount, failures } = await insertQuestionRows(toInsert);

    const report = {
      sourceFile: name,
      totalRows: results.length,
      insertedCount,
      duplicateCount: duplicateRows.length,
      rejectedCount: rejectedRows.length,
      insertFailureCount: failures.length,
      imageCheckFailureCount: imageCheckFailures.length,
      rejectedRows,
      duplicateRows,
      insertFailures: failures.map((f) => ({ questionText: f.row.question_text, reason: f.reason })),
      imageCheckFailures,
      startedAt,
      completedAt: new Date().toISOString(),
      status: (failures.length > 0 || imageCheckFailures.length > 0
        ? 'completed_with_errors'
        : 'completed') as 'completed' | 'completed_with_errors',
    };

    await writeIngestionReport(jobId, report);

    console.log(
      `[${jobId}] Ingestion complete: ${JSON.stringify({
        sourceFile: report.sourceFile,
        totalRows: report.totalRows,
        inserted: report.insertedCount,
        duplicates: report.duplicateCount,
        rejected: report.rejectedCount,
        insertFailures: report.insertFailureCount,
        imageCheckFailures: report.imageCheckFailureCount,
      })}`
    );
  }
);
