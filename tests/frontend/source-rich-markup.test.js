import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("source renderer uses a restricted markup whitelist", () => {
  const source = fs.readFileSync(new URL("../../app/static/js/source.js", import.meta.url), "utf8");
  assert.match(source, /const RICH_TEXT_TAGS/);
  assert.match(source, /"table"/);
  assert.match(source, /"sup"/);
  assert.match(source, /"sub"/);
  assert.match(source, /TABLE_ATTRIBUTES/);
  assert.match(source, /appendSafeMarkup\(txt, richTextMarkupForBlock\(b\)\)/);
  assert.doesNotMatch(source, /div\.innerHTML\s*=/);
});
