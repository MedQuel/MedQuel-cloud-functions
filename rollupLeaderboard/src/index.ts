import { getFirestore } from 'firebase-admin/firestore';
import functions from '@google-cloud/functions-framework';
import { initializeApp, getApps } from 'firebase-admin/app';
import type { CloudEvent } from '@google-cloud/functions-framework';

import { rollupPeriod } from './rollup.js';
import { getActivePeriodKeys } from './periodKeys.js';


if (getApps().length === 0) initializeApp();
const db = getFirestore();

functions.cloudEvent(
  'rollupLeaderboard',
  async (_event: CloudEvent<unknown>) => {
    const now = new Date();
    const periodKeys = getActivePeriodKeys(now);
    const results = await Promise.allSettled(periodKeys.map((key) => rollupPeriod(db, key, now)));

    results.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        console.log(`[rollupLeaderboard] ${periodKeys[i]}: considered ${r.value.entriesConsidered}, updated ${r.value.entriesUpdated}.`);
      } else {
        console.error(`[rollupLeaderboard] ${periodKeys[i]} failed:`, r.reason);
      }
    });

    if (results.some((r) => r.status === 'rejected')) {
      throw new Error('rollupLeaderboard: one or more periods failed — see logs above.');
    }
  }
);
