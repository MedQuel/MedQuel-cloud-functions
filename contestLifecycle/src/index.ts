import { getFirestore } from 'firebase-admin/firestore';
import functions from '@google-cloud/functions-framework';
import { initializeApp, getApps } from 'firebase-admin/app';
import type { CloudEvent } from '@google-cloud/functions-framework';

import { finalizeContest } from './finalize.js';
import { findContestsPastEnd, activateScheduledContests } from './activation.js';


if (getApps().length === 0) initializeApp();
const db = getFirestore();

functions.cloudEvent(
  'contestLifecycle',
  async (_event: CloudEvent<unknown>) => {
    const now = new Date();

    const activatedCount = await activateScheduledContests(db, now);
    console.log(`[contestLifecycle] activated ${activatedCount} contest(s).`);

    const endedContestIds = await findContestsPastEnd(db, now);
    if (endedContestIds.length === 0) {
      console.log('[contestLifecycle] no contests past endsAt this tick.');
      return;
    }

    const results = await Promise.allSettled(
      endedContestIds.map((id) => finalizeContest(id, db))
    );

    let finalized = 0, skipped = 0, failed = 0;
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        r.value === 'finalized' ? finalized++ : skipped++;
      } else {
        failed++;
        console.error(`[contestLifecycle] finalize failed for ${endedContestIds[i]}:`, r.reason);
      }
    });

    console.log(`[contestLifecycle] finalize pass: ${finalized} finalized, ${skipped} skipped, ${failed} failed.`);
  }
);
