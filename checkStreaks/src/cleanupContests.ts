import { Timestamp } from 'firebase-admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';


const MAX_PER_RUN = 25;
const RETENTION_DAYS = 15;

export async function cleanupOldContests(db: Firestore, now: Date): Promise<number> {
  const cutoff = Timestamp.fromMillis(now.getTime() - RETENTION_DAYS * 24*60*60*1000);

  const snap = await db
    .collection('contests')
    .where('status', '==', 'completed')
    .where('endsAt', '<=', cutoff)
    .limit(MAX_PER_RUN)
    .get();

  let deleted = 0;
  for (const doc of snap.docs) {
    try {
      await db.recursiveDelete(doc.ref);
      await db.collection('contestFinalizations').doc(doc.id).delete();
      deleted++;
    } catch (err) {
      console.error(`[cleanupContests] failed for ${doc.id}:`, err);
    }
  }

  return deleted;
}
