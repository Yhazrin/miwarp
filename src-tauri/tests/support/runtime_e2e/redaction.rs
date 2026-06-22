//! Redact sensitive fragments before printing harness diagnostics.

const PROMPT_SUBSTRINGS: &[&str] = &["MIWARP_SMOKE_OK", "Reply with exactly"];

pub fn redact_line(line: &str) -> String {
    let mut out = line.to_string();
    if let Ok(home) = std::env::var("HOME") {
        if !home.is_empty() {
            out = out.replace(&home, "$HOME");
        }
    }
    for needle in PROMPT_SUBSTRINGS {
        out = out.replace(needle, "<smoke-prompt>");
    }
    out = redact_tokens(&out);
    out
}

fn redact_tokens(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut i = 0;
    let bytes = input.as_bytes();
    while i < bytes.len() {
        let slice = &input[i..];
        if let Some(rest) = slice.strip_prefix("sk-") {
            out.push_str("sk-<redacted>");
            i += 3 + rest.len().min(20);
            continue;
        }
        if let Some(rest) = slice.strip_prefix("Bearer ") {
            out.push_str("Bearer <redacted>");
            i += 7 + rest.len().min(24);
            continue;
        }
        if slice.starts_with("MINIMAX_API_KEY=") || slice.starts_with("ANTHROPIC_API_KEY=") {
            out.push_str("<env-var-redacted>");
            while i < bytes.len() && bytes[i] != b'\n' {
                i += 1;
            }
            continue;
        }
        out.push(char::from(bytes[i]));
        i += 1;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_prompt_and_home() {
        let line = format!(
            "{}/projects smoke MIWARP_SMOKE_OK sk-abc123def456",
            std::env::var("HOME").unwrap_or_else(|_| "/Users/test".into())
        );
        let redacted = redact_line(&line);
        assert!(!redacted.contains("MIWARP_SMOKE_OK"));
        assert!(!redacted.contains("sk-abc123def456"));
        assert!(redacted.contains("$HOME") || redacted.contains("/Users/test"));
    }
}
