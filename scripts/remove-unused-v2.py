#!/usr/bin/env python3
"""
Remove unused exports identified by knip.
V2: Properly handles multi-line re-exports and avoids breaking syntax.
"""
import re, os, json

ROOT = "/root/.openclaw/workspace/miwarp"
KNIP_OUTPUT = "/tmp/knip-output.txt"

def parse_knip():
    """Parse knip compact output into {filepath: {names, is_type}}."""
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
    
    # Strategy 1: Remove individual names from re-export blocks
    # Handle both single-line and multi-line export { ... } and export type { ... }
    
    def remove_from_reexport(match):
        nonlocal removed, remaining
        full_match = match.group(0)
        indent = match.group(1) or ""
        type_kw = match.group(2) or ""
        body = match.group(3)
        suffix = match.group(4) or ""
        
        # Parse names from the body
        # Handle: name, name as alias, type name
        parts = []
        for p in body.split(','):
            p = p.strip()
            if p:
                parts.append(p)
        
        new_parts = []
        for p in parts:
            # Extract the actual exported name
            # Patterns: "name", "name as alias", "type name", "type name as alias"
            name_match = re.match(r'^(?:type\s+)?(\w+)', p)
            if name_match:
                name = name_match.group(1)
                if name in remaining:
                    removed.add(name)
                    remaining.discard(name)
                    print(f"    Removed '{name}' from re-export")
                    continue
            new_parts.append(p)
        
        if new_parts:
            new_body = ', '.join(new_parts)
            return f"{indent}export {type_kw}{{{new_body}}}{suffix}"
        else:
            # Entire block removed - return empty
            return ""
    
    # Match multi-line export { ... } blocks
    def replace_reexport_blocks(text):
        # Match export type { ... } from "..." (possibly multi-line)
        pattern = r'^(\s*)export\s+(type\s+)?\{([^}]+)\}(\s+from\s+[^;]*;?)\s*$'
        return re.sub(pattern, remove_from_reexport, text, flags=re.MULTILINE)
    
    content = replace_reexport_blocks(content)
    
    # Strategy 2: Remove export keyword from standalone declarations
    # Only for names that are still in `remaining`
    
    for name in list(remaining):
        # export const/let/var name
        patterns = [
            (rf'^(\s*)export\s+(async\s+)?function\s+' + re.escape(name) + r'\b', 
             lambda m: m.group(1) + (m.group(2) or '') + 'function '),
            (rf'^(\s*)export\s+(abstract\s+)?class\s+' + re.escape(name) + r'\b',
             lambda m: m.group(1) + (m.group(2) or '') + 'class '),
            (rf'^(\s*)export\s+enum\s+' + re.escape(name) + r'\b',
             lambda m: m.group(1) + 'enum '),
            (rf'^(\s*)export\s+interface\s+' + re.escape(name) + r'\b',
             lambda m: m.group(1) + 'interface '),
            (rf'^(\s*)export\s+type\s+' + re.escape(name) + r'\s*[=<]',
             lambda m: m.group(1) + 'type '),
            (rf'^(\s*)export\s+(const|let|var)\s+' + re.escape(name) + r'\b',
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
    
    # Clean up empty lines from removed re-export blocks
    content = re.sub(r'\n\s*\n\s*\n', '\n\n', content)
    
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
