function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export const config = {
  projectId: requireEnv('PROJECT_ID'),
  datasetId: requireEnv('DATASET_ID'),
  questionsTable: requireEnv('QUESTIONS_TABLE'),
  bucketName: requireEnv('BUCKET_NAME'),
  uploadPrefix: process.env.UPLOAD_PREFIX ?? 'incoming/',
  imageBucketName: requireEnv('FIREBASE_STORAGE_BUCKET'),
};
