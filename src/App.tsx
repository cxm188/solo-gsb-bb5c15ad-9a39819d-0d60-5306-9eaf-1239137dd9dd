import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Timeline from './components/Timeline';
import { useHistory } from './hooks/useHistory';
import { formatClock, parseSrt, toSrt } from './lib/srt';
import type { ConstraintConfig, Cue } from './types';

const DEFAULTS: ConstraintConfig = { minDurationMs: 800, minGapMs: 120 };
const SETTINGS_KEY = 'subtitle-desk-config';

function loadConfig(): ConstraintConfig {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return DEFAULTS;
}

function demoCues(): Cue[] {
  const lines = [
    '欢迎使用字幕节奏校对台',
    '导入 SRT 与音频后，时间轴会显示字幕块与播放头',
    '拖动左右边界可调整单条时长，拖动中间可整体平移',
    '不重叠、最短时长与最小间隔约束会实时生效',
    '越界时自动回弹，并在顶部标出原因',
    '点击字幕块可定位播放，Ctrl+Z / Ctrl+Shift+Z 撤销重做',
    '最后用「导出 SRT」保存，编号会按时间顺序重排',
  ];
  let t = 500;
  return lines.map((text, i) => {
    const start = t;
    const end = start + 1400 + (i % 3) * 350;
    t = end + 260;
    return { id: `demo-${Date.now()}-${i}`, start, end, text };
  });
}

