import { createHash } from 'node:crypto';

export function computeContentHash(questionText: string): string {
  return createHash('sha256').update(questionText.trim()).digest('hex');
}
