/**
 * Plugin sidebar navigation entries. Labels are `() => string` so they pick up
 * the current locale via `t()` at render time — keeps i18n reactive.
 */
export type PluginSectionId =
  | "overview"
  | "skills"
  | "sources"
  | "mcp"
  | "hooks"
  | "plugins"
  | "agents";

export type PluginSection = {
  id: PluginSectionId;
  icon: string;
  label: () => string;
};
