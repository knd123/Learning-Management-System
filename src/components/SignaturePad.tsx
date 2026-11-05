import { Eraser } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import type { SignatureDrawing } from '../../shared/agreement.ts';
import { Button } from './ui.tsx';

const HEIGHT = 180;
const INK = '#14306b';

/**
 * A box to sign in with a finger, mouse or stylus. Reports the strokes (in CSS pixels) as they are
 * drawn, or null once cleared. Resizing the box (turning a phone) clears it.
 */
export function SignaturePad({ onChange, disabled }: { onChange(drawing: SignatureDrawing | null): void; disabled?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<number[][][]>([]);
  const drawing = useRef(false);
  const [width, setWidth] = useState(0);
  const [hasInk, setHasInk] = useState(false);

  const paint = useCallback(() => {
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx) return;
    const ratio = window.devicePixelRatio || 1;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, el.width, el.height);
    ctx.strokeStyle = INK;
    ctx.fillStyle = INK;
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const s of strokes.current) {
      if (s.length === 1) {
        ctx.beginPath();
        ctx.arc(s[0][0], s[0][1], 1.4, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      ctx.beginPath();
      ctx.moveTo(s[0][0], s[0][1]);
      for (let i = 1; i < s.length - 1; i++) ctx.quadraticCurveTo(s[i][0], s[i][1], (s[i][0] + s[i + 1][0]) / 2, (s[i][1] + s[i + 1][1]) / 2);
      ctx.lineTo(s[s.length - 1][0], s[s.length - 1][1]);
      ctx.stroke();
    }
  }, []);

  const clear = useCallback(() => {
    strokes.current = [];
    setHasInk(false);
    paint();
    onChange(null);
  }, [onChange, paint]);

  // Size the canvas to its box (sharp on high-density screens); a new width starts over.
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const fit = () => {
      const w = Math.round(el.getBoundingClientRect().width);
      setWidth((old) => {
        if (old === w) return old;
        const ratio = window.devicePixelRatio || 1;
        el.width = w * ratio;
        el.height = HEIGHT * ratio;
        if (strokes.current.length) {
          strokes.current = [];
          setHasInk(false);
          onChange(null);
        }
        requestAnimationFrame(paint);
        return w;
      });
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [onChange, paint]);

  const point = (e: PointerEvent<HTMLCanvasElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    return [Math.round((e.clientX - box.left) * 10) / 10, Math.round((e.clientY - box.top) * 10) / 10];
  };
  const down = (e: PointerEvent<HTMLCanvasElement>) => {
    if (disabled || strokes.current.length >= 100) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    strokes.current.push([point(e)]);
    paint();
  };
  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const stroke = strokes.current[strokes.current.length - 1];
    const [x, y] = point(e);
    const [px, py] = stroke[stroke.length - 1];
    if (Math.hypot(x - px, y - py) < 1.5) return;
    stroke.push([x, y]);
    paint();
  };
  const up = () => {
    if (!drawing.current) return;
    drawing.current = false;
    setHasInk(true);
    onChange({ width, height: HEIGHT, strokes: strokes.current.map((s) => s.map((p) => [...p])) });
  };

  return (
    <div>
      <div className={`relative rounded-xl border-2 border-dashed ${disabled ? 'border-sand-200 bg-sand-50' : 'border-sand-300 bg-white'}`}>
        <canvas
          ref={canvas}
          className={`block w-full touch-none ${disabled ? 'cursor-not-allowed' : 'cursor-crosshair'}`}
          style={{ height: HEIGHT }}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          aria-label="Signature box: draw your signature here"
          role="img"
        />
        <div className="pointer-events-none absolute inset-x-6 bottom-10 border-b border-sand-300" aria-hidden />
        <span className="pointer-events-none absolute bottom-3 left-6 text-xs text-ink-muted" aria-hidden>
          {hasInk ? 'Your signature' : 'Sign here'}
        </span>
      </div>
      <div className="mt-2 flex justify-end">
        <Button type="button" variant="ghost" size="sm" onClick={clear} disabled={disabled || !hasInk}>
          <Eraser className="size-4" aria-hidden /> Clear and sign again
        </Button>
      </div>
    </div>
  );
}
