//! Parse remote markdown into SKILL.md payloads + stable content hashes.
use serde::Deserialize;
use sha2::{Digest, Sha256};

#[derive(Clone, Copy, PartialEq)]
pub enum SkillParserMode {
    Strict,
    Loose,
}

#[derive(Clone)]
pub enum ParsedSkillOutcome {
    Ok(ParsedRemoteSkill),
    Skipped(String),
}

#[derive(Clone)]
pub struct ParsedRemoteSkill {
    pub name: String,
    pub description: String,
    pub category: String,
    pub tags: Vec<String>,
    pub content_hash: String,
    /// Full SKILL.md file (YAML frontmatter + body) for persistence.
    pub full_skill_md: String,
}

#[derive(Debug, Deserialize, Default)]
struct FmYaml {
    miwarp_skill: Option<bool>,
    name: Option<String>,
    description: Option<String>,
    category: Option<String>,
    #[serde(default)]
    tags: Option<Vec<String>>,
    icon: Option<String>,
}

pub fn content_hash_normalized(markdown: &str) -> String {
    let normalized = markdown.replace('\r', "").trim().to_string();
    let mut h = Sha256::new();
    h.update(normalized.as_bytes());
    format!("{:x}", h.finalize())
}

pub fn parse_skill_markdown(
    markdown: &str,
    fallback_title: String,
    remote_id: String,
    remote_url: &str,
    mode: SkillParserMode,
) -> Result<ParsedSkillOutcome, String> {
    let hash = content_hash_normalized(markdown);
    match mode {
        SkillParserMode::Strict => strict_parse(
            markdown,
            &fallback_title,
            remote_id.as_str(),
            remote_url,
            hash,
        ),
        SkillParserMode::Loose => Ok(loose_parse(
            markdown,
            &fallback_title,
            remote_id.as_str(),
            remote_url,
            hash,
        )),
    }
}

fn strict_parse(
    markdown: &str,
    fallback_title: &str,
    remote_id: &str,
    _remote_url: &str,
    hash: String,
) -> Result<ParsedSkillOutcome, String> {
    let Some((yaml_block, body)) = split_yaml_frontmatter(markdown) else {
        return Ok(ParsedSkillOutcome::Skipped(
            "strict: missing YAML frontmatter".into(),
        ));
    };

    let fm: FmYaml = serde_yaml::from_str(yaml_block).unwrap_or_default();
    if fm.miwarp_skill != Some(true) {
        return Ok(ParsedSkillOutcome::Skipped(
            "strict: miwarp_skill is not true".into(),
        ));
    }

    let name = fm
        .name
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| slug_from_remote(remote_id, fallback_title));
    let description = fm
        .description
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| loose_first_paragraph(body));
    let category = map_category(fm.category.as_deref());
    let tags = fm.tags.unwrap_or_default();

    let full_skill_md = build_skill_file(
        &name,
        &description,
        Some(&category),
        &tags,
        fm.icon.as_deref(),
        body,
    );

    Ok(ParsedSkillOutcome::Ok(ParsedRemoteSkill {
        name,
        description,
        category,
        tags,
        content_hash: hash,
        full_skill_md,
    }))
}

fn loose_parse(
    markdown: &str,
    fallback_title: &str,
    remote_id: &str,
    remote_url: &str,
    hash: String,
) -> ParsedSkillOutcome {
    if let Ok(ParsedSkillOutcome::Ok(ok)) = strict_parse(
        markdown,
        fallback_title,
        remote_id,
        remote_url,
        hash.clone(),
    ) {
        return ParsedSkillOutcome::Ok(ok);
    }

    let name =
        markdown_title(markdown).unwrap_or_else(|| slug_from_remote(remote_id, fallback_title));
    let description = loose_first_paragraph(markdown);
    let category: String = "custom".into();
    let tags: Vec<String> = vec![];
    let body = markdown.trim();
    let full_skill_md = build_skill_file(
        &name,
        &description,
        Some(category.as_str()),
        &tags,
        None,
        body,
    );

    ParsedSkillOutcome::Ok(ParsedRemoteSkill {
        name,
        description,
        category,
        tags,
        content_hash: hash,
        full_skill_md,
    })
}

