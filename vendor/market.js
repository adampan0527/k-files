(function () {
  const vscode = acquireVsCodeApi();

  const BASE_TIME = 1704067200;

  /** Read CSS variables for K-line colors */
  function getKfilesColors() {
    const root = getComputedStyle(document.documentElement);
    const up = root.getPropertyValue("--kfiles-up").trim();
    const down = root.getPropertyValue("--kfiles-down").trim();
    const upRgb = root.getPropertyValue("--kfiles-up-rgb").trim();
    const downRgb = root.getPropertyValue("--kfiles-down-rgb").trim();
    const volAlpha = colorTone === "dark" ? 0.6 : 0.45;
    return {
      up,
      down,
      upVol: `rgba(${upRgb}, ${volAlpha})`,
      downVol: `rgba(${downRgb}, ${volAlpha})`,
    };
  }

  function candlestickSeriesOptions(colors) {
    return {
      upColor: colors.up,
      downColor: colors.down,
      borderVisible: true,
      borderUpColor: colors.up,
      borderDownColor: colors.down,
      wickVisible: true,
      wickUpColor: colors.up,
      wickDownColor: colors.down,
    };
  }

  let chart = null;
  let candleSeries = null;
  let volumeSeries = null;
  const metaByTime = new Map();
  let lastCandles = [];
  let lastSelectedFile = null;
  let lastSelectedFolder = null;
  let lastRenderedFile = null;
  let lastSeriesLength = 0;
  let lastSymbols = [];
  let lastMissingFiles = new Set();
  const candlesByFile = new Map();
  let colorScheme = "cn";
  let colorTone = "light";
  let schemeSwitchBound = false;
  let toneSwitchBound = false;
  let symbolListBound = false;
  let userAdjustedViewport = false;

  /* ---- File tree state ---- */
  let fileTree = null;

  const SCHEME_LEGEND = { cn: "红涨绿跌", us: "绿涨红跌" };

  const els = {
    banner: document.getElementById("banner"),
    symbolList: document.getElementById("symbol-list"),
    symbolCount: document.getElementById("symbol-count"),
    emptyHint: document.getElementById("empty-hint"),
    chartTitle: document.getElementById("chart-title"),
    chartLegend: document.getElementById("chart-legend"),
    schemeSwitch: document.querySelector(
      '.scheme-switch:not(.tone-switch)'
    ),
    toneSwitch: document.querySelector(".tone-switch"),
    chartContainer: document.getElementById("chart-container"),
    chartError: document.getElementById("chart-error"),
    ohlcRound: document.getElementById("ohlc-round"),
    ohlcOpen: document.getElementById("ohlc-open"),
    ohlcHigh: document.getElementById("ohlc-high"),
    ohlcLow: document.getElementById("ohlc-low"),
    ohlcClose: document.getElementById("ohlc-close"),
    ohlcVolume: document.getElementById("ohlc-volume"),
  };

  function formatNet(n) {
    return (n > 0 ? "+" : "") + n;
  }

  function legendText() {
    const market = SCHEME_LEGEND[colorScheme];
    const tone = colorTone === "dark" ? " · 暗色" : "";
    return "开/收=阶段起止行数；同轮先删后增拆为两根K线 · " + market + tone;
  }

  function applyMarketColors(scheme, tone) {
    const nextScheme = scheme === "us" ? "us" : "cn";
    const nextTone = tone === "dark" ? "dark" : "light";
    const changed = nextScheme !== colorScheme || nextTone !== colorTone;
    colorScheme = nextScheme;
    colorTone = nextTone;
    document.documentElement.dataset.colorScheme = colorScheme;
    document.documentElement.dataset.colorTone = colorTone;
    document.body.dataset.colorScheme = colorScheme;
    document.body.dataset.colorTone = colorTone;
    els.schemeSwitch?.querySelectorAll(".scheme-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.scheme === colorScheme);
    });
    els.toneSwitch?.querySelectorAll(".scheme-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tone === colorTone);
    });
    if (els.chartLegend) {
      els.chartLegend.textContent = legendText();
    }
    const activeKey = lastSelectedFile || lastSelectedFolder;
    if (changed && candleSeries && lastCandles.length && activeKey) {
      renderChart(activeKey, lastCandles, { preserveViewport: true });
    } else if (candleSeries) {
      candleSeries.applyOptions(candlestickSeriesOptions(getKfilesColors()));
    }
  }

  function bindSchemeSwitch() {
    if (schemeSwitchBound || !els.schemeSwitch) {
      return;
    }
    schemeSwitchBound = true;
    els.schemeSwitch.querySelectorAll(".scheme-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const next = btn.dataset.scheme === "us" ? "us" : "cn";
        if (next === colorScheme) {
          return;
        }
        vscode.postMessage({ type: "setColorScheme", scheme: next });
      });
    });
  }

  function bindToneSwitch() {
    if (toneSwitchBound || !els.toneSwitch) {
      return;
    }
    toneSwitchBound = true;
    els.toneSwitch.querySelectorAll(".scheme-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const next = btn.dataset.tone === "dark" ? "dark" : "light";
        if (next === colorTone) {
          return;
        }
        vscode.postMessage({ type: "setColorTone", tone: next });
      });
    });
  }

  /* ---- File tree builder ---- */

  function buildFileTree(symbols) {
    const root = { name: "", path: "", children: [], files: [] };

    for (const sym of symbols) {
      const parts = sym.file.split("/");
      let current = root;

      for (let i = 0; i < parts.length - 1; i++) {
        let child = current.children.find((c) => c.name === parts[i]);
        if (!child) {
          child = {
            name: parts[i],
            path: parts.slice(0, i + 1).join("/"),
            children: [],
            files: [],
          };
          current.children.push(child);
        }
        current = child;
      }

      current.files.push(sym);
    }

    return root;
  }

  function collectAllFiles(node) {
    let result = [].concat(node.files);
    for (const child of node.children) {
      result = result.concat(collectAllFiles(child));
    }
    return result;
  }

  function findNodeByPath(node, path) {
    if (node.path === path) return node;
    for (const child of node.children) {
      const found = findNodeByPath(child, path);
      if (found) return found;
    }
    return null;
  }

  function collectExpandStates(node, map) {
    if (node.path !== "" && node._expanded) {
      map.set(node.path, true);
    }
    for (const child of node.children) {
      collectExpandStates(child, map);
    }
  }

  function applyExpandStates(node, map) {
    if (map.has(node.path)) {
      node._expanded = true;
    }
    for (const child of node.children) {
      applyExpandStates(child, map);
    }
  }

  function symbolItemFromEvent(event) {
    const target = event.target;
    const element =
      target instanceof Element ? target : target?.parentElement ?? null;
    return element?.closest?.(".symbol-item") ?? null;
  }

  /* ---- Bind symbol list (updated for tree) ---- */

  function bindSymbolList() {
    if (symbolListBound || !els.symbolList) {
      return;
    }
    symbolListBound = true;

    const eventName = window.PointerEvent ? "pointerdown" : "click";
    els.symbolList.addEventListener(eventName, (event) => {
      if (eventName === "pointerdown" && event.button !== 0) {
        return;
      }
      const item = symbolItemFromEvent(event);
      if (!item) {
        return;
      }

      /* Toggle button? */
      const isToggle = !!event.target.closest(".tree-toggle");
      if (isToggle && item.dataset.folder != null) {
        event.preventDefault();
        toggleFolder(item.dataset.folder);
        return;
      }

      /* Folder or file click */
      if (item.dataset.folder != null) {
        event.preventDefault();
        selectFolder(item.dataset.folder);
      } else if (item.dataset.file) {
        event.preventDefault();
        selectSymbol(item.dataset.file);
      }
    });

    els.symbolList.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }
      const item = symbolItemFromEvent(event);
      if (!item) {
        return;
      }
      if (item.dataset.folder != null) {
        event.preventDefault();
        selectFolder(item.dataset.folder);
      } else if (item.dataset.file) {
        event.preventDefault();
        selectSymbol(item.dataset.file);
      }
    });
  }

  function selectSymbol(file) {
    lastSelectedFile = file;
    lastSelectedFolder = null;
    const states = new Map();
    if (fileTree) collectExpandStates(fileTree, states);
    renderSymbols(lastSymbols, file, states);

    const cachedCandles = candlesByFile.get(file);
    if (cachedCandles) {
      renderChart(file, cachedCandles);
    } else {
      els.chartTitle.textContent = file + "（加载中…）";
      updateOhlcBar(null);
    }

    vscode.postMessage({ type: "selectSymbol", file });
  }

  function selectFolder(path) {
    lastSelectedFolder = path;
    lastSelectedFile = null;
    const states = new Map();
    if (fileTree) collectExpandStates(fileTree, states);
    renderSymbols(lastSymbols, null, states);

    /* Aggregate candles from all child files */
    const node = fileTree ? findNodeByPath(fileTree, path) : null;
    if (node) {
      const allFiles = collectAllFiles(node);
      const merged = [];
      for (const sym of allFiles) {
        const fileCandles = candlesByFile.get(sym.file);
        if (fileCandles) {
          for (const c of fileCandles) {
            merged.push(c);
          }
        }
      }
      merged.sort(function (a, b) {
        return (a.edit_index || 0) - (b.edit_index || 0);
      });

      const displayName = path || "项目";
      if (merged.length) {
        renderChart(displayName, merged);
      } else {
        els.chartTitle.textContent = displayName + "（聚合中…）";
        updateOhlcBar(null);
      }
    } else {
      const displayName = path || "项目";
      els.chartTitle.textContent = displayName + "（聚合中…）";
      updateOhlcBar(null);
    }
  }

  function toggleFolder(path) {
    if (!fileTree) return;
    const node = findNodeByPath(fileTree, path);
    if (node) {
      node._expanded = !node._expanded;
      const states = new Map();
      collectExpandStates(fileTree, states);
      renderSymbols(lastSymbols, lastSelectedFile, states);
    }
  }

  function bindChartViewportInteractions() {
    const markAdjusted = () => {
      userAdjustedViewport = true;
    };
    els.chartContainer.addEventListener("wheel", markAdjusted, { passive: true });
    els.chartContainer.addEventListener("pointerdown", markAdjusted);
    els.chartContainer.addEventListener("touchstart", markAdjusted, {
      passive: true,
    });
  }

  function showChartError(msg) {
    if (els.chartError) {
      els.chartError.textContent = msg;
      els.chartError.classList.remove("hidden");
    }
  }

  function hideChartError() {
    els.chartError?.classList.add("hidden");
  }

  function candleToBar(c) {
    const open = c.open;
    const close = c.close;
    let high = c.high;
    let low = c.low;
    high = Math.max(high, open, close);
    low = Math.min(low, open, close);
    if (high <= low) {
      high = low + 1;
    }
    return { open, high, low, close };
  }

  function buildSeries(candles) {
    metaByTime.clear();
    const series = [];
    let lastTime = 0;

    candles.forEach((c, i) => {
      const idx = c.edit_index ?? i + 1;
      const sub = c.sub_step ?? 0;
      let time = BASE_TIME + idx * 3600 + sub * 900;
      if (time <= lastTime) {
        time = lastTime + 900;
      }
      lastTime = time;

      const bar = candleToBar(c);
      series.push({
        time,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
      });
      metaByTime.set(time, {
        edit_index: idx,
        volume: c.volume,
        is_ipo: c.is_ipo,
        leg: c.leg,
        raw: c,
      });
    });

    return series;
  }

  function setCloseTrendClass(open, close) {
    const item = els.ohlcClose?.closest(".ohlc-item");
    if (!item) {
      return;
    }
    item.classList.remove("ohlc-up", "ohlc-down");
    if (close > open) {
      item.classList.add("ohlc-up");
    } else if (close < open) {
      item.classList.add("ohlc-down");
    }
  }

  function updateOhlcBar(meta) {
    if (!meta) {
      ["ohlcRound", "ohlcOpen", "ohlcHigh", "ohlcLow", "ohlcClose", "ohlcVolume"].forEach(
        (k) => {
          if (els[k]) {
            els[k].textContent = "—";
          }
        }
      );
      setCloseTrendClass(0, 0);
      return;
    }
    const c = meta.raw;
    const legLabel =
      meta.leg === "drop" ? " 删" : meta.leg === "rise" ? " 增" : "";
    els.ohlcRound.textContent =
      String(meta.edit_index) +
      legLabel +
      (meta.is_ipo ? " 上市" : "");
    els.ohlcOpen.textContent = String(c.open);
    els.ohlcHigh.textContent = String(c.high);
    els.ohlcLow.textContent = String(c.low);
    els.ohlcClose.textContent = String(c.close);
    els.ohlcVolume.textContent = String(meta.volume);
    setCloseTrendClass(c.open, c.close);
  }

  function resizeChart() {
    if (!chart || !els.chartContainer) {
      return;
    }
    const w = els.chartContainer.clientWidth;
    const h = els.chartContainer.clientHeight;
    if (w > 0 && h > 0) {
      chart.applyOptions({ width: w, height: h });
    }
  }

  function ensureChart() {
    if (chart) {
      return true;
    }

    if (typeof LightweightCharts === "undefined") {
      showChartError(
        "图表库未加载。请在 extension 目录执行: npm install && npm run compile，然后 Reload Window。"
      );
      return false;
    }

    hideChartError();

    const isDark =
      document.body.classList.contains("vscode-dark") ||
      document.body.classList.contains("vscode-high-contrast");

    const w = Math.max(els.chartContainer.clientWidth, 200);
    const h = Math.max(els.chartContainer.clientHeight, 160);

    chart = LightweightCharts.createChart(els.chartContainer, {
      width: w,
      height: h,
      layout: {
        background: { color: "transparent" },
        textColor: isDark ? "#ccc" : "#333",
      },
      grid: {
        vertLines: { color: isDark ? "#333" : "#eee" },
        horzLines: { color: isDark ? "#333" : "#eee" },
      },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false },
    });

    const colors = getKfilesColors();
    candleSeries = chart.addCandlestickSeries(candlestickSeriesOptions(colors));

    volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "",
    });

    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    candleSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.05, bottom: 0.25 },
    });

    chart.subscribeCrosshairMove((param) => {
      if (!param.time) {
        return;
      }
      const meta = metaByTime.get(param.time);
      if (meta) {
        updateOhlcBar(meta);
      }
    });

    bindChartViewportInteractions();
    new ResizeObserver(() => resizeChart()).observe(els.chartContainer);
    return true;
  }

  function isNearLatestRange(range, seriesLength) {
    return Boolean(range && seriesLength > 0 && range.to >= seriesLength - 1.5);
  }

  function shiftRangeBy(range, delta) {
    return {
      from: range.from + delta,
      to: range.to + delta,
    };
  }

  function renderChart(key, candles, options = {}) {
    lastCandles = candles ?? [];
    const previousFile = lastRenderedFile;
    const isFolderView = !candlesByFile.has(key);
    const delisted = !isFolderView &&
      normalizeSymbols(lastSymbols).some(
        (s) => s.file === key && s.is_delisted
      );

    els.chartTitle.textContent = key
      ? key +
        (delisted ? " · ST退市" : "") +
        "（" + lastCandles.length + " 根 K 线）"
      : "选择一只股票";

    if (!key || !lastCandles.length) {
      if (candleSeries) {
        candleSeries.setData([]);
        volumeSeries?.setData([]);
      }
      updateOhlcBar(null);
      lastRenderedFile = key ?? null;
      lastSeriesLength = 0;
      return;
    }

    if (!ensureChart()) {
      return;
    }

    const colors = getKfilesColors();
    candleSeries.applyOptions(candlestickSeriesOptions(colors));

    const series = buildSeries(lastCandles);
    const vol = series.map((bar, i) => {
      const c = lastCandles[i];
      const up = c.close >= c.open;
      return {
        time: bar.time,
        value: c.volume ?? 0,
        color: up ? colors.upVol : colors.downVol,
      };
    });

    const sameFile = key === previousFile;
    const previousRange = sameFile
      ? chart.timeScale().getVisibleLogicalRange()
      : null;
    const wasNearLatest = isNearLatestRange(previousRange, lastSeriesLength);

    candleSeries.setData(series);
    volumeSeries.setData(vol);
    if (options.preserveViewport && previousRange) {
      chart.timeScale().setVisibleLogicalRange(previousRange);
    } else if (sameFile && userAdjustedViewport && previousRange) {
      if (wasNearLatest) {
        chart.timeScale().setVisibleLogicalRange(
          shiftRangeBy(previousRange, series.length - lastSeriesLength)
        );
      } else {
        chart.timeScale().setVisibleLogicalRange(previousRange);
      }
    } else {
      chart.timeScale().fitContent();
    }
    resizeChart();
    lastRenderedFile = key;
    lastSeriesLength = series.length;
    if (!sameFile) {
      userAdjustedViewport = false;
    }

    const last = series[series.length - 1];
    updateOhlcBar(metaByTime.get(last.time));
  }

  function trendArrowMarkup(trend) {
    if (trend === "up") {
      return '<span class="trend-arrow trend-up" title="上次修改：行数上涨">▲</span>';
    }
    if (trend === "down") {
      return '<span class="trend-arrow trend-down" title="上次修改：行数下跌">▼</span>';
    }
    if (trend === "flat") {
      return '<span class="trend-arrow trend-flat" title="上次修改：行数持平">—</span>';
    }
    return '<span class="trend-arrow trend-none" title="暂无修改记录">·</span>';
  }

  function isSymbolDelisted(s) {
    return Boolean(s.is_delisted || lastMissingFiles.has(s.file));
  }

  function normalizeSymbols(symbols) {
    return (symbols ?? []).map((s) => ({
      ...s,
      is_delisted: isSymbolDelisted(s),
    }));
  }

  /* ---- Tree rendering ---- */

  function renderSymbols(symbols, activeFile, expandStates) {
    const list = normalizeSymbols(symbols);
    els.symbolList.innerHTML = "";
    els.symbolCount.textContent = String(list.length);
    els.emptyHint.classList.toggle("hidden", list.length > 0);

    fileTree = buildFileTree(list);

    /* Root expanded by default, children collapsed unless in expandStates */
    fileTree._expanded = true;
    if (expandStates) {
      applyExpandStates(fileTree, expandStates);
    }

    renderTreeNode(fileTree, els.symbolList, 0, activeFile);
  }

  function renderTreeNode(node, parentUl, depth, activeFile) {
    const isRoot = depth === 0 && node.path === "";
    const li = document.createElement("li");
    li.className = "symbol-item tree-folder";
    li.dataset.folder = node.path;
    li.tabIndex = 0;
    li.style.paddingLeft = (6 + depth * 12) + "px";

    const isActiveFolder = lastSelectedFolder === node.path;
    if (isActiveFolder) {
      li.classList.add("active");
    }

    /* Aggregate stats */
    const allFiles = collectAllFiles(node);
    const totalEditCount = allFiles.reduce(function (sum, s) {
      return sum + (s.edit_count || 0);
    }, 0);
    const totalNet = allFiles.reduce(function (sum, s) {
      return sum + (s.total_net || 0);
    }, 0);

    const toggleChar = node._expanded ? "\u25BC" : "\u25B6";
    const displayName = isRoot
      ? (node.name || "项目")
      : node.name;

    li.innerHTML =
      '<span class="tree-toggle">' + toggleChar + '</span>' +
      '<div class="symbol-body">' +
        '<div class="symbol-name">' +
          escapeHtml(displayName) +
        '</div>' +
        '<div class="symbol-meta">' +
          totalEditCount + ' 笔 · 净' + formatNet(totalNet) +
        '</div>' +
      '</div>';

    parentUl.appendChild(li);

    /* Render children when expanded */
    if (node._expanded) {
      /* Folders first */
      for (const child of node.children) {
        renderTreeNode(child, parentUl, depth + 1, activeFile);
      }

      /* Then files */
      for (const s of node.files) {
        renderFileNode(s, parentUl, depth + 1, activeFile);
      }
    }
  }

  function renderFileNode(s, parentUl, depth, activeFile) {
    const li = document.createElement("li");
    li.className = "symbol-item tree-file";
    li.dataset.file = s.file;
    li.tabIndex = 0;
    li.style.paddingLeft = (6 + depth * 12) + "px";

    if (s.file === activeFile && !lastSelectedFolder) {
      li.classList.add("active");
    }
    if (s.is_delisted) {
      li.classList.add("delisted");
    } else if (s.is_new) {
      li.classList.add("ipo");
    } else if (s.is_recent) {
      li.classList.add("recent-edit");
    }

    li.innerHTML =
      trendArrowMarkup(s.is_delisted ? null : s.last_trend) +
      '<div class="symbol-body">' +
        '<div class="symbol-name">' +
          escapeHtml(s.file.split("/").pop()) +
          (s.is_delisted
            ? '<span class="badge-activity badge-delisted">ST退市</span>'
            : "") +
          (s.is_new
            ? '<span class="badge-activity badge-new">新</span>'
            : "") +
          (s.is_recent
            ? '<span class="badge-activity badge-recent">改</span>'
            : "") +
        '</div>' +
        '<div class="symbol-meta">' +
          s.edit_count + ' 笔 · ' + s.last_lines + ' 行 · 净' + formatNet(s.total_net) +
        '</div>' +
      '</div>';

    parentUl.appendChild(li);
  }

  function shortName(file) {
    const p = file.split("/");
    return p.length <= 2 ? file : p.slice(-2).join("/");
  }

  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function updateBanner(payload) {
    const onSave = payload.captureOnSave !== false;
    if (!payload.captureEnabled) {
      els.banner.textContent =
        "未启用采集。请保存文件（kfiles.capture.onSave）或安装 Hooks 记录 Agent。";
      els.banner.classList.remove("hidden");
      return;
    }
    if (!payload.hooksOk && onSave) {
      els.banner.textContent =
        "已记录保存时的编辑。安装 Hooks 可同时记录 Agent：「KFiles: 安装项目 Hooks」";
      els.banner.classList.remove("hidden");
      if (payload.symbols?.length) {
        return;
      }
    }
    if (!payload.symbols?.length) {
      els.banner.textContent = onSave
        ? "保存工作区文件或让 Agent 修改后，此处会出现股票列表。"
        : "用 Agent 修改文件后，此处会出现股票列表。";
      els.banner.classList.remove("hidden");
      return;
    }
    if (!payload.hooksOk && onSave) {
      return;
    }
    els.banner.classList.add("hidden");
  }

  window.addEventListener("message", (event) => {
    if (event.data?.type !== "marketUpdate") {
      return;
    }
    const payload = event.data.payload;
    // Don't reset lastSelectedFolder on marketUpdate
    // Only set lastSelectedFile from payload if we're not in folder view
    if (!lastSelectedFolder) {
      lastSelectedFile = payload.selectedFile ?? null;
    }
    Object.entries(payload.candles ?? {}).forEach(([file, candles]) => {
      candlesByFile.set(file, candles ?? []);
    });
    applyMarketColors(payload.colorScheme, payload.colorTone);
    bindSchemeSwitch();
    bindToneSwitch();
    bindSymbolList();
    updateBanner(payload);
    lastMissingFiles = new Set(payload.missingFiles ?? []);
    lastSymbols = payload.symbols ?? [];
    renderSymbols(lastSymbols, lastSelectedFolder ? null : payload.selectedFile);
    const selectedFile = payload.selectedFile;
    const selectedCandles =
      payload.candles?.[selectedFile] ?? candlesByFile.get(selectedFile);
    requestAnimationFrame(() => {
      if (lastSelectedFolder) {
        selectFolder(lastSelectedFolder);
      } else if (selectedFile === lastSelectedFile) {
        renderChart(selectedFile, selectedCandles);
      }
    });
  });

  bindSchemeSwitch();
  bindToneSwitch();
  bindSymbolList();
  applyMarketColors(
    document.body.dataset.colorScheme || "cn",
    document.body.dataset.colorTone || "light"
  );
  vscode.postMessage({ type: "ready" });
})();
