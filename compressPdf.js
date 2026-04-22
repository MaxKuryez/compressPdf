const { compress: compressPDF } = require("compress-pdf");
const fs = require("fs");
const path = require("path");

async function compress() {
  const folder = path.join(__dirname, "toCompress");

  if (!fs.existsSync(folder)) {
    console.error("ERROR: ./toCompress folder not found next to this script.");
    process.exit(1);
  }

  const files = fs.readdirSync(folder)
    .filter(f => f.toLowerCase().endsWith(".pdf"))
    .sort();

  if (files.length === 0) {
    console.error("ERROR: No PDF files found in ./toCompress");
    process.exit(1);
  }

  console.log(`Found ${files.length} PDF(s) to compress:\n`);

  for (const file of files) {
    const input = path.join(folder, file);
    const output = path.join(folder, file.replace(".pdf", "_compressed.pdf"));

    const before = (fs.statSync(input).size / 1024 / 1024).toFixed(2);
    console.log(`Compressing: ${file} (${before} MB)...`);

    const result = await compressPDF(input, {
      compatibilityLevel: 1.4,
      pdfSettings: "ebook", // try: screen | ebook | printer | prepress
    });

    fs.writeFileSync(output, result);

    const after = (fs.statSync(output).size / 1024 / 1024).toFixed(2);
    console.log(`  ✓ Before: ${before} MB → After: ${after} MB (saved ${((1 - after / before) * 100).toFixed(0)}%)`);
    console.log(`  → ${path.basename(output)}\n`);
  }

  console.log("All done!");
}

compress();