#!/usr/bin/env node
/**
 * Verify version alignment across npm, Tauri, Rust, iOS, and Android.
 * Exit 1 on mismatch. Run in CI via: npm run version:check
 */

import { readFileSync } from "fs";

const pkg = JSON.parse(readFileSync("package.json", "utf-8"));
const expected = pkg.version;
// Allow pre-release suffixes so release candidates (v1.1.0-rc.1) flow
// through the same alignment gate as 1.1.0.
const versionMatch = expected.match(/^(\d+)\.(\d+)\.(\d+)(?:-rc\.\d+)?$/);

if (!versionMatch) {
  console.error(`Invalid package.json version: ${expected}; expected x.y.z or x.y.z-rc.N`);
  process.exit(1);
}

const [, majorRaw, minorRaw, patchRaw] = versionMatch;
const major = Number(majorRaw);
const minor = Number(minorRaw);
const patch = Number(patchRaw);

if (minor >= 1000 || patch >= 1000) {
  console.error("Minor and patch versions must stay below 1000 for mobile build numbers");
  process.exit(1);
}

const expectedBuild = String(major * 1_000_000 + minor * 1_000 + patch);
const errors = [];

function expectEqual(label, actual, wanted) {
  if (actual !== wanted) {
    errors.push(`${label}: ${actual ?? "missing"} (expected ${wanted})`);
  }
}

function capture(path, pattern, label) {
  const text = readFileSync(path, "utf-8");
  const match = text.match(pattern);
  if (!match) {
    errors.push(`${label}: missing in ${path}`);
    return undefined;
  }
  return match[1];
}

const packageLock = JSON.parse(readFileSync("package-lock.json", "utf-8"));
expectEqual("package-lock.json version", packageLock.version, expected);
expectEqual("package-lock.json root package", packageLock.packages?.[""]?.version, expected);

const tauri = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf-8"));
expectEqual("tauri.conf.json", tauri.version, expected);

expectEqual(
  "Cargo.toml",
  capture("src-tauri/Cargo.toml", /^version = "(.*)"$/m, "Cargo.toml version"),
  expected,
);
expectEqual(
  "Cargo.lock MiWarp",
  capture(
    "src-tauri/Cargo.lock",
    /name = "MiWarp"\r?\nversion = "([^"]*)"/,
    "Cargo.lock MiWarp version",
  ),
  expected,
);

expectEqual(
  "iOS project.yml MARKETING_VERSION",
  capture(
    "apps/ios/MiWarpMobile/project.yml",
    /^\s*MARKETING_VERSION: "([^"]*)"$/m,
    "iOS project.yml MARKETING_VERSION",
  ),
  expected,
);
expectEqual(
  "iOS project.yml CURRENT_PROJECT_VERSION",
  capture(
    "apps/ios/MiWarpMobile/project.yml",
    /^\s*CURRENT_PROJECT_VERSION: "([^"]*)"$/m,
    "iOS project.yml CURRENT_PROJECT_VERSION",
  ),
  expectedBuild,
);

const pbxPath = "apps/ios/MiWarpMobile/MiWarpMobile.xcodeproj/project.pbxproj";
const pbx = readFileSync(pbxPath, "utf-8");
const marketingVersions = [...pbx.matchAll(/MARKETING_VERSION = ([^;]+);/g)].map(
  (match) => match[1],
);
const projectVersions = [...pbx.matchAll(/CURRENT_PROJECT_VERSION = ([^;]+);/g)].map(
  (match) => match[1],
);

if (marketingVersions.length === 0) {
  errors.push(`${pbxPath}: MARKETING_VERSION missing`);
} else {
  for (const value of marketingVersions) {
    expectEqual(`${pbxPath} MARKETING_VERSION`, value, expected);
  }
}
if (projectVersions.length === 0) {
  errors.push(`${pbxPath}: CURRENT_PROJECT_VERSION missing`);
} else {
  for (const value of projectVersions) {
    expectEqual(`${pbxPath} CURRENT_PROJECT_VERSION`, value, expectedBuild);
  }
}

for (const plistPath of [
  "apps/ios/MiWarpMobile/MiWarpMobile/Resources/Info.plist",
  "apps/ios/MiWarpMobile/MiWarpLiveActivityExtension/Info.plist",
  "apps/ios/MiWarpMobile/MiWarpMobileTests/Info.plist",
]) {
  expectEqual(
    `${plistPath} CFBundleShortVersionString`,
    capture(
      plistPath,
      /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]*)<\/string>/m,
      `${plistPath} CFBundleShortVersionString`,
    ),
    expected,
  );
  expectEqual(
    `${plistPath} CFBundleVersion`,
    capture(
      plistPath,
      /<key>CFBundleVersion<\/key>\s*<string>([^<]*)<\/string>/m,
      `${plistPath} CFBundleVersion`,
    ),
    expectedBuild,
  );
}

const androidPath = "apps/android/MiWarpMobile/app/build.gradle.kts";
expectEqual(
  "Android versionName",
  capture(androidPath, /^\s*versionName = "([^"]*)"$/m, "Android versionName"),
  expected,
);
expectEqual(
  "Android versionCode",
  capture(androidPath, /^\s*versionCode = (\d+)$/m, "Android versionCode"),
  expectedBuild,
);

if (errors.length > 0) {
  console.error("Version mismatch:\n");
  for (const error of errors) console.error(`  • ${error}`);
  console.error("\nRun: npm run version:sync");
  process.exit(1);
}

console.log(`✓ All versions aligned at ${expected} (mobile build ${expectedBuild})`);
