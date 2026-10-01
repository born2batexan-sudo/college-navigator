import { parseDateStatus } from "./date-status";

/** The saved family checkbox marker alone drives progress and next-action removal. */
export function partitionTasks<T extends { completed: boolean; state: string; rule: { requirement: string } }>(actions: T[]) {
  const applicable = actions.filter((action) => action.state !== "not_applicable" && parseDateStatus(action.rule).kind !== "not_applicable");
  const completed = applicable.filter((action) => action.completed);
  // Even a waived or missed workflow status is not a family completion marker.
  // Keep applicable, uncompleted tasks visible; only the family's checkbox moves one out of the queue.
  const open = applicable.filter((action) => !action.completed);
  return { open, completed, completedCount: completed.length };
}
