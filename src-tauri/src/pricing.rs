/// Model pricing (per million tokens, USD).
pub struct ModelPricing {
    pub input: f64,
    pub output: f64,
    pub cache_read: f64,
    pub cache_write: f64,
}

/// Get pricing for a model. Matches known Claude models, third-party provider models,
/// and falls back to Sonnet pricing for unknown models.
pub fn get_pricing(model: &str) -> ModelPricing {
    // P1-2：在做关键词匹配前先归一化 model ID，避免 `claude-3-5-sonnet-20241022`、
    // `claude-3.5-sonnet`、`anthropic.claude-...` 等风格走错价格档。
    let normalized = normalize_model_id(model);

    // ── Claude models ──
    // Opus 4.5 / 4.6 → $5 / $25
    if normalized.contains("opus-4-6") || normalized.contains("opus-4-5") {
        return claude_pricing(5.0, 25.0);
    }
    // Opus 4.0 / 4.1 (legacy)
    if model.contains("opus") {
        return claude_pricing(15.0, 75.0);
    }
    if model.contains("haiku") {
        return claude_pricing(0.80, 4.0);
    }
    if model.contains("sonnet") {
        return claude_pricing(3.0, 15.0);
    }
    // OpenAI models
    if model.contains("gpt-4o") {
        return claude_pricing(2.5, 10.0);
    }
    if model.contains("gpt-4") {
        return claude_pricing(10.0, 30.0);
    }
    if model.contains("o1") || model.contains("o3") {
        return claude_pricing(15.0, 60.0);
    }

    // ── Third-party provider models ──
    // DeepSeek: deepseek-chat, deepseek-reasoner (V3.2 unified pricing)
    if model.contains("deepseek") {
        return ModelPricing {
            input: 0.28,
            output: 0.42,
            cache_read: 0.028,
            cache_write: 0.28,
        };
    }
    // Kimi / Moonshot
    if model.contains("kimi-k2.5") || model.contains("kimi-k25") {
        return ModelPricing {
            input: 0.60,
            output: 3.0,
            cache_read: 0.10,
            cache_write: 0.60,
        };
    }
    if model.contains("kimi") {
        return ModelPricing {
            input: 0.60,
            output: 2.50,
            cache_read: 0.15,
            cache_write: 0.60,
        };
    }
    // Zhipu GLM
    if model.contains("glm-4.5-flash") || model.contains("glm-4-5-flash") {
        return ModelPricing {
            input: 0.0,
            output: 0.0,
            cache_read: 0.0,
            cache_write: 0.0,
        };
    }
    if model.contains("glm-4.5-air") || model.contains("glm-4-5-air") {
        return ModelPricing {
            input: 0.20,
            output: 1.10,
            cache_read: 0.03,
            cache_write: 0.20,
        };
    }
    if model.contains("glm-4.7") || model.contains("glm-4-7") {
        return ModelPricing {
            input: 0.60,
            output: 2.20,
            cache_read: 0.11,
            cache_write: 0.60,
        };
    }
    // P2-2：GLM-4.6 与 4.7 同一系列，价格按 4.7 估；不要再用 `model.contains("glm")`
    // 兜底——会把 `glm-4.6` / `glm-air` / `glm-zero` / `chatglm` / `my-glm-custom`
    // 全部按 4.7 错误计价，让未知 GLM 模型静默套错档。
    if model.contains("glm-4.6") || model.contains("glm-4-6") {
        return ModelPricing {
            input: 0.60,
            output: 2.20,
            cache_read: 0.11,
            cache_write: 0.60,
        };
    }
    // 未知 GLM 模型（含 glm-air / glm-zero / chatglm 等）继续向下走 Sonnet 默认价，
    // 比静默套 4.7 价更保守，避免把未知档误归到 4.7。
    // Qwen / Bailian (lowest tier pricing)
    if model.contains("qwen3-max") {
        return ModelPricing {
            input: 1.20,
            output: 6.0,
            cache_read: 0.12,
            cache_write: 1.20,
        };
    }
    if model.contains("qwen3.5-plus") || model.contains("qwen35-plus") {
        return ModelPricing {
            input: 0.40,
            output: 2.40,
            cache_read: 0.04,
            cache_write: 0.40,
        };
    }
    if model.contains("qwen-plus") {
        return ModelPricing {
            input: 0.40,
            output: 1.20,
            cache_read: 0.04,
            cache_write: 0.40,
        };
    }
    if model.contains("qwen-flash") || model.contains("qwen") {
        return ModelPricing {
            input: 0.05,
            output: 0.40,
            cache_read: 0.005,
            cache_write: 0.05,
        };
    }
    // DouBao / Volcengine (lowest tier, CNY→USD @ ~7.2)
    if model.contains("doubao") {
        return ModelPricing {
            input: 0.17,
            output: 1.11,
            cache_read: 0.034,
            cache_write: 0.17,
        };
    }
    // MiniMax
    if model.contains("MiniMax-M2.5-highspeed") || model.contains("minimax-m2.5-highspeed") {
        return ModelPricing {
            input: 0.30,
            output: 2.40,
            cache_read: 0.03,
            cache_write: 0.30,
        };
    }
    if model.contains("MiniMax") || model.contains("minimax") {
        return ModelPricing {
            input: 0.30,
            output: 1.20,
            cache_read: 0.03,
            cache_write: 0.30,
        };
    }
    // MiMo / Xiaomi
    if model.contains("mimo") {
        return ModelPricing {
            input: 0.10,
            output: 0.30,
            cache_read: 0.01,
            cache_write: 0.10,
        };
    }

    // Default: Sonnet pricing
    claude_pricing(3.0, 15.0)
}

