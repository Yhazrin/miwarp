// v1.0.9 RuntimeCapabilities — frontend mirror of the 12 capability flags
// listed in docs/architecture/v1.0.9-runtime-contract.md §3.
//
// This module is the single TypeScript source of truth for the capability
// surface that the rest of the frontend reads through `useRuntimeCapabilities`.
// Adding a flag requires updating the spec doc AND this interface in the
// same change; the contract test in __tests__/runtime-capabilities-contract.test.ts
// fails fast if a flag is dropped.

export type CapabilityFlag =
  | "supports_streaming"
  | "supports_resume"
  | "supports_permission_requests"
  | "supports_tool_calls"
  | "supports_usage"
  | "supports_thinking"
  | "supports_attachments"
  | "supports_images"
  | "supports_mcp"
  | "supports_skills"
  | "supports_remote_execution"
  | "supports_structured_events";

export interface RuntimeCapabilities {
  supports_streaming: boolean;
  supports_resume: boolean;
  supports_permission_requests: boolean;
  supports_tool_calls: boolean;
  supports_usage: boolean;
  supports_thinking: boolean;
  supports_attachments: boolean;
  supports_images: boolean;
  supports_mcp: boolean;
  supports_skills: boolean;
  supports_remote_execution: boolean;
  supports_structured_events: boolean;
}

export const CAPABILITY_FLAG_NAMES: readonly CapabilityFlag[] = [
  "supports_streaming",
  "supports_resume",
  "supports_permission_requests",
  "supports_tool_calls",
  "supports_usage",
  "supports_thinking",
  "supports_attachments",
  "supports_images",
  "supports_mcp",
  "supports_skills",
  "supports_remote_execution",
  "supports_structured_events",
] as const;
