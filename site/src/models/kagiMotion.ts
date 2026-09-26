/** Scroll keyframes shared by the viewer and motion checks. */
export const CHAPTER_STOPS = [0, 0.27, 0.64, 1] as const;
export const clamp = (value: number) => Math.max(0, Math.min(1, value));
const smooth = (value: number) => { const t = clamp(value); return t * t * (3 - 2 * t); };
export function kagiPose(progress: number) {
  const p = clamp(progress);
  const turn = smooth(p / 0.27);
  const open = smooth((p - 0.3) / 0.34);
  const power = smooth((p - 0.68) / 0.32);
  return {
    open, power,
    rotation: [0.3 + turn * 0.12 + open * 0.12, -0.08 + turn * 0.22 - open * 1.5, Math.PI / 2] as const,
    chapter: CHAPTER_STOPS.reduce<number>((best, stop, i) => Math.abs(p - stop) < Math.abs(p - CHAPTER_STOPS[best]) ? i : best, 0),
  };
}
