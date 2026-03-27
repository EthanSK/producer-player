const HIGHEST_REMAINING_TODO_OPACITY = 1;
const LOWEST_REMAINING_TODO_OPACITY = 0.78;
const NO_REMAINING_TODOS_OPACITY = 0.68;

export interface ChecklistTodoOpacityInput {
  id: string;
  remainingTodoCount: number;
}

export function computeChecklistOpacitiesByRemainingTodoCount(
  checklists: ChecklistTodoOpacityInput[]
): Map<string, number> {
  const result = new Map<string, number>();

  if (checklists.length === 0) {
    return result;
  }

  const checklistsWithCounts = checklists.map((checklist, sourceIndex) => ({
    id: checklist.id,
    sourceIndex,
    remainingTodoCount:
      Number.isFinite(checklist.remainingTodoCount) && checklist.remainingTodoCount > 0
        ? Math.floor(checklist.remainingTodoCount)
        : 0,
  }));

  const checklistsWithTodos = checklistsWithCounts
    .filter(
      (checklist): checklist is { id: string; sourceIndex: number; remainingTodoCount: number } =>
        checklist.remainingTodoCount > 0
    )
    .sort((left, right) => {
      if (left.remainingTodoCount !== right.remainingTodoCount) {
        return left.remainingTodoCount - right.remainingTodoCount;
      }

      return left.sourceIndex - right.sourceIndex;
    });

  if (checklistsWithTodos.length === 1) {
    result.set(checklistsWithTodos[0].id, HIGHEST_REMAINING_TODO_OPACITY);
  } else if (checklistsWithTodos.length > 1) {
    const opacityRange = HIGHEST_REMAINING_TODO_OPACITY - LOWEST_REMAINING_TODO_OPACITY;
    const denominator = checklistsWithTodos.length - 1;

    checklistsWithTodos.forEach((checklist, rank) => {
      const opacity = LOWEST_REMAINING_TODO_OPACITY + (rank / denominator) * opacityRange;
      result.set(checklist.id, opacity);
    });
  }

  checklistsWithCounts.forEach((checklist) => {
    if (!result.has(checklist.id)) {
      result.set(checklist.id, NO_REMAINING_TODOS_OPACITY);
    }
  });

  return result;
}

export const CHECKLIST_TODO_OPACITY_RANGE = {
  highest: HIGHEST_REMAINING_TODO_OPACITY,
  lowestWithTodos: LOWEST_REMAINING_TODO_OPACITY,
  zeroTodos: NO_REMAINING_TODOS_OPACITY,
} as const;
