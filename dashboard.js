"use strict";

const state = {
  rows: [],
  columns: [],
  dimensions: [],
  weights: {},
  weightsTouched: false,
  dateMin: "",
  dateMax: "",
  filterStart: "",
  filterEnd: "",
  groupCount: 5,
  dateColumn: "",
  returnColumns: [],
  returnColumn: "",
  baseScoreColumn: "",
  resultRows: [],
  dimensionRows: [],
  scoredRows: [],
  groups: { base: [], adjusted: [] },
  activeTab: "group",
  selectedGroupPreview: null,
  selectedDimensionPreview: null,
  previewSorts: { group: null, dimension: null },
  chartBars: [],
  dimensionChartBars: [],
};

const els = {
  csvInput: document.getElementById("csvInput"),
  emptyState: document.getElementById("emptyState"),
  dashboard: document.getElementById("dashboard"),
  rowCount: document.getElementById("rowCount"),
  dimensionCount: document.getElementById("dimensionCount"),
  returnColumn: document.getElementById("returnColumn"),
  baseScoreColumn: document.getElementById("baseScoreColumn"),
  weightList: document.getElementById("weightList"),
  resetWeights: document.getElementById("resetWeights"),
  startDate: document.getElementById("startDate"),
  endDate: document.getElementById("endDate"),
  resetDateRange: document.getElementById("resetDateRange"),
  returnSelector: document.getElementById("returnSelector"),
  resultBody: document.getElementById("resultBody"),
  dimensionHead: document.getElementById("dimensionHead"),
  dimensionBody: document.getElementById("dimensionBody"),
  dimensionLegend: document.getElementById("dimensionLegend"),
  dimensionChart: document.getElementById("dimensionChart"),
  tabButtons: document.querySelectorAll("[data-tab-target]"),
  tabPanels: document.querySelectorAll("[data-tab-panel]"),
  previews: {
    group: {
      head: document.getElementById("groupPreviewHead"),
      body: document.getElementById("groupPreviewBody"),
      caption: document.getElementById("groupPreviewCaption"),
    },
    dimension: {
      head: document.getElementById("dimensionPreviewHead"),
      body: document.getElementById("dimensionPreviewBody"),
      caption: document.getElementById("dimensionPreviewCaption"),
    },
  },
  baseSpread: document.getElementById("baseSpread"),
  adjustedSpread: document.getElementById("adjustedSpread"),
  topGroupCount: document.getElementById("topGroupCount"),
  downloadTable: document.getElementById("downloadTable"),
  chart: document.getElementById("returnChart"),
};

els.csvInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const text = await file.text();
  loadCsv(text, file.name);
});

document.querySelectorAll("[data-groups]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll("[data-groups]").forEach((item) => item.classList.remove("is-active"));
    button.classList.add("is-active");
    state.groupCount = Number(button.dataset.groups);
    clearPreviewSelections();
    recalculate();
  });
});

els.tabButtons.forEach((button) => {
  button.addEventListener("click", () => switchAnalysisTab(button.dataset.tabTarget));
});

els.resetWeights.addEventListener("click", () => {
  state.dimensions.forEach((dimension) => {
    state.weights[dimension] = 1;
  });
  state.weightsTouched = true;
  renderWeights();
  recalculate();
});

[els.startDate, els.endDate].forEach((input) => {
  input.addEventListener("change", () => {
    state.filterStart = els.startDate.value;
    state.filterEnd = els.endDate.value;
    clearPreviewSelections();
    recalculate();
  });
});

els.resetDateRange.addEventListener("click", () => {
  state.filterStart = state.dateMin;
  state.filterEnd = state.dateMax;
  renderDateControls();
  clearPreviewSelections();
  recalculate();
});

els.returnSelector.addEventListener("change", () => {
  state.returnColumn = els.returnSelector.value;
  clearPreviewSelections();
  renderMeta();
  recalculate();
});

