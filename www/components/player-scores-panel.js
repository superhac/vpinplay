class PlayerScoresPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.vpsId = null;
    this.userId = null;
    this.apiBase = null;
    this.availableTables = [];
  }

  static get observedAttributes() {
    return ["vps-id", "user-id", "api-base"];
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue !== newValue) {
      if (name === "vps-id") {
        this.vpsId = newValue;
      } else if (name === "user-id") {
        this.userId = newValue;
      } else if (name === "api-base") {
        this.apiBase = newValue.replace(/\/$/, "");
      }
      if (this.vpsId && this.userId) this.loadPanel();
    }
  }

  connectedCallback() {
    this.render();
    const urlParams = new URLSearchParams(window.location.search);
    this.vpsId =
      this.getAttribute("vps-id") ||
      urlParams.get("score_vpsid") ||
      urlParams.get("vpsid");
    this.userId = this.getAttribute("user-id") || urlParams.get("userid");
    this.apiBase = (
      this.getAttribute("api-base") || "https://api.vpinplay.com:8888"
    ).replace(/\/$/, "");

    if (this.userId) {
      this.loadAvailableTables();
    }

    if (this.vpsId && this.userId) {
      this.loadPanel();
    }
  }

  render() {
    this.shadowRoot.innerHTML = `
      <link rel="stylesheet" href="css/base.css">
      <link rel="stylesheet" href="css/player-scores-panel.css">      
        <div class="panel-header">
          <div>
            <h3>Scoreboard Viewer</h3>
            <p class="panel-note">
              Choose a table score panel from scoreboards you have submitted.
            </p>
          </div>
          <label class="panel-picker">
            <span>Scoreboard</span>
            <select id="scoreUserPanelSelect">
              <option value="">Loading available scoreboards...</option>
            </select>
          </label>
        </div>
        <div class="panel-body">
          <div class="scoreboard-header">
            <img class="table-art" src="" alt="Table backglass art" id="table-art">
            <div class="header-content">
              <div class="table-title" id="table-title">Loading table...</div>
              <div class="meta-stack">
                <div class="meta-line rating-line">
                  <span class="rating-label">Rating</span>
                  <span id="rating-display">Loading...</span>
                </div>
                <div class="meta-line" id="table-subtitle">Loading metadata...</div>
                <div class="meta-line" id="table-meta">Waiting for user score data.</div>
              </div>
            </div>
            <div class="user-badge" id="user-badge">No User</div>
          </div>

          <div class="status" id="status" hidden>Ready.</div>
          <div class="grid-score-panels" id="grid-score-panels"></div>
        </div>
    `;

    // Attach select change handler
    const select = this.shadowRoot.getElementById("scoreUserPanelSelect");
    if (select) {
      select.addEventListener("change", (e) => this.handleScorePanelChange(e));
    }
  }

  handleScorePanelChange(event) {
    const vpsId = event.target.value;
    if (!vpsId) return;

    this.vpsId = vpsId;

    // Update URL without reload
    const url = new URL(window.location);
    url.searchParams.set("score_vpsid", vpsId);
    window.history.pushState({}, "", url);

    this.loadPanel();
  }

  async loadAvailableTables() {
    if (!this.userId) return;

    const select = this.shadowRoot.getElementById("scoreUserPanelSelect");
    if (!select) return;

    try {
      const result = await this.api(
        `/api/v1/users/${encodeURIComponent(this.userId)}/tables/with-score?limit=100&offset=0`,
      );

      if (!result.ok || !Array.isArray(result.data)) {
        select.innerHTML =
          '<option value="">Failed to load scoreboards</option>';
        return;
      }

      this.availableTables = result.data;

      if (this.availableTables.length === 0) {
        select.innerHTML = '<option value="">No scoreboards found</option>';
        return;
      }

      select.innerHTML =
        '<option value="">Select a scoreboard...</option>' +
        this.availableTables
          .map((table) => {
            const name = table.vpsdb?.name || table.tableTitle || table.vpsId;
            return `<option value="${table.vpsId}" ${table.vpsId === this.vpsId ? "selected" : ""}>${name}</option>`;
          })
          .join("");
    } catch (error) {
      select.innerHTML = '<option value="">Error loading scoreboards</option>';
    }
  }

  q(id) {
    return this.shadowRoot.getElementById(id);
  }

  setStatus(message, tone = "info") {
    const el = this.q("status");
    if (!el) return;
    el.hidden = false;
    el.textContent = message;
    el.className = `status ${tone}`;
  }

  clearStatus() {
    const el = this.q("status");
    if (!el) return;
    el.hidden = true;
    el.textContent = "";
    el.className = "status";
  }

  getCaseInsensitiveValue(obj, key) {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return undefined;
    const wanted = String(key).toLowerCase();
    const matched = Object.keys(obj).find(
      (k) => String(k).toLowerCase() === wanted,
    );
    return matched ? obj[matched] : undefined;
  }

  fmtRatingStars(value) {
    if (value === null || value === undefined || value === "") return "Unrated";
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return "Unrated";
    const clamped = Math.max(0, Math.min(5, numeric));
    const rounded = Math.round(clamped);
    const stars = Array.from({ length: 5 }, (_, index) => {
      const filled = index < rounded;
      return `<span class="rating-star${filled ? " is-filled" : ""}">★</span>`;
    }).join("");
    return `<span class="rating-stars" aria-label="${clamped.toFixed(2)} out of 5 stars">${stars}</span><span class="rating-value">(${clamped.toFixed(2)})</span>`;
  }

  scoreText(entry) {
    if (entry.score !== null && entry.score !== undefined) {
      const base = window.fmtNumber
        ? window.fmtNumber(entry.score)
        : entry.score.toLocaleString();
      return entry.value_suffix ? `${base} ${entry.value_suffix}` : base;
    }
    if (Array.isArray(entry.extra_lines) && entry.extra_lines.length) {
      return entry.extra_lines.join(" | ");
    }
    return "-";
  }

  groupEntries(entries) {
    const groups = new Map();
    for (const entry of entries) {
      const section = String(entry.section || "").trim() || "Other";
      if (!groups.has(section)) groups.set(section, []);
      groups.get(section).push(entry);
    }
    return groups;
  }

  scoreOwnerLabel(entry, replacement) {
    const entryInitials =
      typeof entry?.initials === "string" ? entry.initials.trim() : "";
    const entryUserId =
      typeof entry?.userId === "string"
        ? entry.userId.trim()
        : typeof entry?.userid === "string"
          ? entry.userid.trim()
          : "";

    if (
      replacement &&
      replacement.initials &&
      replacement.userId &&
      entryInitials &&
      entryInitials.toUpperCase() === replacement.initials.toUpperCase()
    ) {
      return replacement.userId;
    }

    return entryUserId || entryInitials || "-";
  }

  getPreferredSectionOrder(groups) {
    const sections = [...groups.keys()].sort((a, b) => {
      if (a === "GRAND CHAMPION") return -1;
      if (b === "GRAND CHAMPION") return 1;
      return a.localeCompare(b);
    });
    return sections;
  }

  renderDynamicSections(groups, orderedSections, replacement) {
    const gridPanels = this.q("grid-score-panels");
    if (!gridPanels) return;

    gridPanels.innerHTML = "";

    orderedSections.forEach((sectionName) => {
      const entries = groups.get(sectionName) || [];
      if (!entries.length) return;

      const isGrandChampion = sectionName === "GRAND CHAMPION";
      const cardClass = isGrandChampion ? "score-card hero" : "score-card";

      const card = document.createElement("section");
      card.className = cardClass;
      card.innerHTML = `
        <div class="score-card-title">${sectionName}</div>
        <div class="score-card-body"></div>
      `;

      const body = card.querySelector(".score-card-body");

      if (isGrandChampion) {
        this.renderGrandChampionInline(body, entries[0], replacement);
      } else if (
        sectionName === "MARTIAN CHAMPION" ||
        sectionName === "RULER OF THE UNIVERSE"
      ) {
        this.renderSpecialInline(body, entries[0], replacement);
      } else {
        this.renderRankedListInline(body, entries, replacement);
      }

      gridPanels.appendChild(card);
    });
  }

  renderGrandChampionInline(host, entry, replacement) {
    if (!entry) {
      host.className = "hero-empty";
      host.textContent = "No grand champion entry found.";
      return;
    }
    host.innerHTML = `
      <div class="grand-initials">${this.scoreOwnerLabel(entry, replacement)}</div>
      <div class="grand-score">${this.scoreText(entry)}</div>
    `;
  }

  renderRankedListInline(host, entries, replacement) {
    if (!entries.length) {
      host.innerHTML = `<div class="empty-state">No entries available.</div>`;
      return;
    }
    host.innerHTML = `
      <div class="score-list">
        ${entries
          .map(
            (entry) => `
          <div class="score-row">
            <div class="score-rank">${entry.rank === null || entry.rank === undefined ? "CHAMP" : `#${entry.rank}`}</div>
            <div class="score-initials">${this.scoreOwnerLabel(entry, replacement)}</div>
            <div class="score-value">${this.scoreText(entry)}</div>
          </div>
        `,
          )
          .join("")}
      </div>
    `;
  }

  renderSpecialInline(host, entry, replacement) {
    if (!entry) {
      host.innerHTML = `<div class="empty-state">No entry available.</div>`;
      return;
    }

    const extraLines = Array.isArray(entry.extra_lines)
      ? entry.extra_lines
      : [];
    const detail = this.scoreText(entry);
    host.innerHTML = `
      <div class="special-entry">
        <div class="special-pill">${this.scoreOwnerLabel(entry, replacement)}</div>
        ${detail ? `<div class="special-detail">${detail}</div>` : ""}
        ${
          extraLines.length && entry.score != null
            ? extraLines
                .map((line) => `<div class="special-subtle">${line}</div>`)
                .join("")
            : ""
        }
      </div>
    `;
  }

  getScorePayload(row) {
    const direct = this.getCaseInsensitiveValue(row, "score");
    if (!direct) return null;

    if (direct && typeof direct === "object" && Array.isArray(direct.entries)) {
      return direct;
    }

    if (direct && typeof direct === "object" && !Array.isArray(direct)) {
      const scoreType = direct.score_type || direct.section || "HIGHEST SCORE";
      const scoreValue = direct.value ?? direct.score ?? null;

      return {
        entries: [
          {
            section: scoreType,
            score: scoreValue,
            value_suffix: direct.value_suffix || "",
            extra_lines: direct.extra_lines || [],
            initials: row.userId || "",
            userId: row.userId || "",
            rank: null,
          },
        ],
      };
    }

    const user = this.getCaseInsensitiveValue(row, "user");
    const nested = this.getCaseInsensitiveValue(user, "score");
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      if (Array.isArray(nested.entries)) {
        return nested;
      }

      const scoreType = nested.score_type || nested.section || "HIGHEST SCORE";
      const scoreValue = nested.value ?? nested.score ?? null;

      return {
        entries: [
          {
            section: scoreType,
            score: scoreValue,
            value_suffix: nested.value_suffix || "",
            extra_lines: nested.extra_lines || [],
            initials: row.userId || "",
            userId: row.userId || "",
            rank: null,
          },
        ],
      };
    }

    return null;
  }

  getTableDisplayName(row) {
    const vpsdbName =
      typeof row?.vpsdb?.name === "string" ? row.vpsdb.name.trim() : "";
    if (vpsdbName) return vpsdbName;

    const tableTitle =
      typeof row?.tableTitle === "string" ? row.tableTitle.trim() : "";
    if (tableTitle) return tableTitle;

    return this.vpsId;
  }

  async api(path) {
    try {
      const response = await fetch(`${this.apiBase}${path}`);
      const data = await response.json().catch(() => []);
      return { ok: response.ok, status: response.status, data };
    } catch (error) {
      return { ok: false, status: 0, data: { error: error.message } };
    }
  }

  async fetchScoreRow(userId) {
    const path = `/api/v1/users/${encodeURIComponent(userId)}/tables/with-score?vpsId=${encodeURIComponent(this.vpsId)}&limit=1&offset=0`;
    return this.api(path);
  }

  async fetchUserInitials(userId) {
    const path = `/api/v1/users/${encodeURIComponent(userId)}/initials`;
    return this.api(path);
  }

  async fetchRatingSummary() {
    const path = `/api/v1/tables/${encodeURIComponent(this.vpsId)}/rating-summary`;
    return this.api(path);
  }

  async loadPanel() {
    if (!this.vpsId || !this.userId) return;

    this.q("user-badge").textContent = this.userId;

    this.setStatus(`Loading score data for ${this.userId}...`);
    const [scoreResult, initialsResult, ratingSummaryResult] =
      await Promise.all([
        this.fetchScoreRow(this.userId),
        this.fetchUserInitials(this.userId),
        this.fetchRatingSummary(),
      ]);

    if (!scoreResult.ok || !Array.isArray(scoreResult.data)) {
      this.setStatus(
        `Failed to load score data (${scoreResult.status || "network"}).`,
        "error",
      );
      return;
    }

    const row = scoreResult.data.find(
      (item) => item && String(item.vpsId || "") === this.vpsId,
    );
    const score = row ? this.getScorePayload(row) : null;
    const entries = Array.isArray(score?.entries) ? score.entries : [];

    if (!row || !score || !entries.length) {
      this.setStatus(
        `No score data found for ${this.userId} on ${this.vpsId}.`,
        "error",
      );
      return;
    }

    // Update header
    this.q("table-title").textContent = this.getTableDisplayName(row);
    this.q("rating-display").innerHTML = this.fmtRatingStars(
      ratingSummaryResult.ok ? ratingSummaryResult.data?.avgRating : null,
    );

    const manufacturer =
      typeof row?.vpsdb?.manufacturer === "string"
        ? row.vpsdb.manufacturer.trim()
        : "";
    const year =
      row?.vpsdb?.year === null || row?.vpsdb?.year === undefined
        ? ""
        : String(row.vpsdb.year).trim();
    this.q("table-subtitle").innerHTML =
      `<strong>${manufacturer || "Unknown Manufacturer"}</strong>${year ? ` • ${year}` : ""}`;

    // Set table art
    const artUrl = `https://github.com/superhac/vpinmediadb/raw/refs/heads/main/${this.vpsId}/1k/bg.png`;
    this.q("table-art").src = artUrl;

    const groups = this.groupEntries(entries);
    const replacement =
      initialsResult.ok && initialsResult.data
        ? {
            userId: String(
              initialsResult.data.userId || this.userId || "",
            ).trim(),
            initials: String(initialsResult.data.initials || "").trim(),
          }
        : null;

    const orderedSections = this.getPreferredSectionOrder(groups);
    this.renderDynamicSections(groups, orderedSections, replacement);

    const updatedAt = row.updatedAt
      ? new Date(row.updatedAt).toLocaleString()
      : "Unknown";
    this.q("table-meta").textContent = `Last update: ${updatedAt}`;
    this.clearStatus();
  }
}

customElements.define("player-scores-panel", PlayerScoresPanel);
