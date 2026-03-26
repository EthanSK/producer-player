type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function getStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage !== undefined) {
    return storage;
  }

  if (typeof window === 'undefined') {
    return null;
  }

  return window.localStorage;
}

export function sanitizePanelOrder<T extends string>(
  candidate: readonly unknown[],
  defaults: readonly T[]
): T[] {
  const allowed = new Set(defaults);
  const seen = new Set<T>();
  const sanitized: T[] = [];

  for (const item of candidate) {
    if (typeof item !== 'string') {
      continue;
    }

    const panelId = item as T;
    if (!allowed.has(panelId) || seen.has(panelId)) {
      continue;
    }

    seen.add(panelId);
    sanitized.push(panelId);
  }

  for (const panelId of defaults) {
    if (!seen.has(panelId)) {
      sanitized.push(panelId);
    }
  }

  return sanitized;
}

export function readPanelOrderFromStorage<T extends string>(
  storageKey: string,
  defaults: readonly T[],
  storage?: StorageLike | null
): T[] {
  const resolvedStorage = getStorage(storage);
  if (!resolvedStorage) {
    return [...defaults];
  }

  try {
    const raw = resolvedStorage.getItem(storageKey);
    if (!raw) {
      return [...defaults];
    }

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [...defaults];
    }

    return sanitizePanelOrder(parsed, defaults);
  } catch {
    return [...defaults];
  }
}

export function persistPanelOrder(
  storageKey: string,
  panelOrder: readonly string[],
  storage?: StorageLike | null
): void {
  const resolvedStorage = getStorage(storage);
  if (!resolvedStorage) {
    return;
  }

  resolvedStorage.setItem(storageKey, JSON.stringify(panelOrder));
}

export function movePanelBefore<T extends string>(
  panelOrder: readonly T[],
  draggedPanelId: T,
  dropTargetPanelId: T
): T[] {
  if (draggedPanelId === dropTargetPanelId) {
    return [...panelOrder];
  }

  const sourceIndex = panelOrder.indexOf(draggedPanelId);
  const targetIndex = panelOrder.indexOf(dropTargetPanelId);
  if (sourceIndex === -1 || targetIndex === -1) {
    return [...panelOrder];
  }

  const withoutSource = panelOrder.filter((panelId) => panelId !== draggedPanelId);
  const insertionIndex = withoutSource.indexOf(dropTargetPanelId);
  if (insertionIndex === -1) {
    return [...panelOrder];
  }

  const nextOrder = [...withoutSource];
  nextOrder.splice(insertionIndex, 0, draggedPanelId);
  return nextOrder;
}
