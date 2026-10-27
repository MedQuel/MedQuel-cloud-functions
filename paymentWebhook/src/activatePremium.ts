import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';

import { setPremiumClaim } from './claims.js';
import { getPremiumExpiryMs } from './premium.js';
import { publishNotification } from './notify.js';
import { PaymentNotFoundError, PaymentStateError } from './errors.js';


const DAY_MS = 24 * 60*60*1000;

export type ActivationSource = 'verify' | 'webhook';
export interface ActivationInput {
  orderId: string;
  paymentId: string;
  source: ActivationSource;
  paidAmountPaise?: number;
  paidCurrency?: string;
}
export interface ActivationResult {
  alreadyProcessed: boolean;
  userId: string;
  planId: string;
  premiumExpiresAt: Date;
}

export async function activatePremium(input: ActivationInput, db: Firestore, auth: Auth): Promise<ActivationResult> {
  const paymentRef = db.collection('payments').doc(input.orderId);

  const result = await db.runTransaction(
    async (tx): Promise<ActivationResult> => {
      const paymentSnap = await tx.get(paymentRef);
      if (!paymentSnap.exists) throw new PaymentNotFoundError();

      const payment = paymentSnap.data()!;
      const userId: string = payment.userId;
      const planId: string = payment.planId;

      if (payment.status === 'captured') {
        if (!(payment.expiresAt instanceof Timestamp)) {
          throw new PaymentStateError('Captured payment is missing a valid expiry timestamp.');
        }

        return {
          alreadyProcessed: true,
          userId,
          planId,
          premiumExpiresAt: (payment.expiresAt as Timestamp).toDate(),
        };
      }

      if (payment.status === 'refunded') {
        throw new PaymentStateError('This payment has been refunded.');
      }

      if (input.paidAmountPaise !== undefined && input.paidAmountPaise !== payment.amountPaise) {
        throw new PaymentStateError('Paid amount does not match the order amount.');
      }

      if (input.paidCurrency !== undefined && input.paidCurrency !== payment.currency) {
        throw new PaymentStateError('Paid currency does not match the order currency.');
      }

      const userRef = db.collection('users').doc(userId);
      const userSnap = await tx.get(userRef);
      if (!userSnap.exists) throw new PaymentStateError('User for this payment no longer exists.');

      const userData = userSnap.data()!;
      const now = Timestamp.now();
      const currentExpiryMs = getPremiumExpiryMs(userData);
      const startMs =
        userData.isPremium === true &&
        currentExpiryMs !== null &&
        currentExpiryMs > now.toMillis() ? currentExpiryMs : now.toMillis();
      const expiresAt = Timestamp.fromMillis(startMs + payment.durationDays*DAY_MS);

      const subscriptionId = `sub_${input.orderId}`;
      tx.set(db.collection('subscriptions').doc(subscriptionId), {
        subscriptionId,
        userId,
        planId,
        provider: 'razorpay',
        razorpayOrderId: input.orderId,
        razorpayPaymentId: input.paymentId,
        status: 'active',
        startsAt: Timestamp.fromMillis(startMs),
        expiresAt,
        autoRenew: false,
        createdAt: now,
      });

      tx.update(paymentRef, {
        status: 'captured',
        paymentId: input.paymentId,
        activatedVia: input.source,
        capturedAt: now,
        expiresAt,
        updatedAt: now,
      });

      tx.update(userRef, {
        isPremium: true,
        premiumExpiresAt: expiresAt,
        premiumPlanId: planId,
        subscriptionId,
        updatedAt: FieldValue.serverTimestamp(),
      });

      return {
        alreadyProcessed: false,
        userId,
        planId,
        premiumExpiresAt: expiresAt.toDate(),
      };
    }
  );

  if (!result.alreadyProcessed) {
    await setPremiumClaim(auth, result.userId, true, result.premiumExpiresAt.getTime());

    await publishNotification({
      userId: result.userId,
      type: 'premium',
      kind: 'premium_activated',
      title: 'Premium activated!',
      body: `Your MedQuel Premium is active until ${result.premiumExpiresAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })}.`,
      data: { planId: result.planId, orderId: input.orderId },
      dedupeKey: `premium_${input.orderId}`,
    });
  }

  return result;
}
