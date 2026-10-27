import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';

import { setPremiumClaim } from './claims.js';
import { publishNotification } from './notify.js';


const BATCH_SIZE = 400;
const MAX_BATCHES = 20;
const SIDE_EFFECT_CONCURRENCY = 10;

export async function sweepExpiredPremium(db: Firestore, auth: Auth, nowMs: number = Date.now()): Promise<number> {
  let total = 0;

  for (let i=0; i<MAX_BATCHES; i++) {
    const snap = await db
      .collection('users')
      .where('isPremium', '==', true)
      .where('premiumExpiresAt', '<=', Timestamp.fromMillis(nowMs))
      .limit(BATCH_SIZE)
      .get();
    if (snap.empty) break;

    const now = Timestamp.now();
    const batch = db.batch();
    for (const doc of snap.docs) {
      batch.update(doc.ref, {
        isPremium: false,
        updatedAt: FieldValue.serverTimestamp(),
      });

      const subscriptionId = doc.data().subscriptionId as string | null | undefined;
      if (subscriptionId) {
        batch.set(
          db.collection('subscriptions').doc(subscriptionId),
          { status: 'expired', updatedAt: now },
          { merge: true }
        );
      }
    }
    await batch.commit();

    for (let j=0; j<snap.docs.length; j+=SIDE_EFFECT_CONCURRENCY) {
      const slice = snap.docs.slice(j, j+SIDE_EFFECT_CONCURRENCY);

      await Promise.allSettled(
        slice.map(async (doc) => {
          const expiredAtMs = (doc.data().premiumExpiresAt as Timestamp).toMillis();

          await setPremiumClaim(auth, doc.id, false, null);
          await publishNotification({
            userId: doc.id,
            type: 'premium',
            kind: 'premium_expired',
            title: 'Your premium has ended',
            body: 'Renew anytime to get your premium contests, analytics and study plan back.',
            dedupeKey: `premiumExpired_${doc.id}_${expiredAtMs}`,
          });
        })
      );
    }

    total += snap.size;
    if (snap.size < BATCH_SIZE) break;
  }

  return total;
}
