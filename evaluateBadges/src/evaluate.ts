import type { BadgeDoc } from './types.js';


function getFieldValue(data: FirebaseFirestore.DocumentData, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[key];
    return undefined;
  }, data);
}


export function meetsRequirement(userData: FirebaseFirestore.DocumentData, badge: BadgeDoc): boolean {
  const rawValue = getFieldValue(userData, badge.requirementField);

  switch (badge.requirementType) {
    case 'threshold':
      return ((typeof rawValue === 'number' ? rawValue : 0) >= badge.requirementValue);
    case 'arrayLength':
      return ((Array.isArray(rawValue) ? rawValue.length : 0) >= badge.requirementValue);
    case 'boolean':
      return rawValue === true && badge.requirementValue >= 1;
    default:
      return false;
  }
}

export function computeProgress(userData: FirebaseFirestore.DocumentData, badge: BadgeDoc): number {
  const rawValue = getFieldValue(userData, badge.requirementField);

  if (badge.requirementType === 'arrayLength')
    return Array.isArray(rawValue) ? rawValue.length : 0;
  if (badge.requirementType === 'boolean')
    return rawValue === true ? 1 : 0;

  return typeof rawValue === 'number' ? rawValue : 0;
}
