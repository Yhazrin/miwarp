#!/usr/bin/env python3
"""
Remove unused exports identified by knip.
V5: Simple 'export ' prefix removal + re-export block handling.
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
    for i in range(start, len(content)):
        if content[i] == '{': depth += 1
        elif content[i] == '}':
            depth -= 1
            if depth == 0: return i
    return -1

def process_file(filepath, unused_names):
    full = os.path.join(ROOT, filepath)
    if not os.path.exists(full):
        print(f"  SKIP not found: {filepath}"); return 0

    with open(full) as f:
        content = f.read()
    original = content
    removed = set()
    remaining = set(unused_names)

    # Phase 1: Handle re-export blocks (export { X, Y } / export type { X, Y })
    i = 0
    while i < len(content):
        m = re.search(r'^(\s*)export\s+(type\s+)?\{', content[i:], re.MULTILINE)
        if not m: break
        match_start = i + m.start()
        indent, is_type = m.group(1), bool(m.group(2))
        brace_start = i + m.end() - 1
        brace_end = find_matching_brace(content, brace_start)
        if brace_end == -1:
            i = brace_start + 1; continue
        body = content[brace_start+1:brace_end]
        suffix_m = re.match(r'\s*(from\s+[^;]*;?)', content[brace_end+1:brace_end+200])
        suffix = suffix_m.group(1) if suffix_m else ""
        end_pos = brace_end + 1 + len(suffix)

        parts = [p.strip() for p in body.split(',') if p.strip()]
        new_parts = []
        for p in parts:
            nm = re.match(r'^(?:type\s+)?(\w+)', p)
            if nm and nm.group(1) in remaining:
                removed.add(nm.group(1)); remaining.discard(nm.group(1))
                print(f"    Removed '{nm.group(1)}' from re-export")
            else:
                new_parts.append(p)

        if len(new_parts) < len(parts):  # something was removed
            if new_parts:
                new_body = ', '.join(p.strip() for p in new_parts)
                tk = 'type ' if is_type else ''
                new_block = f"{indent}export {tk}{{{new_body}}}{suffix}"
                content = content[:match_start] + new_block + content[end_pos:]
                i = match_start + len(new_block)
            else:
                e = end_pos
                while e < len(content) and content[e] == '\n': e += 1
                content = content[:match_start] + content[e:]
                i = match_start
        else:
            i = brace_end + 1

    # Phase 2: For each remaining name, find its declaration line and strip "export "
    lines = content.split('\n')
    for name in list(remaining):
        # Pattern: the line starts with optional whitespace, then "export ", then something, then the name
        # We need to find a line where "export" is followed by a declaration containing our name
        for li, line in enumerate(lines):
            stripped = line.lstrip()
            indent = line[:len(line)-len(stripped)]
            
            # Check if this line has "export" and our name
            if not stripped.startswith('export '):
                continue
            if name not in stripped:
                continue
            
            # Now verify this is a declaration of `name` (not just a reference)
            # After "export ", the name should appear as a declaration target
            after_export = stripped[7:]  # remove "export "
            
            # Check for various declaration patterns
            found = False
            for prefix in ['async function ', 'function ', 'abstract class ', 'class ',
                          'enum ', 'interface ']:
                if after_export.startswith(prefix) and re.search(r'\b' + re.escape(name) + r'\b', after_export[len(prefix):len(prefix)+len(name)+5]):
                    # Verify it's exactly this name being declared
                    rest = after_export[len(prefix):]
                    if re.match(re.escape(name) + r'\b', rest):
                        lines[li] = indent + after_export
                        removed.add(name); remaining.discard(name)
                        print(f"    Removed export: {name}")
                        found = True; break
            
            if found: break
            
            # Check for "export type Name" or "export const/let/var Name"
            for kw in ['type ', 'const ', 'let ', 'var ']:
                if after_export.startswith(kw):
                    rest = after_export[len(kw):]
                    if re.match(re.escape(name) + r'\b', rest):
                        lines[li] = indent + after_export
                        removed.add(name); remaining.discard(name)
                        print(f"    Removed export: {name}")
                        found = True; break
            if found: break

    content = '\n'.join(lines)
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
