import functions from '@google-cloud/functions-framework';
import { initializeApp, getApps } from 'firebase-admin/app';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';
import type { CloudEvent } from '@google-cloud/functions-framework';

import { generateFallbackWeekSessions } from './studyPlanFallback.js';
import { generateJsonContent, GeminiRequestError } from './geminiClient.js';
import { validateGeminiStudyPlanOutput } from './studyPlanOutputValidation.js';
import { computeSubjectPriority, computeWeakSubjectsContext } from './planUtils.js';
import { addDaysToDateKey, materializeSessions, computeWeeklyXpTarget } from './planUtils.js';
import { buildStudyPlanSystemInstruction, buildStudyPlanUserContent } from './studyPlanPrompt.js';


if (getApps().length === 0) initializeApp();
const db = getFirestore();
const MAX_GEMINI_ATTEMPTS = 2;

type Outcome = 'regenerated' | 'skipped_inactive' | 'skipped_exam_passed' | 'skipped_no_user';

function jobId(): string {
  return Math.random().toString(36).slice(2, 10);
}

async function regenerateOneUserPlan(planDoc: FirebaseFirestore.QueryDocumentSnapshot, now: Date): Promise<Outcome> {
  const uid = planDoc.id;
  const planData = planDoc.data();

  if (planData.active === false) return 'skipped_inactive';

  const examDate: Timestamp | null = planData.examDate ?? null;
  if (examDate && examDate.toMillis() < now.getTime()) {
    await planDoc.ref.update({ active: false, updatedAt: Timestamp.now() });
    return 'skipped_exam_passed';
  }

  const userSnap = await db.collection('users').doc(uid).get();
  if (!userSnap.exists) return 'skipped_no_user';
  const userData = userSnap.data()!;

  const subjectPriority = computeSubjectPriority(userData, planData.subjectPriority ?? []);
  const weakSubjects = computeWeakSubjectsContext(userData);
  const nextWeekStartDateKey = addDaysToDateKey(planData.currentWeekStartDate, 7);
  const nextWeekNumber = (planData.currentWeekNumber ?? 1) + 1;
  const sessionsPerDay = planData.daysPerWeek.length > 0
    ? Math.max(
      1,
      Math.round((planData.sessions?.length ?? planData.daysPerWeek.length) / planData.daysPerWeek.length)
    )
    : 1;

  const systemInstruction = buildStudyPlanSystemInstruction();
  const userContent = buildStudyPlanUserContent({
    targetExam: userData.targetExam,
    describesYou: userData.describesYou ?? userData.studyLevel,
    weekNumber: nextWeekNumber,
    daysPerWeek: planData.daysPerWeek,
    sessionsPerDay,
    weakSubjects,
    masteredSubjects: userData.stats?.masteredSubjects ?? [],
    subjectPriority,
  });

  let validatedSessions = null;
  let generatedBy: 'ai' | 'fallback' = 'fallback';

  for (let attempt=1; attempt<=MAX_GEMINI_ATTEMPTS; attempt++) {
    try {
      const raw = await generateJsonContent({
        systemInstruction,
        userContent,
        apiKeyIndex: attempt - 1,
      });

      const candidate = validateGeminiStudyPlanOutput(
        raw,
        planData.daysPerWeek,
        sessionsPerDay
      );
      if (candidate) {
        validatedSessions = candidate;
        generatedBy = 'ai';
        break;
      }
    } catch (err) {
      const message = err instanceof GeminiRequestError ? err.message : (err as Error).message;
      console.warn(`[weeklyStudyPlanRegeneration] Gemini request failed on attempt ${attempt}/${MAX_GEMINI_ATTEMPTS}: ${message}`);
    }
  }

  if (!validatedSessions) {
    const fallbackSubjects = subjectPriority.length > 0
      ? subjectPriority
      : weakSubjects.map((w) => w.subject);
    validatedSessions = generateFallbackWeekSessions(
      planData.daysPerWeek,
      sessionsPerDay,
      fallbackSubjects
    );
  }

  const sessions = materializeSessions(validatedSessions, nextWeekStartDateKey);
  const weeklyXpTarget = computeWeeklyXpTarget(sessions);
  const nowTs = Timestamp.now();

  await planDoc.ref.update({
    sessions,
    weeklyXpTarget,
    currentWeekNumber: nextWeekNumber,
    currentWeekStartDate: nextWeekStartDateKey,
    subjectPriority,
    generatedBy,
    lifetimeSessionsPlanned: (planData.lifetimeSessionsPlanned ?? 0) + sessions.length,
    updatedAt: nowTs,
    lastRegeneratedAt: nowTs,
  });

  return 'regenerated';
}


functions.cloudEvent(
  'weeklyStudyPlanRegeneration',
  async (_event: CloudEvent<unknown>) => {
    const id = jobId();
    const now = new Date();
    console.log(`[${id}] weeklyStudyPlanRegeneration tick started.`);

    const snap = await db.collection('studyPlans').get();
    if (snap.empty) {
      console.log(`[${id}] No study plans found.`);
      return;
    }

    const results = await Promise.allSettled(
      snap.docs.map((doc) => regenerateOneUserPlan(doc, now))
    );

    const tally: Record<string, number> = {};
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        tally[r.value] = (tally[r.value] ?? 0) + 1;
      } else {
        console.error(`[${id}] uid=${snap.docs[i].id} failed:`, r.reason);
        tally.failed = (tally.failed ?? 0) + 1;
      }
    });

    console.log(`[${id}] weeklyStudyPlanRegeneration done:`, tally);
  }
);
