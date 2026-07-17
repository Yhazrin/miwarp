#!/usr/bin/env python3
"""Remove unused exports identified by knip compact reporter.
Handles: export const/function/class/enum/interface/type and re-exports.
For re-exports (export { X } / export type { X }), removes just the name.
"""
import re, sys, os

ROOT = "/root/.openclaw/workspace/miwarp"
KNIP_OUTPUT = "/tmp/knip-output.txt"

def parse_knip():
    entries = []
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
            elif line.startswith("Unused files") or line.startswith("Unused ") or line.startswith("Duplicate"):
                section = None
                continue
            if section and ": " in line:
                parts = line.split(": ", 1)
                fp = parts[0].strip()
                names = [re.sub(r'\s*\(.*?\)\s*$', '', n.strip()) for n in parts[1].split(",")]
                entries.append((fp, names, section == "types"))
    return entries

def process_file(filepath, names_set):
    full = os.path.join(ROOT, filepath)
    if not os.path.exists(full):
        print(f"  SKIP not found: {filepath}"); return 0
    with open(full) as f:
        content = f.read()
    original = content
    removed = set()

    for name in sorted(names_set, key=len, reverse=True):
        # 1) export const/let/var name ... -> const/let/var name ...
        pat = rf'^(\s*)export\s+(const|let|var)\s+{re.escape(name)}\b'
        m = re.search(pat, content, re.MULTILINE)
        if m:
            content = content[:m.start()] + m.group(1) + m.group(2) + ' ' + content[m.end():]
            removed.add(name); continue

        # 2) export function name -> function name
        pat = rf'^(\s*)export\s+function\s+{re.escape(name)}\b'
        m = re.search(pat, content, re.MULTILINE)
        if m:
            content = content[:m.start()] + m.group(1) + 'function ' + content[m.end():]
            removed.add(name); continue

        # 3) export class name -> class name
        pat = rf'^(\s*)export\s+class\s+{re.escape(name)}\b'
        m = re.search(pat, content, re.MULTILINE)
        if m:
            content = content[:m.start()] + m.group(1) + 'class ' + content[m.end():]
            removed.add(name); continue

        # 4) export enum name -> enum name
        pat = rf'^(\s*)export\s+enum\s+{re.escape(name)}\b'
        m = re.search(pat, content, re.MULTILINE)
        if m:
            content = content[:m.start()] + m.group(1) + 'enum ' + content[m.end():]
            removed.add(name); continue

        # 5) export interface name -> interface name
        pat = rf'^(\s*)export\s+interface\s+{re.escape(name)}\b'
        m = re.search(pat, content, re.MULTILINE)
        if m:
            content = content[:m.start()] + m.group(1) + 'interface ' + content[m.end():]
            removed.add(name); continue

        # 6) export type name = ... -> type name = ...
        pat = rf'^(\s*)export\s+type\s+{re.escape(name)}\s*='
        m = re.search(pat, content, re.MULTILINE)
        if m:
            content = content[:m.start()] + m.group(1) + 'type ' + content[m.end():]
            removed.add(name); continue

        # 7) export type { ... name ... } -> remove name from the list
        pat = rf'^(\s*)export\s+type\s+\{{([^}}]*)\}}'
        m = re.search(pat, content, re.MULTILINE)
        if m and re.search(r'\b' + re.escape(name) + r'\b', m.group(2)):
            inner = m.group(2)
            # Remove the name from the comma-separated list
            inner = re.sub(r',?\s*' + re.escape(name) + r'\s*,?', ', ', inner)
            inner = re.sub(r'^\s*,\s*', '', inner)
            inner = re.sub(r',\s*$', '', inner)
            inner = inner.strip()
            if inner:
                new_line = m.group(1) + 'export type {' + inner + '}'
            else:
                new_line = m.group(1) + '// removed: ' + name
            content = content[:m.start()] + new_line + content[m.end():]
            removed.add(name); continue

        # 8) export { ... name ... } -> remove name from the list
        pat = rf'^(\s*)export\s+\{{([^}}]*)\}}'
        m = re.search(pat, content, re.MULTILINE)
        if m and re.search(r'\b' + re.escape(name) + r'\b', m.group(2)):
            inner = m.group(2)
            inner = re.sub(r',?\s*' + re.escape(name) + r'\s*,?', ', ', inner)
            inner = re.sub(r'^\s*,\s*', '', inner)
            inner = re.sub(r',\s*$', '', inner)
            inner = inner.strip()
            if inner:
                new_line = m.group(1) + 'export {' + inner + '}'
            else:
                new_line = m.group(1) + '// removed: ' + name
            content = content[:m.start()] + new_line + content[m.end():]
            removed.add(name); continue

        # 9) export type { ... name as alias ... } - with rename
        pat_type_rename = rf'^(\s*)export\s+type\s+\{{([^}}]*)\b' + re.escape(name) + r'\b([^}}]*)\}}'
        m = re.search(pat_type_rename, content, re.MULTILINE)
        if m:
            inner = m.group(2) + m.group(3)
            inner = re.sub(r'^\s*,\s*', '', inner).rstrip(', ')
            new_line = m.group(1) + 'export type {' + inner + '}'
            content = content[:m.start()] + new_line + content[m.end():]
            removed.add(name); continue

    if content != original:
        with open(full, 'w') as f:
            f.write(content)
        print(f"  Modified: {filepath} ({len(removed)}/{len(names_set)} removed)")
        for n in sorted(names_set - removed):
            print(f"    WARN: not found '{n}'")
        return len(removed)
    else:
        print(f"  No changes: {filepath}")
        for n in sorted(names_set):
            print(f"    WARN: not found '{n}'")
        return 0

def main():
    entries = parse_knip()
    total = 0
    for fp, names, is_type in entries:
        print(f"\n[{fp}] ({len(names)} names)")
        total += process_file(fp, set(names))
    print(f"\n=== Done: {total} exports removed ===")

if __name__ == "__main__":
    main()