/// Standard Claude pricing: cache_read = 10% of input, cache_write = 125% of input.
fn claude_pricing(input: f64, output: f64) -> ModelPricing {
    ModelPricing {
        input,
        output,
        cache_read: input * 0.1,
        cache_write: input * 1.25,
    }
}

/// Estimate cost from token counts (input, output, cache read, cache write).
pub fn estimate_cost(
    model: &str,
    input_tokens: u64,
    output_tokens: u64,
    cache_read_tokens: u64,
    cache_write_tokens: u64,
) -> f64 {
    let p = get_pricing(model);
    (input_tokens as f64 * p.input
        + output_tokens as f64 * p.output
        + cache_read_tokens as f64 * p.cache_read
        + cache_write_tokens as f64 * p.cache_write)
        / 1_000_000.0
}

/// P1-2：归一化 model ID，确保不同 provider 风格都映射到一致 key。
///
/// 输入 → 输出示例：
///   "claude-3-5-sonnet-20241022" → "claude-sonnet-3-5"
///   "claude-3.5-sonnet"         → "claude-sonnet-3-5"
///   "claude-sonnet-3-5"         → "claude-sonnet-3-5"
///   "anthropic.claude-3-5-sonnet-20241022-v2:0" → "claude-sonnet-3-5"
///   "gpt-4o-2024-08-06"          → "gpt-4o"
///   "global.anthropic.claude-opus-4-5" → "claude-opus-4-5"
///
/// 规则（按顺序应用）：
///   1) 去掉 `global.` / `anthropic.` 前缀
///   2) 去掉 `:0` / `:N` 这种 bedrock 风格的尾部
///   3) `@` → `-`
///   4) 去掉 `-YYYYMMDD` 风格的日期后缀
///   5) 标准化：`-3-5-sonnet` → `-sonnet-3-5`、`-3.5-sonnet` → `-sonnet-3-5`
///   6) 全部小写
pub fn normalize_model_id(raw: &str) -> String {
    let mut s = raw.trim().to_lowercase();

    // 1) 去掉 provider 前缀
    for prefix in ["global.anthropic.", "anthropic."] {
        if let Some(rest) = s.strip_prefix(prefix) {
            s = rest.to_string();
        }
    }

    // 2) 去掉 bedrock 风格尾部 ":N"
    if let Some(idx) = s.find(':') {
        s.truncate(idx);
    }

    // 3) @ → -
    s = s.replace('@', "-");

    // 3.5) 版本号里的点号转成短横线：claude-3.5-sonnet → claude-3-5-sonnet
    //     只在数字 + 点 + 数字的位置做替换，避免误伤其它 `.`。
    let mut normalized = String::with_capacity(s.len());
    let chars: Vec<char> = s.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if i + 2 < chars.len()
            && chars[i].is_ascii_digit()
            && chars[i + 1] == '.'
            && chars[i + 2].is_ascii_digit()
        {
            normalized.push(chars[i]);
            normalized.push('-');
            i += 2; // 跳过数字 + 点，下一轮 push 数字
            continue;
        }
        normalized.push(chars[i]);
        i += 1;
    }
    s = normalized;

    // 4) 先去掉 bedrock 风格的版本尾巴 `-vN+`（如 `claude-3-5-sonnet-20241022-v2` → `-20241022`）
    if let Some(idx) = s.rfind("-v") {
        if idx > 0 && s[idx + 2..].chars().all(|c| c.is_ascii_digit()) {
            s.truncate(idx);
        }
    }

    // 4b) 去掉日期后缀（-YYYYMMDD 或 -YYYY-MM-DD）
    let date_idx = find_date_suffix_index(&s);
    if date_idx < s.len() && date_idx > 0 {
        s.truncate(date_idx - 1);
    }

    // 5) Claude 系列：把 family 提到末尾（如 `claude-3-5-sonnet` → `claude-sonnet-3-5`）
    // 规则：claude-<name>-<major>... → claude-<major>...-<name> 倒过来
    if s.starts_with("claude-") {
        let parts: Vec<&str> = s.split('-').collect();
        // 找 name 段：第一个非数字 / 非空格的段（在 `claude-` 之后）
        // 命名分两种：
        //   A) claude-<major>-<minor>-<name> → claude-<name>-<major>-<minor>
        //   B) claude-<name>-<major>-<minor>... → 不动（已是目标格式）
        //   C) claude-<major>-<name> → claude-<name>-<major>
        // 区分 B 和 A 的关键：第 2 段是不是数字（major 一定是数字）
        if parts.len() >= 3 {
            let second_is_num = parts[1].chars().all(|c| c.is_ascii_digit());
            if second_is_num && parts.len() == 4 {
                // 形如 claude-3-5-sonnet
                return format!("{}-{}-{}-{}", parts[0], parts[3], parts[1], parts[2]);
            }
            if second_is_num && parts.len() == 3 {
                // 形如 claude-3-sonnet
                return format!("{}-{}-{}", parts[0], parts[2], parts[1]);
            }
            // 否则已经是 claude-<name>-... 形式，不动
        }
    }

    // 6) OpenAI 系列：gpt-4o-2024-08-06 → gpt-4o
    if s.starts_with("gpt-") {
        // 去掉第一个看起来像日期的后缀（-YYYY-MM-DD / -YYYYMMDD）
        let idx = find_date_suffix_index(&s);
        if idx < s.len() {
            s.truncate(idx);
        }
    }

    s
}

