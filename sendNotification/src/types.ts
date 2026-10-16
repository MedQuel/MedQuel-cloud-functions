export type NotificationType =
  | 'streak'
  | 'contest'
  | 'level'
  | 'leaderboard'
  | 'achievements'
  | 'chat'
  | 'dailyChallenge'
  | 'premium'
  | 'studyPlan'
  | 'friends'
  | 'challenge'
  | 'announcement';

export interface NotificationEvent {
  userId: string;
  type: NotificationType;
  kind: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  dedupeKey?: string;
  inApp?: boolean;
  push?: boolean;
}
