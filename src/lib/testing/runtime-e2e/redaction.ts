const PROMPT_FRAGMENTS = ["MIWARP_SMOKE_OK", "Reply with exactly"] as const;

const TOKEN_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{8,}/g,
  /Bearer\s+[A-Za-z0-9._-]+/g,
  /(MINIMAX_API_KEY|ANTHROPIC_API_KEY)=[^\s]+/g,
];

/** Redact user paths, prompts, and credential-like fragments from harness logs. */
export function redactRuntimeE2eLine(line: string, home = process.env.HOME ?? ""): string {
  let out = line;
  if (home) out = out.split(home).join("$HOME");
  for (const fragment of PROMPT_FRAGMENTS) {
    out = out.split(fragment).join("<smoke-prompt>");
  }
  for (const pattern of TOKEN_PATTERNS) {
    out = out.replace(pattern, "<redacted>");
  }
  return out;
}
