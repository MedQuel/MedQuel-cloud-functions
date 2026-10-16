import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import type { Firestore, Transaction } from 'firebase-admin/firestore';

import { toISTDateKey } from './dateUtils.js';
import type { QuizCompletedEvent } from './types.js';


export type ActivityApplyResult = 'applied' | 'skipped_duplicate' | 'skipped_no_user';

function minutesStudiedLabel(timeTakenSecs: number): string {
  return `${(timeTakenSecs / 60).toFixed(1)}m`;
}

export async function applyActivityAndStatsUpdate(db: Firestore, event: QuizCompletedEvent): Promise<ActivityApplyResult> {
  const idempotencyRef = db.collection('processedActivityEvents').doc(event.sessionId);
  const dateKey = toISTDateKey(new Date(event.completedAt));

  const userRef = db.collection('users').doc(event.userId);
  const activityLogRef = userRef.collection('activityLog').doc(dateKey);

  const result = await db.runTransaction(async (tx: Transaction) => {
    const [idempotencySnap, userSnap] = await Promise.all([
      tx.get(idempotencyRef),
      tx.get(userRef),
    ]);

    if (idempotencySnap.exists) return 'skipped_duplicate' as const;
    if (!userSnap.exists) return 'skipped_no_user' as const;

    const nowTs = Timestamp.now();
    const minutesStudied = event.timeTaken / 60;

    tx.set(
      activityLogRef,
      {
        date: dateKey,
        questionsAttempted: FieldValue.increment(event.totalQuestions),
        questionsCorrect: FieldValue.increment(event.correctCount),
        minutesStudied: FieldValue.increment(minutesStudied),
        updatedAt: nowTs,
      },
      { merge: true }
    );

    tx.update(userRef, {
      'stats.scorePercentSum': FieldValue.increment(event.scorePercent),
      'stats.completedSessions': FieldValue.increment(1),
    });

    tx.set(idempotencyRef, {
      sessionId: event.sessionId,
      userId: event.userId,
      dateKey,
      processedAt: nowTs,
    });

    return 'applied' as const;
  });

  if (result === 'applied') {
    console.log(`[activityStats] session ${event.sessionId}: +${event.totalQuestions}q / +${minutesStudiedLabel(event.timeTaken)} logged to ${dateKey} for user ${event.userId}.`);
  } else if (result === 'skipped_no_user') {
    console.error(`[activityStats] user ${event.userId} not found — cannot process session ${event.sessionId}.`);
  } else {
    console.log(`[activityStats] session ${event.sessionId}: duplicate delivery — already processed, skipped.`);
  }

  return result;
}
