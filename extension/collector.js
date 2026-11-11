/* Runs on demand in the page's MAIN world so EasyUI's raw rows are available. */
(() => {
  "use strict";
  const KEY = "__cdasResultExporterV1";
  if (window[KEY]?.version === 1) return;
  const pending = new Map();

  function jq() {
    const candidate = window.jQuery || window.$;
    return candidate?.fn?.datagrid ? candidate : null;
  }

  function getGrid(id) {
    const element = document.getElementById(id);
    if (!element || !/^selectDg\d+$/.test(id)) {
      throw new Error("结果表格已关闭，请重新识别页面。");
    }
    const $ = jq();
    const grid = $ && $.data(element, "datagrid") ? $(element) : null;
    return { element, grid };
  }

  function text(html) {
    const template = document.createElement("template");
    template.innerHTML = String(html ?? "");
    return template.content.textContent.trim();
  }

  function hash(value) {
    let result = 2166136261;
    for (let i = 0; i < value.length; i++) {
      result = Math.imul(result ^ value.charCodeAt(i), 16777619);
    }
    return (result >>> 0).toString(16);
  }

  function title(element) {
    const $ = jq();
    const tabs = document.getElementById("searchTabs");
    if ($ && tabs && $.data(tabs, "tabs")) {
      for (const panel of $(tabs).tabs("tabs")) {
        if (panel[0].contains(element)) return text(panel.panel("options").title);
      }
    }
    return `结果 ${Number(element.id.replace("selectDg", "")) + 1}`;
  }

  function visible(element) {
    return !!element && element.getClientRects().length > 0;
  }

  function snapshot(id) {
    const { element, grid } = getGrid(id);
    if (!grid) return domSnapshot(element);

    const options = grid.datagrid("options");
    const fields = [...new Set([
      ...grid.datagrid("getColumnFields", true),
      ...grid.datagrid("getColumnFields", false),
    ])];
    const columns = fields.flatMap((field) => {
      const column = grid.datagrid("getColumnOption", field);
      if (!column || column.checkbox || column.hidden) return [];
      return [{ field, title: text(column.title) || field }];
    });
    const rows = grid.datagrid("getRows").map((row) =>
      columns.map(({ field }) => row[field] === undefined ? null : row[field]));
    const panel = grid.datagrid("getPanel")[0];
    const pager = grid.datagrid("getPager");
    const pagerOptions = pager.length ? pager.pagination("options") : null;
    const pageNumber = Number(pagerOptions?.pageNumber || options.pageNumber || 1);
    const pageSize = Number(pagerOptions?.pageSize || options.pageSize || rows.length);
    const canPage = !!(options.pagination && pagerOptions &&
      typeof pagerOptions.onSelectPage === "function");
    const params = options.queryParams || {};
    const signature = hash(JSON.stringify({
      id, columns,
      query: [params.sql, params.execSql, params.databaseName, params.databaseType,
        params.centerCode, params.sqlLimit, params.rowLimit, params.sqlType,
        options.sortName, options.sortOrder],
    }));
    return {
      id, title: title(element), mode: "easyui", columns, rows,
      pageNumber, pageSize, canPage,
      hasNext: canPage && pageNumber * pageSize < Number(pagerOptions.total),
      signature,
      busy: [...panel.querySelectorAll(".datagrid-mask")].some(visible),
      active: visible(panel),
    };
  }

  // Saved HTML has no jQuery data cache. Read its frozen and normal columns together.
  function domSnapshot(element) {
    const view = element.closest(".datagrid-view");
    if (!view) throw new Error("未找到结果表格的内容，请在 CDAS 中重新查询。");
    const columns = [];
    for (const cell of view.querySelectorAll(".datagrid-header td[field]")) {
      const field = cell.getAttribute("field");
      if (cell.querySelector(".datagrid-header-check, input[type=checkbox]") ||
          cell.style.display === "none" || columns.some((c) => c.field === field)) continue;
      columns.push({ field, title: (cell.querySelector(".datagrid-cell")?.textContent ||
        cell.textContent).trim() || field });
    }
    const byIndex = new Map();
    for (const row of view.querySelectorAll(".datagrid-body .datagrid-btable tr[datagrid-row-index]")) {
      const index = Number(row.getAttribute("datagrid-row-index"));
      if (!byIndex.has(index)) byIndex.set(index, new Map());
      for (const cell of row.querySelectorAll("td[field]")) {
        byIndex.get(index).set(cell.getAttribute("field"),
          (cell.querySelector(".datagrid-cell") || cell).textContent);
      }
    }
    const rows = [...byIndex].sort((a, b) => a[0] - b[0])
      .map(([, cells]) => columns.map(({ field }) => cells.get(field) ?? ""));
    const panel = view.closest(".datagrid-wrap") || view.parentElement;
    const pageNumber = Number(panel.querySelector(".pagination-num")?.value) || 1;
    return {
      id: element.id, title: title(element), mode: "dom", columns, rows,
      pageNumber, pageSize: rows.length, canPage: false, hasNext: false,
      signature: hash(JSON.stringify([element.id, columns])), busy: false,
      active: visible(view),
    };
  }

  async function page({ id, pageNumber, signature, timeoutMs = 30000 }) {
    if (!Number.isSafeInteger(pageNumber) || pageNumber < 1) throw new Error("无效页码。");
    const before = snapshot(id);
    if (before.signature !== signature) throw new Error("查询或列已变化，请重新读取结果。");
    if (!before.canPage) throw new Error("此结果不能自动翻页。保存的网页仅支持当前页导出。");
    if (before.busy || pending.has(id)) throw new Error("页面正在加载，请等待后重试。");
    const { grid } = getGrid(id);
    const options = grid.datagrid("options");
    const pager = grid.datagrid("getPager");
    return new Promise((resolve, reject) => {
      const originalSuccess = options.onLoadSuccess;
      const originalError = options.onLoadError;
      let settled = false;
      let timer;
      function finish(error, result) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (options.onLoadSuccess === onSuccess) options.onLoadSuccess = originalSuccess;
        if (options.onLoadError === onError) options.onLoadError = originalError;
        pending.delete(id);
        if (error) reject(error); else resolve(result);
      }
      function onSuccess(...args) {
        try {
          originalSuccess?.apply(this, args);
        } catch (error) {
          finish(new Error("页面自身的加载回调失败，请检查 CDAS 状态。"));
          throw error;
        }
        // CDAS refreshes pager state immediately after loadData returns.
        setTimeout(function checkLoaded() {
          if (settled) return;
          try {
            const result = snapshot(id);
            if (result.signature !== signature) throw new Error("查询或列已变化，已停止收集。");
            // EasyUI may still run a deferred pager/render pass after loadData.
            // Wait for its loading mask to clear instead of returning a stale page.
            if (result.busy) { setTimeout(checkLoaded, 40); return; }
            if (result.pageNumber !== pageNumber) throw new Error("页码未按预期变化，已停止收集。");
            finish(null, result);
          } catch (error) { finish(error); }
        }, 0);
      }
      function onError(...args) {
        try { originalError?.apply(this, args); }
        finally { finish(new Error(`第 ${pageNumber} 页加载失败，已保留之前的结果。`)); }
      }
      options.onLoadSuccess = onSuccess;
      options.onLoadError = onError;
      pending.set(id, () => finish(new Error("已停止。页面当前的请求可能仍会完成。")));
      timer = setTimeout(() => finish(new Error(
        `第 ${pageNumber} 页等待超时，已停止收集。请检查登录状态或 CDAS 查询消息。`)), timeoutMs);
      try { pager.pagination("select", pageNumber); }
      catch (error) { finish(error); }
    });
  }

  async function command(action, payload = {}) {
    try {
      if (action === "scan") {
        const grids = [...document.querySelectorAll('table[id^="selectDg"]')]
          .filter((element) => /^selectDg\d+$/.test(element.id));
        const results = [];
        for (const element of grids) {
          try {
            const result = snapshot(element.id);
            const { rows, ...meta } = result;
            results.push({ ...meta, rowCount: rows.length });
          } catch { /* A closed/uninitialized result is not exportable. */ }
        }
        return { ok: true, results };
      }
      if (action === "read") return { ok: true, result: snapshot(payload.id) };
      if (action === "page") return { ok: true, result: await page(payload) };
      if (action === "cancel") {
        pending.get(payload.id)?.();
        return { ok: true };
      }
      throw new Error("未知操作。");
    } catch (error) { return { ok: false, error: error.message || String(error) }; }
  }

  Object.defineProperty(window, KEY, {
    value: Object.freeze({ version: 1, command }), configurable: true,
  });
})();
