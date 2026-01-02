const fs = require("node:fs");
const path = require("node:path");

function listMarkdownFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".md"))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, "en"));
}

function loadContextBundle({ contextDir }) {
  const absDir = path.resolve(contextDir);
  const files = listMarkdownFiles(absDir);
  const items = files.map((filename) => {
    const filePath = path.join(absDir, filename);
    const content = fs.readFileSync(filePath, "utf8");
    return { filename, content };
  });
  return { dir: absDir, files, items };
}

module.exports = { loadContextBundle };

