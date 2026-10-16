export function computeLevelFromXp(totalXp: number): number {
  const xpRequiredForLevel = (level: number) => 50 * (level-1) * level;

  let level = 1;
  while (totalXp >= xpRequiredForLevel(level+1)) level += 1;

  return level;
}
