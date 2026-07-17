#!/usr/bin/env python3
"""
Remove unused exports identified by knip.
V4: Correctly preserves identifier names when removing `export` keyword.
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

    # Phase 1: Handle re-export blocks
    i = 0
    while i < len(content):
        m = re.search(r'^(\s*)export\s+(type\s+)?\{', content[i:], re.MULTILINE)
        if not m:
            break

        match_start = i + m.start()
        indent = m.group(1)
        is_type = bool(m.group(2))
        brace_start = i + m.end() - 1

        brace_end = find_matching_brace(content, brace_start)
        if brace_end == -1:
            i = brace_start + 1
            continue

        body = content[brace_start+1:brace_end]
        suffix_match = re.match(r'\s*(from\s+[^;]*;?)', content[brace_end+1:brace_end+200])
        suffix = suffix_match.group(1) if suffix_match else ""
        end_pos = brace_end + 1 + len(suffix)

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
                type_kw = 'type ' if is_type else ''
                new_block = f"{indent}export {type_kw}{{{new_body}}}{suffix}"
                content = content[:match_start] + new_block + content[end_pos:]
                i = match_start + len(new_block)
            else:
                while end_pos < len(content) and content[end_pos] == '\n':
                    end_pos += 1
                content = content[:match_start] + content[end_pos:]
                i = match_start
        else:
            i = brace_end + 1

    # Phase 2: Remove export keyword from standalone declarations
    for name in list(remaining):
        # Try each pattern - order matters (more specific first)
        patterns = [
            # export async function name(
            (rf'^(\s*)export\s+async\s+function\s+(' + re.escape(name) + r')\b',
             r'\1async function \2'),
            # export function name(
            (rf'^(\s*)export\s+function\s+(' + re.escape(name) + r')\b',
             r'\1function \2'),
            # export abstract class name
            (rf'^(\s*)export\s+abstract\s+class\s+(' + re.escape(name) + r')\b',
             r'\1abstract class \2'),
            # export class name
            (rf'^(\s*)export\s+class\s+(' + re.escape(name) + r')\b',
             r'\1class \2'),
            # export enum name
            (rf'^(\s*)export\s+enum\s+(' + re.escape(name) + r')\b',
             r'\1enum \2'),
            # export interface name
            (rf'^(\s*)export\s+interface\s+(' + re.escape(name) + r')\b',
             r'\1interface \2'),
            # export type name<  (generic type)
            (rf'^(\s*)export\s+type\s+(' + re.escape(name) + r')\s*<',
             r'\1type \2'),
            # export type name =
            (rf'^(\s*)export\s+type\s+(' + re.escape(name) + r')\s*=',
             r'\1type \2'),
            # export const name
            (rf'^(\s*)export\s+(const)\s+(' + re.escape(name) + r')\b',
             r'\1\2 \3'),
            # export let name
            (rf'^(\s*)export\s+(let)\s+(' + re.escape(name) + r')\b',
             r'\1\2 \3'),
            # export var name
            (rf'^(\s*)export\s+(var)\s+(' + re.escape(name) + r')\b',
             r'\1\2 \3'),
        ]

        for pattern, replacement in patterns:
            new_content, count = re.subn(pattern, replacement, content, count=1, flags=re.MULTILINE)
            if count > 0:
                content = new_content
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
