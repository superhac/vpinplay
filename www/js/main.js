const API_BASE = "https://api.vpinplay.com:8888";
const ALL_TABLES_PAGE_SIZE = 50;
const API_PAGE_LIMIT = 100;
const PAGE_SIZE = 100;
const MAX_DASHBOARD_LIMIT = 100;
const ENABLE_ALL_TABLES_PANEL = false;
const TOP_PLAYER_DAYS = 7;
const TOP_PLAYER_LIMIT = 5;
let allTablesOffset = 0;
let allTablesTotal = null;

function fmtTimeAgo(date) {
    if (!date) return "-";
    const now = new Date();
    const seconds = Math.floor((now - date) / 1000);

    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    return `${days}d`;
}

function q(id) { return document.getElementById(id); }

const icons = {
    light: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="sunGradient" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stop-color="#FF00CC" /><stop offset="100%" stop-color="#FFCC00" /></linearGradient></defs><circle cx="12" cy="12" r="10" fill="url(#sunGradient)" /><path d="M2 12H22M2 15H22M2 18H22" stroke="#121212" stroke-width="1.5" /></svg>`,
    dark: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="moonGradient" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#00D2FF" /><stop offset="100%" stop-color="#9D50BB" /></linearGradient></defs><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" fill="url(#moonGradient)" stroke="#00D2FF" stroke-width="0.5" /><circle cx="18" cy="5" r="0.8" fill="#FFFFFF" /><circle cx="15" cy="8" r="0.5" fill="#FFFFFF" /></svg>`
};

function getPreferredTheme() {
    const saved = localStorage.getItem("vpin-theme");
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function updateThemeToggleLabel(theme) {
    const btn = q("themeToggleBtn");
    if (!btn) return;

    // Use 'next' theme logic: if current is dark, button suggests 'Light'
    const nextTheme = theme === "dark" ? "light" : "dark";
    const label = nextTheme.charAt(0).toUpperCase() + nextTheme.slice(1);
    
    // Injects the SVG for the NEXT theme along with the text
    btn.innerHTML = `
        <span class="icon-wrapper">${icons[nextTheme]}</span>
        <span class="btn-text">${label}</span>
    `;
}

function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    updateThemeToggleLabel(theme);
}

function initTheme() {
    applyTheme(getPreferredTheme());
}

