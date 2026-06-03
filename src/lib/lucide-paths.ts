import type { LucideIconName } from "./lucide-icon";

export type SvgPart =
  | { t: "path"; d: string }
  | { t: "circle"; cx: number; cy: number; r: number }
  | { t: "line"; x1: number; y1: number; x2: number; y2: number }
  | { t: "polyline"; points: string }
  | { t: "polygon"; points: string }
  | { t: "rect"; x: number; y: number; width: number; height: number; rx?: number };

export const LUCIDE_PATHS: Record<LucideIconName, SvgPart[]> = {
  check: [{ t: "path", d: "M20 6 9 17l-5-5" }],
  x: [
    { t: "path", d: "M18 6 6 18" },
    { t: "path", d: "m6 6 12 12" },
  ],
  clock: [
    { t: "circle", cx: 12, cy: 12, r: 10 },
    { t: "polyline", points: "12 6 12 12 16 14" },
  ],
  "chevron-right": [{ t: "path", d: "m9 18 6-6-6-6" }],
  "chevron-left": [{ t: "path", d: "m15 18-6-6 6-6" }],
  "chevron-down": [{ t: "path", d: "m6 9 6 6 6-6" }],
  "arrow-right": [
    { t: "line", x1: 5, y1: 12, x2: 19, y2: 12 },
    { t: "polyline", points: "12 5 19 12 12 19" },
  ],
  "arrow-left": [
    { t: "line", x1: 19, y1: 12, x2: 5, y2: 12 },
    { t: "polyline", points: "12 19 5 12 12 5" },
  ],
  search: [
    { t: "circle", cx: 11, cy: 11, r: 8 },
    { t: "path", d: "m21 21-4.3-4.3" },
  ],
  trash: [
    { t: "path", d: "M3 6h18" },
    { t: "path", d: "M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" },
    { t: "path", d: "M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" },
  ],
  "refresh-cw": [
    { t: "path", d: "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" },
    { t: "path", d: "M21 3v5h-5" },
    { t: "path", d: "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" },
    { t: "path", d: "M8 16H3v5" },
  ],
  "refresh-ccw": [
    { t: "path", d: "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" },
    { t: "path", d: "M3 3v5h5" },
  ],
  users: [
    { t: "path", d: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" },
    { t: "circle", cx: 9, cy: 7, r: 4 },
    { t: "path", d: "M23 21v-2a4 4 0 0 0-3-3.87" },
    { t: "path", d: "M16 3.13a4 4 0 0 1 0 7.75" },
  ],
  copy: [
    { t: "rect", x: 8, y: 8, width: 14, height: 14, rx: 2 },
    { t: "path", d: "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" },
  ],
  "external-link": [
    { t: "path", d: "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" },
    { t: "polyline", points: "15 3 21 3 21 9" },
    { t: "line", x1: 10, y1: 14, x2: 21, y2: 3 },
  ],
  file: [
    { t: "path", d: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" },
    { t: "polyline", points: "14 2 14 8 20 8" },
  ],
  "file-text": [
    { t: "path", d: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" },
    { t: "polyline", points: "14 2 14 8 20 8" },
    { t: "line", x1: 16, y1: 13, x2: 8, y2: 13 },
    { t: "line", x1: 16, y1: 17, x2: 8, y2: 17 },
  ],
  plus: [
    { t: "line", x1: 12, y1: 5, x2: 12, y2: 19 },
    { t: "line", x1: 5, y1: 12, x2: 19, y2: 12 },
  ],
  minus: [{ t: "line", x1: 5, y1: 12, x2: 19, y2: 12 }],
  home: [
    { t: "path", d: "M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" },
    { t: "polyline", points: "9 22 9 12 15 12 15 22" },
  ],
  monitor: [
    { t: "rect", x: 2, y: 3, width: 20, height: 14, rx: 2 },
    { t: "line", x1: 8, y1: 21, x2: 16, y2: 21 },
    { t: "line", x1: 12, y1: 17, x2: 12, y2: 21 },
  ],
  wrench: [
    {
      t: "path",
      d: "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z",
    },
  ],
  folder: [{ t: "path", d: "M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" }],
  "folder-open": [
    {
      t: "path",
      d: "m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2",
    },
  ],
  "folder-up": [
    { t: "path", d: "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" },
    { t: "path", d: "M12 10v6" },
    { t: "path", d: "m9 13 3-3 3 3" },
  ],
  pencil: [
    { t: "path", d: "M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" },
    { t: "path", d: "m15 5 4 4" },
  ],
  "loader-2": [{ t: "path", d: "M21 12a9 9 0 1 1-6.219-8.56" }],
  "map-pin": [
    { t: "path", d: "M12 2a8 8 0 0 1 8 8c0 5-8 13-8 13S4 15 4 10a8 8 0 0 1 8-8z" },
    { t: "circle", cx: 12, cy: 10, r: 3 },
  ],
  "git-branch": [
    { t: "line", x1: 6, y1: 3, x2: 6, y2: 15 },
    { t: "circle", cx: 18, cy: 6, r: 3 },
    { t: "circle", cx: 6, cy: 18, r: 3 },
    { t: "path", d: "M18 9a9 9 0 0 1-9 9" },
  ],
  "git-merge": [
    { t: "circle", cx: 18, cy: 18, r: 3 },
    { t: "circle", cx: 6, cy: 6, r: 3 },
    { t: "path", d: "M6 21V9a9 9 0 0 0 9 9" },
  ],
  "triangle-alert": [
    { t: "path", d: "M12 9v4" },
    { t: "path", d: "M12 17h.01" },
    { t: "path", d: "M3.6 15.4 10.2 4a2 2 0 0 1 3.6 0l6.6 11.4a2 2 0 0 1-1.8 3H5.4a2 2 0 0 1-1.8-3Z" },
  ],
  play: [{ t: "polygon", points: "5 3 19 12 5 21 5 3" }],
  "check-square": [
    { t: "rect", x: 3, y: 3, width: 18, height: 18, rx: 2 },
    { t: "path", d: "M9 12l2 2 4-4" },
  ],
  crosshair: [
    { t: "circle", cx: 12, cy: 12, r: 3 },
    { t: "path", d: "M12 2v4m0 12v4M2 12h4m12 0h4" },
  ],
  zap: [{ t: "polygon", points: "13 2 3 14 12 14 11 22 21 10 12 10 13 2" }],
  sparkles: [
    { t: "path", d: "M9.94 15.06 8 22l-1.94-6.94L0 13l6.94-2.06L8 4l1.94 6.94L16 13l-6.06 2.06Z" },
    { t: "path", d: "M20 3v4" },
    { t: "path", d: "M22 5h-4" },
    { t: "path", d: "M4 17v4" },
    { t: "path", d: "M5 19H1" },
  ],
  bot: [
    { t: "path", d: "M12 8V4H8" },
    { t: "rect", x: 4, y: 8, width: 16, height: 12, rx: 2 },
    { t: "path", d: "M2 14h2" },
    { t: "path", d: "M20 14h2" },
    { t: "path", d: "M15 13v2" },
    { t: "path", d: "M9 13v2" },
  ],
  brain: [
    {
      t: "path",
      d: "M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 4.44-1.54",
    },
    {
      t: "path",
      d: "M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-4.44-1.54",
    },
  ],
  link: [
    { t: "path", d: "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" },
    { t: "path", d: "M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" },
  ],
  "bar-chart-2": [
    { t: "line", x1: 18, y1: 20, x2: 18, y2: 10 },
    { t: "line", x1: 12, y1: 20, x2: 12, y2: 4 },
    { t: "line", x1: 6, y1: 20, x2: 6, y2: 14 },
  ],
  plug: [
    { t: "path", d: "M12 22v-5" },
    { t: "path", d: "M9 8V2" },
    { t: "path", d: "M15 8V2" },
    { t: "path", d: "M18 8v5a6 6 0 0 1-12 0V8z" },
  ],
  lock: [
    { t: "rect", x: 3, y: 11, width: 18, height: 11, rx: 2 },
    { t: "path", d: "M7 11V7a5 5 0 0 1 10 0v4" },
  ],
  "clipboard-list": [
    { t: "rect", x: 8, y: 2, width: 8, height: 4, rx: 1 },
    { t: "path", d: "M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" },
    { t: "path", d: "M12 11h4" },
    { t: "path", d: "M12 16h4" },
    { t: "path", d: "M8 11h.01" },
    { t: "path", d: "M8 16h.01" },
  ],
  timer: [
    { t: "line", x1: 10, y1: 2, x2: 14, y2: 2 },
    { t: "line", x1: 12, y1: 14, x2: 15, y2: 11 },
    { t: "circle", cx: 12, cy: 14, r: 8 },
  ],
  globe: [
    { t: "circle", cx: 12, cy: 12, r: 10 },
    { t: "line", x1: 2, y1: 12, x2: 22, y2: 12 },
    { t: "path", d: "M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" },
  ],
  camera: [
    { t: "path", d: "M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" },
    { t: "circle", cx: 12, cy: 13, r: 3 },
  ],
  radio: [
    { t: "circle", cx: 12, cy: 12, r: 2 },
    { t: "path", d: "M16.24 7.76a6 6 0 0 1 0 8.49" },
    { t: "path", d: "M19.07 4.93a10 10 0 0 1 0 14.14" },
    { t: "path", d: "M7.76 16.24a6 6 0 0 1 0-8.49" },
    { t: "path", d: "M4.93 19.07a10 10 0 0 1 0-14.14" },
  ],
  shield: [
    {
      t: "path",
      d: "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",
    },
  ],
  settings: [
    {
      t: "path",
      d: "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z",
    },
    { t: "circle", cx: 12, cy: 12, r: 3 },
  ],
  eye: [
    { t: "path", d: "M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" },
    { t: "circle", cx: 12, cy: 12, r: 3 },
  ],
  "flask-conical": [
    { t: "path", d: "M10 2v7.527a2 2 0 0 1-.211.896L4.72 20.55a1 1 0 0 0 .9 1.45h12.76a1 1 0 0 0 .9-1.45l-5.069-10.127A2 2 0 0 1 14 9.527V2" },
    { t: "path", d: "M8.5 2h7" },
    { t: "path", d: "M7 16h10" },
  ],
  network: [
    { t: "rect", x: 16, y: 16, width: 6, height: 6, rx: 1 },
    { t: "rect", x: 2, y: 16, width: 6, height: 6, rx: 1 },
    { t: "rect", x: 9, y: 2, width: 6, height: 6, rx: 1 },
    { t: "path", d: "M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3" },
    { t: "path", d: "M12 12V8" },
  ],
  keyboard: [
    { t: "rect", x: 2, y: 4, width: 20, height: 16, rx: 2 },
    { t: "path", d: "M6 8h.01" },
    { t: "path", d: "M10 8h.01" },
    { t: "path", d: "M14 8h.01" },
    { t: "path", d: "M18 8h.01" },
    { t: "path", d: "M8 12h.01" },
    { t: "path", d: "M12 12h.01" },
    { t: "path", d: "M16 12h.01" },
    { t: "path", d: "M7 16h10" },
  ],
  "scroll-text": [
    { t: "path", d: "M8 21h12a2 2 0 0 0 2-2v-2H10v2a2 2 0 0 1-2 2Z" },
    { t: "path", d: "M8 3h12a2 2 0 0 1 2 2v2H10V5a2 2 0 0 0-2-2Z" },
    { t: "path", d: "M12 11h6" },
    { t: "path", d: "M12 15h6" },
    { t: "path", d: "M12 7h6" },
  ],
  layout: [
    { t: "rect", x: 3, y: 3, width: 18, height: 18, rx: 2 },
    { t: "path", d: "M3 9h18" },
    { t: "path", d: "M9 21V9" },
  ],
  code: [
    { t: "polyline", points: "16 18 22 12 16 6" },
    { t: "polyline", points: "8 6 2 12 8 18" },
  ],
  "mouse-pointer-click": [
    { t: "path", d: "M14 4.1 12 6" },
    { t: "path", d: "m5.1 8.9-3-3" },
    { t: "path", d: "M6.7 15l-4.6 4.6" },
    { t: "path", d: "m18.5 6.5-1.4-1.4" },
    { t: "path", d: "m21.2 11.2-1.4-1.4" },
    { t: "path", d: "m14.1 18.1-1.4-1.4" },
    { t: "path", d: "M9 13l2-6 4 4-6 2Z" },
  ],
  hand: [
    { t: "path", d: "M18 11V6a2 2 0 0 0-4 0v5" },
    { t: "path", d: "M14 10V4a2 2 0 0 0-4 0v6" },
    { t: "path", d: "M10 9.5V4a2 2 0 0 0-4 0v8" },
    { t: "path", d: "M18 8a2 2 0 1 1 4 0v8a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-1.2-1.2a2 2 0 0 1 2.83-2.83l.79.79" },
  ],
  "mouse-pointer": [
    { t: "path", d: "M12 2v4" },
    { t: "path", d: "m6.8 15-3.5 2" },
    { t: "path", d: "M20 4l-1.5 1.5" },
    { t: "path", d: "M4 20l1.5-1.5" },
    { t: "path", d: "M4 4l1.5 1.5" },
    { t: "path", d: "M12 18v4" },
    { t: "path", d: "m17.2 15 3.5 2" },
    { t: "path", d: "M12 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z" },
  ],
  "mouse-pointer-2": [
    { t: "path", d: "M4.037 4.688a.5.5 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.124a.5.5 0 0 1-.947.063z" },
  ],
  upload: [
    { t: "path", d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" },
    { t: "polyline", points: "17 8 12 3 7 8" },
    { t: "line", x1: 12, y1: 3, x2: 12, y2: 15 },
  ],
  download: [
    { t: "path", d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" },
    { t: "polyline", points: "7 10 12 15 17 10" },
    { t: "line", x1: 12, y1: 15, x2: 12, y2: 3 },
  ],
  circle: [{ t: "circle", cx: 12, cy: 12, r: 10 }],
  "circle-dot": [{ t: "circle", cx: 12, cy: 12, r: 10 }, { t: "circle", cx: 12, cy: 12, r: 1 }],
  target: [
    { t: "circle", cx: 12, cy: 12, r: 10 },
    { t: "circle", cx: 12, cy: 12, r: 6 },
    { t: "circle", cx: 12, cy: 12, r: 2 },
  ],
  rocket: [
    { t: "path", d: "M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" },
    { t: "path", d: "m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" },
    { t: "path", d: "M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" },
    { t: "path", d: "M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" },
  ],
  package: [
    { t: "path", d: "M16.5 9.4 7.55 4.24" },
    { t: "path", d: "M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" },
    { t: "polyline", points: "3.27 6.96 12 12.01 20.73 6.96" },
    { t: "line", x1: 12, y1: 22.08, x2: 12, y2: 12 },
  ],
  "message-square": [{ t: "path", d: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" }],
  square: [{ t: "rect", x: 5, y: 5, width: 14, height: 14, rx: 2 }],
  lightbulb: [
    { t: "path", d: "M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" },
    { t: "path", d: "M9 18h6" },
    { t: "path", d: "M10 22h4" },
  ],
};
