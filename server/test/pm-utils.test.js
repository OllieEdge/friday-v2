const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseCardIdFromUrl, mergeSizingIntoDesc, mergeRelatedCards } = require("../src/lib/pm-utils");

test("parseCardIdFromUrl extracts shortLink", () => {
  assert.equal(parseCardIdFromUrl("https://trello.com/c/9Iv2vgkk/13-title"), "9Iv2vgkk");
  assert.equal(parseCardIdFromUrl("https://trello.com/c/ABCdef12"), "ABCdef12");
  assert.equal(parseCardIdFromUrl(""), "");
});

test("mergeSizingIntoDesc appends or replaces sizing section", () => {
  const initial = "# Project\n\n## Notes\n- Something";
  const merged = mergeSizingIntoDesc({
    desc: initial,
    sizeLabel: "L",
    timeEstimate: "2h",
    risks: ["Dependencies"],
  });
  assert.match(merged, /## Sizing/);
  assert.match(merged, /Size: L/);
  assert.match(merged, /Time estimate: 2h/);

  const updated = mergeSizingIntoDesc({
    desc: merged,
    sizeLabel: "XL",
    timeEstimate: "4h",
    risks: ["New risk"],
  });
  assert.match(updated, /Size: XL/);
  assert.match(updated, /Time estimate: 4h/);
  assert.match(updated, /New risk/);
});


test("mergeRelatedCards merges unique urls", () => {
  const initial = "# Project\n\n## Related Cards\n- https://trello.com/c/AAA111\n- https://trello.com/c/BBB222";
  const merged = mergeRelatedCards({
    desc: initial,
    cards: ["https://trello.com/c/BBB222", "https://trello.com/c/CCC333"],
  });
  const count = (merged.match(/trello\.com\/c\//g) || []).length;
  assert.equal(count, 3);
  assert.match(merged, /## Related Cards/);
});