els.downloadTable.addEventListener("click", () => {
  if (!state.resultRows.length) return;
  const suffix = returnColumnSuffix(state.returnColumn);
  const header = ["group", `base_avg_${suffix}`, `adjusted_avg_${suffix}`, "adjusted_minus_base", "base_count", "adjusted_count", "base_avg_score", "adjusted_avg_score"];
  const lines = [
    header.join(","),
    ...state.resultRows.map((row) =>
      [row.label, row.baseReturn, row.adjustedReturn, row.deltaReturn, row.baseCount, row.adjustedCount, row.baseScore, row.adjustedScore]
        .map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`)
        .join(",")
    ),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `weight_adjustment_group_returns_${suffix}.csv`;
  link.click();
  URL.revokeObjectURL(url);
});

els.chart.addEventListener("click", (event) => {
  const bar = hitTestChartBar(event);
  if (!bar) {
    state.selectedGroupPreview = null;
    renderGroupPreview();
    drawChart(state.resultRows);
    return;
  }
  state.selectedGroupPreview = {
    series: bar.series,
    groupIndex: bar.groupIndex,
    label: bar.label,
  };
  renderGroupPreview();
  drawChart(state.resultRows);
});

els.chart.addEventListener("mousemove", (event) => {
  els.chart.style.cursor = hitTestChartBar(event) ? "pointer" : "default";
});

els.dimensionChart.addEventListener("click", (event) => {
  const bar = hitTestDimensionChartBar(event);
  if (!bar) {
    state.selectedDimensionPreview = null;
    renderDimensionPreview();
    drawDimensionChart();
    return;
  }
  state.selectedDimensionPreview = {
    dimension: bar.dimension,
    dimensionLabel: bar.dimensionLabel,
    groupIndex: bar.groupIndex,
    label: bar.label,
  };
  renderDimensionPreview();
  drawDimensionChart();
});

els.dimensionChart.addEventListener("mousemove", (event) => {
  els.dimensionChart.style.cursor = hitTestDimensionChartBar(event) ? "pointer" : "default";
});

function loadCsv(text) {
  const parsed = parseCsv(text);
  if (parsed.length < 2) {
    showMessage("CSV 内容为空或格式无法识别。");
    return;
  }

  const columns = parsed[0].map((column) => column.trim());
  const rawRows = parsed.slice(1).filter((row) => row.some((cell) => String(cell).trim() !== ""));
  const rows = rawRows.map((row) =>
    Object.fromEntries(columns.map((column, index) => [column, row[index] ?? ""]))
  );

  const dimensions = detectDimensions(columns, rows);
  const dateColumn = detectDateColumn(columns);
  const returnColumns = detectReturnColumns(columns);
  const returnColumn = chooseDefaultReturnColumn(returnColumns);
  const baseScoreColumn = columns.includes("score") ? "score" : dimensions[0] || "";

  if (!dimensions.length || !returnColumn) {
    showMessage("没有识别到维度分数列或 excess_return_Xd 收益列。请检查 CSV 表头。");
    return;
  }

  state.columns = columns;
  state.rows = rows
    .map((row) => ({
      ...row,
      __dateKey: dateColumn ? String(row[dateColumn] ?? "").trim() : "__all__",
      __dateValue: dateColumn ? parseDateValue(row[dateColumn]) : "",
      __baseScore: parseNumber(row[baseScoreColumn]),
    }))
    .filter((row) => Number.isFinite(row.__baseScore));
  state.dimensions = dimensions;
  state.dateColumn = dateColumn;
  state.returnColumns = returnColumns;
  state.returnColumn = returnColumn;
  state.baseScoreColumn = baseScoreColumn;
  state.weights = Object.fromEntries(dimensions.map((dimension) => [dimension, 1]));
  state.weightsTouched = false;
  clearPreviewSelections();
  setDefaultDateRange();

  if (!state.rows.length) {
    showMessage("识别到了列名，但没有可用于计算的有效行。");
    return;
  }

  els.emptyState.classList.add("is-hidden");
  els.dashboard.classList.remove("is-hidden");
  renderMeta();
  renderDateControls();
  renderReturnSelector();
  renderWeights();
  recalculate();
}

function showMessage(message) {
  els.emptyState.classList.remove("is-hidden");
  els.dashboard.classList.add("is-hidden");
  els.emptyState.innerHTML = `<div><strong>无法分析</strong><span>${escapeHtml(message)}</span></div>`;
}

function detectDimensions(columns, rows) {
  return columns.filter((column) => {
    const lower = column.toLowerCase();
    if (!lower.endsWith("_score") || ["score", "price_in_score"].includes(lower)) return false;
    return rows.some((row) => String(row[column] ?? "").trim() !== "") || columns.includes(column.replace(/_score$/i, "_logic"));
  });
}

function detectReturnColumns(columns) {
  return columns
    .filter((column) => /^excess_return_\d+d$/i.test(column) || /excess.*\d+d|\d+d.*excess/i.test(column))
    .sort((a, b) => returnHorizon(a) - returnHorizon(b));
}

function chooseDefaultReturnColumn(columns) {
  return columns.find((column) => returnHorizon(column) === 5) || columns[0] || "";
}

function returnHorizon(column) {
  const match = String(column).match(/(\d+)d/i);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function detectDateColumn(columns) {
  return ["date", "trade_date", "report_date", "T1_date"].find((column) => columns.includes(column)) || "";
}

function setDefaultDateRange() {
  const dates = state.rows.map((row) => row.__dateValue).filter(Boolean).sort();
  state.dateMin = dates[0] || "";
  state.dateMax = dates[dates.length - 1] || "";
  state.filterStart = state.dateMin;
  state.filterEnd = state.dateMax;
}

function filteredRows() {
  return state.rows.filter((row) => {
    if (!Number.isFinite(parseNumber(row[state.returnColumn]))) return false;
    if (!row.__dateValue) return true;
    if (state.filterStart && row.__dateValue < state.filterStart) return false;
    if (state.filterEnd && row.__dateValue > state.filterEnd) return false;
    return true;
  });
}

function renderMeta() {
  els.rowCount.textContent = filteredRows().length.toLocaleString("zh-CN");
  els.dimensionCount.textContent = state.dimensions.length;
  els.returnColumn.textContent = state.returnColumn;
  els.baseScoreColumn.textContent = state.baseScoreColumn;
}

function renderReturnSelector() {
  els.returnSelector.innerHTML = state.returnColumns
    .map((column) => `<option value="${escapeHtml(column)}">${escapeHtml(returnLabel(column))}</option>`)
    .join("");
  els.returnSelector.value = state.returnColumn;
}

function renderDateControls() {
  [els.startDate, els.endDate].forEach((input) => {
    input.min = state.dateMin || "";
    input.max = state.dateMax || "";
  });
  els.startDate.value = state.filterStart || "";
  els.endDate.value = state.filterEnd || "";
}

function renderWeights() {
  els.weightList.innerHTML = state.dimensions
    .map((dimension) => {
      const label = cleanDimensionName(dimension);
      const value = state.weights[dimension];
      return `
        <div class="weight-item" data-dimension="${escapeHtml(dimension)}">
          <div class="weight-label"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(dimension)}</span></div>
          <input type="range" min="-3" max="5" step="0.1" value="${value}" aria-label="${escapeHtml(label)} 权重" />
          <input type="number" min="-3" max="5" step="0.1" value="${value}" aria-label="${escapeHtml(label)} 权重数值" />
        </div>
      `;
    })
    .join("");

  els.weightList.querySelectorAll(".weight-item").forEach((item) => {
    const dimension = item.dataset.dimension;
    const range = item.querySelector('input[type="range"]');
    const number = item.querySelector('input[type="number"]');
    const update = (value) => {
      const next = clamp(parseNumber(value), -3, 5);
      state.weights[dimension] = next;
      state.weightsTouched = true;
      range.value = next;
      number.value = next;
      recalculate();
    };
    range.addEventListener("input", () => update(range.value));
    number.addEventListener("input", () => update(number.value));
  });
}

function recalculate() {
  if (!state.rows.length) return;
  const baseRows = filteredRows();
  renderMeta();
  const scoredRows = baseRows.map((row) => {
    const adjustedScore = state.weightsTouched ? calculateWeightedScore(row) : row.__baseScore;
    return { ...row, __return: parseNumber(row[state.returnColumn]), __adjustedScore: adjustedScore };
  });

  const baseGroups = groupRowsByDate(scoredRows, "__baseScore", state.groupCount);
  const adjustedGroups = groupRowsByDate(scoredRows, "__adjustedScore", state.groupCount);
  state.scoredRows = scoredRows;
  state.groups = { base: baseGroups, adjusted: adjustedGroups };
  if (!scoredRows.length) {
    state.resultRows = [];
    state.dimensionRows = [];
    clearPreviewSelections();
    renderEmptyResults();
    return;
  }

  state.resultRows = Array.from({ length: state.groupCount }, (_, index) => {
    const label = `G${index + 1}`;
    const base = summarizeGroup(baseGroups[index] || [], "__baseScore");
    const adjusted = summarizeGroup(adjustedGroups[index] || [], "__adjustedScore");
    return {
      label,
      baseReturn: base.avgReturn,
      adjustedReturn: adjusted.avgReturn,
      deltaReturn: adjusted.avgReturn - base.avgReturn,
      baseCount: base.count,
      adjustedCount: adjusted.count,
      baseScore: base.avgScore,
      adjustedScore: adjusted.avgScore,
    };
  });
  state.dimensionRows = buildDimensionRows(scoredRows);

  renderSummary();
  renderTable();
  renderDimensionTable();
  drawDimensionChart();
  renderAllPreviews();
  drawChart(state.resultRows);
}

function renderEmptyResults() {
  els.baseSpread.textContent = "-";
  els.adjustedSpread.textContent = "-";
  els.topGroupCount.textContent = "-";
  els.resultBody.innerHTML = "";
  els.dimensionHead.innerHTML = "";
  els.dimensionBody.innerHTML = "";
  els.dimensionLegend.innerHTML = "";
  renderPreview([], { caption: "当前日期区间内没有有效样本" }, "group");
  renderPreview([], { caption: "当前日期区间内没有有效样本" }, "dimension");
  clearCanvas(els.chart, 360);
  clearCanvas(els.dimensionChart, 400);
}

function switchAnalysisTab(tabName) {
  if (!["group", "dimension"].includes(tabName)) return;
  state.activeTab = tabName;
  els.tabButtons.forEach((button) => {
    const isActive = button.dataset.tabTarget === tabName;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });
  els.tabPanels.forEach((panel) => {
    panel.classList.toggle("is-hidden", panel.dataset.tabPanel !== tabName);
  });
  window.requestAnimationFrame(() => {
    if (tabName === "group") {
      drawChart(state.resultRows);
    } else {
      drawDimensionChart();
    }
  });
}

function clearPreviewSelections() {
  state.selectedGroupPreview = null;
  state.selectedDimensionPreview = null;
  state.previewSorts = { group: null, dimension: null };
}

function clearCanvas(canvas, height) {
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(900, Math.floor(rect.width * dpr));
  canvas.height = Math.floor(height * dpr);
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
}

function calculateWeightedScore(row) {
  return orderedDimensions().reduce((sum, dimension) => {
    const score = parseNumber(row[dimension]);
    return sum + (Number.isFinite(score) ? score * state.weights[dimension] : 0);
  }, 0);
}

function buildDimensionRows(rows) {
  return state.dimensions.map((dimension) => {
    const dimensionGroups = groupRowsByDate(rows, dimension, state.groupCount);
    const groupStats = dimensionGroups.map((groupRowsForDimension) => summarizeGroup(groupRowsForDimension, dimension));
    const first = groupStats[0];
    const last = groupStats[groupStats.length - 1];
    return {
      dimension,
      label: cleanDimensionName(dimension),
      groupStats,
      groups: dimensionGroups,
      spread: last.avgReturn - first.avgReturn,
      topCount: last.count,
    };
  });
}

function groupRowsByDate(rows, scoreKey, count) {
  const groups = Array.from({ length: count }, () => []);
  const rowsByDate = new Map();
  rows.forEach((row) => {
    const dateKey = row.__dateKey || "__all__";
    if (!rowsByDate.has(dateKey)) rowsByDate.set(dateKey, []);
    rowsByDate.get(dateKey).push(row);
  });

  rowsByDate.forEach((dateRows) => {
    const dateGroups = groupRowsWithinDateByThreshold(dateRows, scoreKey, count);
    dateGroups.forEach((group, index) => {
      groups[index].push(...group);
    });
  });
  return groups;
}

function groupRowsWithinDateByThreshold(rows, scoreKey, count) {
  const validRows = rows.filter((row) => Number.isFinite(scoreValue(row, scoreKey)));
  const groups = Array.from({ length: count }, () => []);
  if (!validRows.length) return groups;

  const scores = validRows.map((row) => scoreValue(row, scoreKey)).sort((a, b) => a - b);
  const thresholds = Array.from({ length: count - 1 }, (_, index) => quantile(scores, (index + 1) / count));
  const assignments = new Map();

  for (let group = 1; group <= count; group += 1) {
    validRows.forEach((row) => {
      const score = scoreValue(row, scoreKey);
      let belongs = false;
      if (group === 1) {
        belongs = score <= thresholds[0];
      } else if (group === count) {
        belongs = score >= thresholds[thresholds.length - 1];
      } else if (group === count - 1) {
        belongs = score > thresholds[group - 2] && score < thresholds[group - 1];
      } else {
        belongs = score > thresholds[group - 2] && score <= thresholds[group - 1];
      }
      if (belongs) assignments.set(row, group - 1);
    });
  }

  assignments.forEach((groupIndex, row) => {
    groups[groupIndex].push(row);
  });
  return groups;
}

function quantile(sortedValues, probability) {
  if (!sortedValues.length) return NaN;
  if (sortedValues.length === 1) return sortedValues[0];
  const position = (sortedValues.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sortedValues[lower];
  const fraction = position - lower;
  return sortedValues[lower] + (sortedValues[upper] - sortedValues[lower]) * fraction;
}

function orderedDimensions() {
  const preferred = ["tech_score", "certainty_score", "exp_diff_score", "event_score", "moat_score"];
  return [
    ...preferred.filter((dimension) => state.dimensions.includes(dimension)),
    ...state.dimensions.filter((dimension) => !preferred.includes(dimension)),
  ];
}

function summarizeGroup(rows, scoreKey) {
  if (!rows.length) return { count: 0, avgReturn: NaN, avgScore: NaN };
  return {
    count: rows.length,
    avgReturn: average(rows.map((row) => row.__return)),
    avgScore: average(rows.map((row) => scoreValue(row, scoreKey))),
  };
}

function scoreValue(row, scoreKey) {
  const value = row[scoreKey];
  return typeof value === "number" ? value : parseNumber(value);
}

function renderSummary() {
  const first = state.resultRows[0];
  const last = state.resultRows[state.resultRows.length - 1];
  els.baseSpread.textContent = formatPercent(last.baseReturn - first.baseReturn);
  els.adjustedSpread.textContent = formatPercent(last.adjustedReturn - first.adjustedReturn);
  els.topGroupCount.textContent = last.adjustedCount.toLocaleString("zh-CN");
}

function renderTable() {
  els.resultBody.innerHTML = state.resultRows
    .map(
      (row) => `
        <tr>
          <td>${row.label}</td>
          <td>${formatPercent(row.baseReturn)}</td>
          <td>${formatPercent(row.adjustedReturn)}</td>
          <td class="${deltaClass(row.deltaReturn)}">${formatPercent(row.deltaReturn)}</td>
          <td>${row.baseCount}</td>
          <td>${row.adjustedCount}</td>
          <td>${formatNumber(row.baseScore)}</td>
          <td>${formatNumber(row.adjustedScore)}</td>
        </tr>
      `
    )
    .join("");
}

function deltaClass(value) {
  if (!Number.isFinite(value) || value === 0) return "";
  return value > 0 ? "delta-positive" : "delta-negative";
}

function renderDimensionTable() {
  const groupHeaders = Array.from({ length: state.groupCount }, (_, index) => `<th>G${index + 1} 平均超额</th>`).join("");
  els.dimensionHead.innerHTML = `
    <tr>
      <th>维度</th>
      ${groupHeaders}
      <th>Top-Bottom</th>
      <th>最高组样本数</th>
    </tr>
  `;
  els.dimensionBody.innerHTML = state.dimensionRows
    .map(
      (row) => `
        <tr>
          <td>
            <strong>${escapeHtml(row.label)}</strong>
            <span class="subtle">${escapeHtml(row.dimension)}</span>
          </td>
          ${row.groupStats.map((stat) => `<td><span class="cell-main">${formatPercent(stat.avgReturn)}</span><span class="subtle">n=${stat.count.toLocaleString("zh-CN")}</span></td>`).join("")}
          <td class="${row.spread >= 0 ? "positive" : "negative"}">${formatPercent(row.spread)}</td>
          <td>${row.topCount.toLocaleString("zh-CN")}</td>
        </tr>
      `
    )
    .join("");
}

function drawDimensionChart() {
  const canvas = els.dimensionChart;
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1040, Math.floor(rect.width * dpr));
  canvas.height = Math.floor(400 * dpr);
  ctx.scale(dpr, dpr);

  const width = canvas.width / dpr;
  const height = canvas.height / dpr;
  ctx.clearRect(0, 0, width, height);

  const padding = { top: 24, right: 24, bottom: 76, left: 66 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;
  const values = state.dimensionRows
    .flatMap((row) => row.groupStats.map((stat) => stat.avgReturn))
    .filter(Number.isFinite);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const range = max - min || 1;
  const y = (value) => padding.top + (max - value) / range * plotH;

  drawYAxis(ctx, width, padding, min, max, y);

  const zeroY = y(0);
  const groupW = plotW / Math.max(1, state.groupCount);
  const clusterW = Math.min(groupW * 0.78, 150);
  const dimensionCount = Math.max(1, state.dimensionRows.length);
  const barW = Math.max(4, Math.min(16, clusterW / dimensionCount - 2));
  state.dimensionChartBars = [];

  Array.from({ length: state.groupCount }, (_, groupIndex) => groupIndex).forEach((groupIndex) => {
    const center = padding.left + groupW * groupIndex + groupW / 2;
    const startX = center - ((dimensionCount - 1) * (barW + 2)) / 2;
    state.dimensionRows.forEach((row, dimensionIndex) => {
      const stat = row.groupStats[groupIndex];
      if (!Number.isFinite(stat.avgReturn)) return;
      const x = startX + dimensionIndex * (barW + 2);
      const bar = drawBar(ctx, x, zeroY, y(stat.avgReturn), barW, dimensionColor(dimensionIndex), isSelectedDimensionBar(row.dimension, groupIndex));
      state.dimensionChartBars.push({
        ...bar,
        dimension: row.dimension,
        dimensionLabel: row.label,
        groupIndex,
        label: `G${groupIndex + 1}`,
      });
    });
    ctx.fillStyle = "#425166";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.font = "12px Arial";
    ctx.fillText(`G${groupIndex + 1}`, center, height - padding.bottom + 22);
  });

  renderDimensionLegend();
}

function drawYAxis(ctx, width, padding, min, max, y) {
  ctx.strokeStyle = "#dce2ea";
  ctx.lineWidth = 1;
  ctx.fillStyle = "#637083";
  ctx.font = "12px Arial";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let i = 0; i <= 4; i += 1) {
    const value = min + ((max - min || 1) * i) / 4;
    const yy = y(value);
    ctx.beginPath();
    ctx.moveTo(padding.left, yy);
    ctx.lineTo(width - padding.right, yy);
    ctx.stroke();
    ctx.fillText(formatPercent(value), padding.left - 8, yy);
  }

  ctx.strokeStyle = "#9aa6b5";
  ctx.beginPath();
  ctx.moveTo(padding.left, y(0));
  ctx.lineTo(width - padding.right, y(0));
  ctx.stroke();
}

function renderDimensionLegend() {
  els.dimensionLegend.innerHTML = state.dimensionRows.map((row, index) => (
    `<span><i class="legend-dot" style="background:${dimensionColor(index)}"></i>${escapeHtml(row.label)}</span>`
  )).join("");
}

function dimensionColor(index) {
  const colors = ["#5661f6", "#1f9ebc", "#16a36f", "#7cba26", "#d6a21f", "#d96c17", "#c2415d", "#9b4ed4", "#64748b", "#0f766e"];
  return colors[index % colors.length];
}

function isSelectedDimensionBar(dimension, groupIndex) {
  return state.selectedDimensionPreview?.dimension === dimension && state.selectedDimensionPreview.groupIndex === groupIndex;
}

function hitTestDimensionChartBar(event) {
  const rect = els.dimensionChart.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  return state.dimensionChartBars.find((bar) => x >= bar.left && x <= bar.right && y >= bar.top && y <= bar.bottom);
}

function wrapCanvasLabel(ctx, text, x, y, maxWidth) {
  const chars = Array.from(String(text));
  let line = "";
  let lineY = y;
  chars.forEach((char) => {
    const test = line + char;
    if (line && ctx.measureText(test).width > maxWidth) {
      ctx.fillText(line, x, lineY);
      line = char;
      lineY += 15;
    } else {
      line = test;
    }
  });
  if (line) ctx.fillText(line, x, lineY);
}

function renderPreview(rows, options = {}, targetName = "group") {
  const {
    limit = 80,
    sortKey = "__adjustedScore",
    sortDirection = "desc",
    caption = "前 80 行，按调整后分数从高到低",
  } = options;
  const target = els.previews[targetName] || els.previews.group;
  const columns = ["date", "secid", "secname", state.returnColumn, state.baseScoreColumn, "__adjustedScore", ...state.dimensions]
    .filter((column, index, all) => column && all.indexOf(column) === index)
    .filter((column) => column === "__adjustedScore" || state.columns.includes(column));
  const activeSort = state.previewSorts[targetName] || { column: sortKey, direction: sortDirection };
  target.caption.textContent = caption;
  target.head.innerHTML = `<tr>${columns.map((column) => renderSortableHeader(column, activeSort)).join("")}</tr>`;
  target.head.querySelectorAll("[data-sort-column]").forEach((button) => {
    button.addEventListener("click", () => {
      state.previewSorts[targetName] = {
        column: button.dataset.sortColumn,
        direction: button.dataset.sortDirection,
      };
      renderPreview(rows, { limit, sortKey, sortDirection, caption }, targetName);
    });
  });
  target.body.innerHTML = sortPreviewRows(rows, activeSort)
    .slice(0, limit)
    .map(
      (row) => `
        <tr>
          ${columns
            .map((column) => {
              const value = column === "__adjustedScore" ? formatNumber(row.__adjustedScore) : row[column];
              return `<td>${escapeHtml(value)}</td>`;
            })
            .join("")}
        </tr>
      `
    )
    .join("");
}

function renderSortableHeader(column, activeSort) {
  const label = column === "__adjustedScore" ? "adjusted_score" : column;
  const active = activeSort.column === column ? (activeSort.direction === "asc" ? " ↑" : " ↓") : "";
  return `
    <th>
      <details class="sort-menu">
        <summary>${escapeHtml(label)}${active}</summary>
        <div>
          <button type="button" data-sort-column="${escapeHtml(column)}" data-sort-direction="asc">正序</button>
          <button type="button" data-sort-column="${escapeHtml(column)}" data-sort-direction="desc">倒序</button>
        </div>
      </details>
    </th>
  `;
}

function sortPreviewRows(rows, sort) {
  const direction = sort.direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => comparePreviewValue(a, b, sort.column) * direction);
}

function comparePreviewValue(a, b, column) {
  const aValue = previewSortValue(a, column);
  const bValue = previewSortValue(b, column);
  if (aValue.kind === "number" && bValue.kind === "number") return aValue.value - bValue.value;
  return String(aValue.value).localeCompare(String(bValue.value), "zh-CN", { numeric: true });
}

function previewSortValue(row, column) {
  if (column === "__adjustedScore") return { kind: "number", value: row.__adjustedScore };
  if (column === state.dateColumn || column === "date" || /date/i.test(column)) {
    return { kind: "text", value: parseDateValue(row[column]) || String(row[column] ?? "") };
  }
  const numeric = parseNumber(row[column]);
  if (Number.isFinite(numeric)) return { kind: "number", value: numeric };
  return { kind: "text", value: row[column] ?? "" };
}

function renderAllPreviews() {
  renderGroupPreview();
  renderDimensionPreview();
}

function renderGroupPreview() {
  const selection = state.selectedGroupPreview;
  if (!selection || selection.groupIndex >= state.groupCount) {
    state.selectedGroupPreview = null;
    renderPreview(state.scoredRows, {}, "group");
    return;
  }
  const groupRowsForSelection = state.groups[selection.series]?.[selection.groupIndex] || [];
  const isBase = selection.series === "base";
  renderPreview(groupRowsForSelection, {
    limit: groupRowsForSelection.length,
    sortKey: isBase ? "__baseScore" : "__adjustedScore",
    caption: `${isBase ? "原始分" : "调整后"} ${selection.label} 组股票，共 ${groupRowsForSelection.length} 行`,
  }, "group");
}

function renderDimensionPreview() {
  const selection = state.selectedDimensionPreview;
  if (!selection || selection.groupIndex >= state.groupCount) {
    state.selectedDimensionPreview = null;
    renderPreview(state.scoredRows, {}, "dimension");
    return;
  }
  const dimensionRow = state.dimensionRows.find((row) => row.dimension === selection.dimension);
  const groupRowsForSelection = dimensionRow?.groups?.[selection.groupIndex] || [];
  renderPreview(groupRowsForSelection, {
    limit: groupRowsForSelection.length,
    sortKey: selection.dimension,
    caption: `${selection.dimensionLabel} ${selection.label} 组股票，共 ${groupRowsForSelection.length} 行`,
  }, "dimension");
}

function drawChart(rows) {
  const canvas = els.chart;
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(900, Math.floor(rect.width * dpr));
  canvas.height = Math.floor(360 * dpr);
  ctx.scale(dpr, dpr);

  const width = canvas.width / dpr;
  const height = canvas.height / dpr;
  ctx.clearRect(0, 0, width, height);

  const padding = { top: 22, right: 24, bottom: 50, left: 66 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;
  const values = rows.flatMap((row) => [row.baseReturn, row.adjustedReturn]).filter(Number.isFinite);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const range = max - min || 1;
  const y = (value) => padding.top + (max - value) / range * plotH;

  drawYAxis(ctx, width, padding, min, max, y);
  const zeroY = y(0);

  const groupW = plotW / rows.length;
  const barW = Math.min(28, groupW * 0.28);
  state.chartBars = [];
  rows.forEach((row, index) => {
    const center = padding.left + groupW * index + groupW / 2;
    const baseBar = drawBar(ctx, center - barW * 0.6, zeroY, y(row.baseReturn), barW, "#2f6fed", isSelectedBar("base", index));
    const adjustedBar = drawBar(ctx, center + barW * 0.6, zeroY, y(row.adjustedReturn), barW, "#158765", isSelectedBar("adjusted", index));
    state.chartBars.push({ ...baseBar, series: "base", groupIndex: index, label: row.label });
    state.chartBars.push({ ...adjustedBar, series: "adjusted", groupIndex: index, label: row.label });
    ctx.fillStyle = "#425166";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(row.label, center, height - padding.bottom + 18);
  });
}

function drawBar(ctx, x, zeroY, valueY, width, color, selected = false) {
  const top = Math.min(zeroY, valueY);
  const height = Math.max(2, Math.abs(zeroY - valueY));
  const left = x - width / 2;
  ctx.fillStyle = color;
  ctx.fillRect(left, top, width, height);
  if (selected) {
    ctx.strokeStyle = "#1b232f";
    ctx.lineWidth = 2;
    ctx.strokeRect(left - 2, top - 2, width + 4, height + 4);
  }
  return { left, right: left + width, top: top - 4, bottom: top + height + 4 };
}

function isSelectedBar(series, groupIndex) {
  return state.selectedGroupPreview?.series === series && state.selectedGroupPreview?.groupIndex === groupIndex;
}

function hitTestChartBar(event) {
  const rect = els.chart.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  return state.chartBars.find((bar) => x >= bar.left && x <= bar.right && y >= bar.top && y <= bar.bottom);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i];
    const next = normalized[i + 1];
    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
    } else if (char === "\n" && !inQuotes) {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  if (rows[0]?.[0]) rows[0][0] = rows[0][0].replace(/^\uFEFF/, "");
  return rows;
}

function parseNumber(value) {
  if (value === null || value === undefined) return NaN;
  const cleaned = String(value).trim().replace(/%$/, "");
  if (!cleaned) return NaN;
  const number = Number(cleaned);
  return String(value).trim().endsWith("%") ? number / 100 : number;
}

function parseDateValue(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const datePart = text.split("T")[0].replace(/[./]/g, "-");
  const parts = datePart.split("-").map((part) => part.trim()).filter(Boolean);
  if (parts.length < 3) return "";
  const [year, month, day] = parts;
  if (!/^\d{4}$/.test(year)) return "";
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function average(values) {
  const valid = values.filter(Number.isFinite);
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function cleanDimensionName(column) {
  const names = {
    exp_diff_score: "预期差",
    tech_score: "技术",
    certainty_score: "确定性",
    moat_score: "护城河",
    event_score: "事件",
    macro_score: "宏观",
  };
  return names[column] || column.replace(/_score$/i, "").replaceAll("_", " ");
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : "-";
}

function formatNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(2) : "-";
}

function returnLabel(column) {
  const horizon = returnHorizon(column);
  return Number.isFinite(horizon) && horizon !== Number.MAX_SAFE_INTEGER ? `${horizon}日超额收益 (${column})` : column;
}

function returnColumnSuffix(column) {
  return String(column || "excess_return").replace(/[^\w]+/g, "_");
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

window.__weightDashboard = {
  loadCsv,
  setWeights: (weights) => {
    Object.entries(weights || {}).forEach(([dimension, weight]) => {
      if (dimension in state.weights) state.weights[dimension] = parseNumber(weight);
    });
    state.weightsTouched = true;
    recalculate();
  },
  getState: () => ({
    rowCount: state.rows.length,
    filteredRowCount: filteredRows().length,
    dimensions: [...state.dimensions],
    returnColumns: [...state.returnColumns],
    returnColumn: state.returnColumn,
    dateMin: state.dateMin,
    dateMax: state.dateMax,
    filterStart: state.filterStart,
    filterEnd: state.filterEnd,
    weightsTouched: state.weightsTouched,
    groupCount: state.groupCount,
    dateColumn: state.dateColumn,
    activeTab: state.activeTab,
    selectedGroupPreview: state.selectedGroupPreview,
    selectedDimensionPreview: state.selectedDimensionPreview,
    previewCaptions: {
      group: els.previews.group.caption.textContent,
      dimension: els.previews.dimension.caption.textContent,
    },
    chartBars: [...state.chartBars],
    dimensionChartBars: [...state.dimensionChartBars],
    resultRows: [...state.resultRows],
    dimensionRows: [...state.dimensionRows],
  }),
};

document.documentElement.dataset.dashboardReady = "true";
