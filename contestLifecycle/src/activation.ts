import { Timestamp } from 'firebase-admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';


const BATCH_LIMIT = 500;

export async function activateScheduledContests(db: Firestore, now: Date): Promise<number> {
  const snap = await db
    .collection('contests')
    .where('status', '==', 'scheduled')
    .where('startsAt', '<=', Timestamp.fromDate(now))
    .limit(BATCH_LIMIT)
    .get();

  if (snap.empty) return 0;

  const batch = db.batch();
  const nowTs = Timestamp.now();

  snap.docs.forEach((doc) => batch.update(doc.ref, { status: 'active', updatedAt: nowTs }));
  await batch.commit();

  return snap.size;
}

export async function findContestsPastEnd(db: Firestore, now: Date): Promise<string[]> {
  const snap = await db
    .collection('contests')
    .where('status', '==', 'active')
    .where('endsAt', '<=', Timestamp.fromDate(now))
    .limit(BATCH_LIMIT)
    .get();

  return snap.docs.map((d) => d.id);
}