/// 查找末尾日期后缀（-YYYY-MM-DD / -YYYYMMDD）中数字部分的起始 index，
/// 也就是紧跟分隔符 `-` 之后的位置。找不到返回 s.len()。
fn find_date_suffix_index(s: &str) -> usize {
    let bytes = s.as_bytes();
    let n = bytes.len();
    if n < 9 {
        return n;
    }

    // 情形 A：末尾 `-YYYYMMDD`（8 位全数字，前面是 `-`），数字起点 = n-8
    if bytes[n - 8..n].iter().all(|b| b.is_ascii_digit()) && bytes[n - 9] == b'-' {
        return n - 8;
    }

    // 情形 B：末尾 `-YYYY-MM-DD`，数字起点 = n-10
    if n >= 10
        && bytes[n - 2..n].iter().all(|b| b.is_ascii_digit())
        && bytes[n - 3] == b'-'
        && bytes[n - 5..n - 3].iter().all(|b| b.is_ascii_digit())
        && bytes[n - 6] == b'-'
        && bytes[n - 10..n - 6].iter().all(|b| b.is_ascii_digit())
    {
        return n - 10;
    }

    n
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_anthropic_dated() {
        assert_eq!(
            normalize_model_id("claude-3-5-sonnet-20241022"),
            "claude-sonnet-3-5"
        );
    }

    #[test]
    fn normalize_anthropic_dot_version() {
        assert_eq!(normalize_model_id("claude-3.5-sonnet"), "claude-sonnet-3-5");
    }

    #[test]
    fn normalize_anthropic_bedrock_style() {
        assert_eq!(
            normalize_model_id("anthropic.claude-3-5-sonnet-20241022-v2:0"),
            "claude-sonnet-3-5"
        );
    }

    #[test]
    fn normalize_global_prefix() {
        assert_eq!(
            normalize_model_id("global.anthropic.claude-opus-4-5"),
            "claude-opus-4-5"
        );
    }

    #[test]
    fn normalize_opus_4() {
        assert_eq!(
            normalize_model_id("claude-opus-4-1-20250514"),
            "claude-opus-4-1"
        );
    }

    #[test]
    fn normalize_gpt_dated() {
        assert_eq!(normalize_model_id("gpt-4o-2024-08-06"), "gpt-4o");
    }

    #[test]
    fn normalize_hyphen_to_dash() {
        assert_eq!(normalize_model_id("foo@bar"), "foo-bar");
    }

    #[test]
    fn normalize_already_canonical_unchanged() {
        assert_eq!(normalize_model_id("claude-sonnet-3-5"), "claude-sonnet-3-5");
        assert_eq!(normalize_model_id("gpt-4o"), "gpt-4o");
    }

    // ── P2-2：GLM 匹配限制已知系列，不再用 `model.contains("glm")` 兜底 ──

    /// 已知的 GLM-4.5 flash → ¥0（免费）
    #[test]
    fn p2_2_glm_4_5_flash_free() {
        let p = get_pricing("glm-4.5-flash");
        assert_eq!(p.input, 0.0);
        assert_eq!(p.output, 0.0);
    }

    /// 已知的 GLM-4.5 air → 0.20/1.10
    #[test]
    fn p2_2_glm_4_5_air_pricing() {
        let p = get_pricing("glm-4.5-air");
        assert_eq!(p.input, 0.20);
        assert_eq!(p.output, 1.10);
    }

    /// 已知的 GLM-4.7 → 0.60/2.20
    #[test]
    fn p2_2_glm_4_7_pricing() {
        let p = get_pricing("glm-4.7");
        assert_eq!(p.input, 0.60);
        assert_eq!(p.output, 2.20);
    }

    /// GLM-4.6 → 4.7 同系列价
    #[test]
    fn p2_2_glm_4_6_pricing_matches_4_7() {
        let p = get_pricing("glm-4.6");
        assert_eq!(p.input, 0.60);
        assert_eq!(p.output, 2.20);
    }

    /// 未知 GLM 模型（glm-air / glm-zero / chatglm）→ 不再静默套 4.7 价，
    /// 而是落到默认 Sonnet 价。输入/输出与 GLM-4.7 不同，说明没有走错分支。
    #[test]
    fn p2_2_unknown_glm_falls_back_to_default() {
        let unknown_glm = get_pricing("glm-air");
        let glm_4_7 = get_pricing("glm-4.7");
        // 关键断言：未知 GLM 不应再得到 GLM-4.7 价格
        assert_ne!(unknown_glm.input, glm_4_7.input);
        // 默认价是 Sonnet 3.0 / 15.0
        assert_eq!(unknown_glm.input, 3.0);
        assert_eq!(unknown_glm.output, 15.0);
    }

    /// chatglm 这种含 glm 子串但完全不是 GLM-4.x 的模型也要落到默认价
    #[test]
    fn p2_2_chatglm_falls_back_to_default() {
        let p = get_pricing("chatglm-6b");
        assert_eq!(p.input, 3.0);
        assert_eq!(p.output, 15.0);
    }
}
