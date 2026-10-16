import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';


if (getApps().length === 0) initializeApp();
const db = getFirestore();

export interface IngestionReport {
  sourceFile: string;
  totalRows: number;
  insertedCount: number;
  duplicateCount: number;
  rejectedCount: number;
  insertFailureCount: number;
  rejectedRows: Array<{ row: number; errors: string[] }>;
  duplicateRows: Array<{ row: number; contentHash: string }>;
  insertFailures: Array<{ questionText: string; reason: string }>;
  imageCheckFailures: Array<{ row: number; imageUrl: string }>;
  startedAt: string;
  completedAt: string;
  status: 'completed' | 'completed_with_errors';
}

export async function writeIngestionReport(jobId: string, report: IngestionReport): Promise<void> {
  await db.collection('ingestions').doc(jobId).set({ ...report, createdAt: FieldValue.serverTimestamp() });
}
