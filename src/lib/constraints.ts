import type { ConstraintConfig } from '../types';
import { round5 } from '../types';

export interface Bounds {
  /** 允许的最小起点：0 或 上一条结束 + 间隔 */
  minStart: number;
  /** 允许的最大终点：下一条起点 - 间隔；无限制时为 Infinity */
  maxEnd: number;
  /** 上一条（用于生成提示） */
  prevEnd: number | null;
  /** 下一条（用于生成提示） */
  nextStart: number | null;
}

export function neighborBounds(
  sorted: { id: string; start: number; end: number }[],
  id: string,
  cfg: ConstraintConfig,
  mediaDurationMs: number,
): Bounds {
  const idx = sorted.findIndex((c) => c.id === id);
  const prev = idx > 0 ? sorted[idx - 1] : null;
  const next = idx >= 0 && idx < sorted.length - 1 ? sorted[idx + 1] : null;
  return {
    minStart: prev ? prev.end + cfg.minGapMs : 0,
    maxEnd: next
      ? next.start - cfg.minGapMs
      : mediaDurationMs > 0
        ? mediaDurationMs
        : Infinity,
    prevEnd: prev ? prev.end : null,
    nextStart: next ? next.start : null,
  };
}

export interface ClampResult {
  value: number;
  reason: string | null;
}

/** 拖动左边界 */
export function clampLeft(
  desiredStart: number,
  end: number,
  b: Bounds,
  cfg: ConstraintConfig,
): ClampResult {
  const desired = round5(desiredStart);
  const upper = end - cfg.minDurationMs;

  if (desired < 0) {
    return { value: 0, reason: '起点不能早于 00:00:00,000，已回弹' };
  }
  if (b.prevEnd !== null && desired < b.minStart) {
    return {
      value: Math.min(b.minStart, upper),
      reason: `与上一条字幕至少间隔 ${cfg.minGapMs} ms，已回弹`,
    };
  }
  if (desired > upper) {
    return {
      value: upper,
      reason: `单条字幕最短时长为 ${cfg.minDurationMs} ms，已回弹`,
    };
  }
  return { value: desired, reason: null };
}

/** 拖动右边界 */
export function clampRight(
  start: number,
  desiredEnd: number,
  b: Bounds,
  cfg: ConstraintConfig,
): ClampResult {
  const desired = round5(desiredEnd);
  const lower = start + cfg.minDurationMs;

  if (desired < lower) {
    return {
      value: lower,
      reason: `单条字幕最短时长为 ${cfg.minDurationMs} ms，已回弹`,
    };
  }
  if (Number.isFinite(b.maxEnd) && desired > b.maxEnd) {
    if (b.nextStart !== null) {
      return {
        value: b.maxEnd,
        reason: `与下一条字幕至少间隔 ${cfg.minGapMs} ms，已回弹`,
      };
    }
    return { value: b.maxEnd, reason: '终点不能超出音频时长，已回弹' };
  }
  return { value: desired, reason: null };
}

export interface MoveResult {
  start: number;
  end: number;
  reason: string | null;
}

/** 整条拖动（保持时长不变） */
export function clampMove(
  desiredStart: number,
  duration: number,
  b: Bounds,
  cfg: ConstraintConfig,
): MoveResult {
  const desired = round5(desiredStart);
  const desiredEnd = desired + duration;
  let d = 0;
  let reason: string | null = null;

  if (desired < b.minStart) {
    d = b.minStart - desired;
    if (b.prevEnd !== null) {
      reason = `与上一条字幕至少间隔 ${cfg.minGapMs} ms，已回弹`;
    } else {
      reason = '起点不能早于 00:00:00,000，已回弹';
    }
  } else if (Number.isFinite(b.maxEnd) && desiredEnd > b.maxEnd) {
    d = b.maxEnd - desiredEnd;
    if (b.nextStart !== null) {
      reason = `与下一条字幕至少间隔 ${cfg.minGapMs} ms，已回弹`;
    } else {
      reason = '终点不能超出音频时长，已回弹';
    }
  }

  const start = desired + d;
  return { start, end: start + duration, reason };
}
