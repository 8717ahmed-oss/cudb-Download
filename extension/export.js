import { toCsv, toJson, toDelimited, fileName } from "./formats.mjs";

const $ = (id) => document.getElementById(id);
const tabId = Number(new URL(location.href).searchParams.get("tab"));
let sources = [];
let data = null;
let busy = false;
let stopped = false;
let collecting = false;

function status(message, tone = "info") {
  $("status").textContent = message;
  $("status").dataset.tone = tone;
}

function selected() { return sources[Number($("source").value)]; }

function controls() {
  const source = selected();
  $("refresh").disabled = busy;
  $("source").disabled = busy || !sources.length;
  $("read").disabled = busy || !source;
  $("collect").disabled = busy || !source?.canPage;
  $("max-pages").disabled = busy;
  $("max-rows").disabled = busy;
  $("stop").hidden = !collecting;
  $("stop").disabled = stopped;
  for (const id of ["csv", "json", "copy"]) $(id).disabled = busy || !data?.columns.length;
}

async function request(source, action, payload = {}) {
  const replies = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [source.frameId] }, world: "MAIN",
    func: (operation, params) => {
      const collector = window.__cdasResultExporterV1;
      if (!collector) return { ok: false, error: "页面已刷新，请点击重新识别。" };
      return collector.command(operation, params);
    },
    args: [action, { id: source.id, ...payload }],
  });
  const response = replies[0]?.result;
  if (!response?.ok) throw new Error(response?.error || "未能读取来源页面，请重新识别。");
  return response.result;
}

function preview() {
  $("row-count").textContent = (data?.rows.length || 0).toLocaleString();
  $("column-count").textContent = String(data?.columns.length || 0);
  $("page-count").textContent = String(data?.pagesCollected || 0);
  $("result-note").textContent = data?.note || "尚未读取数据。";
  $("result-note").dataset.incomplete = String(data?.complete === false);
  const head = $("preview").tHead;
  const body = $("preview").tBodies[0];
  head.replaceChildren(); body.replaceChildren();
  if (!data?.columns.length) {
    const cell = body.insertRow().insertCell();
    cell.className = "empty"; cell.textContent = "读取后在这里预览结果";
    controls(); return;
  }
  const heading = head.insertRow();
  for (const column of data.columns) {
    const th = document.createElement("th");
    th.scope = "col"; th.textContent = column.title; heading.append(th);
  }
  for (const row of data.rows.slice(0, 8)) {
    const tr = body.insertRow();
    for (const value of row) {
      const td = tr.insertCell();
      td.textContent = value === null ? "NULL" :
        typeof value === "object" ? JSON.stringify(value) : String(value ?? "");
      if (value === null) td.className = "null-value";
    }
  }
  if (!data.rows.length) {
    const td = body.insertRow().insertCell();
    td.colSpan = data.columns.length; td.className = "empty";
    td.textContent = "查询返回 0 行，可导出列标题。";
  }
  controls();
}

function validate(result) {
  if (result.busy) throw new Error("CDAS 正在加载查询结果，请等待完成后重试。");
  if (!result.columns.length) throw new Error("结果中没有可导出的数据列，请先执行查询。");
}

async function readCurrent() {
  const source = selected();
  if (!source) return;
  busy = true; controls();
  status("正在读取当前页…");
  try {
    const result = await request(source, "read");
    validate(result);
    data = { ...result, scope: "current", complete: true, pagesCollected: 1,
      note: `已读取当前第 ${result.pageNumber} 页，共 ${result.rows.length} 行。` +
        (result.mode === "dom" ? "来源为页面文本，NULL 与空字符串无法区分；仅包含此页已保存的行。" :
          result.hasNext ? "当前查询还有后续页，本次仅包含当前页。" : "本次仅包含当前页。"),
    };
    status(`当前页读取完成：${result.rows.length} 行、${result.columns.length} 列。`, "success");
  } catch (error) { data = null; status(error.message, "error"); }
  finally { busy = false; preview(); }
}

async function detect() {
  busy = true; data = null; sources = []; preview();
  $("source").replaceChildren(new Option("正在识别页面…", ""));
  status("正在识别 CDAS 结果表格及内嵌窗口…");
  try {
    if (!Number.isSafeInteger(tabId) || tabId <= 0) throw new Error("请在 CDAS 页面点击扩展图标来打开此工具。");
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true }, world: "MAIN", files: ["collector.js"],
    });
    const replies = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true }, world: "MAIN",
      func: () => window.__cdasResultExporterV1?.command("scan"),
    });
    for (const reply of replies) {
      for (const result of reply.result?.results || []) sources.push({ ...result, frameId: reply.frameId });
    }
    sources.sort((a, b) => Number(b.active) - Number(a.active));
    $("source").replaceChildren();
    sources.forEach((source, index) => $("source").add(new Option(
      `${source.title} · 第 ${source.pageNumber} 页 · ${source.rowCount} 行 · ${source.columns.length} 列${source.active ? " · 当前可见" : ""}`, String(index))));
    if (!sources.length) {
      $("source").add(new Option("未找到查询结果", ""));
      throw new Error("未找到 CDAS 结果表格。请先执行查询并打开「结果」页签，再点重新识别。如窗口单独打开，请在该窗口点击扩展。");
    }
    sourceNote();
  } catch (error) {
    status(`${error.message} 如果来源页已关闭、跳转或浏览器限制访问，请回到 CDAS 页面重新点击扩展。`, "error");
  } finally { busy = false; controls(); }
  if (sources.length) await readCurrent();
}

