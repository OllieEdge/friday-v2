function normalizeText(value) {
  return String(value ?? "").trim();
}

function parseCardIdFromUrl(url) {
  const match = String(url || "").match(/trello\.com\/c\/([a-zA-Z0-9]+)/);
  return match ? match[1] : "";
}

function mergeSizingIntoDesc({ desc, sizeLabel, timeEstimate, risks }) {
  const lines = ["## Sizing", `- Size: ${sizeLabel || "TBD"}`];
  if (timeEstimate) lines.push(`- Time estimate: ${timeEstimate}`);
  if (Array.isArray(risks) && risks.length) {
    lines.push(`- Risks: ${risks.join("; ")}`);
  }
  const block = lines.join("\n");

  const existing = String(desc || "");
  if (!existing.trim()) return block;
  const regex = /## Sizing[\s\S]*?(?=\n## |$)/i;
  if (regex.test(existing)) {
    return existing.replace(regex, block);
  }
  return `${existing}\n\n${block}`;
}

function mergeRelatedCards({ desc, cards }) {
  const urls = (cards || []).map((c) => normalizeText(c)).filter(Boolean);
  if (!urls.length) return String(desc || "");

  const existing = String(desc || "");
  const regex = /## Related Cards[\s\S]*?(?=\n## |$)/i;

  let list = [];
  if (regex.test(existing)) {
    const block = existing.match(regex)?.[0] || "";
    const lines = block.split(/\r?\n/).slice(1);
    for (const line of lines) {
      const match = line.match(/https:\/\/trello\.com\/c\/\S+/);
      if (match) list.push(match[0]);
    }
  }

  list = [...new Set([...list, ...urls])];
  const nextBlock = ["## Related Cards", ...list.map((u) => `- ${u}`)].join("\n");

  if (!existing.trim()) return nextBlock;
  if (regex.test(existing)) {
    return existing.replace(regex, nextBlock);
  }
  return `${existing}\n\n${nextBlock}`;
}

module.exports = { normalizeText, parseCardIdFromUrl, mergeSizingIntoDesc, mergeRelatedCards };
