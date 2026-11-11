// Keep data as data when a spreadsheet opens it; CSV quoting alone is insufficient.
export function spreadsheetValue(value) {
  let result = value === null || value === undefined ? "" :
    typeof value === "object" ? JSON.stringify(value) : String(value);
  if (typeof value === "string" && /^[\s\uFEFF]*[=+\-@\t\r\n]/u.test(value)) result = `'${result}`;
  return result;
}

function quote(value, separator) {
  return value.includes(separator) || /["\r\n]/u.test(value)
    ? `"${value.replaceAll('"', '""')}"` : value;
}

export function toDelimited(result, separator = ",") {
  const rows = [result.columns.map((column) => column.title), ...result.rows];
  return rows.map((row) => row.map((cell) =>
    quote(spreadsheetValue(cell), separator)).join(separator)).join("\r\n") + "\r\n";
}

export function toCsv(result) {
  return "\uFEFF" + toDelimited(result);
}

export function toJson(result) {
  return JSON.stringify({
    result: result.title,
    complete: result.complete,
    scope: result.scope,
    pagesCollected: result.pagesCollected,
    rowCount: result.rows.length,
    note: result.note || "",
    columns: result.columns,
    rows: result.rows,
  }, null, 2) + "\n";
}

export function fileName(result, extension, date = new Date()) {
  const name = (result.title || "查询结果").replace(/[\\/:*?"<>|\u0000-\u001F]/gu, "_").slice(0, 60);
  const stamp = [date.getFullYear(), date.getMonth() + 1, date.getDate()].map((n) =>
    String(n).padStart(2, "0")).join("") + "-" +
    [date.getHours(), date.getMinutes(), date.getSeconds()].map((n) => String(n).padStart(2, "0")).join("");
  return `CDAS_${name}_${result.scope === "current" ? "当前页" : "连续分页"}${result.complete ? "" : "_未完成"}_${stamp}.${extension}`;
}
