import assert from "node:assert/strict";
import test from "node:test";
import { escapeCsv } from "../src/adminOpsUtils.js";

test("CSV export neutralizes spreadsheet formulas", () => {
  assert.equal(escapeCsv("=HYPERLINK(\"https://example.invalid\")"), "\"'=HYPERLINK(\"\"https://example.invalid\"\")\"");
  assert.equal(escapeCsv("  +SUM(1,2)"), "\"'  +SUM(1,2)\"");
  assert.equal(escapeCsv("@command"), "'@command");
});

test("CSV export preserves ordinary institutional values", () => {
  assert.equal(escapeCsv("English"), "English");
  assert.equal(escapeCsv("Last, First"), "\"Last, First\"");
});
