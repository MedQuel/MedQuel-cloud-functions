import { getFirestore } from 'firebase-admin/firestore';
import functions from '@google-cloud/functions-framework';
import { initializeApp, getApps } from 'firebase-admin/app';
import type { CloudEvent } from '@google-cloud/functions-framework';

import { resetExpiredStreaks } from './resetStreaks.js';
import { cleanupOldContests } from './cleanupContests.js';


if (getApps().length === 0) initializeApp();
const db = getFirestore();

functions.cloudEvent('checkStreaks', async (_event: CloudEvent<unknown>) => {
  const now = new Date();

  try {
    const { scanned, reset } = await resetExpiredStreaks(db, now);
    console.log(`[checkStreaks] scanned ${scanned}, reset ${reset}.`);
  } catch (err) {
    console.error('[checkStreaks] streak reset failed:', err);
  }

  try {
    const deleted = await cleanupOldContests(db, now);
    console.log(`[checkStreaks] cleaned up ${deleted} old contest(s).`);
  } catch (err) {
    console.error('[checkStreaks] contest cleanup failed:', err);
  }
});
