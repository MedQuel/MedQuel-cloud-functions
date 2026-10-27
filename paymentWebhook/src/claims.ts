import type { Auth } from 'firebase-admin/auth';


export async function setPremiumClaim(
  auth: Auth,
  uid: string,
  isPremium: boolean,
  premiumUntilMs: number | null
): Promise<void> {
  try {
    const record = await auth.getUser(uid);

    await auth.setCustomUserClaims(uid, {
      ...(record.customClaims ?? {}),
      isPremium,
      premiumUntil: premiumUntilMs,
    });
  } catch (err) {
    console.error('[payments] Failed to sync premium custom claim:', err);
  }
}
