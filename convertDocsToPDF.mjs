#!/usr/bin/env node

/**
 * convertDocsToPDF.js
 *
 * Converts all .docx files in ./toConvertToPDF to PDF using LibreOffice WASM.
 * No native LibreOffice installation required.
 *
 * Setup (one time):
 *   npm install @matbee/libreoffice-converter
 *
 * Usage:
 *   node ./convertDocsToPDF.js
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createWorkerConverter } from "@matbee/libreoffice-converter/server";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INPUT_DIR = path.resolve(__dirname, "toConvertToPDF");

function findDocxFiles(dir) {
  if (!fs.existsSync(dir)) {
    console.error(`❌  Input folder not found: ${dir}`);
    process.exit(1);
  }
  return fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".docx"))
    .map((f) => path.join(dir, f));
}

async function main() {
  const docxFiles = findDocxFiles(INPUT_DIR);

  if (docxFiles.length === 0) {
    console.log(`ℹ  No .docx files found in ${INPUT_DIR}`);
    return;
  }

  console.log(`📄  Found ${docxFiles.length} file(s) to convert...`);
  console.log(`⏳  Initializing LibreOffice WASM (first run may take a moment)...\n`);

  // createWorkerConverter runs LibreOffice WASM in a worker thread,
  // keeping the main thread free and allowing converter reuse across files.
  const converter = await createWorkerConverter();

  let passed = 0;
  let failed = 0;

  for (const docxPath of docxFiles) {
    const label = path.basename(docxPath);
    const pdfPath = docxPath.replace(/\.docx$/i, ".pdf");

    process.stdout.write(`  Converting  ${label} ...`);
    try {
      const input = fs.readFileSync(docxPath);
      const result = await converter.convert(input, { outputFormat: "pdf" });
      fs.writeFileSync(pdfPath, result.data);
      console.log(`  ✅  →  ${path.basename(pdfPath)}`);
      passed++;
    } catch (err) {
      console.log(`  ❌  FAILED`);
      console.error(`     ${err.message}`);
      failed++;
    }
  }

  await converter.destroy();

  console.log(`\n────────────────────────────────────`);
  console.log(`✅  ${passed} converted   ❌  ${failed} failed`);
  console.log(`📁  Output folder: ${INPUT_DIR}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
