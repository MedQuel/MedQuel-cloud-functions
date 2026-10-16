import { Storage } from '@google-cloud/storage';
import { config } from './config.js';


const storage = new Storage({ projectId: config.projectId });

export async function imageExists(relativePath: string): Promise<boolean> {
  try {
    const [exists] = await storage.bucket(config.imageBucketName).file(relativePath).exists();
    return exists;
  } catch (err) {
    console.error(`Image existence check failed for "${relativePath}": ${(err as Error).message}`);
    return false;
  }
}

const CONCURRENCY = 10;

export async function checkImagesInBatches<
  T extends { imageUrl: string | null; questionType: string }
>(entries: T[]): Promise<Array<{ entry: T; ok: boolean }>> {
  const results: Array<{ entry: T; ok: boolean }> = [];

  for (let i=0; i<entries.length; i+=CONCURRENCY) {
    const batch = entries.slice(i, i+CONCURRENCY);
    const checked = await Promise.all(
      batch.map(async (entry) => {
        if (entry.questionType !== 'image_based' || !entry.imageUrl) return { entry, ok: true };
        const ok = await imageExists(entry.imageUrl);
        return { entry, ok };
      })
    );
    results.push(...checked);
  }

  return results;
}
