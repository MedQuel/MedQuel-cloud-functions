import { getFirestore } from 'firebase-admin/firestore';
import functions from '@google-cloud/functions-framework';
import { initializeApp, getApps } from 'firebase-admin/app';
import type { CloudEvent } from '@google-cloud/functions-framework';

import { generateRotationContest, generateGrandChampionshipContest } from './generateFromTemplate.js';
import { claimEligibleRotationTemplates, claimGrandChampionshipTemplate } from './templateSelection.js';


if (getApps().length === 0) initializeApp();
const db = getFirestore();

function jobId(): string {
  return Math.random().toString(36).slice(2, 10);
}


functions.cloudEvent(
  'generateContests',
  async (_event: CloudEvent<unknown>) => {
    const id = jobId();
    console.log(`[${id}] generateContests tick started.`);

    const templates = await claimEligibleRotationTemplates(db);
    if (templates.length === 0) {
      console.log(`[${id}] No rotation templates due this tick.`);
      return;
    }

    const results = await Promise.allSettled(templates.map((t) => generateRotationContest(t, db)));

    let created = 0, skipped = 0, failed = 0;
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        r.value.status === 'created' ? created++ : skipped++;
      } else {
        failed++;
        console.error(`[${id}] Template "${templates[i].templateId}" failed:`, r.reason);
      }
    });

    console.log(`[${id}] generateContests done: ${created} created, ${skipped} skipped, ${failed} failed, of ${templates.length} due templates.`);
  }
);

functions.cloudEvent(
  'generateWeeklyChampionship',
  async (_event: CloudEvent<unknown>) => {
    const id = jobId();
    console.log(`[${id}] generateWeeklyChampionship tick started.`);

    const template = await claimGrandChampionshipTemplate(db);
    if (!template) {
      console.log(`[${id}] No eligible grand_championship template this week.`);
      return;
    }

    try {
      const result = await generateGrandChampionshipContest(template, db);
      console.log(`[${id}] generateWeeklyChampionship done:`, result);
    } catch (err) {
      console.error(`[${id}] generateWeeklyChampionship failed:`, err);
    }
  }
);
