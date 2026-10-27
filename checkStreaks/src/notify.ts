import { PubSub } from '@google-cloud/pubsub';


export interface NotificationEvent {
  userId: string;
  type: 'streak' | 'premium';
  kind: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  dedupeKey?: string;
  inApp?: boolean;
  push?: boolean;
}

let pubsub: PubSub | null = null;
function getPubSub(): PubSub {
  if (!pubsub) pubsub = new PubSub();
  return pubsub;
}

export async function publishNotification(event: NotificationEvent): Promise<void> {
  const topicName = process.env.PUBSUB_TOPIC_NOTIFICATIONS;
  if (!topicName) {
    console.warn('[checkStreaks] PUBSUB_TOPIC_NOTIFICATIONS not set, skipping notification.');
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
    console.error('[checkStreaks] Failed to publish notification:', err);
  }
}
