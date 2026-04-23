#!/usr/bin/env node

/**
 * readMetadata.js
 * Reads metadata for all files in the adjacent `toReadMetadata` folder
 * and prints each filename alongside its metadata.
 *
 * Usage:
 *   node readMetadata.js
 *
 * The `toReadMetadata` folder must sit next to this script file.
 * .gitignore files are automatically skipped.
 */

const fs   = require("fs");
const path = require("path");

// ─── PDF metadata parser (zero dependencies) ────────────────────────────────
// Reads PDF info dictionary directly from raw bytes — no npm package needed.

/**
 * Extracts the /Info dictionary fields from a PDF buffer.
 * Handles both plain-text and hex-encoded string values.
 */
/**
 * Converts a PDF date string like "D:20251118164911+01'00'"
 * into a readable local date string.
 */
function parsePdfDate(raw) {
  if (!raw) return raw;
  // Strip leading "D:" if present
  const s = raw.replace(/^D:/, "").trim();
  // Parse components: YYYYMMDDHHmmssOHH'mm'
  const m = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})([+-Z])?(\d{2})?'?(\d{2})?/);
  if (!m) return raw;
  const [, yr, mo, dy, hr, mn, sc, sign, tzH = "00", tzM = "00"] = m;
  // Build ISO string with timezone offset
  let iso = `${yr}-${mo}-${dy}T${hr}:${mn}:${sc}`;
  if (sign && sign !== "Z") iso += `${sign}${tzH}:${tzM}`;
  else iso += "Z";
  const d = new Date(iso);
  return isNaN(d) ? raw : d.toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    timeZoneName: "short"
  });
}

function parsePdfMetadata(buffer) {
  const text = buffer.toString("binary");
  const result = {};

  // Page count: count unique "Page\n" / "Page\r" dictionary entries
  const pageMatches = text.match(/\/Type\s*\/Page[^s]/g);
  if (pageMatches) result["Pages"] = pageMatches.length;

  // PDF version from header
  const versionMatch = text.match(/%PDF-(\d+\.\d+)/);
  if (versionMatch) result["PDF Version"] = versionMatch[1];

  // Pull the /Info dictionary block
  const infoMatch = text.match(/\/Info\s*<<([\s\S]*?)>>/);
  const infoBlock = infoMatch ? infoMatch[1] : text; // fallback: scan whole file

  const fields = ["Title", "Author", "Subject", "Keywords", "Creator", "Producer", "CreationDate", "ModDate"];

  for (const field of fields) {
    // Try plain string:  /Field (value)
    const plain = new RegExp(`/${field}\\s*\\(([^)]*)\\)`).exec(infoBlock);
    if (plain) {
      const val = plain[1].trim();
      if (val) result[field] = val;
      continue;
    }
    // Try hex string:  /Field <hex>
    const hex = new RegExp(`/${field}\\s*<([0-9a-fA-F]+)>`).exec(infoBlock);
    if (hex) {
      try {
        const decoded = Buffer.from(hex[1], "hex").toString("utf16le").replace(/\0/g, "").trim();
        if (decoded) result[field] = decoded;
      } catch { /* skip */ }
    }
  }

  if (result["CreationDate"]) result["CreationDate"] = parsePdfDate(result["CreationDate"]);
  if (result["ModDate"])      result["ModDate"]      = parsePdfDate(result["ModDate"]);

  return result;
}

// ─── Config ──────────────────────────────────────────────────────────────────
const SCRIPT_DIR    = __dirname;
const TARGET_FOLDER = path.join(SCRIPT_DIR, "toReadMetadata");

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Returns a human-readable file size string. */
function humanSize(bytes) {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
}

/** Formats a Date object as a readable local string. */
function fmt(date) {
  return date.toLocaleString();
}

/** Extracts filesystem-level metadata from an fs.Stats object. */
function fsMetadata(stat) {
  return {
    "Size"         : humanSize(stat.size),
    "Created"      : fmt(stat.birthtime),
    "Modified"     : fmt(stat.mtime),
    "Last Accessed": fmt(stat.atime),
    "Permissions"  : `0${(stat.mode & 0o777).toString(8)}`,
  };
}

