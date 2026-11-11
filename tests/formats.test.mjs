import test from "node:test";
import assert from "node:assert/strict";
import { toCsv, toJson, toDelimited, spreadsheetValue, fileName } from "../extension/formats.mjs";

test("CSV retains Chinese, full values, quotes, commas, newlines and duplicate rows", () => {
  const result = {
    columns: [{ title: "名称" }, { title: "说明" }, { title: "值" }],
    rows: [["中文", 'a,"b"\r\nc', null], ["重复", "完整长内容", 0], ["重复", "完整长内容", 0]],
  };
  assert.equal(toCsv(result), '\uFEFF名称,说明,值\r\n中文,"a,""b""\r\nc",\r\n重复,完整长内容,0\r\n重复,完整长内容,0\r\n');
});

test("spreadsheet exports neutralize formulas without changing numeric values", () => {
  for (const value of ["=1+1", "+cmd", "-1", "@SUM(A1)", "  =1", "\tlink", "\rtext", "\ntext"]) {
    assert.equal(spreadsheetValue(value), `'${value}`);
  }
  assert.equal(spreadsheetValue(-7.5), "-7.5");
  assert.equal(spreadsheetValue("00012345678901234567890"), "00012345678901234567890");
  assert.equal(spreadsheetValue(false), "false");
  assert.equal(spreadsheetValue(undefined), "");
  assert.equal(spreadsheetValue("  safe text  "), "  safe text  ");
});

test("TSV quotes tabs/newlines for spreadsheet paste", () => {
  assert.equal(toDelimited({ columns: [{ title: "A" }, { title: "B" }], rows: [["a\tb", 'c"d']] }, "\t"),
    'A\tB\r\n"a\tb"\t"c""d"\r\n');
});

test("JSON keeps null, empty strings, booleans, numbers, raw formulas and column mapping", () => {
  const result = { title: "结果 1", columns: [{ field: "n", title: "重复标题" }, { field: "m", title: "重复标题" }],
    rows: [[null, ""], [false, 0], ["=SUM(A1)", "0012345678901234567890"]],
    complete: false, scope: "all", pagesCollected: 3, note: "未完成" };
  const parsed = JSON.parse(toJson(result));
  assert.deepEqual(parsed.rows, result.rows);
  assert.deepEqual(parsed.columns, result.columns);
  assert.equal(parsed.complete, false);
  assert.equal(parsed.rowCount, 3);
  assert.equal(parsed.note, "未完成");
});

test("filenames distinguish partial results and current pages, using local time", () => {
  const date = new Date(2026, 10, 11, 15, 6, 7);
  assert.equal(fileName({ title: '结果/1:*?', scope: "all", complete: false }, "csv", date),
    "CDAS_结果_1____连续分页_未完成_20261111-150607.csv");
  assert.match(fileName({ title: "结果", scope: "current", complete: true }, "json", date), /当前页_20261111-150607\.json$/);
});
