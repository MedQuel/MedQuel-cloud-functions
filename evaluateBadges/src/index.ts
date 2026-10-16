import { getFirestore } from 'firebase-admin/firestore';
import functions from '@google-cloud/functions-framework';
import { initializeApp, getApps } from 'firebase-admin/app';
import type { CloudEvent } from '@google-cloud/functions-framework';

import type { QuizCompletedEvent } from './types.js';
import { evaluateAndAwardBadges } from './awardBadges.js';


interface PubSubMessage {
  data?: string;
  messageId?: string;
}
interface PubSubCloudEventData {
  message: PubSubMessage;
}

if (getApps().length === 0) initializeApp();
const db = getFirestore();

function parseEvent(data: PubSubCloudEventData): QuizCompletedEvent {
  if (!data?.message?.data) throw new Error('Pub/Sub message has no data payload.');
  const decoded = Buffer.from(data.message.data, 'base64').toString('utf-8');

  return JSON.parse(decoded) as QuizCompletedEvent;
}


functions.cloudEvent(
  'evaluateBadges',
  async (cloudEvent: CloudEvent<PubSubCloudEventData>) => {
    const messageId = cloudEvent.data?.message?.messageId ?? 'unknown';

    let event: QuizCompletedEvent;
    try {
      event = parseEvent(cloudEvent.data as PubSubCloudEventData);
    } catch (err) {
      console.error(`[evaluateBadges] messageId=${messageId}: failed to parse, dropping.`, err);
      return;
    }

    if (!event.sessionId || !event.userId) {
      console.error(`[evaluateBadges] messageId=${messageId}: missing sessionId/userId, dropping.`, event);
      return;
    }

    try {
      const result = await evaluateAndAwardBadges(db, event);
      console.log(`[evaluateBadges] session=${event.sessionId} user=${event.userId}: ${result}.`);
    } catch (err) {
      console.error(`[evaluateBadges] messageId=${messageId} session=${event.sessionId}: failed, will retry.`, err);
      throw err;
    }
  }
);
