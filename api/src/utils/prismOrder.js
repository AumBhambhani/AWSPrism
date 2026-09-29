export const PRISM_ORDER = { 'P': 1, 'R': 2, 'I': 3, 'S': 4, 'M': 5 };

export function deriveSortOrder(moduleId) {
  const prefix = (moduleId || '').trim().charAt(0).toUpperCase();
  return PRISM_ORDER[prefix] ?? 99;
}
