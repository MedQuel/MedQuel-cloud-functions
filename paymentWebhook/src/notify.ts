import { PubSub } from '@google-cloud/pubsub';


export interface NotificationEvent {
  userId: string;
  type: 'premium';
  kind: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  dedupeKey?: string;
  inApp?: boolean;
  push?: boolean;
}

let _pubsub: PubSub | null = null;
function getPubSub(): PubSub {
  if (!_pubsub) _pubsub = new PubSub();
  return _pubsub;
}

export async function publishNotification(event: NotificationEvent): Promise<void> {
  const topicName = process.env.PUBSUB_TOPIC_NOTIFICATIONS;
  if (!topicName) {
    console.warn('[notify] PUBSUB_TOPIC_NOTIFICATIONS not set, skipping notification.');
    return;
  }

  try {
    await getPubSub()
      .topic(topicName)
      .publishMessage({
        data: Buffer.from(JSON.stringify(event)),
        attributes: { eventType: 'notification_requested' },
      });
  } catch (err) {
    console.error('[notify] Failed to publish notification:', err);
  }
}