fn slug_from_remote(remote_id: &str, title: &str) -> String {
    let raw = remote_id
        .rsplit(|c| c == '/' || c == ':')
        .next()
        .unwrap_or(remote_id)
        .to_lowercase()
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' {
                c
            } else {
                '-'
            }
        })
        .collect::<String>();
    let raw = raw.trim_matches('-').to_string();
    if raw.is_empty() {
        slugify_hint(title)
    } else {
        raw
    }
}

fn slugify_hint(s: &str) -> String {
    let t = s
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == ' ' || *c == '-')
        .collect::<String>();
    let t = t
        .split_whitespace()
        .take(6)
        .collect::<Vec<_>>()
        .join("-")
        .to_lowercase();
    if t.is_empty() {
        "remote-skill".into()
    } else {
        t
    }
}

fn markdown_title(md: &str) -> Option<String> {
    for line in md.lines() {
        let t = line.trim();
        let t = if let Some(r) = t.strip_prefix('#') {
            r.trim().trim_start_matches('#').trim().to_string()
        } else {
            continue;
        };
        if !t.is_empty() {
            return Some(slugify_hint(&t).replace('_', "-"));
        }
    }
    None
}

fn loose_first_paragraph(md: &str) -> String {
    let body = strip_leading_heading(md);
    let stripped = body.trim_start();
    for block in stripped.split("\n\n") {
        let p = block.trim().split('\n').next().unwrap_or("").trim();
        if !p.starts_with('#') && !p.is_empty() && p.len() < 420 {
            return p.to_string();
        }
        if !p.is_empty() {
            break;
        }
    }
    stripped
        .lines()
        .take(3)
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string()
}

fn strip_leading_heading(md: &str) -> String {
    let mut lines = md.lines();
    if let Some(first) = lines.next() {
        if first.trim().starts_with('#') {
            lines.collect::<Vec<_>>().join("\n")
        } else {
            md.to_string()
        }
    } else {
        md.to_string()
    }
}

fn split_yaml_frontmatter(doc: &str) -> Option<(&str, &str)> {
    let trimmed = doc.trim_start();
    if !trimmed.starts_with("---") {
        return None;
    }
    let after = trimmed.strip_prefix("---").unwrap_or(trimmed);
    let after = if let Some(r) = after.strip_prefix('\n') {
        r
    } else if let Some(r) = after.strip_prefix("\r\n") {
        r
    } else {
        ""
    };

    let end = after.find("\n---")?;
    let (_, rest) = after.split_at(end);
    let body = rest
        .strip_prefix("\n---")
        .or_else(|| rest.strip_prefix("\r\n---"))?;

    let body = body
        .strip_prefix('\n')
        .or_else(|| body.strip_prefix('\r'))
        .unwrap_or(body)
        .trim_start();

    let yaml_only = after[..end].trim_end();
    Some((yaml_only, body))
}

fn map_category(cat: Option<&str>) -> String {
    let Some(raw) = cat
        .map(|s| s.trim().to_lowercase())
        .filter(|s| !s.is_empty())
    else {
        return "custom".into();
    };
    match raw.as_str() {
        "productivity" => "productivity".into(),
        "development" | "dev" => "development".into(),
        "automation" => "automation".into(),
        "memory" => "memory".into(),
        "organization" | "organisation" => "organization".into(),
        "integrations" | "integration" => "integrations".into(),
        "custom" => "custom".into(),
        _ => "custom".into(),
    }
}

fn build_skill_file(
    name: &str,
    description: &str,
    category: Option<&str>,
    tags: &[String],
    icon: Option<&str>,
    body: &str,
) -> String {
    let mut fm = vec![
        format!("miwarp_skill: true"),
        format!("name: \"{}\"", name.replace('\"', "'")),
        format!("description: \"{}\"", description.replace('\"', "'")),
        format!("source: \"feishu\""),
    ];
    if let Some(c) = category {
        fm.push(format!("category: \"{}\"", c.replace('\"', "'")));
    }
    if let Some(ic) = icon {
        fm.push(format!("icon: \"{}\"", ic.replace('\"', "'")));
    }
    if !tags.is_empty() {
        let joined = tags
            .iter()
            .map(|t| serde_json::to_string(t).unwrap_or_else(|_| format!("{:?}", t)))
            .collect::<Vec<_>>()
            .join(", ");
        fm.push(format!("tags: [{}]", joined));
    }
    format!("---\n{}\n---\n\n{}", fm.join("\n"), body.trim())
}
