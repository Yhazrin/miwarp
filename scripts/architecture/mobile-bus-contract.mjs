#!/usr/bin/env node
/**
 * Mobile BusEvent contract gate.
 *
 * Ensures iOS (BusEventPayload.EventType) and Android (MiWarpRpcClient when
 * branches) stay aligned with Rust `BusEvent` variants in models/.
 *
 * Sister to `src/lib/bus/__tests__/bus-contract.test.ts` (Rust ↔ desktop TS)
 * and focused on the mobile decoders that previously fell back to `.raw`.
 *
 * Run from repo root:
 *   node scripts/architecture/mobile-bus-contract.mjs
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import {
  RECOVERY_BUS_EVENT_TYPES,
  RECOVERY_PAYLOAD_FIELDS,
  classifyMobileBusDrift,
  parseAndroidBusEventTypes,
  parseIosBusEventTypes,
  parseRustBusEventVariants,
} from "./contract-lib.mjs";
import { REPO_ROOT, readText, rel, report } from "./lib.mjs";

const modelsDir = join(REPO_ROOT, "src-tauri", "src", "models");
const iosFile = join(
  REPO_ROOT,
  "apps",
  "ios",
  "MiWarpMobile",
  "MiWarpMobile",
  "Core",
  "BusEventPayload.swift",
);
const androidFile = join(
  REPO_ROOT,
  "apps",
  "android",
  "MiWarpMobile",
  "app",
  "src",
  "main",
  "java",
  "com",
  "miwarp",
  "mobile",
  "rpc",
  "MiWarpRpcClient.kt",
);

const rustSrc = readdirSync(modelsDir)
  .filter((f) => f.endsWith(".rs"))
  .map((f) => readText(join(modelsDir, f)) ?? "")
  .join("\n");
const iosSrc = readText(iosFile);
const androidSrc = readText(androidFile);

if (!rustSrc || !iosSrc || !androidSrc) {
  console.error("✗ mobile-bus-contract: missing source file(s)");
  process.exit(1);
}

if (!rustSrc) {
  console.error("✗ mobile-bus-contract: cannot read models/ directory");
  process.exit(1);
}

const rustVariants = parseRustBusEventVariants(rustSrc);
const iosTypes = parseIosBusEventTypes(iosSrc);
const androidTypes = parseAndroidBusEventTypes(androidSrc);

if (rustVariants.length === 0) {
  console.error("✗ mobile-bus-contract: failed to parse Rust BusEvent variants");
  process.exit(1);
}

const { iosMissing, androidMissing } = classifyMobileBusDrift(
  rustVariants,
  iosTypes,
  androidTypes,
);

console.log(
  `  Rust variants: ${rustVariants.length}  |  iOS EventType: ${iosTypes.size}  |  Android when: ${androidTypes.size}`,
);

const violations = [];

for (const entry of iosMissing) {
  violations.push(`iOS missing Rust variant ${entry} in BusEventPayload.EventType`);
}
for (const entry of androidMissing) {
  violations.push(`Android missing Rust variant ${entry} in parseBusEventFromEnvelope`);
}

for (const eventType of RECOVERY_BUS_EVENT_TYPES) {
  if (!iosTypes.has(eventType)) {
    violations.push(`iOS missing recovery event type "${eventType}"`);
  }
  if (!androidTypes.has(eventType)) {
    violations.push(`Android missing recovery event type "${eventType}"`);
  }
}

for (const [eventType, fields] of Object.entries(RECOVERY_PAYLOAD_FIELDS)) {
  for (const field of fields) {
    if (!iosSrc.includes(field)) {
      violations.push(`iOS BusEventPayload missing payload field "${field}" for ${eventType}`);
    }
    if (!androidSrc.includes(`"${field}"`)) {
      violations.push(`Android MiWarpRpcClient missing payload field "${field}" for ${eventType}`);
    }
  }
}

const hint =
  `Sources:\n` +
  `  · ${rel(REPO_ROOT, modelsDir)}\n` +
  `  · ${rel(REPO_ROOT, iosFile)}\n` +
  `  · ${rel(REPO_ROOT, androidFile)}\n` +
  `Recovery events must decode to typed payloads — Raw is only for truly unknown wire types.`;

process.exit(report("mobile-bus-contract", violations, hint));
