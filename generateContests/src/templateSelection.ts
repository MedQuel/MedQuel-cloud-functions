import { Timestamp } from 'firebase-admin/firestore';
import type { Firestore, Transaction } from 'firebase-admin/firestore';

import type { ContestTemplate } from './types.js';


const DUE_TOLERANCE_MS = 5*60*1000;

async function claimRotationTemplateIfDue(db: Firestore, templateId: string): Promise<ContestTemplate | null> {
  const ref = db.collection('contestTemplates').doc(templateId);

  return db.runTransaction(async (tx: Transaction) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;

    const data = snap.data() as ContestTemplate;
    if (!data.isActive) return null;

    const now = Timestamp.now();
    const intervalMs = data.generationIntervalHrs * 60 * 60 * 1000;
    const isDue = !data.lastGeneratedAt || now.toMillis()-data.lastGeneratedAt.toMillis() >= intervalMs-DUE_TOLERANCE_MS;
    if (!isDue) return null;

    tx.update(ref, { lastGeneratedAt: now, updatedAt: now });

    return { ...data, templateId: snap.id, lastGeneratedAt: now };
  });
}

export async function claimEligibleRotationTemplates(db: Firestore): Promise<ContestTemplate[]> {
  const snap = await db
    .collection('contestTemplates')
    .where('templateKind', '==', 'rotation')
    .where('isActive', '==', true)
    .get();

  const claimed: ContestTemplate[] = [];
  for (const doc of snap.docs) {
    const template = await claimRotationTemplateIfDue(db, doc.id);
    if (template) claimed.push(template);
  }

  return claimed;
}

export async function claimGrandChampionshipTemplate(db: Firestore): Promise<ContestTemplate | null> {
  const snap = await db
    .collection('contestTemplates')
    .where('templateKind', '==', 'grand_championship')
    .where('isActive', '==', true)
    .limit(2)
    .get();

  if (snap.empty) {
    console.warn('[generateWeeklyChampionship] No active grand_championship template found.');
    return null;
  }
  if (snap.size > 1) {
    console.warn(`[generateWeeklyChampionship] Found ${snap.size} active grand_championship templates — using the first. Fix your data.`);
  }

  const ref = db.collection('contestTemplates').doc(snap.docs[0].id);

  return db.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    if (!doc.exists) return null;

    const data = doc.data() as ContestTemplate;
    const now = Timestamp.now();

    if (data.lastGeneratedAt && isSameIsoWeek(data.lastGeneratedAt.toDate(), now.toDate())) {
      console.warn('[generateWeeklyChampionship] Already generated this ISO week — skipping (likely a Scheduler retry).');
      return null;
    }

    tx.update(ref, { lastGeneratedAt: now, updatedAt: now });

    return { ...data, templateId: doc.id, lastGeneratedAt: now };
  });
}

function isSameIsoWeek(a: Date, b: Date): boolean {
  return getIsoWeekKey(a) === getIsoWeekKey(b);
}

export function getIsoWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);

  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime()-yearStart.getTime()) / 86400000+1) / 7);

  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}
