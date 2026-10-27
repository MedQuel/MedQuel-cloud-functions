import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import functions from '@google-cloud/functions-framework';
import { initializeApp, getApps } from 'firebase-admin/app';
import type { CloudEvent } from '@google-cloud/functions-framework';

import { toISTDateKey } from './dateUtils.js';
import { publishNotification } from './notify.js';
import { resetExpiredStreaks } from './resetStreaks.js';
import { sweepExpiredPremium } from './expirePremium.js';
import { cleanupOldContests } from './cleanupContests.js';


if (getApps().length === 0) initializeApp();
const db = getFirestore();
const auth = getAuth();

functions.cloudEvent('checkStreaks', async (_event: CloudEvent<unknown>) => {
  const now = new Date();
  let premiumSweepError: unknown;

  try {
    const { scanned, reset, resetUsers } = await resetExpiredStreaks(db, now);
    console.log(`[checkStreaks] scanned ${scanned}, reset ${reset}.`);

    await Promise.all(resetUsers.map((user) =>
      publishNotification({
        userId: user.userId,
        type: 'streak',
        kind: 'streak_reset',
        title: 'Your streak has ended',
        body: `Your ${user.previousStreak}-day streak has ended. Start a new one today!`,
        data: { previousStreak: String(user.previousStreak) },
        dedupeKey: `streakReset_${user.userId}_${toISTDateKey(now)}`,
      }))
    );
  } catch (err) {
    console.error('[checkStreaks] streak reset failed:', err);
  }

  try {
    const deleted = await cleanupOldContests(db, now);
    console.log(`[checkStreaks] cleaned up ${deleted} old contest(s).`);
  } catch (err) {
    console.error('[checkStreaks] contest cleanup failed:', err);
  }

  try {
    const expired = await sweepExpiredPremium(db, auth);
    console.log(`[checkStreaks] marked ${expired} user(s) as no longer premium.`);
  } catch (err) {
    premiumSweepError = err;
    console.error('[checkStreaks] premium expiration sweep failed:', err);
  }

  if (premiumSweepError) throw premiumSweepError;
});
