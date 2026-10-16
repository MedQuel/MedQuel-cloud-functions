import { Timestamp } from 'firebase-admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';

import { getPreviousWeeklyPeriodKey } from './periodKeys.js';


const TOP_N = 100;
export interface RollupOutcome {
  periodKey: string;
  entriesConsidered: number;
  entriesUpdated: number;
}

export async function rollupPeriod(db: Firestore, periodKey: string, now: Date = new Date()): Promise<RollupOutcome> {
  const entriesRef = db.collection('leaderboard').doc(periodKey).collection('entries');
  const snap = await entriesRef.orderBy('epPoints', 'desc').limit(TOP_N).get();

  if (snap.empty) return { periodKey, entriesConsidered: 0, entriesUpdated: 0 };

  const isWeekly = periodKey.startsWith('weekly_');
  const prevEpByUserId = new Map<string, number>();

  if (isWeekly) {
    const prevPeriodKey = getPreviousWeeklyPeriodKey(now);
    const prevEntriesRef = db.collection('leaderboard').doc(prevPeriodKey).collection('entries');
    const prevRefs = snap.docs.map((doc) => prevEntriesRef.doc(doc.id));

    const prevSnaps = await db.getAll(...prevRefs);
    prevSnaps.forEach((prevSnap, i) => {
      if (prevSnap.exists) prevEpByUserId.set(snap.docs[i].id, prevSnap.data()!.epPoints ?? 0);
    });
  }

  const batch = db.batch();
  const nowTs = Timestamp.now();
  let updated = 0;

  snap.docs.forEach((doc, index) => {
    const newRank = index + 1;
    const data = doc.data();
    const oldRank: number = data.rank ?? 0;
    const currentEp: number = data.epPoints ?? 0;
    const oldWeeklyChange: number = data.weeklyChange ?? 0;

    const newWeeklyChange = isWeekly ? currentEp - (prevEpByUserId.get(doc.id) ?? 0) : oldWeeklyChange;

    const rankChanged = oldRank !== newRank;
    const weeklyChangeChanged = isWeekly && newWeeklyChange !== oldWeeklyChange;

    if (!rankChanged && !weeklyChangeChanged) return;

    const updatePayload: Record<string, unknown> = { updatedAt: nowTs };
    if (rankChanged) {
      updatePayload.rank = newRank;
      updatePayload.prevRank = oldRank;
    }
    if (isWeekly) updatePayload.weeklyChange = newWeeklyChange;

    batch.update(doc.ref, updatePayload);
    updated += 1;
  });

  if (updated > 0) await batch.commit();

  return { periodKey, entriesConsidered: snap.size, entriesUpdated: updated };
}
