import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import type { Firestore, Transaction } from 'firebase-admin/firestore';

import type { QuizCompletedEvent } from './types.js';
import { getIsoWeekKey, getMonthKey } from './dateUtils.js';


const CONTEST_QUIZ_TYPES = new Set(['contest', 'daily']);
export type ApplyResult =
  | 'applied'
  | 'skipped_duplicate'
  | 'skipped_not_contest'
  | 'skipped_zero_ep'
  | 'skipped_no_user';

interface UserSnapshot {
  displayName: string;
  photoURL: string | null;
  specialization: string;
}

function buildPeriodKeys(now: Date): string[] {
  return [
    `weekly_${getIsoWeekKey(now)}`,
    `monthly_${getMonthKey(now)}`,
    'allTime',
  ];
}

async function fetchUserSnapshot(db: Firestore, userId: string): Promise<UserSnapshot | null> {
  const doc = await db.collection('users').doc(userId).get();
  if (!doc.exists) return null;

  const data = doc.data()!;
  return {
    displayName: data.displayName ?? 'Unknown',
    photoURL: data.photoURL ?? null,
    specialization: data.targetExam ?? '',
  };
}


export async function applyQuizCompletedEvent(db: Firestore, event: QuizCompletedEvent): Promise<ApplyResult> {
  if (!CONTEST_QUIZ_TYPES.has(event.quizType)) {
    console.log(`[onQuizCompleted] session ${event.sessionId} is quizType="${event.quizType}" — not contest mode, skipping.`);
    return 'skipped_not_contest';
  }

  if (event.epEarned <= 0) {
    console.log(`[onQuizCompleted] session ${event.sessionId} earned 0 EP — skipping (below pass threshold).`);
    return 'skipped_zero_ep';
  }

  const userSnapshot = await fetchUserSnapshot(db, event.userId);
  if (!userSnapshot) {
    console.error(`[onQuizCompleted] user ${event.userId} not found — cannot process session ${event.sessionId}.`);
    return 'skipped_no_user';
  }

  const idempotencyRef = db.collection('processedQuizEvents').doc(event.sessionId);
  const periodKeys = buildPeriodKeys(new Date());
  const entryRefs = periodKeys.map((period) => db.collection('leaderboard').doc(period).collection('entries').doc(event.userId));

  const result = await db.runTransaction(async (tx: Transaction) => {
    const idempotencySnap = await tx.get(idempotencyRef);
    if (idempotencySnap.exists) return 'skipped_duplicate' as const;

    const entrySnaps = await Promise.all(entryRefs.map((ref) => tx.get(ref)));
    const nowTs = Timestamp.now();

    entrySnaps.forEach((snap, i) => {
      const ref = entryRefs[i];

      if (snap.exists) {
        tx.update(ref, {
          epPoints: FieldValue.increment(event.epEarned),
          displayName: userSnapshot.displayName,
          photoURL: userSnapshot.photoURL,
          specialization: userSnapshot.specialization,
          updatedAt: nowTs,
        });
      } else {
        tx.set(ref, {
          userId: event.userId,
          displayName: userSnapshot.displayName,
          photoURL: userSnapshot.photoURL,
          specialization: userSnapshot.specialization,
          epPoints: event.epEarned,
          rank: 0,
          prevRank: 0,
          weeklyChange: 0,
          updatedAt: nowTs,
        });
      }
    });

    tx.set(idempotencyRef, {
      sessionId: event.sessionId,
      userId: event.userId,
      epApplied: event.epEarned,
      periods: periodKeys,
      processedAt: nowTs,
    });

    return 'applied' as const;
  });

  if (result === 'applied') {
    console.log(`[onQuizCompleted] session ${event.sessionId}: +${event.epEarned} EP applied to [${periodKeys.join(', ')}] for user ${event.userId}.`);
  } else {
    console.log(`[onQuizCompleted] session ${event.sessionId}: duplicate delivery — already processed, skipped.`);
  }

  return result;
}
