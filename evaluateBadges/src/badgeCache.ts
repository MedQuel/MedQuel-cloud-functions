import type { Firestore } from 'firebase-admin/firestore';
import type { BadgeDoc } from './types.js';


const CACHE_TTL_MS = 10 * 60 * 1000;
let cached: { badges: BadgeDoc[]; expiresAt: number } | null = null;

export async function getActiveBadges(db: Firestore): Promise<BadgeDoc[]> {
  if (cached && cached.expiresAt > Date.now()) return cached.badges;

  const snap = await db.collection('badges').where('isActive', '==', true).get();
  const badges = snap.docs.map((d) => d.data() as BadgeDoc);

  cached = { badges, expiresAt: Date.now()+CACHE_TTL_MS };
  return badges;
}
