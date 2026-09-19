import assert from 'node:assert';
import { clampLeft, clampMove, clampRight, neighborBounds } from '../src/lib/constraints';
import { parseSrt, toSrt } from '../src/lib/srt';

const cfg = { minDurationMs: 800, minGapMs: 120 };
const cues = [
  { id: 'a', start: 0, end: 1000 },
  { id: 'b', start: 1120, end: 3000 },
  { id: 'c', start: 3120, end: 5000 },
];

// 拖 b 的左边界到 500 -> 必须回弹到 prev.end + gap = 1120
{
  const b = neighborBounds(cues, 'b', cfg, 60000);
  const r = clampLeft(500, 3000, b, cfg);
  assert.strictEqual(r.value, 1120);
  assert.ok(r.reason.includes('间隔'));
}

// 拖 b 的右边界到 4000 -> 回弹到 next.start - gap = 3000
{
  const b = neighborBounds(cues, 'b', cfg, 60000);
  const r = clampRight(1120, 4000, b, cfg);
  assert.strictEqual(r.value, 3000);
  assert.ok(r.reason.includes('间隔'));
}

// 最短时长：把 b 右边拖到 1500 -> 回弹到 start + 800 = 1920
{
  const b = neighborBounds(cues, 'b', cfg, 60000);
  const r = clampRight(1120, 1500, b, cfg);
  assert.strictEqual(r.value, 1920);
  assert.ok(r.reason.includes('最短时长'));
}

// 最短时长（左边界越过 end-800）
{
  const b = neighborBounds(cues, 'c', cfg, 60000);
  const r = clampLeft(4800, 5000, b, cfg);
  assert.strictEqual(r.value, 4200);
  assert.ok(r.reason.includes('最短时长'));
}

// 整条移动 b：往左超出 -> 回弹到 minStart=1120
{
  const b = neighborBounds(cues, 'b', cfg, 60000);
  const r = clampMove(0, 1880, b, cfg); // duration 保持 1880
  assert.strictEqual(r.start, 1120);
  assert.strictEqual(r.end, 3000);
}

// 整条移动 b：往右顶到 c -> end 回弹到 3000，start = 3000-1880 = 1120
{
  const b = neighborBounds(cues, 'b', cfg, 60000);
  const r = clampMove(2000, 1880, b, cfg);
  assert.strictEqual(r.end, 3000);
  assert.strictEqual(r.start, 1120);
  assert.ok(r.reason.includes('间隔'));
}

// 音频时长边界：最后一条拖出音频末尾
{
  const b = neighborBounds(cues, 'c', cfg, 5000);
  const r = clampRight(3120, 9000, b, cfg);
  assert.strictEqual(r.value, 5000);
  assert.ok(r.reason.includes('音频时长'));
}

// 合法拖动：无 reason
{
  const b = neighborBounds(cues, 'b', cfg, 60000);
  const r = clampLeft(1500, 3000, b, cfg);
  assert.strictEqual(r.value, 1500);
  assert.strictEqual(r.reason, null);
}

// SRT 往返 + 乱序编号重排
const srt = '2\n00:00:03,000 --> 00:00:04,000\nsecond\n\n1\n00:00:01.000 --> 00:00:02,500\nfirst line\nsecond line\n';
const parsed = parseSrt(srt);
assert.strictEqual(parsed.length, 2);
assert.strictEqual(parsed[0].text, 'first line\nsecond line');
assert.strictEqual(parsed[1].start, 3000);
const out = toSrt(parsed);
assert.match(out, /^1\n00:00:01,000 --> 00:00:02,500/);
assert.match(out, /2\n00:00:03,000 --> 00:00:04,000\nsecond\n$/);

console.log('all constraint + srt tests passed');