function sourceNote() {
  const source = selected();
  $("source-note").textContent = source?.mode === "dom"
    ? "当前使用页面文本读取。可导出已保存的当前页；自动翻页需要在线 CDAS 结果表格。"
    : "读取完整单元格内容，列宽截断不会影响导出；勾选框和行号不会导出。";
}

async function collectAll() {
  const source = selected();
  if (!source) return;
  const maxPages = Number($("max-pages").value);
  const maxRows = Number($("max-rows").value);
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 1000 ||
      !Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows > 200000) {
    status("最多页数须为 1–1000 的整数，最多行数须为 1–200000 的整数。", "error"); return;
  }
  stopped = false; busy = true; collecting = true; data = null; preview();
  try {
    const initial = await request(source, "read");
    validate(initial);
    if (!initial.canPage) throw new Error("此结果不能连续分页，请使用当前页导出。");
    data = { ...initial, rows: [], scope: "all", complete: false, pagesCollected: 0,
      note: "正在收集，此时数据尚未完整。" };
    for (let page = 1; page <= maxPages && !stopped; page++) {
      status(`正在读取第 ${page} 页；已收集 ${data.rows.length.toLocaleString()} 行…`);
      const result = page === 1 && initial.pageNumber === 1 ? initial :
        await request(source, "page", { pageNumber: page, signature: initial.signature });
      if (stopped) break;
      validate(result);
      if (result.signature !== initial.signature) throw new Error("查询或列已变化，已停止收集。");
      if (!result.rows.length && result.hasNext) throw new Error("页面返回空数据但仍提示下一页，已停止以避免重复请求。");
      const remaining = maxRows - data.rows.length;
      data.rows.push(...result.rows.slice(0, remaining));
      data.pagesCollected++;
      if (!result.hasNext && result.rows.length <= remaining) {
        data.complete = true;
        data.note = `已从第 1 页读取到末页，共 ${data.pagesCollected} 页、${data.rows.length} 行。范围以 CDAS 返回结果为准。`;
        preview(); break;
      }
      if (data.rows.length >= maxRows || page >= maxPages) {
        data.note = `达到${data.rows.length >= maxRows ? "最多行数" : "最多页数"}限制，未完成全部分页。已保留 ${data.rows.length} 行；可导出当前收集部分，或调高限制后从第 1 页重新读取。`;
        preview(); break;
      }
      preview();
      await new Promise((resolve) => setTimeout(resolve, 450));
    }
    if (stopped && data && !data.complete) {
      data.note = `已停止，分页未完成。已保留 ${data.rows.length} 行。CDAS 当前的请求可能仍会完成。`;
    }
    status(data?.note || "已停止读取。", data?.complete ? "success" : "warning");
  } catch (error) {
    if (data) data.note = `分页未完成：${error.message} 已保留 ${data.rows.length} 行，可导出已收集部分。`;
    status(data?.note || error.message, "error");
  } finally { busy = false; collecting = false; preview(); }
}

async function stop() {
  stopped = true; controls();
  status("正在停止，已收集的数据会保留…", "warning");
  try { await request(selected(), "cancel"); }
  catch { /* The source tab may already have closed. */ }
}

async function download(format) {
  if (!data) return;
  const content = format === "csv" ? toCsv(data) : toJson(data);
  const blob = new Blob([content], { type: format === "csv" ? "text/csv;charset=utf-8" : "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({ url, filename: fileName(data, format), saveAs: true });
    status(`已发起 ${format.toUpperCase()} 文件保存${data.complete ? "" : "，文件名已标记「未完成」"}。`, data.complete ? "success" : "warning");
  } catch (error) { status(`保存未完成：${error.message}`, "error"); }
  finally { setTimeout(() => URL.revokeObjectURL(url), 60000); }
}

$("refresh").addEventListener("click", detect);
$("source").addEventListener("change", () => { sourceNote(); readCurrent(); });
$("read").addEventListener("click", readCurrent);
$("collect").addEventListener("click", collectAll);
$("stop").addEventListener("click", stop);
$("csv").addEventListener("click", () => download("csv"));
$("json").addEventListener("click", () => download("json"));
$("copy").addEventListener("click", async () => {
  if (!data) return;
  try {
    await navigator.clipboard.writeText(toDelimited(data, "\t"));
    status(`已复制 ${data.rows.length} 行（含列标题），可在 Excel / Numbers 中粘贴。${data.complete ? "" : "注意：分页尚未完成。"}`, data.complete ? "success" : "warning");
  } catch (error) { status(`复制失败，请改用文件导出：${error.message}`, "error"); }
});

detect();
