#!/usr/bin/env python3
"""
Remove unused exports identified by knip.
V3: Correctly handles multi-line re-export blocks by parsing brace matching.
"""
import re, os

ROOT = "/root/.openclaw/workspace/miwarp"
KNIP_OUTPUT = "/tmp/knip-output.txt"

def parse_knip():
    entries = {}
    section = None
    with open(KNIP_OUTPUT) as f:
        for line in f:
            line = line.rstrip()
            if line.startswith("Unused exports"):
                section = "exports"
                continue
            elif line.startswith("Unused exported types"):
                section = "types"
                continue
            elif line.startswith("Unused ") or line.startswith("Duplicate"):
                section = None
                continue
            if section and ": " in line:
                parts = line.split(": ", 1)
                fp = parts[0].strip()
                names = [re.sub(r'\s*\(.*?\)\s*$', '', n.strip()) for n in parts[1].split(",")]
                if fp not in entries:
                    entries[fp] = set()
                entries[fp].update(names)
    return entries

def find_matching_brace(content, start):
    """Find the position of the closing brace matching the opening brace at `start`."""
    depth = 0
    i = start
    while i < len(content):
        if content[i] == '{':
            depth += 1
        elif content[i] == '}':
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return -1

def process_file(filepath, unused_names):
    full = os.path.join(ROOT, filepath)
    if not os.path.exists(full):
        print(f"  SKIP not found: {filepath}")
        return 0
    
    with open(full) as f:
        content = f.read()
    
    original = content
    removed = set()
    remaining = set(unused_names)
    
    # Phase 1: Handle re-export blocks (export { ... } and export type { ... })
    # These can span multiple lines
    
    i = 0
    while i < len(content):
        # Look for "export " or "export type " followed by "{"
        m = re.search(r'^(\s*)export\s+(type\s+)?\{', content[i:], re.MULTILINE)
        if not m:
            break
        
        match_start = i + m.start()
        indent = m.group(1)
        is_type = bool(m.group(2))
        brace_start = i + m.end() - 1  # position of the opening {
        
        brace_end = find_matching_brace(content, brace_start)
        if brace_end == -1:
            i = brace_end + 1 if brace_end != -1 else len(content)
            continue
        
        # Extract the body between { and }
        body = content[brace_start+1:brace_end]
        
        # Check for "from ..." suffix
        suffix_match = re.match(r'\s*(from\s+[^;]*;?)', content[brace_end+1:brace_end+100])
        suffix = suffix_match.group(1) if suffix_match else ""
        
        # Parse names from body
        parts = [p.strip() for p in body.split(',') if p.strip()]
        new_parts = []
        block_removed = set()
        
        for p in parts:
            name_match = re.match(r'^(?:type\s+)?(\w+)', p)
            if name_match and name_match.group(1) in remaining:
                block_removed.add(name_match.group(1))
                remaining.discard(name_match.group(1))
                print(f"    Removed '{name_match.group(1)}' from re-export")
            else:
                new_parts.append(p)
        
        if block_removed:
            removed.update(block_removed)
            if new_parts:
                new_body = ', '.join(p.strip() for p in new_parts)
                # Reconstruct
                type_kw = 'type ' if is_type else ''
                new_block = f"{indent}export {type_kw}{{{new_body}}}{suffix}"
                end_pos = brace_end + 1 + len(suffix)
                content = content[:match_start] + new_block + content[end_pos:]
                i = match_start + len(new_block)
            else:
                # Remove entire block
                end_pos = brace_end + 1 + len(suffix)
                # Also remove trailing newline
                while end_pos < len(content) and content[end_pos] == '\n':
                    end_pos += 1
                content = content[:match_start] + content[end_pos:]
                i = match_start
        else:
            i = brace_end + 1
    
    # Phase 2: Remove export keyword from standalone declarations
    for name in list(remaining):
        # Match export declarations (not inside re-export blocks)
        # Must be at the start of a line
        patterns = [
            (rf'^(\s*)export\s+(async\s+)function\s+{re.escape(name)}\b',
             lambda m: m.group(1) + (m.group(2) or '') + 'function '),
            (rf'^(\s*)export\s+(abstract\s+)class\s+{re.escape(name)}\b',
             lambda m: m.group(1) + (m.group(2) or '') + 'class '),
            (rf'^(\s*)export\s+enum\s+{re.escape(name)}\b',
             lambda m: m.group(1) + 'enum '),
            (rf'^(\s*)export\s+interface\s+{re.escape(name)}\b',
             lambda m: m.group(1) + 'interface '),
            # export type Name (not generic, not in braces)
            (rf'^(\s*)export\s+type\s+{re.escape(name)}\b(?!\s*<)(?!\s*\{{)',
             lambda m: m.group(1) + 'type '),
            # export type Name<...>  (generic type)
            (rf'^(\s*)export\s+type\s+{re.escape(name)}\s*<',
             lambda m: m.group(1) + 'type '),
            (rf'^(\s*)export\s+(const|let|var)\s+{re.escape(name)}\b',
             lambda m: m.group(1) + m.group(2) + ' '),
        ]
        
        for pattern, replacement_fn in patterns:
            m = re.search(pattern, content, re.MULTILINE)
            if m:
                new_line = replacement_fn(m)
                content = content[:m.start()] + new_line + content[m.end():]
                removed.add(name)
                remaining.discard(name)
                print(f"    Removed export from declaration: {name}")
                break
    
    # Clean up
    content = re.sub(r'\n{3,}', '\n\n', content)
    
    if content != original:
        with open(full, 'w') as f:
            f.write(content)
        print(f"  Modified: {filepath} ({len(removed)}/{len(unused_names)} removed)")
    
    for n in remaining:
        print(f"    WARN: not found '{n}'")
    
    return len(removed)

def main():
    entries = parse_knip()
    total = 0
    for fp, names in sorted(entries.items()):
        print(f"\n[{fp}] ({len(names)} names)")
        total += process_file(fp, names)
    print(f"\n=== Done: {total} exports removed ===")

if __name__ == "__main__":
    main()
