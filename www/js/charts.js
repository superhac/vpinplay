const CHART_WINDOW_DAYS = 30;
const CHART_TOP_LIMIT = 10;

let topRuntimeChart = null;
let globalStartsChart = null;

function formatBucketLabel(bucket) {
  const date = new Date(`${bucket}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return bucket;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function getChartPalette() {
  return [
    "#00d9ff",
    "#ff0a78",
    "#ffd93d",
    "#00ff9f",
    "#b429f9",
    "#ff6b35",
    "#6ce5ff",
    "#ff7bb0",
    "#fff07a",
    "#a98bff",
  ];
}

function getCssVar(name, fallback) {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
}

function destroyChart(chartRef) {
  if (chartRef) {
    chartRef.destroy();
  }
}

function renderTopRuntimeSummary(items) {
  const el = q("topRuntimeSummary");
  if (!el) return;

  if (!Array.isArray(items) || items.length === 0) {
    el.innerHTML = "";
    return;
  }

  el.innerHTML = items
    .map(
      (item, index) => `
        <article class="chart-summary-card">
          <div class="chart-summary-rank">Rank ${index + 1}</div>
          <div class="chart-summary-title">${escapeHtml(fmtTableName(item))}</div>
          <div class="chart-summary-stats">
            ${escapeHtml(fmtWeeklyRuntime(item.runTimePlayed))} total runtime<br>
            ${escapeHtml(`${fmtNumber(item.startCountPlayed)} starts`)}
          </div>
        </article>
      `,
    )
    .join("");
}

function renderGlobalStartsSummary(payload) {
  const el = q("globalStartsSummary");
  if (!el) return;

  const dailyBuckets = Array.isArray(payload?.dailyBuckets)
    ? payload.dailyBuckets
    : [];

  if (dailyBuckets.length === 0) {
    el.innerHTML = "";
    return;
  }

  const peakDay = dailyBuckets.reduce((best, current) =>
    Number(current.startCountPlayed || 0) > Number(best.startCountPlayed || 0)
      ? current
      : best,
  );
  const averageStarts =
    dailyBuckets.reduce(
      (sum, point) => sum + Number(point.startCountPlayed || 0),
      0,
    ) / dailyBuckets.length;

  el.innerHTML = `
    <article class="chart-callout">
      <div class="chart-callout-label">Peak Day</div>
      <div class="chart-callout-value">${escapeHtml(fmtNumber(peakDay.startCountPlayed || 0))}</div>
      <div class="chart-callout-sub">${escapeHtml(formatBucketLabel(peakDay.bucket || ""))}</div>
    </article>
    <article class="chart-callout">
      <div class="chart-callout-label">Daily Average</div>
      <div class="chart-callout-value">${escapeHtml(fmtNumber(Math.round(averageStarts)))}</div>
      <div class="chart-callout-sub">starts per day</div>
    </article>
    <article class="chart-callout">
      <div class="chart-callout-label">Active Tables</div>
      <div class="chart-callout-value">${escapeHtml(fmtNumber(payload?.tableCount || 0))}</div>
      <div class="chart-callout-sub">tables changed in window</div>
    </article>
    <article class="chart-callout">
      <div class="chart-callout-label">Active Users</div>
      <div class="chart-callout-value">${escapeHtml(fmtNumber(payload?.userCount || 0))}</div>
      <div class="chart-callout-sub">users changed in window</div>
    </article>
  `;
}

function buildTopRuntimeDatasets(items) {
  const palette = getChartPalette();
  return items.map((item, index) => ({
    label: fmtTableName(item),
    data: Array.isArray(item.dailyBuckets)
      ? item.dailyBuckets.map((point) => Number(point.runTimePlayed || 0))
      : [],
    borderColor: palette[index % palette.length],
    backgroundColor: palette[index % palette.length],
    borderWidth: 2,
    pointRadius: 1.5,
    pointHoverRadius: 4,
    pointBackgroundColor: palette[index % palette.length],
    pointBorderWidth: 0,
    tension: 0.28,
    fill: false,
  }));
}

function renderTopRuntimeChart(payload) {
  const canvas = q("topRuntimeChart");
  if (!canvas || typeof Chart === "undefined") return false;

  destroyChart(topRuntimeChart);
  topRuntimeChart = null;

  const items = Array.isArray(payload?.items) ? payload.items : [];
  const buckets = Array.isArray(payload?.buckets) ? payload.buckets : [];
  const labels = buckets.map(formatBucketLabel);
  const axisInk = getCssVar("--ink-muted", "#b89dd9");
  const axisLine = getCssVar("--line", "#3d2461");

  topRuntimeChart = new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: buildTopRuntimeDatasets(items),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: "index",
        intersect: false,
      },
      plugins: {
        legend: {
          position: "bottom",
          labels: {
            color: axisInk,
            boxWidth: 18,
            usePointStyle: true,
            pointStyle: "line",
          },
        },
        tooltip: {
          callbacks: {
            label(context) {
              const value = Number(context.parsed.y || 0);
              return `${context.dataset.label}: ${fmtWeeklyRuntime(value)}`;
            },
          },
        },
      },
      scales: {
        x: {
          ticks: {
            color: axisInk,
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 10,
          },
          grid: {
            color: axisLine,
          },
        },
        y: {
          beginAtZero: true,
          ticks: {
            color: axisInk,
            callback(value) {
              return fmtWeeklyRuntime(value);
            },
          },
          grid: {
            color: axisLine,
          },
        },
      },
    },
  });

  return true;
}

function renderGlobalStartsChart(payload) {
  const canvas = q("globalStartsChart");
  if (!canvas || typeof Chart === "undefined") return false;

  destroyChart(globalStartsChart);
  globalStartsChart = null;

  const dailyBuckets = Array.isArray(payload?.dailyBuckets)
    ? payload.dailyBuckets
    : [];
  const labels = dailyBuckets.map((point) => formatBucketLabel(point.bucket));
  const values = dailyBuckets.map((point) => Number(point.startCountPlayed || 0));
  const axisInk = getCssVar("--ink-muted", "#b89dd9");
  const axisLine = getCssVar("--line", "#3d2461");
  const accent = getCssVar("--neon-pink", "#ff0a78");

  globalStartsChart = new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Starts",
          data: values,
          backgroundColor: "rgba(255, 10, 120, 0.45)",
          borderColor: accent,
          borderWidth: 1.5,
          borderRadius: 6,
          borderSkipped: false,
          hoverBackgroundColor: "rgba(255, 10, 120, 0.65)",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          callbacks: {
            label(context) {
              return `${fmtNumber(context.parsed.y || 0)} starts`;
            },
          },
        },
      },
      scales: {
        x: {
          ticks: {
            color: axisInk,
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 10,
          },
          grid: {
            color: axisLine,
          },
        },
        y: {
          beginAtZero: true,
          ticks: {
            color: axisInk,
            callback(value) {
              return fmtNumber(value);
            },
          },
          grid: {
            color: axisLine,
          },
        },
      },
    },
  });

  return true;
}

async function refreshCharts() {
  const header = document.querySelector("vpinplay-header");
  const topRuntimeStatusEl = q("topRuntimeChartStatus");
  const topRuntimeMetaEl = q("topRuntimeChartMeta");
  const globalStartsStatusEl = q("globalStartsChartStatus");
  const globalStartsMetaEl = q("globalStartsChartMeta");

  if (header) header.setRefreshing(true);
  if (topRuntimeStatusEl) topRuntimeStatusEl.textContent = "Loading chart data...";
  if (globalStartsStatusEl) globalStartsStatusEl.textContent = "Loading chart data...";

  try {
    const [runtimeResult, startsResult] = await Promise.all([
      api(
        `/api/v1/tables/top-play-time-buckets?days=${encodeURIComponent(CHART_WINDOW_DAYS)}&limit=${encodeURIComponent(CHART_TOP_LIMIT)}`,
      ),
      api(
        `/api/v1/tables/activity-buckets?days=${encodeURIComponent(CHART_WINDOW_DAYS)}`,
      ),
    ]);

    if (!runtimeResult.ok) {
      destroyChart(topRuntimeChart);
      topRuntimeChart = null;
      q("kpiTrackedTables").textContent = "-";
      renderTopRuntimeSummary([]);
      if (topRuntimeStatusEl) topRuntimeStatusEl.textContent = "Unable to load chart data.";
    } else {
      const items = Array.isArray(runtimeResult.data?.items)
        ? runtimeResult.data.items
        : [];
      q("kpiChartWindow").textContent = `${fmtNumber(runtimeResult.data?.days || CHART_WINDOW_DAYS)}d`;
      q("kpiTrackedTables").textContent = fmtNumber(items.length);

      if (topRuntimeMetaEl) {
        topRuntimeMetaEl.textContent =
          `Daily runtime buckets from ${fmtDate(runtimeResult.data?.from)} to ${fmtDate(runtimeResult.data?.to)}.`;
      }

      renderTopRuntimeSummary(items);

      if (items.length === 0) {
        destroyChart(topRuntimeChart);
        topRuntimeChart = null;
        if (topRuntimeStatusEl) {
          topRuntimeStatusEl.textContent =
            "No runtime activity found for this window.";
        }
      } else {
        const rendered = renderTopRuntimeChart(runtimeResult.data);
        if (topRuntimeStatusEl) {
          topRuntimeStatusEl.textContent = rendered
            ? "Top 10 tables ranked by total runtime across the selected window."
            : "Chart library unavailable.";
        }
      }
    }

    if (!startsResult.ok) {
      destroyChart(globalStartsChart);
      globalStartsChart = null;
      q("kpiGlobalStarts").textContent = "-";
      renderGlobalStartsSummary([]);
      if (globalStartsStatusEl) {
        globalStartsStatusEl.textContent = "Unable to load global starts trend.";
      }
    } else {
      q("kpiGlobalStarts").textContent = fmtNumber(
        startsResult.data?.startCountPlayed || 0,
      );

      if (globalStartsMetaEl) {
        globalStartsMetaEl.textContent =
          `Daily start counts from ${fmtDate(startsResult.data?.from)} to ${fmtDate(startsResult.data?.to)}.`;
      }

      renderGlobalStartsSummary(startsResult.data);

      const dailyBuckets = Array.isArray(startsResult.data?.dailyBuckets)
        ? startsResult.data.dailyBuckets
        : [];

      if (dailyBuckets.length === 0) {
        destroyChart(globalStartsChart);
        globalStartsChart = null;
        if (globalStartsStatusEl) {
          globalStartsStatusEl.textContent =
            "No global starts activity found for this window.";
        }
      } else {
        const rendered = renderGlobalStartsChart(startsResult.data);
        if (globalStartsStatusEl) {
          globalStartsStatusEl.textContent = rendered
            ? "Global daily starts over the selected window."
            : "Chart library unavailable.";
        }
      }
    }
  } finally {
    if (header) header.markRefresh();
  }
}

window.refreshDashboard = refreshCharts;

document.addEventListener("DOMContentLoaded", async () => {
  await customElements.whenDefined("vpinplay-header");
  refreshCharts();
});
