const pdfParse = require("pdf-parse");
const fs = require("fs");
const buf = fs.readFileSync("C:/Users/EQ-7/Downloads/80085bb0-b3b3-48b9-8412-2f269b0f84c0.pdf");
pdfParse(buf).then(r => {
  console.log("=== INFO ===");
  console.log("Pages:", r.numpages);
  console.log("Length:", r.text.length, "chars");
  console.log("=== TEXT ===");
  console.log(r.text);
});