function toggleTheme() {
    const btn = q("themeToggleBtn");
    const current = document.documentElement.getAttribute("data-theme");
    const next = current === "dark" ? "light" : "dark";

    // Trigger your CSS spin animation
    if (btn) {
        btn.classList.add("refreshing");
        setTimeout(() => btn.classList.remove("refreshing"), 600);
    }

    localStorage.setItem("vpin-theme", next);
    applyTheme(next);
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function fmtDate(value) {
    if (!value) return "-";
    const raw = String(value).trim();
    const hasTimeZone = /([zZ]|[+-]\d{2}:\d{2})$/.test(raw);
    const normalized = !hasTimeZone && raw.includes("T") ? `${raw}Z` : raw;
    const d = new Date(normalized);
    if (Number.isNaN(d.getTime())) return "-";
    return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" });
}

function truncateHash(value, max = 32) {
    const text = value || "";
    return text.length > max ? text.slice(0, max) : (text || "-");
}

function fmtNumber(value) {
    return Number(value || 0).toLocaleString();
}

function fmtRuntime(minutes) {
  const n = Number(minutes || 0);
  return `${n} min`;
}

function fmtLatestScoreValue(score) {
    if (!score || typeof score !== "object") return "-";
    const numericValue = score.value ?? score.score;
    if (
        numericValue !== null &&
        numericValue !== undefined &&
        numericValue !== ""
    ) {
        const base = fmtNumber(numericValue);
        return score.value_suffix ? `${base} ${score.value_suffix}` : base;
    }
    if (Array.isArray(score.extra_lines) && score.extra_lines.length) {
        return score.extra_lines.join(" | ");
    }
    return "-";
}

function fmtRatingStars(value, options = {}) {
    if (value === null || value === undefined || value === "") return "-";
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return "-";
    const clamped = Math.max(0, Math.min(5, numeric));
    const roundedToHalf = Math.round(clamped * 2) / 2;
    const fullStars = Math.floor(roundedToHalf);
    const hasHalf = roundedToHalf - fullStars >= 0.5;
    let stars = "";
    for (let i = 0; i < 5; i += 1) {
        const fillPercent = i < fullStars ? 100 : (i === fullStars && hasHalf ? 50 : 0);
        stars += `<span class="rating-star-cell" aria-hidden="true"><span class="rating-star empty">★</span><span class="rating-star fill" style="width:${fillPercent}%">★</span></span>`;
    }
    const numericText = options.showNumeric ? ` <span class="rating-value">(${escapeHtml(clamped.toFixed(2))})</span>` : "";
    return `<span class="rating-stars" title="${escapeHtml(clamped.toFixed(2))} / 5" aria-label="${escapeHtml(clamped.toFixed(2))} out of 5 stars">${stars}</span>${numericText}`;
}

function fmtTableName(row) {
    const name = row?.vpsdb?.name || "Unknown Table";
    const manufacturer = row?.vpsdb?.manufacturer;
    const year = row?.vpsdb?.year;
    const parts = [manufacturer, year].filter(v => v !== null && v !== undefined && String(v).trim() !== "");
    return parts.length ? `${name} (${parts.join(", ")})` : name;
}

function linkTableName(name, vpsId) {
    const text = name === null || name === undefined || name === "" ? "-" : String(name);
    const id = String(vpsId || "").trim();
    if (!id || text === "-") return escapeHtml(text);
    return `<a href="tables.html?vpsid=${encodeURIComponent(id)}">${escapeHtml(text)}</a>`;
}

function linkVpsId(vpsId) {
    const id = String(vpsId || "").trim();
    if (!id) return "-";
    return `<a href="https://virtualpinballspreadsheet.github.io/games?game=${encodeURIComponent(id)}" target="_blank" rel="noopener noreferrer">${escapeHtml(id)}</a>`;
}

function linkUserId(userId) {
    const id = String(userId || "").trim();
    if (!id) return "-";
    return `<a href="players.html?userid=${encodeURIComponent(id)}">${escapeHtml(id)}</a>`;
}

async function api(path) {
    try {
        const response = await fetch(`${API_BASE}${path}`);
        const data = await response.json().catch(() => ({}));
        return { ok: response.ok, status: response.status, data };
    } catch (error) {
        return { ok: false, status: 0, data: { error: error.message } };
    }
}

function flattenObject(obj, prefix = "") {
  const out = [];
  if (obj === null || obj === undefined) {
    out.push({ key: prefix || "value", value: "-" });
    return out;
  }
  if (Array.isArray(obj)) {
    out.push({
      key: prefix,
      value:
        obj
          .map((item) =>
            typeof item === "object" ? JSON.stringify(item) : String(item),
          )
          .join(", ") || "-",
    });
    return out;
  }
  if (typeof obj !== "object") {
    out.push({ key: prefix || "value", value: obj });
    return out;
  }

  Object.entries(obj).forEach(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      out.push(...flattenObject(value, path));
    } else if (Array.isArray(value)) {
      out.push({
        key: path,
        value:
          value
            .map((item) =>
              typeof item === "object" ? JSON.stringify(item) : String(item),
            )
            .join(", ") || "-",
      });
    } else {
      out.push({ key: path, value });
    }
  });
  return out;
}

function renderTable(elId, columns, rows) {
    const el = q(elId);
    if (!rows || rows.length === 0) {
        el.innerHTML = `<tr><td class="muted">No data</td></tr>`;
        return;
    }

    let html = "<thead><tr>";
    columns.forEach(col => { html += `<th>${escapeHtml(col.label)}</th>`; });
    html += "</tr></thead><tbody>";

    rows.forEach(row => {
        html += "<tr>";
        columns.forEach(col => {
            const raw = col.getter(row);
            const text = raw === null || raw === undefined || raw === "" ? "-" : raw;
            html += `<td>${col.html ? text : escapeHtml(text)}</td>`;
        });
        html += "</tr>";
    });

    html += "</tbody>";
    el.innerHTML = html;
}

