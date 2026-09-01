import { useEffect, useState } from 'react';
import type { Item } from '../data/schema';

/**
 * Pull a dominant colour out of the album art so the stage can take on the
 * record's own palette.
 *
 * This is the difference between a black void with a picture in it and a room
 * the album is lighting. Sampling happens on a detached 16x16 canvas, which is
 * plenty for an average and costs nothing.
 *
 * Cover Art Archive redirects to archive.org, and if that response lacks CORS
 * headers the canvas is tainted and getImageData throws. That is expected, not
 * exceptional — every failure falls back to a stable per-album hue, so the
 * stage is always lit even when sampling is impossible.
 */
const cache = new Map<string, string>();
const DEFAULT = 'hsl(220 18% 40%)';

function fallbackHue(item: Item): string {
  let h = 0;
  const text = item.title + item.subtitle;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 360;
  return `hsl(${h} 34% 40%)`;
}

function dominant(data: Uint8ClampedArray): string {
  let r = 0, g = 0, b = 0, weight = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const cr = data[i], cg = data[i + 1], cb = data[i + 2];
    const max = Math.max(cr, cg, cb);
    const min = Math.min(cr, cg, cb);
    // Weight by saturation: a mostly-grey sleeve with one vivid element should
    // be lit by the vivid element, not by the grey that outnumbers it.
    const w = 0.15 + (max - min) / 255;
    r += cr * w; g += cg * w; b += cb * w; weight += w;
  }
  if (!weight) return DEFAULT;
  r /= weight; g /= weight; b /= weight;

  // Convert to HSL so saturation and lightness can be forced into a usable
  // range — raw averages trend muddy and would just make the stage grey again.
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0, s = 0;
  if (d) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const sat = Math.min(72, Math.max(32, s * 100 * 1.5));
  const light = Math.min(52, Math.max(30, l * 100 * 1.1));
  return `hsl(${Math.round(h)} ${Math.round(sat)}% ${Math.round(light)}%)`;
}

export function useAmbient(item: Item | null): string {
  const [color, setColor] = useState(DEFAULT);

  useEffect(() => {
    if (!item) return;
    const hit = cache.get(item.id);
    if (hit) {
      setColor(hit);
      return;
    }
    setColor(fallbackHue(item));

    const url = item.artThumbUrl ?? item.artUrl;
    // No Image constructor outside a browser (SSR, tests): the fallback hue
    // already applied, so there is nothing else to do.
    if (!url || typeof Image === 'undefined') return;

    let cancelled = false;
    const img = new Image();
    // A separate Image from the one on screen: if CORS forbids sampling, only
    // the ambient light is lost, never the cover itself.
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 16;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, 16, 16);
        const css = dominant(ctx.getImageData(0, 0, 16, 16).data);
        cache.set(item.id, css);
        if (!cancelled) setColor(css);
      } catch {
        // Tainted canvas — the per-album fallback hue is already applied.
      }
    };
    img.src = url;
    return () => { cancelled = true; };
  }, [item]);

  return color;
}
