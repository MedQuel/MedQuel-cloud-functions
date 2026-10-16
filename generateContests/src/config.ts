function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export const config = {
  projectId: requireEnv('PROJECT_ID'),
  datasetId: requireEnv('DATASET_ID'),
};
