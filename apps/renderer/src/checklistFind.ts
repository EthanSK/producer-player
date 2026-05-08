export type ChecklistFindDirection = 'next' | 'previous';

export type ChecklistFindItem = {
  id: string;
  text: string;
};

export type ChecklistFindMatch = {
  id: string;
  itemIndex: number;
};

export function normalizeChecklistFindQuery(query: string): string {
  return query.trim().toLocaleLowerCase();
}

export function buildChecklistFindMatches(
  items: readonly ChecklistFindItem[],
  query: string,
): ChecklistFindMatch[] {
  const normalizedQuery = normalizeChecklistFindQuery(query);
  if (normalizedQuery.length === 0) {
    return [];
  }

  return items.flatMap((item, itemIndex) => {
    const normalizedText = item.text.toLocaleLowerCase();
    return normalizedText.includes(normalizedQuery)
      ? [{ id: item.id, itemIndex }]
      : [];
  });
}

export function coerceChecklistFindActiveIndex(
  activeIndex: number,
  matchCount: number,
): number {
  if (matchCount <= 0) {
    return -1;
  }

  if (!Number.isInteger(activeIndex) || activeIndex < 0) {
    return 0;
  }

  return Math.min(activeIndex, matchCount - 1);
}

export function getNextChecklistFindIndex(
  activeIndex: number,
  matchCount: number,
  direction: ChecklistFindDirection,
): number {
  if (matchCount <= 0) {
    return -1;
  }

  if (!Number.isInteger(activeIndex) || activeIndex < 0) {
    return direction === 'previous' ? matchCount - 1 : 0;
  }

  const coercedIndex = Math.min(activeIndex, matchCount - 1);
  if (direction === 'previous') {
    return coercedIndex <= 0 ? matchCount - 1 : coercedIndex - 1;
  }

  return coercedIndex >= matchCount - 1 ? 0 : coercedIndex + 1;
}

export function formatChecklistFindStatus(
  query: string,
  activeIndex: number,
  matchCount: number,
): string {
  const trimmedQuery = query.trim();
  if (trimmedQuery.length === 0) {
    return 'Type to find checklist items';
  }

  if (matchCount <= 0) {
    return `No results for “${trimmedQuery}”`;
  }

  const coercedIndex = coerceChecklistFindActiveIndex(activeIndex, matchCount);
  return `${coercedIndex + 1} / ${matchCount}`;
}
