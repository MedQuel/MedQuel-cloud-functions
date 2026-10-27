import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';

import { setPremiumClaim } from './claims.js';
import { getPremiumExpiryMs } from './premium.js';
import { publishNotification } from './notify.js';


const DAY_MS = 24 * 60*60*1000;
export interface RefundEntity {
  id: string;
  payment_id: string;
  amount: number;
}

export async function handleRefundProcessed(refund: RefundEntity, db: Firestore, auth: Auth): Promise<void> {
  const found = await db
    .collection('payments')
    .where('paymentId', '==', refund.payment_id)
    .limit(1)
    .get();
  if (found.empty) {
    console.warn(`[payments] refund ${refund.id}: no payment found for ${refund.payment_id}, ignoring.`);
    return;
  }

  const paymentRef = found.docs[0]!.ref;

  const outcome = await db.runTransaction(async (tx) => {
    const paymentSnap = await tx.get(paymentRef);
    const payment = paymentSnap.data()!;

    if (payment.status === 'refunded') return null;
    if (payment.status !== 'captured') {
      tx.update(paymentRef, {
        status: 'refunded',
        refundId: refund.id,
        updatedAt: Timestamp.now(),
      });
      return null;
    }
    if (refund.amount < payment.amountPaise) {
      console.error(`[payments] PARTIAL refund ${refund.id} on order ${payment.orderId}: review manually.`);
      return null;
    }

    const userRef = db.collection('users').doc(payment.userId);
    const userSnap = await tx.get(userRef);
    const now = Timestamp.now();

    tx.update(paymentRef, {
      status: 'refunded',
      refundId: refund.id,
      refundedAt: now,
      updatedAt: now,
    });
    tx.set(
      db.collection('subscriptions').doc(`sub_${payment.orderId}`),
      { status: 'refunded', updatedAt: now },
      { merge: true }
    );

    if (!userSnap.exists) return null;

    const currentExpiryMs = getPremiumExpiryMs(userSnap.data());
    const newExpiryMs = (currentExpiryMs ?? now.toMillis()) - payment.durationDays*DAY_MS;

    if (newExpiryMs > now.toMillis()) {
      tx.update(userRef, {
        premiumExpiresAt: Timestamp.fromMillis(newExpiryMs),
        updatedAt: FieldValue.serverTimestamp(),
      });

      return {
        userId: payment.userId as string,
        stillPremium: true,
        expiryMs: newExpiryMs,
        orderId: payment.orderId as string,
      };
    }

    tx.update(userRef, {
      isPremium: false,
      premiumExpiresAt: now,
      premiumPlanId: null,
      subscriptionId: null,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return {
      userId: payment.userId as string,
      stillPremium: false,
      expiryMs: null,
      orderId: payment.orderId as string,
    };
  });

  if (!outcome) return;

  await setPremiumClaim(auth, outcome.userId, outcome.stillPremium, outcome.expiryMs);

  await publishNotification({
    userId: outcome.userId,
    type: 'premium',
    kind: 'premium_refunded',
    title: 'Refund processed',
    body: outcome.stillPremium
      ? 'Your refund has been processed. Your remaining premium time is unchanged.'
      : 'Your refund has been processed and premium has ended on your account.',
    data: { orderId: outcome.orderId },
    dedupeKey: `premiumRefund_${refund.id}`,
  });
}
