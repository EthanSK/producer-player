export type ChecklistFindDirection = 'next' | 'previous';

export type ChecklistFindKeyboardEventLike = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
};

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

function normalizeChecklistFindHaystack(text: string): string {
  return text.toLocaleLowerCase();
}

function normalizeChecklistFindNeedle(query: string): string {
  // Spaces in Ethan's fuzzy searches are usually just chunking ("vcl sib")
  // rather than a request to match literal whitespace. Strip them from the
  // fuzzy needle while keeping exact substring search whitespace-aware below.
  return query.replace(/\s+/g, '');
}

function isFuzzySubsequenceMatch(text: string, query: string): boolean {
  const fuzzyNeedle = normalizeChecklistFindNeedle(query);
  if (fuzzyNeedle.length === 0) {
    return false;
  }

  let needleIndex = 0;
  for (const character of text) {
    if (character === fuzzyNeedle[needleIndex]) {
      needleIndex += 1;
      if (needleIndex >= fuzzyNeedle.length) {
        return true;
      }
    }
  }

  return false;
}

export function isChecklistFindKeyboardShortcut(
  event: ChecklistFindKeyboardEventLike,
  platform: string,
): boolean {
  const normalizedPlatform = platform.toLocaleLowerCase();
  const isApplePlatform =
    normalizedPlatform.includes('mac') ||
    normalizedPlatform.includes('iphone') ||
    normalizedPlatform.includes('ipad') ||
    normalizedPlatform.includes('ipod');
  const primaryModifierPressed = isApplePlatform
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;

  return (
    event.key.toLocaleLowerCase() === 'f' &&
    primaryModifierPressed &&
    !event.shiftKey &&
    !event.altKey
  );
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
    const normalizedText = normalizeChecklistFindHaystack(item.text);
    return normalizedText.includes(normalizedQuery) ||
      isFuzzySubsequenceMatch(normalizedText, normalizedQuery)
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
