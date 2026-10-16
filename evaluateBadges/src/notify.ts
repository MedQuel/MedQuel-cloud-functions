import { PubSub } from '@google-cloud/pubsub';


const TOPIC = process.env.PUBSUB_TOPIC_NOTIFICATIONS;
let _pubsub: PubSub | null = null;

export async function publishNotification(event: Record<string, unknown>): Promise<void> {
  try {
    if (!TOPIC) {
      console.error('[evaluateBadges] notification topic is not configured');
      return;
    }

    _pubsub ??= new PubSub();
    await _pubsub.topic(TOPIC).publishMessage({
      data: Buffer.from(JSON.stringify(event)),
      attributes: { eventType: 'notification_requested' },
    });
  } catch (err) {
    console.error('[evaluateBadges] failed to publish notification:', err);
  }
}
