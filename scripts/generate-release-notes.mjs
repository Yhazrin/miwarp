#!/usr/bin/env node
/**
 * Print release notes markdown from conventional commits since the last git tag.
 *
 * Usage:
 *   npm run release:notes              # since latest tag
 *   npm run release:notes -- v1.0.3    # since specific tag
 */

import { execSync } from "child_process";
import { readFileSync } from "fs";

const pkg = JSON.parse(readFileSync("package.json", "utf-8"));
const version = pkg.version;

let since = process.argv[2];
if (!since) {
  try {
    since = execSync("git describe --tags --abbrev=0", { encoding: "utf-8" }).trim();
  } catch {
    since = "";
  }
}

const range = since ? `${since}..HEAD` : "HEAD";
let log = "";
try {
  log = execSync(`git log ${range} --pretty=format:%s`, { encoding: "utf-8" });
} catch {
  console.error("Could not read git log");
  process.exit(1);
}

const lines = log.split("\n").filter(Boolean);
const groups = {
  feat: [],
  fix: [],
  perf: [],
  chore: [],
  other: [],
};

for (const line of lines) {
  const m = line.match(/^(\w+)(?:\([^)]+\))?!?:\s*(.+)$/);
  if (!m) {
    groups.other.push(line);
    continue;
  }
  const [, type, msg] = m;
  if (type === "feat") groups.feat.push(msg);
  else if (type === "fix") groups.fix.push(msg);
  else if (type === "perf") groups.perf.push(msg);
  else if (type === "chore") groups.chore.push(msg);
  else groups.other.push(line);
}

function section(title, items) {
  if (!items.length) return "";
  return `### ${title}\n${items.map((i) => `- ${i}`).join("\n")}\n\n`;
}

const parts = [`## MiWarp v${version}`, ""];
for (const block of [
  section("Features", groups.feat),
  section("Fixes", groups.fix),
  section("Performance", groups.perf),
  section("Maintenance", groups.chore),
  section("Other", groups.other),
]) {
  if (block) parts.push(block);
}
parts.push("### Install", "", "Download from [GitHub Releases](https://github.com/Yhazrin/miwarp/releases).", "");

console.log(parts.join("\n"));
