import { Timestamp } from 'firebase-admin/firestore';


export function getPremiumExpiryMs(userData: FirebaseFirestore.DocumentData | undefined): number | null {
  const expiresAt = userData?.premiumExpiresAt;
  return expiresAt instanceof Timestamp ? expiresAt.toMillis() : null;
}
