#!/usr/bin/env node
/**
 * Smoke-test all SvelteKit routes and record a demo walkthrough video.
 * Usage: node scripts/page-smoke-and-demo.mjs [--base http://127.0.0.1:1420]
 */

import { chromium } from "playwright";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const routesDir = path.join(root, "src/routes");
const baseUrl = process.argv.includes("--base")
  ? process.argv[process.argv.indexOf("--base") + 1]
  : "http://127.0.0.1:1420";
const artifactsDir = "/opt/cursor/artifacts";
const videoDir = path.join(artifactsDir, "videos");
const screenshotDir = path.join(artifactsDir, "screenshots");

/** Collect static route paths from src/routes (skip dynamic segments). */
async function collectRoutes(dir = routesDir, prefix = "") {
  const entries = await readdir(dir, { withFileTypes: true });
  const routes = [];

  for (const entry of entries) {
    if (entry.name.startsWith("_")) continue;
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (entry.name.startsWith("(") && entry.name.endsWith(")")) {
        routes.push(...(await collectRoutes(full, prefix)));
        continue;
      }
      if (entry.name.startsWith("[")) continue;
      const nextPrefix = `${prefix}/${entry.name}`;
      routes.push(...(await collectRoutes(full, nextPrefix)));
      continue;
    }

    if (entry.name === "+page.svelte" || entry.name === "+page.ts") {
      routes.push(prefix || "/");
    }
  }

  return [...new Set(routes)].sort();
}

function isHardError(message) {
  const lower = message.toLowerCase();
  if (lower.includes("favicon")) return false;
  if (lower.includes("websocket") && lower.includes("failed")) return false;
  if (lower.includes("failed to fetch")) return false;
  if (lower.includes("net::err_connection_refused")) return false;
  return true;
}

async function checkPage(page, route, consoleErrors, setCurrentRoute) {
  setCurrentRoute(route);
  const url = `${baseUrl}${route}`;
  const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(1200);

  const status = response?.status() ?? 0;
  const title = await page.title();
  const bodyText = await page.locator("body").innerText();
  const hasSvelteError =
    bodyText.includes("Internal Error") ||
    bodyText.includes("500 Internal Error") ||
    bodyText.includes("Application Error");
  const hasVisibleContent = bodyText.trim().length > 0;

  const screenshotName = route === "/" ? "root" : route.replace(/\//g, "_").replace(/^_/, "");
  await page.screenshot({
    path: path.join(screenshotDir, `${screenshotName || "root"}.png`),
    fullPage: false,
  });

  const routeErrors = consoleErrors.filter((e) => e.route === route && isHardError(e.text));

  return {
    route,
    url,
    status,
    title,
    ok:
      status >= 200 &&
      status < 400 &&
      !hasSvelteError &&
      hasVisibleContent &&
      routeErrors.length === 0,
    issues: [
      ...(status >= 400 ? [`HTTP ${status}`] : []),
      ...(hasSvelteError ? ["SvelteKit error page detected"] : []),
      ...(!hasVisibleContent ? ["Empty page body"] : []),
      ...routeErrors.map((e) => `Console: ${e.text.slice(0, 120)}`),
    ],
  };
}

async function main() {
  const routes = await collectRoutes();
  const demoRoutes = [
    "/",
    "/chat",
    "/scheduled-tasks",
    "/workbench",
    "/explorer",
    "/history",
    "/personal",
    "/teams",
    "/plugins",
    "/usage",
    "/settings",
    "/skills",
    "/specs",
    "/automation",
    "/tasks",
    "/artifacts",
    "/browser",
    "/multi-agent",
    "/fleet",
    "/diagnostics",
    "/release-notes",
    "/embedded-app",
    "/config/claude",
    "/config/codex",
    "/workspace",
  ];

  const consoleErrors = [];

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: videoDir, size: { width: 1440, height: 900 } },
  });
  const page = await context.newPage();
  let currentRoute = "/";

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push({ route: currentRoute, text: msg.text() });
    }
  });
  page.on("pageerror", (err) => {
    consoleErrors.push({ route: currentRoute, text: String(err) });
  });

  const results = [];

  console.log(`\n=== MiWarp page smoke test (${routes.length} routes) ===\n`);
  console.log(`Base URL: ${baseUrl}\n`);

  for (const route of routes) {
    const result = await checkPage(page, route, consoleErrors, (r) => {
      currentRoute = r;
    });
    results.push(result);
    const icon = result.ok ? "✓" : "✗";
    console.log(`${icon} ${route.padEnd(22)} ${result.status}  ${result.title || "(no title)"}`);
    if (result.issues.length) {
      for (const issue of result.issues) console.log(`    - ${issue}`);
    }
  }

  console.log("\n=== Recording demo walkthrough ===\n");

  for (const route of demoRoutes) {
    console.log(`  → ${route}`);
    currentRoute = route;
    await page.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(1800);

    if (route === "/chat" || route === "/") {
      const rail = page.locator("nav a, [data-testid='nav-rail'] a, aside a").first();
      if (await rail.count()) {
        await rail.hover().catch(() => {});
      }
    }
  }

  await page.waitForTimeout(1000);
  const video = await page.video()?.path();
  await context.close();
  await browser.close();

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);

  const report = {
    baseUrl,
    total: results.length,
    passed,
    failed: failed.length,
    video,
    results,
  };

  const reportPath = path.join(artifactsDir, "page-smoke-report.json");
  await import("node:fs/promises").then((fs) =>
    fs.writeFile(reportPath, JSON.stringify(report, null, 2)),
  );

  console.log(`\n=== Summary: ${passed}/${results.length} pages OK ===`);
  if (failed.length) {
    console.log("\nFailed pages:");
    for (const f of failed) {
      console.log(`  ✗ ${f.route}: ${f.issues.join("; ") || "unknown"}`);
    }
  }
  if (video) console.log(`\nDemo video: ${video}`);
  console.log(`Report: ${reportPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
