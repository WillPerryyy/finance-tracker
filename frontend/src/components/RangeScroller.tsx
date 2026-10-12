import { useRef } from 'react';

export interface Range { start: number; end: number }

/**
 * A horizontal scrollbar for a chart's x axis. Shows a miniature of the whole series with the
 * visible window highlighted: drag the window to pan, drag either edge to zoom.
 * Handles are keyboard operable (arrow keys move by one point, Shift + arrow by five).
 */
export default function RangeScroller({ values, labels, range, onChange, minSpan = 2 }: {
  values: number[]; labels: (string | number)[]; range: Range; onChange: (r: Range) => void; minSpan?: number;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const n = values.length;
  const last = Math.max(1, n - 1);
  const pct = (i: number) => (i / last) * 100;

  const clamp = (r: Range): Range => {
    let { start, end } = r;
    start = Math.max(0, Math.min(start, last - minSpan));
    end = Math.min(last, Math.max(end, start + minSpan));
    return { start, end };
  };

  const indexAt = (clientX: number) => {
    const rect = trackRef.current!.getBoundingClientRect();
    return Math.round(((clientX - rect.left) / rect.width) * last);
  };

  const startDrag = (e: React.PointerEvent, mode: 'start' | 'end' | 'pan') => {
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const origin = indexAt(e.clientX);
    const initial = { ...range };
    const move = (ev: PointerEvent) => {
      const i = indexAt(ev.clientX);
      if (mode === 'start') onChange(clamp({ start: Math.min(i, initial.end - minSpan), end: initial.end }));
      else if (mode === 'end') onChange(clamp({ start: initial.start, end: Math.max(i, initial.start + minSpan) }));
      else {
        const span = initial.end - initial.start;
        const s = Math.max(0, Math.min(last - span, initial.start + (i - origin)));
        onChange({ start: s, end: s + span });
      }
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };

  // Clicking the track outside the window centres the window there.
  const jump = (e: React.PointerEvent) => {
    if (e.target !== e.currentTarget && !(e.target as HTMLElement).dataset.track) return;
    const span = range.end - range.start;
    const centre = indexAt(e.clientX);
    const s = Math.max(0, Math.min(last - span, Math.round(centre - span / 2)));
    onChange({ start: s, end: s + span });
  };

  const keyHandle = (which: 'start' | 'end') => (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 5 : 1;
    const d = e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -step : e.key === 'ArrowRight' || e.key === 'ArrowUp' ? step : 0;
    if (!d) return;
    e.preventDefault();
    onChange(clamp(which === 'start' ? { ...range, start: range.start + d } : { ...range, end: range.end + d }));
  };
  const keyWindow = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 5 : 1;
    const d = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
    if (!d) return;
    e.preventDefault();
    const span = range.end - range.start;
    const s = Math.max(0, Math.min(last - span, range.start + d));
    onChange({ start: s, end: s + span });
  };

  // Miniature of the series, drawn in a 100 x 30 box and stretched to fit.
  const lo = Math.min(0, ...values);
  const hi = Math.max(1, ...values);
  const y = (v: number) => 28 - ((v - lo) / (hi - lo || 1)) * 26;
  const path = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${pct(i).toFixed(2)},${y(v).toFixed(2)}`).join(' ');
  const area = `${path} L100,30 L0,30 Z`;

  return (
    <div className="select-none">
      <div
        ref={trackRef}
        data-track="1"
        className="relative h-11 rounded-md cursor-pointer"
        style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}
        onPointerDown={jump}
      >
        <svg data-track="1" viewBox="0 0 100 30" preserveAspectRatio="none" className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden="true">
          <path d={area} fill="var(--color-text-4)" fillOpacity={0.18} />
          <path d={path} fill="none" stroke="var(--color-text-3)" strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
        </svg>
        {/* Window */}
        <div
          role="slider"
          tabIndex={0}
          aria-label="Visible years. Use the arrow keys to move."
          aria-valuemin={0}
          aria-valuemax={last}
          aria-valuenow={range.start}
          aria-valuetext={`${labels[range.start]} to ${labels[range.end]}`}
          className="absolute top-0 bottom-0 cursor-grab active:cursor-grabbing focus-visible:outline-2"
          style={{
            left: `${pct(range.start)}%`,
            width: `${pct(range.end) - pct(range.start)}%`,
            background: 'rgba(36, 87, 197, 0.12)',
            borderTop: '2px solid var(--color-accent)',
            borderBottom: '2px solid var(--color-accent)',
          }}
          onPointerDown={e => startDrag(e, 'pan')}
          onKeyDown={keyWindow}
        />
        {(['start', 'end'] as const).map(which => (
          <div
            key={which}
            role="slider"
            tabIndex={0}
            aria-label={which === 'start' ? 'First visible year' : 'Last visible year'}
            aria-valuemin={0}
            aria-valuemax={last}
            aria-valuenow={range[which]}
            aria-valuetext={String(labels[range[which]])}
            className="absolute top-[-3px] bottom-[-3px] w-3 -ml-1.5 rounded cursor-ew-resize flex items-center justify-center"
            style={{ left: `${pct(range[which])}%`, background: 'var(--color-accent)' }}
            onPointerDown={e => startDrag(e, which)}
            onKeyDown={keyHandle(which)}
          >
            <span className="w-[2px] h-4 rounded" style={{ background: 'rgba(255,255,255,0.8)' }} />
          </div>
        ))}
      </div>
      <div className="relative h-5 mt-1 text-[12px] num muted">
        <span className="absolute" style={{ left: 0 }}>{labels[0]}</span>
        <span className="absolute" style={{ right: 0 }}>{labels[last]}</span>
      </div>
    </div>
  );
}
