import { getFirestore } from 'firebase-admin/firestore';
import functions from '@google-cloud/functions-framework';
import { initializeApp, getApps } from 'firebase-admin/app';
import type { CloudEvent } from '@google-cloud/functions-framework';

import type { NotificationEvent } from './types.js';
import { processNotification } from './processNotification.js';


interface PubSubMessage {
  data?: string;
  messageId?: string;
}
interface PubSubCloudEventData {
  message: PubSubMessage;
}

if (getApps().length === 0) initializeApp();
const db = getFirestore();

function parseEvent(data: PubSubCloudEventData): NotificationEvent {
  if (!data?.message?.data) throw new Error('Pub/Sub message has no data payload.');

  return JSON.parse(
    Buffer.from(data.message.data, 'base64').toString('utf-8')
  ) as NotificationEvent;
}

function isValid(e: NotificationEvent): boolean {
  return Boolean(
    e?.userId && e.type && e.kind &&
    typeof e.title === 'string' && typeof e.body === 'string'
  );
}


functions.cloudEvent('sendNotification', async (cloudEvent: CloudEvent<PubSubCloudEventData>) => {
  const messageId = cloudEvent.data?.message?.messageId ?? 'unknown';

  let event: NotificationEvent;
  try {
    event = parseEvent(cloudEvent.data as PubSubCloudEventData);
  } catch (err) {
    console.error(`[sendNotification] messageId=${messageId}: failed to parse, dropping.`, err);
    return;
  }

  if (!isValid(event)) {
    console.error(`[sendNotification] messageId=${messageId}: invalid event, dropping.`, event);
    return;
  }

  event.title = event.title.slice(0, 100);
  event.body = event.body.slice(0, 300);

  try {
    const result = await processNotification(db, event);
    console.log(`[sendNotification] user=${event.userId} kind=${event.kind}: ${result}.`);
  } catch (err) {
    console.error(`[sendNotification] messageId=${messageId}: failed, will retry.`, err);
    throw err;
  }
});
