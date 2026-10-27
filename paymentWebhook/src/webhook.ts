import crypto from 'node:crypto';
import { getAuth } from 'firebase-admin/auth';
import { initializeApp, getApps } from 'firebase-admin/app';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';
import type { Request, Response } from '@google-cloud/functions-framework';

import { activatePremium } from './activatePremium.js';
import { PaymentNotFoundError, PaymentStateError } from './errors.js';
import { handleRefundProcessed, type RefundEntity } from './refund.js';


const WEBHOOK_EVENT_RETENTION_MS = 90 * 24*60*60*1000;
const EVENT_ID_PATTERN = /^[A-Za-z0-9._:-]{1,200}$/;

if (getApps().length === 0) initializeApp();
const db = getFirestore();
const auth = getAuth();


interface PaymentEntity {
  id: string;
  order_id: string;
  amount: number;
  currency: string;
  status: string;
  error_description?: string | null;
}
interface RazorpayEvent {
  event: string;
  payload: {
    payment?: { entity?: PaymentEntity };
    refund?: { entity?: RefundEntity };
  };
}

function signatureIsValid(rawBody: Buffer, signature: string, secret: string): boolean {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');

  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function getEventClaimId(headerEventId: string | undefined, event: RazorpayEvent): string | null {
  if (headerEventId && EVENT_ID_PATTERN.test(headerEventId)) {
    return headerEventId;
  }

  const entityId = event.payload.payment?.entity?.id ?? event.payload.refund?.entity?.id;
  return entityId ? `${event.event}_${entityId}` : null;
}

async function markPaymentFailed(payment: PaymentEntity): Promise<void> {
  const ref = db.collection('payments').doc(payment.order_id);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;

    const status = snap.data()!.status;
    if (status === 'captured' || status === 'refunded') return;

    tx.update(ref, {
      status: 'failed',
      failureReason: payment.error_description ?? null,
      updatedAt: Timestamp.now(),
    });
  });
}

async function processEvent(event: RazorpayEvent): Promise<void> {
  const payment = event.payload.payment?.entity;

  switch (event.event) {
    case 'payment.captured':
    case 'order.paid': {
      if (!payment) throw new Error(`${event.event} without payment entity`);
      await activatePremium(
        {
          orderId: payment.order_id,
          paymentId: payment.id,
          source: 'webhook',
          paidAmountPaise: Number(payment.amount),
          paidCurrency: payment.currency,
        },
        db,
        auth
      );
      return;
    }
    case 'payment.failed': {
      if (payment) await markPaymentFailed(payment);
      return;
    }
    case 'refund.processed': {
      const refund = event.payload.refund?.entity;
      if (refund) await handleRefundProcessed(refund, db, auth);
      return;
    }
    default: return;
  }
}

async function claimWebhookEvent(
  eventId: string,
  event: RazorpayEvent
): Promise<{ ref: FirebaseFirestore.DocumentReference; duplicate: boolean }> {
  const ref = db.collection('webhookEvents').doc(eventId);

  try {
    await ref.create({
      event: event.event,
      status: 'processing',
      receivedAt: Timestamp.now(),
      expiresAt: Timestamp.fromMillis(Date.now() + WEBHOOK_EVENT_RETENTION_MS),
    });
    return { ref, duplicate: false };
  } catch (err) {
    if ((err as { code?: number }).code !== 6) throw err;

    const snapshot = await ref.get();
    const data = snapshot.data();
    if (data?.status === 'completed') return { ref, duplicate: true };
    if (data?.status === 'failed') {
      await ref.set(
        {
          event: event.event,
          status: 'processing',
          retryStartedAt: Timestamp.now(),
          expiresAt: Timestamp.fromMillis(Date.now() + WEBHOOK_EVENT_RETENTION_MS),
        },
        { merge: true }
      );
      return { ref, duplicate: false };
    }

    await ref.set(
      {
        event: event.event,
        status: 'processing',
        retryStartedAt: Timestamp.now(),
        expiresAt: Timestamp.fromMillis(Date.now() + WEBHOOK_EVENT_RETENTION_MS),
      },
      { merge: true }
    );
    return { ref, duplicate: false };
  }
}


export async function paymentWebhook(req: Request, res: Response): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  const secret = process.env.RAZORPAY_WEBHOOK_SECRET?.trim();
  if (!secret) {
    console.error('[webhook] RAZORPAY_WEBHOOK_SECRET is not configured.');
    res.status(500).send('Server misconfigured');
    return;
  }

  const signature = req.get('x-razorpay-signature');
  const rawBody = req.rawBody;
  if (!signature || !rawBody || !signatureIsValid(rawBody, signature, secret)) {
    console.warn('[webhook] Rejected request with missing/invalid signature.');
    res.status(401).send('Invalid signature');
    return;
  }

  let event: RazorpayEvent;
  try {
    event = JSON.parse(rawBody.toString('utf8')) as RazorpayEvent;
  } catch {
    res.status(400).send('Invalid JSON');
    return;
  }

  if (!event || typeof event.event !== 'string' || !event.payload || typeof event.payload !== 'object') {
    res.status(400).send('Invalid event payload');
    return;
  }

  const eventId = getEventClaimId(req.get('x-razorpay-event-id')?.trim(), event);
  let claimRef: FirebaseFirestore.DocumentReference | null = null;
  if (eventId) {
    const claim = await claimWebhookEvent(eventId, event);
    claimRef = claim.ref;
    if (claim.duplicate) {
      res.status(200).json({ ok: true, duplicate: true });
      return;
    }
  }

  try {
    await processEvent(event);
    await claimRef?.set(
      { status: 'completed', completedAt: Timestamp.now() },
      { merge: true }
    );
    res.status(200).json({ ok: true });
  } catch (err) {
    if (err instanceof PaymentNotFoundError || err instanceof PaymentStateError) {
      console.error(`[webhook] ${event.event} not applied (${(err as Error).name}): ${(err as Error).message}`);

      try {
        await claimRef?.set(
          { status: 'completed', applied: false, completedAt: Timestamp.now() },
          { merge: true }
        );
      } catch (claimError) {
        console.error('[webhook] Failed to record non-retryable webhook outcome.', claimError);
      }

      res.status(200).json({ ok: true, applied: false });
      return;
    }

    console.error(`[webhook] ${event.event} failed, asking Razorpay to retry:`, err);
    if (claimRef) {
      try {
        await claimRef.set(
          { status: 'failed', failedAt: Timestamp.now() },
          { merge: true }
        );
      } catch (claimError) {
        console.error('[webhook] Failed to record failed webhook claim; stale-claim recovery will retry it.', claimError);
      }
    }

    res.status(500).send('Processing failed');
  }
}
