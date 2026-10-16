import { FieldValue } from 'firebase-admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';

import { publishNotification } from './notify.js';
import { getActiveBadges } from './badgeCache.js';
import type { QuizCompletedEvent } from './types.js';
import { meetsRequirement, computeProgress } from './evaluate.js';


export type AwardResult = 'applied' | 'skipped_duplicate' | 'skipped_no_user';

export async function evaluateAndAwardBadges(db: Firestore, event: QuizCompletedEvent): Promise<AwardResult> {
  const idempotencyRef = db.collection('processedBadgeEvents').doc(event.sessionId);
  const userRef = db.collection('users').doc(event.userId);
  const badges = await getActiveBadges(db);

  let earnedThisRun: string[] = [];

  const result = await db.runTransaction<AwardResult>(async (tx) => {
    earnedThisRun = [];
    const [idempotencySnap, userSnap] = await Promise.all([
      tx.get(idempotencyRef),
      tx.get(userRef),
    ]);

    if (idempotencySnap.exists) return 'skipped_duplicate';
    if (!userSnap.exists) return 'skipped_no_user';

    const userData = userSnap.data()!;
    const earnedSet = new Set<string>(userData.badges ?? []);
    const badgeProgress: Record<string, number> = { ...(userData.badgeProgress ?? {}) };

    const newlyEarned: string[] = [];
    for (const badge of badges) {
      if (earnedSet.has(badge.badgeId)) continue;

      badgeProgress[badge.badgeId] = computeProgress(userData, badge);
      if (meetsRequirement(userData, badge)) newlyEarned.push(badge.badgeId);
    }

    if (newlyEarned.length > 0) {
      tx.update(userRef, {
        badges: FieldValue.arrayUnion(...newlyEarned),
        badgeProgress,
        badgeEarnedAt: {
          ...(userData.badgeEarnedAt ?? {}),
          ...Object.fromEntries(newlyEarned.map((id) => [id, FieldValue.serverTimestamp()])),
        },
        updatedAt: FieldValue.serverTimestamp(),
      });
    } else if (Object.keys(badgeProgress).length > 0) {
      tx.update(userRef, { badgeProgress });
    }

    tx.set(idempotencyRef, {
      sessionId: event.sessionId,
      userId: event.userId,
      newlyEarned,
      processedAt: FieldValue.serverTimestamp(),
    });

    earnedThisRun = newlyEarned;
    return 'applied';
  });

  if (result === 'applied' && earnedThisRun.length > 0) {
    const names = earnedThisRun.map((id) => badges.find((b) => b.badgeId === id)?.name ?? id);
    await publishNotification({
      userId: event.userId,
      type: 'achievements',
      kind: 'badge_unlocked',
      title: names.length === 1 ? 'New badge unlocked!' : `${names.length} new badges unlocked!`,
      body: names.length === 1 ? `You've earned the "${names[0]}" badge.` : `You've earned: ${names.join(', ')}.`,
      data: { badgeIds: earnedThisRun.join(',') },
      dedupeKey: `badge_${event.sessionId}`,
    });
  }

  return result;
}
