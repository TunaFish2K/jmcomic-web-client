export type ChapterDirection = 'prev' | 'next';

export const SCROLL_EDGE_TOLERANCE_PX = 2;
export const BOUNDARY_SWITCH_THRESHOLD = 60;
export const MOUSE_WHEEL_BOUNDARY_CONTRIBUTION = BOUNDARY_SWITCH_THRESHOLD;

export function getBoundaryDirection({
  position,
  maxPosition,
  step,
  tolerance = SCROLL_EDGE_TOLERANCE_PX,
}: {
  position: number;
  maxPosition: number;
  step: number;
  tolerance?: number;
}): ChapterDirection | null {
  if (step < 0 && position <= tolerance) return 'prev';
  if (step > 0 && position >= Math.max(0, maxPosition - tolerance)) return 'next';
  return null;
}

export function isScrollTargetReached({
  position,
  targetPosition,
  tolerance = SCROLL_EDGE_TOLERANCE_PX,
}: {
  position: number;
  targetPosition: number;
  tolerance?: number;
}) {
  return Math.abs(position - targetPosition) <= tolerance;
}

export function accumulateBoundaryGesture({
  currentDirection,
  currentAmount,
  direction,
  contribution,
  threshold = BOUNDARY_SWITCH_THRESHOLD,
}: {
  currentDirection: ChapterDirection | null;
  currentAmount: number;
  direction: ChapterDirection;
  contribution: number;
  threshold?: number;
}) {
  const amount = (currentDirection === direction ? currentAmount : 0) + Math.abs(contribution);
  return {
    direction,
    amount,
    progress: Math.min(1, amount / threshold),
    shouldSwitch: amount >= threshold,
  };
}

export function getChapterLandingPage(direction: ChapterDirection): 0 | 'last' {
  return direction === 'next' ? 0 : 'last';
}

export function getDominantWheelDelta(deltaX: number, deltaY: number) {
  return Math.abs(deltaX) > Math.abs(deltaY) ? deltaX : deltaY;
}

export function isLikelyTrackpadWheel(deltaMode: number, deltaX: number, deltaY: number) {
  return deltaMode === 0 && (Math.abs(deltaX) > 0 || Math.abs(deltaY) < 40);
}

export function isMatchingChapterTransition({
  activeTransitionId,
  currentChapterId,
  transitionId,
  chapterId,
}: {
  activeTransitionId: number | null;
  currentChapterId: string;
  transitionId: number | null;
  chapterId: string;
}) {
  if (currentChapterId !== chapterId) return false;
  return transitionId === null
    ? activeTransitionId === null
    : activeTransitionId === transitionId;
}

export function isCurrentChapterLoad({
  generation,
  currentGeneration,
  chapterId,
  currentChapterId,
}: {
  generation: number;
  currentGeneration: number;
  chapterId: string;
  currentChapterId: string;
}) {
  return generation === currentGeneration && chapterId === currentChapterId;
}