export default function App() {
  const {
    present: cues,
    commit: commitCue,
    reset: resetCues,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useHistory<Cue[]>([]);
  const [config, setConfig] = useState<ConstraintConfig>(loadConfig);
  const [audioName, setAudioName] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [durationMs, setDurationMs] = useState(0);
  const [currentMs, setCurrentMs] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [warning, setWarning] = useState<{ msg: string; key: number } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement>(null);
  const srtInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const warningTimer = useRef<number | null>(null);

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(config));
  }, [config]);

  const flashWarning = useCallback((msg: string) => {
    setWarning((prev) => {
      // 持续停留在同一种越界状态时不重置计时
      if (prev && prev.msg === msg) return prev;
      return { msg, key: Date.now() + Math.random() };
    });
    if (warningTimer.current) window.clearTimeout(warningTimer.current);
    warningTimer.current = window.setTimeout(() => setWarning(null), 2400);
  }, []);

  // 播放头跟随
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const a = audioRef.current;
      if (a && Number.isFinite(a.currentTime)) {
        setCurrentMs(a.currentTime * 1000);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const handleSeek = useCallback((ms: number) => {
    const a = audioRef.current;
    if (a && durationMs > 0) {
      a.currentTime = Math.min(Math.max(ms, 0), durationMs) / 1000;
    }
    setCurrentMs(Math.max(ms, 0));
  }, [durationMs]);

  const handleImportSrt = (file: File) => {
    file.text().then(
      (text) => {
        const parsed = parseSrt(text);
        if (parsed.length === 0) {
          setImportError('未在文件中识别到有效 SRT 条目');
          return;
        }
        setImportError(null);
        resetCues(parsed);
        setSelectedId(null);
      },
      () => setImportError('读取 SRT 文件失败'),
    );
  };

  const handleImportAudio = (file: File) => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    const url = URL.createObjectURL(file);
    setAudioUrl(url);
    setAudioName(file.name);
    setCurrentMs(0);
  };

  const handleExport = () => {
    if (cues.length === 0) {
      flashWarning('没有可导出的字幕');
      return;
    }
    const blob = new Blob([toSrt(cues)], {
      type: 'text/plain;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const base = audioName ? audioName.replace(/\.[^.]+$/, '') : 'subtitles';
    a.href = url;
    a.download = `${base}.corrected.srt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCommit = useCallback(
    (id: string, start: number, end: number) => {
      commitCue((cues) =>
        cues.map((c) => (c.id === id ? { ...c, start, end } : c)),
      );
    },
    [commitCue],
  );

  // 键盘快捷键
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if (e.code === 'Space') {
        const a = audioRef.current;
        if (a && audioUrl) {
          e.preventDefault();
          if (a.paused) a.play();
          else a.pause();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, audioUrl]);

  const selectedCue = useMemo(
    () => cues.find((c) => c.id === selectedId) ?? null,
    [cues, selectedId],
  );

  const overlapping = useMemo(() => {
    const s = [...cues].sort((a, b) => a.start - b.start);
    for (let i = 1; i < s.length; i++) {
      if (s[i].start < s[i - 1].end) return true;
    }
    return false;
  }, [cues]);

  return (
    <div className="app">
      <header className="app-header">
        <h1>字幕节奏校对台</h1>
        <div className="header-actions">
          <button onClick={() => srtInputRef.current?.click()}>导入 SRT</button>
          <button onClick={() => audioInputRef.current?.click()}>导入音频</button>
          <button
            onClick={undo}
            disabled={!canUndo}
            title="Ctrl+Z"
          >
            ↶ 撤销
          </button>
          <button
            onClick={redo}
            disabled={!canRedo}
            title="Ctrl+Shift+Z"
          >
            ↷ 重做
          </button>
          <button className="primary" onClick={handleExport}>导出 SRT</button>
          <input
            ref={srtInputRef}
            type="file"
            accept=".srt,text/plain"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleImportSrt(f);
              e.target.value = '';
            }}
          />
          <input
            ref={audioInputRef}
            type="file"
            accept="audio/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleImportAudio(f);
              e.target.value = '';
            }}
          />
        </div>
      </header>

      <section className="toolbar">
        <label className="cfg">
          最短时长
          <input
            type="number"
            min={0}
            step={50}
            value={config.minDurationMs}
            onChange={(e) =>
              setConfig((c) => ({
                ...c,
                minDurationMs: Math.max(0, Number(e.target.value) || 0),
              }))
            }
          />
          ms
        </label>
        <label className="cfg">
          最小间隔
          <input
            type="number"
            min={0}
            step={20}
            value={config.minGapMs}
            onChange={(e) =>
              setConfig((c) => ({
                ...c,
                minGapMs: Math.max(0, Number(e.target.value) || 0),
              }))
            }
          />
          ms
        </label>
        <div className="status-chips">
          <span className="chip">
            音频：{audioName ?? '未导入'}
            {durationMs > 0 && `（${formatClock(durationMs)}）`}
          </span>
          <span className="chip">字幕：{cues.length} 条</span>
          <span className="chip">
            播放头：{formatClock(currentMs, true)}
          </span>
          {selectedCue && (
            <span className="chip chip-accent">
              选中：{selectedCue.end - selectedCue.start} ms
            </span>
          )}
          {overlapping && (
            <span className="chip chip-warn">检测到导入数据存在重叠（仅拖动时强制约束）</span>
          )}
          {importError && <span className="chip chip-warn">{importError}</span>}
        </div>
        {cues.length === 0 && (
          <button
            className="link-btn"
            onClick={() => resetCues(demoCues())}
          >
            没有文件？载入示例字幕
          </button>
        )}
      </section>

      <main className="stage">
        {audioUrl && (
          <div className="audio-bar">
            <audio
              ref={audioRef}
              src={audioUrl}
              controls
              onLoadedMetadata={(e) => setDurationMs(e.currentTarget.duration * 1000)}
              onSeeked={(e) => setCurrentMs(e.currentTarget.currentTime * 1000)}
            />
          </div>
        )}
        {cues.length === 0 && !audioUrl ? (
          <div className="empty">
            <p>还没有内容。</p>
            <p>
              点击右上角「导入 SRT」与「导入音频」开始校对，
              或<a onClick={() => resetCues(demoCues())}>载入示例字幕</a>先体验。
            </p>
            <p className="hint">快捷键：空格 播放/暂停 · Ctrl+Z 撤销 · Ctrl+Shift+Z 重做</p>
          </div>
        ) : (
          <Timeline
            cues={cues}
            currentMs={currentMs}
            durationMs={durationMs}
            config={config}
            selectedId={selectedId}
            warning={warning}
            onSelect={setSelectedId}
            onSeek={handleSeek}
            onCommit={handleCommit}
            onViolation={flashWarning}
          />
        )}
      </main>
    </div>
  );
}
