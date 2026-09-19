import type { Cue } from '../types';

const TIME_RE =
  /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/;

function toMs(h: string, m: string, s: string, ms: string): number {
  return (
    Number(h) * 3_600_000 +
    Number(m) * 60_000 +
    Number(s) * 1_000 +
    Number(ms.padEnd(3, '0'))
  );
}

/** 解析 SRT 文本。非法条目会被跳过；返回按开始时间排序的条目。 */
export function parseSrt(content: string): Cue[] {
  const cues: Cue[] = [];
  const blocks = content.replace(/\r\n/g, '\n').split(/\n{2,}/);
  let seq = 0;

  for (const raw of blocks) {
    const block = raw.trim();
    if (!block) continue;
    const lines = block.split('\n');
    const timeLineIdx = lines.findIndex((l) => TIME_RE.test(l));
    if (timeLineIdx === -1) continue;

    const m = lines[timeLineIdx].match(TIME_RE)!;
    const start = toMs(m[1], m[2], m[3], m[4]);
    const end = toMs(m[5], m[6], m[7], m[8]);
    const text = lines.slice(timeLineIdx + 1).join('\n').trim();
    if (!text || end <= start) continue;

    cues.push({ id: `cue-${Date.now()}-${seq++}`, start, end, text });
  }

  return cues.sort((a, b) => a.start - b.start);
}

export function formatSrtTime(ms: number): string {
  const clamped = Math.max(0, Math.round(ms));
  const h = Math.floor(clamped / 3_600_000);
  const m = Math.floor((clamped % 3_600_000) / 60_000);
  const s = Math.floor((clamped % 60_000) / 1_000);
  const milli = clamped % 1_000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(
    s,
  ).padStart(2, '0')},${String(milli).padStart(3, '0')}`;
}

/** 序列化 SRT：按开始时间排序并重新连续编号，保证导出编号有序。 */
export function toSrt(cues: Cue[]): string {
  return [...cues]
    .sort((a, b) => a.start - b.start)
    .map(
      (cue, i) =>
        `${i + 1}\n${formatSrtTime(cue.start)} --> ${formatSrtTime(cue.end)}\n${cue.text}`,
    )
    .join('\n\n')
    .concat('\n');
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** 时间轴刻度/状态栏使用的展示格式：h:mm:ss(.d) */
export function formatClock(ms: number, withFraction = false): string {
  const clamped = Math.max(0, ms);
  const h = Math.floor(clamped / 3_600_000);
  const m = Math.floor((clamped % 3_600_000) / 60_000);
  const s = Math.floor((clamped % 60_000) / 1_000);
  const base = `${h}:${pad2(m)}:${pad2(s)}`;
  if (withFraction) {
    const tenth = Math.floor((clamped % 1_000) / 100);
    return `${base}.${tenth}`;
  }
  return base;
}
