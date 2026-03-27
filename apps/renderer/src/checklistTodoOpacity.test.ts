import { describe, expect, it } from 'vitest';
import {
  CHECKLIST_TODO_OPACITY_RANGE,
  computeChecklistOpacitiesByRemainingTodoCount,
} from './checklistTodoOpacity';

describe('computeChecklistOpacitiesByRemainingTodoCount', () => {
  it('makes checklists with more remaining todos more visible', () => {
    const opacities = computeChecklistOpacitiesByRemainingTodoCount([
      { id: 'few', remainingTodoCount: 1 },
      { id: 'middle', remainingTodoCount: 3 },
      { id: 'most', remainingTodoCount: 5 },
    ]);

    expect(opacities.get('few')).toBe(CHECKLIST_TODO_OPACITY_RANGE.lowestWithTodos);
    expect(opacities.get('middle')).toBeCloseTo(0.89);
    expect(opacities.get('most')).toBe(CHECKLIST_TODO_OPACITY_RANGE.highest);
  });

  it('distributes opacity evenly across ranked checklist todo counts', () => {
    const opacities = computeChecklistOpacitiesByRemainingTodoCount([
      { id: 'c1', remainingTodoCount: 1 },
      { id: 'c2', remainingTodoCount: 2 },
      { id: 'c3', remainingTodoCount: 3 },
      { id: 'c4', remainingTodoCount: 4 },
    ]);

    expect(opacities.get('c1')).toBeCloseTo(CHECKLIST_TODO_OPACITY_RANGE.lowestWithTodos);
    expect(opacities.get('c2')).toBeCloseTo(0.8533333333);
    expect(opacities.get('c3')).toBeCloseTo(0.9266666667);
    expect(opacities.get('c4')).toBeCloseTo(CHECKLIST_TODO_OPACITY_RANGE.highest);
  });

  it('uses the fallback opacity for checklists with no remaining todos', () => {
    const opacities = computeChecklistOpacitiesByRemainingTodoCount([
      { id: 'has-work', remainingTodoCount: 2 },
      { id: 'empty', remainingTodoCount: 0 },
      { id: 'invalid', remainingTodoCount: Number.NaN },
    ]);

    expect(opacities.get('has-work')).toBe(CHECKLIST_TODO_OPACITY_RANGE.highest);
    expect(opacities.get('empty')).toBe(CHECKLIST_TODO_OPACITY_RANGE.zeroTodos);
    expect(opacities.get('invalid')).toBe(CHECKLIST_TODO_OPACITY_RANGE.zeroTodos);
  });
});
