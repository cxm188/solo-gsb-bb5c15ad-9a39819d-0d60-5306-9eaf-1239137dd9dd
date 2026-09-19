import { useEffect, useMemo, useRef, useState } from 'react';
import type { ConstraintConfig, Cue, DragState } from '../types';
import { formatClock } from '../lib/srt';
import {
  clampLeft,
  clampMove,
  clampRight,
  neighborBounds,
} from '../lib/constraints';

const RULER_H = 34;
const HANDLE_W = 7;

interface TimelineProps {
  cues: Cue[];
  currentMs: number;
  durationMs: number;
  config: ConstraintConfig;
  selectedId: string | null;
  warning: { msg: string; key: number } | null;
  onSelect: (id: string | null) => void;
  onSeek: (ms: number) => void;
  onCommit: (id: string, start: number, end: number) => void;
  onViolation: (msg: string) => void;
}

function niceStep(pxPerSec: number): number {
  const targetPx = 110;
  const candidates = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
  for (const s of candidates) {
    if (s * pxPerSec >= targetPx) return s;
  }
  return 3600;
}

function tickLabel(sec: number): string {
  const total = Math.round(sec * 1000);
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const s = (total % 60_000) / 1000;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (h > 0) return `${h}:${pad(m)}:${pad(Math.floor(s))}`;
  if (m > 0) return `${m}:${pad(Math.floor(s))}`;
  return Number.isInteger(s) ? `0:${pad(s)}` : `0:${pad(Math.floor(s))}.${Math.round((s % 1) * 10)}`;
}

