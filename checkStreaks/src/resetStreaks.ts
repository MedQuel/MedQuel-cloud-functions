import type { Firestore, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { toISTDateKey, istDateKeyMinusOneDay } from './dateUtils.js';


const PAGE_SIZE = 500;
const BATCH_LIMIT = 500;
export interface ResetOutcome {
  scanned: number;
  reset: number;
}

export async function resetExpiredStreaks(db: Firestore, now: Date): Promise<ResetOutcome> {
  const todayKey = toISTDateKey(now);
  const yesterdayKey = istDateKeyMinusOneDay(now);

  let scanned = 0;
  let reset = 0;
  let lastDoc: QueryDocumentSnapshot | undefined;

  while (true) {
    let query = db.collection('users').where('currentStreak', '>', 0).orderBy('currentStreak').limit(PAGE_SIZE);

    if (lastDoc) query = query.startAfter(lastDoc);

    const snap = await query.get();
    if (snap.empty) break;

    scanned += snap.size;

    const staleDocs = snap.docs.filter((doc) => {
      const lastActiveDate = doc.data().lastActiveDate?.toDate?.();
      if (!lastActiveDate) return true;

      const lastKey = toISTDateKey(lastActiveDate);

      return lastKey !== todayKey && lastKey !== yesterdayKey;
    });

    for (let i=0; i<staleDocs.length; i+=BATCH_LIMIT) {
      const chunk = staleDocs.slice(i, i+BATCH_LIMIT);
      const batch = db.batch();
      chunk.forEach((doc) => batch.update(doc.ref, { currentStreak: 0 }));
      await batch.commit();
      reset += chunk.length;
    }

    lastDoc = snap.docs[snap.docs.length - 1];
    if (snap.size < PAGE_SIZE) break;
  }

  return { scanned, reset };
}
