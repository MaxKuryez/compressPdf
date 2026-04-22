const { PDFDocument } = require("pdf-lib");
const fs = require("fs");
const path = require("path");

async function mergePDFs() {
  const folder = path.join(__dirname, "toMerge");

  if (!fs.existsSync(folder)) {
    console.error("ERROR: ./toMerge folder not found next to this script.");
    process.exit(1);
  }

  // Get all PDFs in the folder, sorted by filename
  const files = fs.readdirSync(folder)
    .filter(f => f.toLowerCase().endsWith(".pdf"))
    .sort()
    .map(f => path.join(folder, f));

  if (files.length < 2) {
    console.error(`ERROR: Need at least 2 PDFs in ./toMerge, found ${files.length}.`);
    process.exit(1);
  }

  console.log(`Found ${files.length} PDFs to merge (sorted by name):`);

  const merged = await PDFDocument.create();

  for (const filePath of files) {
    const bytes = fs.readFileSync(filePath);
    const pdf = await PDFDocument.load(bytes);
    const pages = await merged.copyPages(pdf, pdf.getPageIndices());
    pages.forEach((page) => merged.addPage(page));
    console.log(`  + ${path.basename(filePath)}  (${pdf.getPageCount()} page(s))`);
  }

  const output = path.join(__dirname, "merged.pdf");
  const outBytes = await merged.save();
  fs.writeFileSync(output, outBytes);
  console.log(`\n✓ Saved → ${output}`);
}

mergePDFs();