export default function Timeline({
  cues,
  currentMs,
  durationMs,
  config,
  selectedId,
  warning,
  onSelect,
  onSeek,
  onCommit,
  onViolation,
}: TimelineProps) {
  const [pxPerSec, setPxPerSec] = useState(100);
  const [drag, setDrag] = useState<DragState | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const sorted = useMemo(() => [...cues].sort((a, b) => a.start - b.start), [cues]);

  const viewMs = useMemo(() => {
    const mediaEnd = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0;
    const lastCueEnd = sorted.reduce((mx, c) => Math.max(mx, c.end), 0);
    return Math.max(mediaEnd, lastCueEnd, 10_000) + 2000;
  }, [durationMs, sorted]);

  const width = Math.ceil((viewMs / 1000) * pxPerSec);
  const stepSec = niceStep(pxPerSec);
  const ticks: number[] = [];
  for (let t = 0, max = viewMs / 1000; t <= max; t += stepSec) ticks.push(t);

  const msToX = (ms: number) => (ms / 1000) * pxPerSec;
  const xToMs = (x: number) => (x / pxPerSec) * 1000;

  const effectiveCues = useMemo(() => {
    if (!drag) return sorted;
    return sorted.map((c) =>
      c.id === drag.id ? { ...c, start: drag.previewStart, end: drag.previewEnd } : c,
    );
  }, [sorted, drag]);

  function startDrag(e: React.PointerEvent, cue: Cue, mode: DragState['mode']) {
    e.preventDefault();
    e.stopPropagation();
    onSelect(cue.id);
    draggingRef.current = true;
    const init: DragState = {
      id: cue.id,
      mode,
      startX: e.clientX,
      origStart: cue.start,
      origEnd: cue.end,
      previewStart: cue.start,
      previewEnd: cue.end,
      reason: null,
    };

    const move = (ev: PointerEvent) => {
      const deltaMs = xToMs(ev.clientX - init.startX);
      const bounds = neighborBounds(sorted, cue.id, config, durationMs);

      if (mode === 'left') {
        const r = clampLeft(init.origStart + deltaMs, init.origEnd, bounds, config);
        setDrag({ ...init, previewStart: r.value, previewEnd: init.origEnd, reason: r.reason });
        if (r.reason) onViolation(r.reason);
      } else if (mode === 'right') {
        const r = clampRight(init.origStart, init.origEnd + deltaMs, bounds, config);
        setDrag({ ...init, previewStart: init.origStart, previewEnd: r.value, reason: r.reason });
        if (r.reason) onViolation(r.reason);
      } else {
        const r = clampMove(
          init.origStart + deltaMs,
          init.origEnd - init.origStart,
          bounds,
          config,
        );
        setDrag({ ...init, previewStart: r.start, previewEnd: r.end, reason: r.reason });
        if (r.reason) onViolation(r.reason);
      }
    };

    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDrag((cur) => {
        if (!cur) return null;
        if (
          cur.previewStart !== cur.origStart ||
          cur.previewEnd !== cur.origEnd
        ) {
          onCommit(cur.id, cur.previewStart, cur.previewEnd);
        } else {
          // 手柄按下但未拖动：视为点击，定位播放
          onSeek(cur.origStart);
        }
        return null;
      });
      draggingRef.current = false;
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // 播放时自动跟随：播放头越过可视区 65% 时把它滚到 35% 处
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || drag) return;
    const headX = msToX(currentMs);
    const viewLeft = el.scrollLeft;
    const viewW = el.clientWidth;
    if (headX > viewLeft + viewW * 0.65 || headX < viewLeft - 40) {
      el.scrollTo({ left: Math.max(0, headX - viewW * 0.35) });
    }
  }, [currentMs, drag, pxPerSec]);

  function seekFromEvent(e: React.MouseEvent<HTMLDivElement>) {
    if (draggingRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left + (scrollRef.current?.scrollLeft ?? 0);
    onSelect(null);
    onSeek(xToMs(x));
  }

  const headX = msToX(currentMs);
  const headCue = effectiveCues.find((c) => currentMs >= c.start && currentMs < c.end);

  return (
    <div className="timeline-wrap">
      {warning && (
        <div key={warning.key} className="tl-warning">
          ⚠ {warning.msg}
        </div>
      )}
      <div
        ref={scrollRef}
        className="timeline-scroll"
        onMouseDown={seekFromEvent}
      >
        <div className="timeline-inner" style={{ width }}>
          {/* 刻度尺 */}
          <div className="ruler" style={{ height: RULER_H }}>
            {ticks.map((t) => (
              <div
                key={t}
                className="tick"
                style={{ left: t * pxPerSec }}
              >
                <span className="tick-label">{tickLabel(t)}</span>
              </div>
            ))}
            <div className="playhead" style={{ left: headX }}>
              <div className="playhead-cap" />
            </div>
          </div>

          {/* 字幕轨道 */}
          <div className="track">
            {ticks.map((t) => (
              <div key={t} className="gridline" style={{ left: t * pxPerSec }} />
            ))}
            {effectiveCues.map((cue, i) => {
              const left = msToX(cue.start);
              const w = msToX(cue.end - cue.start);
              const isSelected = cue.id === selectedId;
              const isHead = headCue?.id === cue.id;
              const isDragging = drag?.id === cue.id;
              const violation = isDragging && drag?.reason;
              return (
                <div
                  key={cue.id}
                  className={[
                    'cue',
                    isSelected ? 'cue-selected' : '',
                    isHead ? 'cue-active' : '',
                    isDragging ? 'cue-dragging' : '',
                    violation ? 'cue-violation' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  style={{ left, width: Math.max(w, 4) }}
                  title={`#${i + 1}  ${formatClock(cue.start)} → ${formatClock(
                    cue.end,
                  )}（${cue.end - cue.start} ms）\n${cue.text.replace(/\n/g, ' ')}`}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    onSelect(cue.id);
                    onSeek(cue.start);
                  }}
                >
                  <div
                    className="cue-handle cue-handle-l"
                    style={{ width: HANDLE_W }}
                    onPointerDown={(e) => startDrag(e, cue, 'left')}
                  />
                  <div className="cue-body">
                    <span className="cue-index">#{i + 1}</span>
                    <span className="cue-text">{cue.text}</span>
                  </div>
                  <div
                    className="cue-handle cue-handle-r"
                    style={{ width: HANDLE_W }}
                    onPointerDown={(e) => startDrag(e, cue, 'right')}
                  />
                </div>
              );
            })}
            <div className="track-playhead" style={{ left: headX }} />
          </div>
        </div>
      </div>

      <div className="timeline-zoom">
        <button onClick={() => setPxPerSec((p) => Math.max(10, p / 1.25))}>－</button>
        <span>{Math.round(pxPerSec)} px/s</span>
        <button onClick={() => setPxPerSec((p) => Math.min(600, p * 1.25))}>＋</button>
      </div>
    </div>
  );
}
