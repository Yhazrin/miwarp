#!/usr/bin/env python3
"""Remove unused exports identified by knip's compact reporter."""
import re, sys, os

KNIP_OUTPUT = "/tmp/knip-output.txt"

def parse_knip_output(path):
    """Parse knip compact output -> list of (filepath, [names], is_type)."""
    entries = []
    section = None  # 'exports' or 'types'
    with open(path) as f:
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
                # format: "src/lib/foo.ts: name1, name2, name3"
                parts = line.split(": ", 1)
                filepath = parts[0].strip()
                names = [n.strip() for n in parts[1].split(",")]
                # Filter out parenthesized annotations like "(browserService)"
                names = [re.sub(r'\s*\(.*?\)\s*$', '', n) for n in names]
                entries.append((filepath, names, section == "types"))
    return entries

def remove_export_from_file(filepath, names_to_remove, is_type):
    """Remove `export` keyword for specific named exports in a file."""
    full_path = os.path.join("/root/.openclaw/workspace/miwarp", filepath)
    if not os.path.exists(full_path):
        print(f"  SKIP (not found): {filepath}")
        return 0
    
    with open(full_path) as f:
        content = f.read()
    lines = content.split('\n')
    changes = 0
    
    for i, line in enumerate(lines):
        stripped = line.lstrip()
        indent = line[:len(line) - len(stripped)]
        
        for name in list(names_to_remove):
            # Pattern: export const/function/class/enum/let/var name
            # or: export type { ... name ... }
            # or: export { ... name ... }
            # or: export default name (less common)
            
            # Match: export [type] <kind> name
            patterns = [
                # export const/let/var name = ...
                (rf'^export\s+(const|let|var)\s+{re.escape(name)}\b', None),
                # export function name(...)
                (rf'^export\s+function\s+{re.escape(name)}\b', None),
                # export class name
                (rf'^export\s+class\s+{re.escape(name)}\b', None),
                # export enum name
                (rf'^export\s+enum\s+{re.escape(name)}\b', None),
                # export interface name
                (rf'^export\s+interface\s+{re.escape(name)}\b', None),
                # export type name = ...  (inline type alias)
                (rf'^export\s+type\s+{re.escape(name)}\s*=', None),
                # export type { ... name ... } - re-export
                (rf'^export\s+type\s+\{{([^}}]*){re.escape(name)}([^}}]*)\}}', None),
                # export { ... name ... } - re-export  
                (rf'^export\s+\{{([^}}]*){re.escape(name)}([^}}]*)\}}', None),
            ]
            
            for pattern, _ in patterns:
                if re.match(pattern, stripped):
                    # Remove 'export ' keyword
                    new_line = re.sub(r'^export\s+', '', stripped, count=1)
                    # For 'export default', keep 'default'
                    # For type exports like 'export type Foo = ...', we already handled
                    lines[i] = indent + new_line
                    changes += 1
                    names_to_remove.remove(name)
                    print(f"  REMOVED export: {name} from {filepath}:{i+1}")
                    break
    
    if changes > 0:
        with open(full_path, 'w') as f:
            f.write('\n'.join(lines))
    
    # Report any names we couldn't find
    for name in names_to_remove:
        print(f"  WARN: Could not find export '{name}' in {filepath}")
    
    return changes

def main():
    entries = parse_knip_output(KNIP_OUTPUT)
    total_changes = 0
    
    for filepath, names, is_type in entries:
        print(f"\nProcessing: {filepath} ({len(names)} names, type={is_type})")
        changes = remove_export_from_file(filepath, names, is_type)
        total_changes += changes
    
    print(f"\n=== Total changes: {total_changes} ===")

if __name__ == "__main__":
    main()
