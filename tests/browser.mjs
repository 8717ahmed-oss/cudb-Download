// Uses the supplied EasyUI assets locally. No intranet services are contacted.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, cp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const resources = process.argv[2];
if (!resources) throw new Error("Usage: node tests/browser.mjs <directory with the supplied EasyUI resources>");
const localResources = path.resolve(resources);
const temp = await mkdtemp(path.join(tmpdir(), "cdas-export-test-"));
const extension = path.join(temp, "extension");
await cp(path.join(root, "extension"), extension, { recursive: true });
const manifest = JSON.parse(await readFile(path.join(extension, "manifest.json"), "utf8"));
// Automated tests cannot click browser chrome. Only this disposable test copy
// receives localhost access; the shipped extension uses the user's activeTab grant.
manifest.host_permissions = ["http://127.0.0.1/*"];
await writeFile(path.join(extension, "manifest.json"), JSON.stringify(manifest));

const fixture = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="/assets/easyui.css">
<script src="/assets/jquery-3.5.0.min.js"></script><script src="/assets/jquery.easyui.min.js"></script>
</head><body><div id="searchTabs" style="width:950px;height:480px">
<div title="结果 1"><table id="selectDg0"></table></div><div title="结果 2"><table id="selectDg1"></table></div></div>
<script>
window.fixture = {delay:30, fail:false, hang:false, change:false, requests:0, loaded:0};
const longText = '完整内容，包含逗号、换行\\n和"引号"，超过列宽但必须完整导出。';
const duplicate = {code:'00012345678901234567890',database_name:'demo_db',table_name:'repeat_table',size:'1.00G',note:null};
const pages = [
 [{code:'001',database_name:'示例库',table_name:'orders',size:'97.73G',note:longText}, duplicate],
 [duplicate, {code:'004',database_name:'demo_db',table_name:'<b>literal</b>',size:0,note:'=1+1'}],
 [{code:'005',database_name:'demo_db',table_name:'last',size:'0G',note:''}]
];
$('#searchTabs').tabs();
function setup(id, rows) {
 const grid = $(id);
 grid.datagrid({height:390,width:920,pagination:true,pageSize:2,pageList:[2],rownumbers:true,
  queryParams:{sql:'select * from demo',execSql:'select * from demo',sqlType:'select',databaseName:'demo_db'},
  frozenColumns:[[{field:'code',title:'编号',width:80}]],
  columns:[[{field:'ck',checkbox:true},{field:'database_name',title:'<b>数据库</b>',width:110},
   {field:'table_name',title:'表名',width:80},{field:'size',title:'大小',width:70},
   {field:'note',title:'备注',width:100,formatter: v => v == null ? 'NULL' : String(v).slice(0,4)+'…'},
   {field:'hidden',title:'隐藏列',hidden:true}]],
  onLoadSuccess:function(){ fixture.loaded++; grid.datagrid('loaded'); }
 });
 function apply(page) {
  const values = rows[page-1] || [];
  grid.datagrid('loadData',{total:values.length,rows:values});
  grid.datagrid('options').pageNumber = page;
  grid.datagrid('getPager').pagination('refresh',{pageNumber:page,pageSize:2,total:page*2+(page<rows.length?1:0)});
 }
 grid.datagrid('getPager').pagination({pageSize:2,pageNumber:1,pageList:[2],layout:['prev','manual','next'],
  onSelectPage:function(page){
   fixture.requests++; grid.datagrid('options').pageNumber = page; grid.datagrid('loading');
   if(fixture.hang) return;
   setTimeout(function(){
    if(fixture.fail){ grid.datagrid('options').onLoadError.call(grid[0]); grid.datagrid('loaded'); return; }
    if(fixture.change) grid.datagrid('options').queryParams.sql='select changed_query';
    apply(page);
   }, fixture.delay);
  }
 });
 apply(1);
 return {grid,apply,success:grid.datagrid('options').onLoadSuccess,error:grid.datagrid('options').onLoadError};
}
fixture.first=setup('#selectDg0',pages);
fixture.second=setup('#selectDg1',[[{code:'S1',database_name:'other_db',table_name:'other_result',size:42,note:'second result'}]]);
fixture.expected=pages.flat().map(row=>['code','database_name','table_name','size','note'].map(k=>row[k]));
$('#searchTabs').tabs('select',0);
</script></body></html>`;

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>CDAS 本地测试</title><h1>CDAS 本地测试</h1><iframe title="查询窗口" src="/live" style="width:1020px;height:560px;border:0"></iframe></html>');
    } else if (url.pathname === "/live") {
      res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end(fixture);
    } else if (url.pathname === "/saved") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'none'; script-src 'none'; frame-src 'none'; connect-src 'none'");
      res.end(await readFile(path.join(localResources, "-1.html")));
    } else if (url.pathname.startsWith("/extension/")) {
      const relative = url.pathname.slice("/extension/".length);
      if (relative.includes("..")) throw new Error("Invalid path");
      const types = { ".html": "text/html; charset=utf-8", ".js": "application/javascript", ".mjs": "application/javascript", ".css": "text/css", ".png": "image/png" };
      res.setHeader("Content-Type", types[path.extname(relative)] || "application/octet-stream");
      res.end(await readFile(path.join(root, "extension", relative)));
    } else if (url.pathname.startsWith("/assets/") || /\.(css|png|jpg|svg)$/.test(url.pathname)) {
      const name = path.basename(decodeURIComponent(url.pathname));
      const type = name.endsWith(".js") ? "application/javascript" : name.endsWith(".css") ? "text/css" : "application/octet-stream";
      res.setHeader("Content-Type", type); res.end(await readFile(path.join(localResources, name)));
    } else { res.statusCode = 404; res.end(); }
  } catch { res.statusCode = 404; res.end(); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let context;
let exportPage;
let liveFrame;
const checks = [];
function pass(name) { checks.push(name); console.log("PASS", name); }
try {
  context = await chromium.launchPersistentContext(path.join(temp, "profile"), {
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    headless: true, acceptDownloads: true, viewport: { width: 1280, height: 1000 },
    ignoreDefaultArgs: ["--disable-extensions"],
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-extension-debugging", `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  // Captured intranet HTML is untrusted: all external connections are blocked.
  await context.route("**/*", (route) => {
    const url = route.request().url();
    return url.startsWith(origin + "/") || url.startsWith("chrome-extension:") || url.startsWith("blob:")
      ? route.continue() : route.abort();
  });
  let mode = "native-extension";
  if (!context.serviceWorkers().length) {
    const browserSession = await context.browser().newBrowserCDPSession();
    try { await browserSession.send("Extensions.loadUnpacked", { path: extension }); }
    catch (error) {
      if (!error.message.includes("disabled by the administrator")) throw error;
      mode = "web-harness";
      console.log("NOTICE: managed Chromium forbids unpacked extensions. Testing unchanged collector/UI with a test-only Chrome API bridge; native extension permissions are untested.");
    }
    await browserSession.detach();
  }
  const worker = mode === "native-extension"
    ? context.serviceWorkers()[0] || await context.waitForEvent("serviceworker", { timeout: 15000 }) : null;
  const extensionId = worker ? new URL(worker.url()).host : null;
  const source = await context.newPage(); await source.goto(origin);
  const frame = await (async () => {
    await source.frameLocator("iframe").locator("#selectDg0").waitFor({ state: "attached" });
    const result = source.frames().find((f) => f.url().endsWith("/live"));
    await result.waitForFunction(() => !!window.fixture?.expected);
    return result;
  })();
  liveFrame = frame;
  const tabId = worker ? await worker.evaluate(async (url) => (await chrome.tabs.query({})).find((t) => t.url === url).id, origin + "/") : 1;
  const ui = await context.newPage();
  exportPage = ui;
  if (mode === "web-harness") {
    await ui.exposeFunction("__cdasTestExecute", async (spec) => {
      const frames = source.frames().map((frame, frameId) => ({ frame, frameId }));
      const targets = spec.target.allFrames ? frames : frames.filter(({ frameId }) => spec.target.frameIds.includes(frameId));
      const results = [];
      for (const { frame, frameId } of targets) {
        let result;
        for (const file of spec.files || []) {
          await frame.evaluate(await readFile(path.join(root, "extension", file), "utf8"));
        }
        if (spec.functionSource) {
          result = await frame.evaluate(`(${spec.functionSource})(...${JSON.stringify(spec.args || [])})`);
        }
        results.push({ frameId, result });
      }
      return results;
    });
    await ui.addInitScript(() => {
      // Test bridge only. Production extension files remain unchanged.
      window.chrome ||= {};
      window.chrome.scripting = { executeScript: (spec) => window.__cdasTestExecute({
        target: spec.target, files: spec.files, functionSource: spec.func?.toString(), args: spec.args,
      }) };
      window.chrome.downloads = { download: async ({ url, filename }) => {
        const link = document.createElement("a"); link.href = url; link.download = filename; link.click();
        return 1;
      } };
    });
  }
  const consoleErrors = [];
  ui.on("pageerror", (error) => consoleErrors.push(error.message));
  await ui.goto(mode === "native-extension" ? `chrome-extension://${extensionId}/export.html?tab=${tabId}` : `${origin}/extension/export.html?tab=${tabId}`);
  await ui.waitForFunction(() => document.querySelector("#row-count").textContent === "2");
  assert.equal(await ui.locator("#source option").count(), 2);
  assert.equal(await ui.locator("#column-count").textContent(), "5");
  assert.match(await ui.locator("#preview").textContent(), /超过列宽但必须完整导出/);
  assert.equal(await frame.evaluate(() => fixture.requests), 0);
  pass("iframe discovery, raw EasyUI values, frozen/hidden/checkbox columns; current read makes no query");

  const downloadJson = async () => {
    const promise = ui.waitForEvent("download", { timeout: 15000 });
    await ui.locator("#json").click();
    const download = await promise;
    const value = JSON.parse(await readFile(await download.path(), "utf8"));
    return { value, filename: download.suggestedFilename() };
  };
  const current = await downloadJson();
  const expected = await frame.evaluate(() => fixture.expected);
  assert.deepEqual(current.value.rows, expected.slice(0, 2));
  assert.equal(current.value.scope, "current");
  pass("browser download exports a JSON file with unchanged values and NULL");

  await ui.locator("#collect").click();
  await ui.waitForFunction(() => document.querySelector("#row-count").textContent === "5" && !document.querySelector("#json").disabled);
  const all = await downloadJson();
  assert.deepEqual(all.value.rows, expected);
  assert.equal(all.value.complete, true);
  assert.equal(all.value.pagesCollected, 3);
  assert.equal(await frame.evaluate(() => fixture.requests), 2);
  assert.equal(await frame.evaluate(() => fixture.first.grid.datagrid("options").onLoadSuccess === fixture.first.success), true);
  pass("virtual totals, sequential pagination, duplicate preservation, and original callbacks restored");

  const csvPromise = ui.waitForEvent("download"); await ui.locator("#csv").click();
  const csvDownload = await csvPromise; const csv = await readFile(await csvDownload.path(), "utf8");
  assert.equal(csv[0], "\uFEFF"); assert.match(csv, /'=1\+1/); assert.match(csv, /""引号""/);
  pass("actual CSV download has UTF-8 BOM, correct quotes and spreadsheet formula protection");

  await ui.locator("#max-rows").fill("3"); await ui.locator("#collect").click();
  await ui.waitForFunction(() => document.querySelector("#row-count").textContent === "3" && !document.querySelector("#json").disabled);
  const partial = await downloadJson();
  assert.equal(partial.value.complete, false); assert.match(partial.filename, /未完成/);
  assert.deepEqual(partial.value.rows, expected.slice(0, 3));
  pass("restart from page one and row cap produce an explicitly incomplete file");

  await ui.locator("#max-rows").fill("50000"); await ui.locator("#max-pages").fill("1");
  await ui.locator("#collect").click();
  await ui.waitForFunction(() => document.querySelector("#row-count").textContent === "2" && !document.querySelector("#json").disabled);
  assert.match(await ui.locator("#result-note").textContent(), /最多页数/);
  pass("page limit is not reported as a complete query result");

  await frame.evaluate(() => { fixture.delay = 500; });
  await ui.locator("#max-pages").fill("100"); await ui.locator("#collect").click();
  await ui.waitForFunction(() => document.querySelector("#status").textContent.includes("第 2 页"));
  await ui.locator("#stop").click();
  await ui.waitForFunction(() => !document.querySelector("#json").disabled);
  assert.match(await ui.locator("#result-note").textContent(), /未完成/);
  assert.equal(await ui.locator("#row-count").textContent(), "2");
  assert.equal(await frame.evaluate(() => fixture.first.grid.datagrid("options").onLoadSuccess === fixture.first.success), true);
  pass("stop retains collected rows and restores the original page callback");
  await ui.waitForTimeout(650);

  const call = (action, payload) => frame.evaluate(([action, payload]) => window.__cdasResultExporterV1.command(action, payload), [action, payload]);
  await frame.evaluate(() => { fixture.delay = 20; fixture.hang = true; fixture.first.grid.datagrid("loaded"); });
  let state = (await call("read", { id: "selectDg0" })).result;
  const timeout = await call("page", { id: "selectDg0", pageNumber: 3, signature: state.signature, timeoutMs: 50 });
  assert.equal(timeout.ok, false); assert.match(timeout.error, /超时/);
  assert.equal(await frame.evaluate(() => fixture.first.grid.datagrid("options").onLoadSuccess === fixture.first.success), true);
  pass("a stalled page times out instead of silently exporting old rows");

  await frame.evaluate(() => { fixture.hang = false; fixture.fail = true; fixture.first.grid.datagrid("loaded"); });
  state = (await call("read", { id: "selectDg0" })).result;
  const failed = await call("page", { id: "selectDg0", pageNumber: 3, signature: state.signature });
  assert.equal(failed.ok, false); assert.match(failed.error, /失败/);
  assert.equal(await frame.evaluate(() => fixture.first.grid.datagrid("options").onLoadError === fixture.first.error), true);
  pass("load failure preserves existing error callbacks and does not return a success");

  await frame.evaluate(() => { fixture.fail = false; fixture.change = true; fixture.first.grid.datagrid("loaded"); });
  state = (await call("read", { id: "selectDg0" })).result;
  const changed = await call("page", { id: "selectDg0", pageNumber: 1, signature: state.signature });
  assert.equal(changed.ok, false); assert.match(changed.error, /查询或列已变化/);
  pass("query changes abort pagination before data from different queries can mix");

  await frame.evaluate(() => { fixture.change = false; $("#searchTabs").tabs("select", 1); });
  await ui.locator("#refresh").click();
  await ui.waitForFunction(() => document.querySelector("#row-count").textContent === "1");
  assert.match(await ui.locator("#source").inputValue(), /^0$/);
  assert.match(await ui.locator("#preview").textContent(), /other_result/);
  pass("active result tab is preferred when multiple query results exist");

  // Design previews use synthetic data only; uploaded intranet records never
  // enter the screenshots or the repository.
  await frame.evaluate(() => {
    const grid = fixture.first.grid;
    grid.datagrid({ frozenColumns: [], columns: [[
      { field: "database_name", title: "database_name", width: 180 },
      { field: "table_name", title: "table_name", width: 230 },
      { field: "total_required_size", title: "total_required_size", width: 150 },
    ]] });
    const names = ["orders_daily", "event_logs", "session_metrics", "customer_profiles", "product_catalog", "audit_history", "report_snapshots", "task_queue"];
    const sizes = ["97.73G", "74.34G", "58.58G", "42.58G", "29.11G", "20.55G", "10.58G", "6.19G"];
    const rows = Array.from({ length: 200 }, (_, i) => ({ database_name: "demo_analytics", table_name: names[i % names.length] + (i < 8 ? "" : `_${i}`), total_required_size: sizes[i % sizes.length] }));
    grid.datagrid("loadData", { total: 201, rows });
    grid.datagrid("options").pageNumber = 1;
    grid.datagrid("getPager").pagination("refresh", { pageNumber: 1, pageSize: 200, total: 201 });
    $("#searchTabs").tabs("getTab", 0).panel("setTitle", "演示结果");
    $("#searchTabs").tabs("select", 0);
  });
  await ui.locator("#refresh").click();
  await ui.waitForFunction(() => document.querySelector("#row-count").textContent === "200");
  const requestsBeforeNavigation = await frame.evaluate(() => fixture.requests);
  const summary = ui.locator("#guide summary");
  await summary.focus(); await ui.keyboard.press("Enter");
  assert.equal(await ui.locator("#guide details").getAttribute("open"), "");
  assert.match(await ui.locator(".guide-content").textContent(), /NULL/);
  await ui.keyboard.press("Enter");
  await ui.locator('nav a[href="#results"]').click();
  await ui.locator(".table-wrap").focus();
  const focusStyle = await ui.locator(".table-wrap").evaluate((el) => getComputedStyle(el).outlineWidth);
  assert.equal(focusStyle, "3px");
  assert.equal(await frame.evaluate(() => fixture.requests), requestsBeforeNavigation);
  pass("keyboard disclosure, visible table focus and page navigation without new query requests");

  await ui.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(await ui.locator("#csv").evaluate((el) => getComputedStyle(el).transitionDuration), "0s");
  assert.equal(await ui.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior), "auto");
  pass("reduced motion disables transitions and smooth scrolling");

  await mkdir(path.join(root, "docs"), { recursive: true });
  for (const width of [375, 650, 768, 1024, 1440]) {
    await ui.setViewportSize({ width, height: 1000 });
    await ui.evaluate(() => { document.activeElement?.blur(); window.scrollTo({ top: 0, behavior: "instant" }); });
    assert.equal(await ui.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Page overflow at ${width}px`);
    const sourceBounds = await ui.locator("#source").boundingBox();
    assert.ok(sourceBounds.x >= 0 && sourceBounds.x + sourceBounds.width <= width);
    if (width === 1440 || width === 375) {
      // Paint the full document in one viewport; Chromium can otherwise omit
      // offscreen backdrop-filter children in full-page screenshots.
      const height = await ui.evaluate(() => document.documentElement.scrollHeight);
      await ui.setViewportSize({ width, height });
      await ui.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
      await ui.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await ui.screenshot({ path: path.join(root, "docs", `ui-${width === 1440 ? "desktop" : "mobile"}.png`), fullPage: true });
    }
  }
  await ui.setViewportSize({ width: 375, height: 1000 });
  await ui.locator("#export-heading").scrollIntoViewIfNeeded();
  await ui.screenshot({ path: path.join(root, "test-results", "mobile-result-viewport.png") });
  await ui.emulateMedia({ reducedMotion: "no-preference" });
  pass("Lens layout fits 375/650/768/1024/1440px and keeps controls within viewport");

  await mkdir(path.join(root, "test-results"), { recursive: true });
  await ui.screenshot({ path: path.join(root, "test-results", "export-ui.png"), fullPage: true });
  await ui.setViewportSize({ width: 650, height: 1000 });
  assert.equal(await ui.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  pass("export interface works at a narrow viewport without page overflow");

  await source.goto(origin + "/saved");
  await source.locator("#selectDg0").waitFor({ state: "attached" });
  await ui.locator("#refresh").click();
  await ui.waitForFunction(() => document.querySelector("#row-count").textContent === "200");
  assert.equal(await ui.locator("#column-count").textContent(), "3");
  assert.equal(await ui.locator("#collect").isDisabled(), true);
  const saved = await downloadJson();
  assert.equal(saved.value.rows.length, 200);
  assert.equal(saved.value.rows[0].length, 3);
  const reference = await source.evaluate(() => [...document.querySelectorAll(".datagrid-view2 .datagrid-btable tr[datagrid-row-index]")]
    .map((row) => [...row.querySelectorAll("td[field]")]
      .filter((cell) => !cell.querySelector(".datagrid-cell-check"))
      .map((cell) => (cell.querySelector(".datagrid-cell") || cell).textContent)));
  assert.deepEqual(saved.value.rows, reference);
  pass("supplied saved result page exports every one of its 200 rows and 3 data columns");
  assert.deepEqual(consoleErrors, []);
  pass("extension interface has no uncaught JavaScript errors");
  await writeFile(path.join(root, "test-results", "browser-report.json"), JSON.stringify({ mode, nativeExtensionLoaded: mode === "native-extension", passed: checks.length, checks }, null, 2));
  console.log(`Browser checks passed: ${checks.length}`);
} catch (error) {
  console.error("Test failure status:", await exportPage?.locator("#status").textContent().catch(() => "unavailable"));
  console.error("Result note:", await exportPage?.locator("#result-note").textContent().catch(() => "unavailable"));
  console.error("Synthetic fixture state:", await liveFrame?.evaluate(() => ({ requests: fixture.requests, loaded: fixture.loaded,
    page: fixture.first.grid.datagrid("getPager").pagination("options").pageNumber,
    total: fixture.first.grid.datagrid("getPager").pagination("options").total,
    pageSize: fixture.first.grid.datagrid("getPager").pagination("options").pageSize,
  })).catch(() => "unavailable"));
  throw error;
} finally {
  await context?.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(temp, { recursive: true, force: true });
}
