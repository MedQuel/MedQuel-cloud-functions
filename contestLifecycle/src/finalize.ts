import type { Firestore } from 'firebase-admin/firestore';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';

import { computeLevelFromXp } from './xpLevel.js';
import type { ContestDoc, ContestLeaderboardEntry } from './types.js';


const TOP_N_RANK = 100;
const EP_BONUS_TIERS: ReadonlyArray<{ rank: number; multiplier: number }> = [
  { rank: 1, multiplier: 0.5 },
  { rank: 2, multiplier: 0.3 },
  { rank: 3, multiplier: 0.15 },
];
const XP_BONUS_TIERS: ReadonlyArray<{ rank: number; multiplier: number }> = [
  { rank: 1, multiplier: 0.25 },
  { rank: 2, multiplier: 0.15 },
  { rank: 3, multiplier: 0.08 },
];

export type FinalizeOutcome = 'finalized' | 'skipped_already_finalized' | 'skipped_not_found' | 'skipped_already_completed';

const IST_OFFSET_MS = (5*60 + 30) * 60*1000;
function getIsoWeekKey(date: Date): string {
  const istShifted = new Date(date.getTime() + IST_OFFSET_MS);
  const d = new Date(
    Date.UTC(
      istShifted.getUTCFullYear(),
      istShifted.getUTCMonth(),
      istShifted.getUTCDate()
    )
  );

  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate()+4 - dayNum);

  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime()-yearStart.getTime()) / 86400000+1) / 7);

  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function getMonthKey(date: Date): string {
  const istShifted = new Date(date.getTime() + IST_OFFSET_MS);
  return `${istShifted.getUTCFullYear()}-${String(istShifted.getUTCMonth()+1).padStart(2, '0')}`;
}

function buildPeriodKeys(now: Date): string[] {
  return [
    `weekly_${getIsoWeekKey(now)}`,
    `monthly_${getMonthKey(now)}`,
    'allTime',
  ];
}

async function fetchUserSnapshot(db: Firestore, userId: string) {
  const doc = await db.collection('users').doc(userId).get();
  if (!doc.exists) return null;

  const data = doc.data()!;

  return {
    displayName: data.displayName ?? 'Unknown',
    photoURL: data.photoURL ?? null,
    specialization: data.targetExam ?? '',
  };
}


async function awardContestBonus(db: Firestore, userId: string, bonusEp: number, bonusXp: number, contestId: string, rank: number): Promise<void> {
  if (bonusEp <= 0 && bonusXp <= 0) return;

  const userSnapshot = await fetchUserSnapshot(db, userId);
  if (!userSnapshot) {
    console.error(`[contestLifecycle] contest ${contestId}: winner ${userId} (rank ${rank}) not found — skipping bonus.`);
    return;
  }

  const now = new Date();
  const periodKeys = buildPeriodKeys(now);
  const userRef = db.collection('users').doc(userId);
  const entryRefs = periodKeys.map((p) => db.collection('leaderboard').doc(p).collection('entries').doc(userId));

  await db.runTransaction(async (tx) => {
    const [userSnap, ...entrySnaps] = await Promise.all([
      tx.get(userRef),
      ...entryRefs.map((r) => tx.get(r)),
    ]);
    if (!userSnap.exists) return;

    const userData = userSnap.data()!;
    const nowTs = Timestamp.now();
    const updatedXpPoints = (userData.xpPoints ?? 0) + bonusXp;
    const updatedCurrentLevel = computeLevelFromXp(updatedXpPoints);

    tx.update(userRef, {
      epPoints: FieldValue.increment(bonusEp),
      xpPoints: updatedXpPoints,
      currentLevel: updatedCurrentLevel,
      'stats.top3Finishes': FieldValue.increment(1),
      updatedAt: nowTs,
    });

    entrySnaps.forEach((snap, i) => {
      const ref = entryRefs[i];
      if (snap.exists) {
        tx.update(ref, { epPoints: FieldValue.increment(bonusEp), updatedAt: nowTs });
      } else {
        tx.set(ref, {
          userId,
          displayName: userSnapshot.displayName,
          photoURL: userSnapshot.photoURL,
          specialization: userSnapshot.specialization,
          epPoints: bonusEp,
          rank: 0,
          prevRank: 0,
          weeklyChange: 0,
          updatedAt: nowTs,
        });
      }
    });
  });

  console.log(`[contestLifecycle] contest ${contestId}: awarded +${bonusEp} EP / +${bonusXp} XP bonus to rank ${rank} (${userId}).`);
}


export async function finalizeContest(contestId: string, db: Firestore): Promise<FinalizeOutcome> {
  const contestRef = db.collection('contests').doc(contestId);
  const finalizationRef = db.collection('contestFinalizations').doc(contestId);

  type ClaimResult = 'claimed' | 'not_found' | 'already_finalized' | 'already_completed';

  const claimResult = await db.runTransaction<ClaimResult>(async (tx) => {
    const [contestSnap, finalizationSnap] = await Promise.all([
      tx.get(contestRef),
      tx.get(finalizationRef),
    ]);
    if (!contestSnap.exists) return 'not_found';
    if (finalizationSnap.exists) return 'already_finalized';

    const data = contestSnap.data() as ContestDoc;
    if (data.status === 'completed') return 'already_completed';

    const now = Timestamp.now();
    tx.update(contestRef, { status: 'completed', updatedAt: now });
    tx.set(finalizationRef, { contestId, status: 'ranking', startedAt: now });
    return 'claimed';
  });

  if (claimResult !== 'claimed') return claimResult === 'not_found' ? 'skipped_not_found' : 'skipped_already_finalized';

  const contestSnap = await contestRef.get();
  const contest = contestSnap.data() as ContestDoc;

  const leaderboardRef = contestRef.collection('leaderboard');
  const rankSnap = await leaderboardRef
    .orderBy('score', 'desc')
    .limit(TOP_N_RANK)
    .get();

  if (!rankSnap.empty) {
    const batch = db.batch();
    rankSnap.docs.forEach((doc, i) => batch.update(doc.ref, { rank: i+1 }));
    await batch.commit();
  }

  for (const tier of EP_BONUS_TIERS) {
    const winnerDoc = rankSnap.docs[tier.rank-1];
    if (!winnerDoc) continue;

    const entry = winnerDoc.data() as ContestLeaderboardEntry;
    const bonusEp = Math.round(contest.epReward * tier.multiplier);
    const xpTier = XP_BONUS_TIERS.find((t) => t.rank === tier.rank)!;
    const bonusXp = Math.round(contest.epReward * xpTier.multiplier);

    await awardContestBonus(
      db,
      entry.userId,
      bonusEp,
      bonusXp,
      contestId,
      tier.rank
    );
  }

  await finalizationRef.update({
    status: 'completed',
    completedAt: Timestamp.now(),
    rankedCount: rankSnap.size,
  });
  console.log(`[contestLifecycle] contest ${contestId}: finalized, ranked ${rankSnap.size} entries.`);

  return 'finalized';
}