function setKpi(id, value, className = "") {
    const el = q(id);
    el.textContent = value;
    el.className = `value ${className}`.trim();
}

async function loadAllTablesPage() {
    const result = await api(`/api/v1/tables?limit=${ALL_TABLES_PAGE_SIZE}&offset=${allTablesOffset}`);
    const items = result.ok && Array.isArray(result.data?.items) ? result.data.items : [];
    const pg = result.ok ? (result.data?.pagination || {}) : {};
    allTablesTotal = result.ok ? (pg.total ?? null) : null;

    renderTable("allTablesTable",
        [
            { label: "Name", getter: r => linkTableName(r.vpsdb?.name || "Unknown Table", r.vpsId), html: true },
            { label: "Manufacturer", getter: r => r.vpsdb?.manufacturer || "-" },
            { label: "Year", getter: r => r.vpsdb?.year || "-" },
            { label: "VPS ID", getter: r => linkVpsId(r.vpsId), html: true },
            { label: "Filename", getter: r => r.filename || "-" },
            { label: "Filehash", getter: r => truncateHash(r.filehash, 32) },
        ],
        items
    );

    const pageNumber = Math.floor((pg.offset || 0) / ALL_TABLES_PAGE_SIZE) + 1;
    const total = pg.total || 0;
    const returned = pg.returned || 0;
    const start = total === 0 ? 0 : (pg.offset || 0) + 1;
    const end = (pg.offset || 0) + returned;
    q("allTablesPageInfo").textContent = `Page ${pageNumber} (${start}-${end} of ${total})`;
    q("allTablesPrevBtn").disabled = !pg.hasPrev;
    q("allTablesNextBtn").disabled = !pg.hasNext;
}

async function prevAllTablesPage() {
    allTablesOffset = Math.max(0, allTablesOffset - ALL_TABLES_PAGE_SIZE);
    await loadAllTablesPage();
}

async function nextAllTablesPage() {
    allTablesOffset = allTablesOffset + ALL_TABLES_PAGE_SIZE;
    await loadAllTablesPage();
}

async function loadTopPlayerActivity(metric, days = TOP_PLAYER_DAYS, limit = TOP_PLAYER_LIMIT) {
    const safeLimit = Math.max(1, Math.min(API_PAGE_LIMIT, Number(limit || TOP_PLAYER_LIMIT)));
    const res = await api(`/api/v1/users/top-activity?metric=${encodeURIComponent(metric)}&days=${encodeURIComponent(days)}&limit=${encodeURIComponent(safeLimit)}`);
    return res.ok && Array.isArray(res.data?.items) ? res.data.items : [];
}

function parseDashboardLimit() {
    const raw = Number.parseInt(String(q("limitInput").value || "").trim(), 10);
    if (!Number.isFinite(raw) || raw < 1) return 5;
    return Math.min(raw, MAX_DASHBOARD_LIMIT);
}

async function fetchPaginatedRows(basePath, requestedLimit) {
    const target = Math.max(1, Number(requestedLimit || 0));
    let offset = 0;
    let remaining = target;
    const items = [];

    while (remaining > 0) {
        const pageLimit = Math.min(API_PAGE_LIMIT, remaining);
        const joiner = basePath.includes("?") ? "&" : "?";
        const res = await api(`${basePath}${joiner}limit=${encodeURIComponent(pageLimit)}&offset=${encodeURIComponent(offset)}`);
        if (!res.ok || !Array.isArray(res.data)) return [];

        const pageItems = res.data;
        items.push(...pageItems);

        if (pageItems.length < pageLimit) break;
        offset += pageItems.length;
        remaining = target - items.length;
    }

    return items.slice(0, target);
}
