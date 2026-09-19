export interface Cue {
  id: string;
  start: number; // 毫秒
  end: number; // 毫秒
  text: string;
}

export interface ConstraintConfig {
  minDurationMs: number;
  minGapMs: number;
}

export type DragMode = 'left' | 'right' | 'move';

export interface DragState {
  id: string;
  mode: DragMode;
  startX: number;
  origStart: number;
  origEnd: number;
  /** 实时钳制后的边界 */
  previewStart: number;
  previewEnd: number;
  /** 最近一次违反约束的原因（无则 null） */
  reason: string | null;
}

export interface Bounds {
  left: number;
  right: number;
}

export const clamp = (v: number, min: number, max: number): number =>
  Math.min(Math.max(v, min), max);

export const round5 = (v: number): number => Math.round(v / 5) * 5;
