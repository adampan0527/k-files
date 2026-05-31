#!/usr/bin/env node
/**
 * Sync vendor files from the KAgent VS Code extension.
 * Run: node scripts/sync-vendor.mjs
 */
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");

const kfilesMedia = join(projectRoot, "..", "KAgent", "extension", "media");
const vendorDir = join(projectRoot, "vendor");

const files = ["market.js", "market.css", "lightweight-charts.js"];

// Ensure vendor directory exists
if (!existsSync(vendorDir)) {
  mkdirSync(vendorDir, { recursive: true });
}

let ok = true;
for (const file of files) {
  const src = join(kfilesMedia, file);
  const dest = join(vendorDir, file);
  if (!existsSync(src)) {
    console.error(`  ✗ Source not found: ${src}`);
    ok = false;
    continue;
  }
  copyFileSync(src, dest);
  console.log(`  ✔ Copied ${file}`);
}

if (!ok) {
  console.error("\nSome files could not be copied. Check that KAgent exists at ../KAgent/");
  process.exit(1);
}

console.log("\nVendor sync complete.");
