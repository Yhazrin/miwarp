/**
 * 类型化的 settings 切片 —— 把 `UserSettings` 按域切成 5 个独立 prop，
 * 让 personal 页的子组件只依赖自己关心的字段，避免任意字段变更都触发
 * 9 个子树级联重渲。
 *
 * 每个 slice 用 `Pick<UserSettings, ...>` 派生，类型变化时编译器会强制
 * 同步更新所有相关 prop。
 */
import type { UserSettings } from "$lib/types";

export type IdentitySettings = Pick<
  UserSettings,
  "user_display_name" | "user_handle" | "user_role" | "user_timezone" | "user_email"
>;

export type AiSettings = Pick<
  UserSettings,
  "default_agent" | "default_model" | "fallback_model" | "allowed_tools"
>;

export type SessionSettings = Pick<
  UserSettings,
  | "default_session_mode"
  | "auto_commit_on_complete"
  | "auto_pr_on_complete"
  | "auto_cleanup_worktree"
>;

export type NotificationSettings = Pick<
  UserSettings,
  | "notifications_enabled"
  | "notify_on_run_completed"
  | "notify_on_run_failed"
  | "notify_on_approval_required"
  | "notify_on_schedule_completed"
  | "notify_on_team_completed"
>;

export type DisplaySettings = Pick<UserSettings, "ui_zoom">;

export type ProviderSettings = Pick<UserSettings, "platform_credentials" | "active_platform_id">;