/** Attempts to read extra metadata for known file types. */
async function extraMetadata(filePath, ext) {
  const result = {};

  switch (ext) {
    // ── PDF ──────────────────────────────────────────────────────────────────
    case ".pdf": {
      try {
        const buffer  = fs.readFileSync(filePath);
        const pdfMeta = parsePdfMetadata(buffer);
        Object.assign(result, pdfMeta);
      } catch (err) {
        result["PDF parse error"] = err.message;
      }
      break;
    }

    // ── Images (JPEG / PNG / GIF / BMP / WebP) ───────────────────────────────
    case ".jpg":
    case ".jpeg":
    case ".png":
    case ".gif":
    case ".bmp":
    case ".webp": {
      try {
        // Read magic bytes to confirm format and pull basic dimensions where
        // available without a heavyweight dependency.
        const fd  = fs.openSync(filePath, "r");
        const buf = Buffer.alloc(24);
        fs.readSync(fd, buf, 0, 24, 0);
        fs.closeSync(fd);

        // PNG: width/height in bytes 16-24
        if (buf[0] === 0x89 && buf[1] === 0x50) {
          result["Format"] = "PNG";
          result["Width"]  = buf.readUInt32BE(16) + "px";
          result["Height"] = buf.readUInt32BE(20) + "px";
        }
        // JPEG
        else if (buf[0] === 0xff && buf[1] === 0xd8) {
          result["Format"] = "JPEG";
        }
        // GIF
        else if (buf.slice(0, 3).toString() === "GIF") {
          result["Format"] = "GIF";
          result["Width"]  = buf.readUInt16LE(6) + "px";
          result["Height"] = buf.readUInt16LE(8) + "px";
        }
        // BMP
        else if (buf[0] === 0x42 && buf[1] === 0x4d) {
          result["Format"] = "BMP";
          result["Width"]  = buf.readInt32LE(18) + "px";
          result["Height"] = buf.readInt32LE(22) + "px";
        }
      } catch {
        // silently ignore — fs metadata is still shown
      }
      break;
    }

    // ── Plain text / code ────────────────────────────────────────────────────
    case ".txt":
    case ".md":
    case ".csv":
    case ".json":
    case ".xml":
    case ".html":
    case ".htm":
    case ".js":
    case ".ts":
    case ".py":
    case ".rb":
    case ".java":
    case ".c":
    case ".cpp":
    case ".go":
    case ".rs":
    case ".sh":
    case ".yaml":
    case ".yml": {
      try {
        const content  = fs.readFileSync(filePath, "utf8");
        const lines    = content.split(/\r?\n/);
        const words    = content.split(/\s+/).filter(Boolean).length;
        result["Lines"]     = lines.length;
        result["Words"]     = words;
        result["Chars"]     = content.length;
        result["Encoding"]  = "UTF-8 (assumed)";
      } catch {
        result["Text read"] = "Could not read as UTF-8";
      }
      break;
    }

    default:
      break; // filesystem metadata is enough for unknown types
  }

  return result;
}

/** Prints a formatted metadata block for one file. */
function printMetadata(filename, meta) {
  const bar   = "─".repeat(60);
  const label = `  📄  ${filename}`;
  console.log(`\n┌${bar}┐`);
  console.log(`│${label.padEnd(60)}│`);
  console.log(`├${bar}┤`);

  const maxKey = Math.max(...Object.keys(meta).map((k) => k.length));
  for (const [key, value] of Object.entries(meta)) {
    const line = `  ${key.padEnd(maxKey + 2)}: ${value}`;
    // Wrap long values at 56 chars
    const chunks = String(value).match(/.{1,54}/g) || [""];
    const first  = `  ${key.padEnd(maxKey + 2)}: ${chunks[0]}`;
    console.log(`│${first.padEnd(60)}│`);
    for (let i = 1; i < chunks.length; i++) {
      const cont = `  ${"".padEnd(maxKey + 2)}  ${chunks[i]}`;
      console.log(`│${cont.padEnd(60)}│`);
    }
  }

  console.log(`└${bar}┘`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  // Verify target folder exists
  if (!fs.existsSync(TARGET_FOLDER)) {
    console.error(`\n❌  Folder not found: ${TARGET_FOLDER}`);
    console.error(`    Create a "toReadMetadata" folder next to this script and add files to it.\n`);
    process.exit(1);
  }

  const entries = fs.readdirSync(TARGET_FOLDER);

  if (entries.length === 0) {
    console.log(`\n⚠️  The folder "${TARGET_FOLDER}" is empty.\n`);
    process.exit(0);
  }

  console.log(`\n📂  Reading metadata from: ${TARGET_FOLDER}`);
  console.log(`    Found ${entries.length} entr${entries.length === 1 ? "y" : "ies"}\n`);

  let processed = 0;
  let skipped   = 0;

  for (const name of entries) {
    // ── Skip .gitignore (and any hidden dot-files if desired) ────────────────
    if (name === ".gitignore" || name === ".gitkeep" || name === ".DS_Store" || name === "Thumbs.db") {
      console.log(`⏭   Skipping: ${name}`);
      skipped++;
      continue;
    }

    const fullPath = path.join(TARGET_FOLDER, name);
    const stat     = fs.statSync(fullPath);

    // Skip sub-directories
    if (stat.isDirectory()) {
      console.log(`⏭   Skipping directory: ${name}`);
      skipped++;
      continue;
    }

    const ext  = path.extname(name).toLowerCase();
    const base = fsMetadata(stat);
    const xtra = await extraMetadata(fullPath, ext);
    const meta = {
      "Extension": ext || "(none)",
      ...base,
      ...xtra,
    };

    printMetadata(name, meta);
    processed++;
  }

  console.log(`\n✅  Done. Processed: ${processed} file(s), skipped: ${skipped}.\n`);
})();