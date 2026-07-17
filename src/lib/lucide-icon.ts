/** Lucide icon names used across MiWarp UI (kebab-case). */
export type LucideIconName =
  | "arrow-left"
  | "arrow-right"
  | "bar-chart-2"
  | "bot"
  | "brain"
  | "camera"
  | "check"
  | "check-square"
  | "chevron-down"
  | "chevron-left"
  | "chevron-right"
  | "circle"
  | "circle-dot"
  | "circle-user"
  | "clipboard-list"
  | "clock"
  | "code"
  | "copy"
  | "crosshair"
  | "download"
  | "external-link"
  | "eye"
  | "file"
  | "file-text"
  | "flask-conical"
  | "folder"
  | "folder-open"
  | "folder-up"
  | "git-branch"
  | "git-merge"
  | "globe"
  | "hand"
  | "home"
  | "keyboard"
  | "layout"
  | "lightbulb"
  | "link"
  | "loader-2"
  | "lock"
  | "map-pin"
  | "message-square"
  | "minus"
  | "monitor"
  | "package"
  | "mouse-pointer"
  | "mouse-pointer-2"
  | "mouse-pointer-click"
  | "network"
  | "pencil"
  | "play"
  | "plug"
  | "plus"
  | "radio"
  | "refresh-ccw"
  | "refresh-cw"
  | "rocket"
  | "scroll-text"
  | "search"
  | "settings"
  | "shield"
  | "sparkles"
  | "square"
  | "target"
  | "timer"
  | "trash"
  | "triangle-alert"
  | "upload"
  | "users"
  | "wrench"
  | "x"
  | "zap";

const LUCIDE_ICON_SET = new Set<string>([
  "arrow-left",
  "arrow-right",
  "bar-chart-2",
  "bot",
  "brain",
  "camera",
  "check",
  "check-square",
  "chevron-down",
  "chevron-left",
  "chevron-right",
  "circle",
  "circle-dot",
  "circle-user",
  "clipboard-list",
  "clock",
  "code",
  "copy",
  "crosshair",
  "download",
  "external-link",
  "eye",
  "file",
  "file-text",
  "flask-conical",
  "folder",
  "folder-open",
  "folder-up",
  "git-branch",
  "git-merge",
  "globe",
  "hand",
  "home",
  "keyboard",
  "layout",
  "lightbulb",
  "link",
  "loader-2",
  "lock",
  "map-pin",
  "message-square",
  "minus",
  "monitor",
  "package",
  "mouse-pointer",
  "mouse-pointer-2",
  "mouse-pointer-click",
  "network",
  "pencil",
  "play",
  "plug",
  "plus",
  "radio",
  "refresh-ccw",
  "refresh-cw",
  "rocket",
  "scroll-text",
  "search",
  "settings",
  "shield",
  "sparkles",
  "square",
  "target",
  "timer",
  "trash",
  "triangle-alert",
  "upload",
  "users",
  "wrench",
  "x",
  "zap",
]);

/** Map legacy emoji (and aliases) to Lucide icon names. */
const EMOJI_TO_LUCIDE: Record<string, LucideIconName> = {
  "⚡": "zap",
  "🔧": "wrench",
  "🤖": "bot",
  "🧠": "brain",
  "📁": "folder",
  "🔗": "link",
  "✨": "sparkles",
  "✓": "check",
  "✗": "x",
  "✕": "x",
  "❌": "x",
  "✅": "check-square",
  "🔄": "refresh-cw",
  "⚠": "triangle-alert",
  "⚠️": "triangle-alert",
  "📂": "folder-open",
  "🔀": "git-merge",
  "🔍": "search",
  "📊": "bar-chart-2",
  "🏠": "home",
  "👥": "users",
  "📋": "clipboard-list",
  "🔒": "lock",
  "👆": "mouse-pointer-click",
  "🕐": "clock",
  "⏱️": "timer",
  "⏱": "timer",
  "🔌": "plug",
  "⏳": "loader-2",
  "○": "circle",
  "⬇": "download",
  "▶": "play",
  "⚙": "settings",
  "⚙️": "settings",
  "🌐": "globe",
  "📡": "radio",
  "📷": "camera",
  "💻": "monitor",
  "🕷️": "network",
  "📝": "file-text",
  "🧪": "flask-conical",
  "👁️": "eye",
  "⌨️": "keyboard",
  "📜": "scroll-text",
  "📑": "layout",
  "✋": "hand",
  "👆👆": "mouse-pointer-click",
  "🖱️": "mouse-pointer-2",
  "▼": "chevron-down",
  "🎯": "target",
  "📦": "package",
  "📤": "upload",
  "💬": "message-square",
  "⏹": "square",
  "💰": "target",
  "⏰": "clock",
  "📈": "bar-chart-2",
  "🧩": "settings",
  "🔐": "lock",
  "🩺": "target",
  ℹ️: "target",
  "🚀": "rocket",
  "📄": "file",
  "🔮": "sparkles",
  "🎨": "pencil",
  "🎵": "radio",
  "🌟": "sparkles",
  "💡": "lightbulb",
  "⚪": "circle",
  "🟢": "circle-dot",
  "🟡": "circle-dot",
  "🟠": "circle-dot",
  "🔴": "circle-dot",
};

function isLucideIconName(value: string): value is LucideIconName {
  return LUCIDE_ICON_SET.has(value);
}

export function resolveIconName(
  value: string | undefined | null,
  fallback: LucideIconName = "sparkles",
): LucideIconName {
  if (!value) return fallback;
  if (isLucideIconName(value)) return value;
  return EMOJI_TO_LUCIDE[value] ?? fallback;
}
