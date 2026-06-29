#!/usr/bin/env node
/**
 * Sync the release version from package.json across desktop, Rust, iOS, and Android.
 *
 * Single source of truth: package.json
 * Mobile build number: major * 1_000_000 + minor * 1_000 + patch.
 */

import { readFileSync, writeFileSync } from "fs";

const pkg = JSON.parse(readFileSync("package.json", "utf-8"));
const version = pkg.version;
// Allow pre-release suffixes for release candidates (v1.1.0-rc.1).
const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-rc\.\d+)?$/);

if (!match) {
  throw new Error(`Unsupported release version "${version}"; expected x.y.z or x.y.z-rc.N`);
}

const [, majorRaw, minorRaw, patchRaw] = match;
const major = Number(majorRaw);
const minor = Number(minorRaw);
const patch = Number(patchRaw);

if (minor >= 1000 || patch >= 1000) {
  throw new Error("Minor and patch versions must stay below 1000 for mobile build numbers");
}

const buildNumber = major * 1_000_000 + minor * 1_000 + patch;

function writeJsonIfChanged(path, mutate) {
  const currentText = readFileSync(path, "utf-8");
  const value = JSON.parse(currentText);
  mutate(value);
  const nextText = `${JSON.stringify(value, null, 2)}\n`;
  if (nextText !== currentText) {
    writeFileSync(path, nextText);
    console.log(`  ✓ ${path} → ${version}`);
  }
}

function updateTextFile(path, replacements, displayValue = version) {
  const current = readFileSync(path, "utf-8");
  let next = current;

  for (const { pattern, replacement, label } of replacements) {
    pattern.lastIndex = 0;
    if (!pattern.test(next)) {
      throw new Error(`Unable to find ${label} in ${path}`);
    }
    pattern.lastIndex = 0;
    next = next.replace(pattern, replacement);
  }

  if (next !== current) {
    writeFileSync(path, next);
    console.log(`  ✓ ${path} → ${displayValue}`);
  }
}

// npm lock metadata
writeJsonIfChanged("package-lock.json", (lock) => {
  lock.version = version;
  if (!lock.packages?.[""]) {
    throw new Error("package-lock.json is missing the root package entry");
  }
  lock.packages[""].version = version;
});

// Tauri desktop metadata
writeJsonIfChanged("src-tauri/tauri.conf.json", (tauri) => {
  tauri.version = version;
});

updateTextFile("src-tauri/Cargo.toml", [
  {
    pattern: /^version = ".*"$/m,
    replacement: `version = "${version}"`,
    label: "package version",
  },
]);

updateTextFile("src-tauri/Cargo.lock", [
  {
    pattern: /(name = "MiWarp"\r?\nversion = )"[^"]*"/,
    replacement: `$1"${version}"`,
    label: "MiWarp package version",
  },
]);

// iOS source spec and generated Xcode project
updateTextFile(
  "apps/ios/MiWarpMobile/project.yml",
  [
    {
      pattern: /^\s*MARKETING_VERSION: ".*"$/m,
      replacement: `    MARKETING_VERSION: "${version}"`,
      label: "MARKETING_VERSION",
    },
    {
      pattern: /^\s*CURRENT_PROJECT_VERSION: ".*"$/m,
      replacement: `    CURRENT_PROJECT_VERSION: "${buildNumber}"`,
      label: "CURRENT_PROJECT_VERSION",
    },
  ],
  `${version} (${buildNumber})`,
);

updateTextFile(
  "apps/ios/MiWarpMobile/MiWarpMobile.xcodeproj/project.pbxproj",
  [
    {
      pattern: /MARKETING_VERSION = [^;]+;/g,
      replacement: `MARKETING_VERSION = ${version};`,
      label: "MARKETING_VERSION build settings",
    },
    {
      pattern: /CURRENT_PROJECT_VERSION = [^;]+;/g,
      replacement: `CURRENT_PROJECT_VERSION = ${buildNumber};`,
      label: "CURRENT_PROJECT_VERSION build settings",
    },
  ],
  `${version} (${buildNumber})`,
);

for (const plistPath of [
  "apps/ios/MiWarpMobile/MiWarpMobile/Resources/Info.plist",
  "apps/ios/MiWarpMobile/MiWarpLiveActivityExtension/Info.plist",
  "apps/ios/MiWarpMobile/MiWarpMobileTests/Info.plist",
]) {
  updateTextFile(
    plistPath,
    [
      {
        pattern: /(<key>CFBundleShortVersionString<\/key>\s*<string>)[^<]*(<\/string>)/m,
        replacement: `$1${version}$2`,
        label: "CFBundleShortVersionString",
      },
      {
        pattern: /(<key>CFBundleVersion<\/key>\s*<string>)[^<]*(<\/string>)/m,
        replacement: `$1${buildNumber}$2`,
        label: "CFBundleVersion",
      },
    ],
    `${version} (${buildNumber})`,
  );
}

// Android application metadata
updateTextFile(
  "apps/android/MiWarpMobile/app/build.gradle.kts",
  [
    {
      pattern: /^\s*versionCode = \d+$/m,
      replacement: `        versionCode = ${buildNumber}`,
      label: "versionCode",
    },
    {
      pattern: /^\s*versionName = ".*"$/m,
      replacement: `        versionName = "${version}"`,
      label: "versionName",
    },
  ],
  `${version} (${buildNumber})`,
);
