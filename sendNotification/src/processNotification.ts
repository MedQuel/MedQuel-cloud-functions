import { getMessaging } from 'firebase-admin/messaging';
import type { Firestore } from 'firebase-admin/firestore';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';

import type { NotificationEvent, NotificationType } from './types.js';


const PUSH_TTL_MS = 24 * 60*60*1000;
const INBOX_TTL_MS = 60*24 * 60*60*1000;
const FIRESTORE_ALREADY_EXISTS = 6;

const CATEGORY_PREF: Partial<Record<NotificationType, string>> = {
  contest: 'contestReminders',
  leaderboard: 'rankAlerts',
  achievements: 'achievementAlerts',
  level: 'achievementAlerts',
};

const ANDROID_CHANNEL: Record<NotificationType, string> = {
  friends: 'social',
  challenge: 'social',
  chat: 'social',
  contest: 'contests',
  dailyChallenge: 'contests',
  leaderboard: 'contests',
  streak: 'progress',
  level: 'progress',
  achievements: 'progress',
  studyPlan: 'progress',
  premium: 'account',
  announcement: 'account',
};
const HIGH_PRIORITY = new Set<NotificationType>([
  'chat',
  'friends',
  'challenge',
  'premium',
]);
const STALE_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

export type ProcessResult =
  | 'sent'
  | 'inbox_only'
  | 'skipped_pref'
  | 'skipped_duplicate'
  | 'skipped_no_user'
  | 'skipped_nothing_to_do';

function toStringMap(data: Record<string, string> | undefined): Record<string, string> {
  return Object.fromEntries(
    Object.entries(data ?? {}).map(([k, v]) => [k, String(v)])
  );
}


async function sendPush(db: Firestore, uid: string, tokens: string[], event: NotificationEvent, notificationId: string): Promise<void> {
  try {
    const res = await getMessaging().sendEachForMulticast({
      tokens,
      notification: { title: event.title, body: event.body },
      data: {
        ...toStringMap(event.data),
        type: event.type,
        kind: event.kind,
        notificationId,
      },
      android: {
        priority: HIGH_PRIORITY.has(event.type) ? 'high' : 'normal',
        ttl: PUSH_TTL_MS,
        notification: { channelId: ANDROID_CHANNEL[event.type], tag: notificationId },
      },
    });

    const stale = tokens.filter((_, i) => {
      const code = res.responses[i]?.error?.code;
      return code !== undefined && STALE_TOKEN_CODES.has(code);
    });

    if (stale.length > 0) {
      await db.collection('users').doc(uid).update({ notifTokens: FieldValue.arrayRemove(...stale) });
    }
  } catch (err) {
    console.error(`[sendNotification] push failed for ${uid}:`, err);
  }
}

export async function processNotification(db: Firestore, event: NotificationEvent): Promise<ProcessResult> {
  const userSnap = await db.collection('users').doc(event.userId).get();
  if (!userSnap.exists) return 'skipped_no_user';

  const user = userSnap.data()!;
  const prefs = user.notifPrefs ?? {};

  const prefKey = CATEGORY_PREF[event.type];
  if (prefKey && prefs[prefKey] === false) return 'skipped_pref';

  const inApp = event.inApp !== false;
  const wantPush = event.push !== false && prefs.pushEnabled !== false;
  if (!inApp && !wantPush) return 'skipped_nothing_to_do';

  const collection = db.collection('notifications');
  const safeKey = event.dedupeKey?.replace(/[\/\s]/g, '_').slice(0, 200);
  const ref = safeKey ? collection.doc(safeKey) : collection.doc();

  if (inApp) {
    try {
      await ref.create({
        userId: event.userId,
        type: event.type,
        kind: event.kind,
        title: event.title,
        body: event.body,
        data: toStringMap(event.data),
        isRead: false,
        createdAt: FieldValue.serverTimestamp(),
        expireAt: Timestamp.fromMillis(Date.now() + INBOX_TTL_MS),
      });
    } catch (err) {
      if ((err as { code?: number }).code === FIRESTORE_ALREADY_EXISTS) {
        return 'skipped_duplicate';
      }
      throw err;
    }
  }

  const tokens: string[] = Array.isArray(user.notifTokens) ? user.notifTokens : [];
  if (!wantPush || tokens.length === 0) {
    return inApp ? 'inbox_only' : 'skipped_nothing_to_do';
  }

  await sendPush(db, event.userId, tokens, event, ref.id);
  return 'sent';
}
