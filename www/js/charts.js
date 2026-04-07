const CHART_WINDOW_DAYS = 30;
const CHART_TOP_LIMIT = 10;

let topRuntimeChart = null;
let topStartsChart = null;
let newTablesChart = null;
let reviewersChart = null;

function formatBucketLabel(bucket) {
  const date = new Date(`${bucket}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return bucket;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function fmtDay(value) {
  if (!value) return "-";
  const raw = String(value).trim();
  const hasTimeZone = /([zZ]|[+-]\d{2}:\d{2})$/.test(raw);
  const normalized = !hasTimeZone && raw.includes("T") ? `${raw}Z` : raw;
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString(undefined, {
    dateStyle: "medium",
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

function truncateChartLabel(value, max = 36) {
  const text = String(value || "").trim();
  if (!text) return "Unknown Table";
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function destroyChart(chartRef) {
  if (chartRef) chartRef.destroy();
}

function buildDatasets(items, metricKey) {
  const palette = getChartPalette();
  return items.map((item, index) => ({
    label: fmtTableName(item),
    data: Array.isArray(item.dailyBuckets)
      ? item.dailyBuckets.map((point) => Number(point[metricKey] || 0))
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

function renderMultiTableLineChart(canvasId, chartRef, payload, metricKey, tooltipFormatter, yTickFormatter) {
  const canvas = q(canvasId);
  if (!canvas || typeof Chart === "undefined") return null;

  destroyChart(chartRef);

  const items = Array.isArray(payload?.items) ? payload.items : [];
  const buckets = Array.isArray(payload?.buckets) ? payload.buckets : [];
  const labels = buckets.map(formatBucketLabel);
  const axisInk = getCssVar("--ink-muted", "#b89dd9");
  const axisLine = getCssVar("--line", "#3d2461");

  return new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: buildDatasets(items, metricKey),
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
              return `${context.dataset.label}: ${tooltipFormatter(value)}`;
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
              return yTickFormatter(value);
            },
          },
          grid: {
            color: axisLine,
          },
        },
      },
    },
  });
}

function renderRankedBarChart(canvasId, chartRef, items) {
  const canvas = q(canvasId);
  if (!canvas || typeof Chart === "undefined") return null;

  destroyChart(chartRef);

  const axisInk = getCssVar("--ink-muted", "#b89dd9");
  const axisLine = getCssVar("--line", "#3d2461");
  const accent = getCssVar("--neon-yellow", "#ffd93d");
  const labels = items.map((item) => truncateChartLabel(fmtTableName(item)));
  const values = items.map((item) => Number(item.variationCount || 0));

  return new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Variations",
          data: values,
          backgroundColor: "rgba(255, 217, 61, 0.45)",
          borderColor: accent,
          borderWidth: 1.5,
          borderRadius: 6,
          borderSkipped: false,
        },
      ],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          callbacks: {
            title(itemsCtx) {
              const index = itemsCtx?.[0]?.dataIndex ?? -1;
              return index >= 0 ? fmtTableName(items[index]) : "";
            },
            label(context) {
              return `${fmtNumber(context.parsed.x || 0)} variations`;
            },
          },
        },
      },
      scales: {
        x: {
          beginAtZero: true,
          ticks: {
            color: axisInk,
            precision: 0,
            callback(value) {
              return fmtNumber(value);
            },
          },
          grid: {
            color: axisLine,
          },
        },
        y: {
          ticks: {
            color: axisInk,
          },
          grid: {
            display: false,
          },
        },
      },
    },
  });
}

function renderReviewersBarChart(canvasId, chartRef, items) {
  const canvas = q(canvasId);
  if (!canvas || typeof Chart === "undefined") return null;

  destroyChart(chartRef);

  const axisInk = getCssVar("--ink-muted", "#b89dd9");
  const axisLine = getCssVar("--line", "#3d2461");
  const accent = getCssVar("--ok", "#00ff9f");
  const labels = items.map((item) => String(item.userId || "Unknown User"));
  const values = items.map((item) => Number(item.reviewCount || 0));

  return new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Reviews",
          data: values,
          backgroundColor: "rgba(0, 255, 159, 0.35)",
          borderColor: accent,
          borderWidth: 1.5,
          borderRadius: 6,
          borderSkipped: false,
        },
      ],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          callbacks: {
            title(itemsCtx) {
              const index = itemsCtx?.[0]?.dataIndex ?? -1;
              return index >= 0 ? String(items[index].userId || "Unknown User") : "";
            },
            label(context) {
              return `${fmtNumber(context.parsed.x || 0)} reviews`;
            },
          },
        },
      },
      scales: {
        x: {
          beginAtZero: true,
          ticks: {
            color: axisInk,
            precision: 0,
            callback(value) {
              return fmtNumber(value);
            },
          },
          grid: {
            color: axisLine,
          },
        },
        y: {
          ticks: {
            color: axisInk,
          },
          grid: {
            display: false,
          },
        },
      },
    },
  });
}

function renderNewTablesLineChart(canvasId, chartRef, items) {
  const canvas = q(canvasId);
  if (!canvas || typeof Chart === "undefined") return null;

  destroyChart(chartRef);

  const axisInk = getCssVar("--ink-muted", "#b89dd9");
  const axisLine = getCssVar("--line", "#3d2461");
  const palette = getChartPalette();
  const sortedItems = [...items].sort((a, b) => {
    const aTime = new Date(a?.firstSeenAt || 0).getTime();
    const bTime = new Date(b?.firstSeenAt || 0).getTime();
    return aTime - bTime;
  });
  const bucketLabels = [];
  const endDate = new Date();
  endDate.setHours(0, 0, 0, 0);
  for (let i = CHART_WINDOW_DAYS - 1; i >= 0; i -= 1) {
    const date = new Date(endDate);
    date.setDate(endDate.getDate() - i);
    bucketLabels.push(
      date.toLocaleDateString(undefined, {
        dateStyle: "medium",
      }),
    );
  }
  const datasets = sortedItems.map((item, index) => {
    const itemLabel = fmtDay(item.firstSeenAt);
    const playerCount = Number(item.playerCount || 0);
    const startIndex = bucketLabels.indexOf(itemLabel);
    return {
      label: fmtTableName(item),
      data: bucketLabels.map((label) =>
        startIndex >= 0 && bucketLabels.indexOf(label) >= startIndex
          ? playerCount
          : null,
      ),
      borderColor: palette[index % palette.length],
      backgroundColor: palette[index % palette.length],
      borderWidth: 2,
      pointRadius: bucketLabels.map((label) => (label === itemLabel ? 5 : 0)),
      pointHoverRadius: 7,
      pointBackgroundColor: palette[index % palette.length],
      pointBorderWidth: 0,
      tension: 0.2,
      fill: false,
      spanGaps: false,
    };
  });

  return new Chart(canvas, {
    type: "line",
    data: {
      labels: bucketLabels,
      datasets,
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "bottom",
          labels: {
            color: axisInk,
            boxWidth: 18,
            usePointStyle: true,
          },
        },
        tooltip: {
          callbacks: {
            title(itemsCtx) {
              const datasetIndex = itemsCtx?.[0]?.datasetIndex ?? -1;
              return datasetIndex >= 0
                ? fmtTableName(sortedItems[datasetIndex])
                : "";
            },
            label(context) {
              return `${fmtNumber(context.parsed.y || 0)} installed players`;
            },
            afterLabel(context) {
              const datasetIndex = context.datasetIndex ?? -1;
              return datasetIndex >= 0
                ? `First seen: ${fmtDay(sortedItems[datasetIndex].firstSeenAt)}`
                : "";
            },
          },
        },
      },
      scales: {
        x: {
          ticks: {
            color: axisInk,
            autoSkip: true,
            maxRotation: 0,
            maxTicksLimit: 6,
          },
          grid: {
            color: axisLine,
          },
        },
        y: {
          beginAtZero: true,
          ticks: {
            color: axisInk,
            precision: 0,
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
}

async function refreshCharts() {
  const header = document.querySelector("vpinplay-header");
  const topRuntimeStatusEl = q("topRuntimeChartStatus");
  const topRuntimeMetaEl = q("topRuntimeChartMeta");
  const topStartsStatusEl = q("topStartsChartStatus");
  const topStartsMetaEl = q("topStartsChartMeta");
  const newTablesStatusEl = q("newTablesChartStatus");
  const newTablesMetaEl = q("newTablesChartMeta");
  const reviewersStatusEl = q("reviewersChartStatus");
  const reviewersMetaEl = q("reviewersChartMeta");

  if (header) header.setRefreshing(true);
  if (topRuntimeStatusEl) topRuntimeStatusEl.textContent = "Loading chart data...";
  if (topStartsStatusEl) topStartsStatusEl.textContent = "Loading chart data...";
  if (newTablesStatusEl) newTablesStatusEl.textContent = "Loading chart data...";
  if (reviewersStatusEl) reviewersStatusEl.textContent = "Loading chart data...";

  try {
    const [runtimeResult, startsResult, newTablesResult, reviewersResult] = await Promise.all([
      api(
        `/api/v1/tables/top-play-time-buckets?days=${encodeURIComponent(CHART_WINDOW_DAYS)}&limit=${encodeURIComponent(CHART_TOP_LIMIT)}`,
      ),
      api(
        `/api/v1/tables/top-starts-buckets?days=${encodeURIComponent(CHART_WINDOW_DAYS)}&limit=${encodeURIComponent(CHART_TOP_LIMIT)}`,
      ),
      api(
        `/api/v1/tables/top-newly-added?days=${encodeURIComponent(CHART_WINDOW_DAYS)}&limit=${encodeURIComponent(CHART_TOP_LIMIT)}`,
      ),
      api(
        `/api/v1/tables/top-reviewers?limit=${encodeURIComponent(CHART_TOP_LIMIT)}`,
      ),
    ]);

    if (!runtimeResult.ok) {
      destroyChart(topRuntimeChart);
      topRuntimeChart = null;
      if (topRuntimeStatusEl) topRuntimeStatusEl.textContent = "Unable to load chart data.";
    } else {
      const items = Array.isArray(runtimeResult.data?.items)
        ? runtimeResult.data.items
        : [];

      if (topRuntimeMetaEl) {
        topRuntimeMetaEl.textContent =
          `Daily runtime buckets from ${fmtDate(runtimeResult.data?.from)} to ${fmtDate(runtimeResult.data?.to)}.`;
      }

      if (items.length === 0) {
        destroyChart(topRuntimeChart);
        topRuntimeChart = null;
        if (topRuntimeStatusEl) {
          topRuntimeStatusEl.textContent = "No runtime activity found for this window.";
        }
      } else {
        topRuntimeChart = renderMultiTableLineChart(
          "topRuntimeChart",
          topRuntimeChart,
          runtimeResult.data,
          "runTimePlayed",
          fmtWeeklyRuntime,
          fmtWeeklyRuntime,
        );
        if (topRuntimeStatusEl) {
          topRuntimeStatusEl.textContent = topRuntimeChart
            ? "Top 10 tables ranked by total runtime across the selected window."
            : "Chart library unavailable.";
        }
      }
    }

    if (!startsResult.ok) {
      destroyChart(topStartsChart);
      topStartsChart = null;
      if (topStartsStatusEl) topStartsStatusEl.textContent = "Unable to load chart data.";
    } else {
      const items = Array.isArray(startsResult.data?.items)
        ? startsResult.data.items
        : [];

      if (topStartsMetaEl) {
        topStartsMetaEl.textContent =
          `Daily start-count buckets from ${fmtDate(startsResult.data?.from)} to ${fmtDate(startsResult.data?.to)}.`;
      }

      if (items.length === 0) {
        destroyChart(topStartsChart);
        topStartsChart = null;
        if (topStartsStatusEl) {
          topStartsStatusEl.textContent = "No start activity found for this window.";
        }
      } else {
        topStartsChart = renderMultiTableLineChart(
          "topStartsChart",
          topStartsChart,
          startsResult.data,
          "startCountPlayed",
          (value) => `${fmtNumber(value)} starts`,
          fmtNumber,
        );
        if (topStartsStatusEl) {
          topStartsStatusEl.textContent = topStartsChart
            ? "Top 10 tables ranked by total starts across the selected window."
            : "Chart library unavailable.";
        }
      }
    }

    if (!newTablesResult.ok) {
      destroyChart(newTablesChart);
      newTablesChart = null;
      if (newTablesStatusEl) newTablesStatusEl.textContent = "Unable to load chart data.";
    } else {
      const items = Array.isArray(newTablesResult.data?.items)
        ? newTablesResult.data.items
        : [];

      if (newTablesMetaEl) {
        newTablesMetaEl.textContent =
          `Newest tables first from ${fmtDay(newTablesResult.data?.from)} to ${fmtDay(newTablesResult.data?.to)}, with installed player count on the y-axis.`;
      }

      if (items.length === 0) {
        destroyChart(newTablesChart);
        newTablesChart = null;
        if (newTablesStatusEl) {
          newTablesStatusEl.textContent = "No newly added tables found for this window.";
        }
      } else {
        newTablesChart = renderNewTablesLineChart(
          "newTablesChart",
          newTablesChart,
          items,
        );
        if (newTablesStatusEl) {
          newTablesStatusEl.textContent = newTablesChart
            ? "Newest 10 tables plotted by first-seen date and installed player count."
            : "Chart library unavailable.";
        }
      }
    }

    if (!reviewersResult.ok) {
      destroyChart(reviewersChart);
      reviewersChart = null;
      if (reviewersStatusEl) reviewersStatusEl.textContent = "Unable to load chart data.";
    } else {
      const items = Array.isArray(reviewersResult.data)
        ? reviewersResult.data
        : [];

      if (reviewersMetaEl) {
        reviewersMetaEl.textContent =
          "Players ranked by total submitted rating count.";
      }

      if (items.length === 0) {
        destroyChart(reviewersChart);
        reviewersChart = null;
        if (reviewersStatusEl) {
          reviewersStatusEl.textContent = "No submitted reviews found.";
        }
      } else {
        reviewersChart = renderReviewersBarChart(
          "reviewersChart",
          reviewersChart,
          items,
        );
        if (reviewersStatusEl) {
          reviewersStatusEl.textContent = reviewersChart
            ? "Top 10 players ranked by submitted review count."
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
