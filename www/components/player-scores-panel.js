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
    if (oldValue === newValue) return;

    // Update the internal state variables
    this.syncState();

    // Only trigger a load if the component is actually attached and rendered
    if (this.shadowRoot && this.shadowRoot.innerHTML !== "") {
      if (this.vpsId && this.userId) {
        this.loadPanel();
      } else {
        this.hidePanel();
      }
    }
  }

  connectedCallback() {
    this.render(); // Build the DOM structure ONCE
    this.syncState(); // Get the initial data

    if (this.userId) {
      this.loadAvailableTables();
    }

    if (this.vpsId && this.userId) {
      this.loadPanel();
    } else {
      this.hidePanel();
    }
  }

  syncState() {
    const urlParams = new URLSearchParams(window.location.search);

    // Priority: Attribute > URL Param > Internal State
    this.vpsId =
      this.getAttribute("vps-id") ||
      urlParams.get("score_vpsid") ||
      urlParams.get("vpsid") ||
      this.vpsId;

    this.userId =
      this.getAttribute("user-id") || urlParams.get("userid") || this.userId;

    const rawApi =
      this.getAttribute("api-base") || "https://api.vpinplay.com:8888";
    this.apiBase = rawApi.replace(/\/$/, "");
  }

  render() {
    this.shadowRoot.innerHTML = `
      <link rel="stylesheet" href="css/base.css">
      <style>
        :host {
          position: relative;
          color: var(--ink);
          z-index: 1;
          display: block;
          width: 100%;
          contain: layout;
        }

        :host,
        :host * {
          box-sizing: border-box;
          font-family: inherit;
        }

        .panel-header {
          display: flex;
          gap: 16px;
          justify-content: space-between;
          align-items: end;
          flex-wrap: wrap;
          margin-bottom: 12px;
        }

        .panel-note {
          margin: 0;
          color: var(--ink-muted);
          font-size: 0.9rem;
        }

        .panel-picker {
          position: relative; /* Anchor for the dropdown list */
          width: 100%;
          max-width: 320px;
        }

        .panel-picker span {
          display: block;
          margin: 8px 0;
        }

        .picker-trigger {
          width: 100%;
          border: 1px solid var(--line);
          border-radius: 10px;
          background: var(--surface-2);
          color: var(--ink);
          padding: 10px 12px;
          text-align: left;
          cursor: pointer;
          font: inherit;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .picker-trigger::after {
          content: '▼';
          font-size: 0.6rem;
          color: var(--ink-muted);
        }

        .picker-options {
          display: none;
          position: absolute;
          left: 0;
          right: 0;
          z-index: 100;
          background: var(--surface-2);
          border: 1px solid var(--line);
          border-radius: 10px;
          max-height: 250px; /* Adjust as needed */
          overflow-y: auto;
          box-shadow: 0 4px 12px rgba(0,0,0,0.5);
        }

        /* Default: Opens Down */
        .picker-options.open-down {
          display: block;
          top: 100%;
          margin-top: 4px;
        }

        /* Smart Direction: Opens Up */
        .picker-options.open-up {
          display: block;
          bottom: 100%;
          margin-bottom: 4px;
        }

        .picker-option {
          padding: 10px 12px;
          cursor: pointer;
          color: var(--ink);
          transition: background 0.2s;
        }

        .picker-option:hover {
          background: var(--surface);
          color: var(--neon-cyan);
        }

        .picker-option.active {
          background: var(--surface);
          color: var(--neon-cyan);
          border-left: 3px solid var(--neon-cyan);
        }

        .picker-option.is-highlighted {
          background: var(--surface);
          color: var(--neon-cyan);
        }

        .picker-trigger:focus {
          outline: none;
          border-color: var(--neon-cyan);
          box-shadow: 0 0 2px var(--glow-cyan);
        }

        .panel-body {
          width: 100%;
          border-radius: 12px;
          background: transparent;
          display: none;
        }

        .panel-body.visible {
          display: block;
        }

        /* Scoreboard header */
        .scoreboard-header {
          display: grid;
          grid-template-columns: 290px minmax(0, 1fr) auto;
          gap: 22px;
          align-items: start;
          background: var(--surface);
          border-radius: var(--radius);
          padding: 20px;
          box-shadow: var(--shadow);
          margin-bottom: 24px;
        }

        .table-art {
          width: 290px;
          height: 164px;
          border-radius: 12px;
          object-fit: cover;
        }

        .header-content {
          min-width: 0;
          display: grid;
          gap: 0.7rem;
          align-content: center;
        }

        .table-title {
          margin: 0;
          color: var(--ink);
          font-size: clamp(2.4rem, 5vw, 4.3rem);
          line-height: 0.92;
          font-weight: 500;
          letter-spacing: 0.02em;
          text-shadow: 0 0 28px rgba(198, 134, 255, 0.2);
        }

        .meta-stack {
          display: grid;
          gap: 0.46rem;
        }

        .meta-line {
          margin: 0;
          color: var(--ink-muted);
          font-size: 1.14rem;
          line-height: 1.32;
        }

        .meta-line strong {
          color: var(--ink);
          font-weight: 700;
        }

        .rating-line {
          display: flex;
          align-items: center;
          gap: 0.8rem;
          flex-wrap: wrap;
        }

        .rating-label {
          color: var(--ink-muted);
          text-transform: uppercase;
          letter-spacing: 0.1em;
          font-size: 0.9rem;
          font-weight: 700;
        }

        .rating-stars {
          display: inline-flex;
          align-items: center;
          gap: 0.16rem;
        }

        .rating-star {
          color: rgba(255, 239, 188, 0.28);
          font-size: 1.12rem;
          line-height: 1;
        }

        .rating-star.is-filled {
          color: var(--neon-yellow);
          text-shadow: var(--glow-yellow);
        }

        .rating-value {
          color: var(--ink-muted);
          font-size: 1.08rem;
        }

        .user-badge {
          background: var(--surface-2);
          color: var(--neon-cyan);
          padding: 10px 20px;
          border-radius: 8px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          border: 1px solid var(--line);
        }

        /* Special entries */
        .special-entry {
          display: flex;
          flex-direction: column;
          gap: 8px;
          padding: 12px;
        }

        .special-pill {
          background: var(--surface-2);
          color: var(--neon-cyan);
          padding: 8px 16px;
          border-radius: 24px;
          font-weight: 700;
          width: fit-content;
        }

        .special-detail {
          font-size: 1.1rem;
          color: var(--ink);
        }

        .special-subtle {
          font-size: 0.9rem;
          color: var(--ink-muted);
        }

      .status {
        margin-bottom: 14px;
        border-radius: 10px;
        padding: 10px 12px;
        background: rgba(0, 217, 255, 0.08);
        border: 1px solid rgba(0, 217, 255, 0.18);
        color: var(--neon-cyan);
        font-size: 0.9rem;
        font-weight: 700;
        box-shadow: var(--glow-cyan);
      }

      .status.error {
        color: var(--bad);
        border-color: rgba(255, 10, 120, 0.24);
        background: rgba(255, 10, 120, 0.12);
      }

      .grid-score-panels {
        display: flex;
        flex-direction: row;
        flex-wrap: wrap;
        gap: 12px;
        align-items: start;
        width: 100%;
      }

      .score-card {
        background: var(--surface);
        border-radius: var(--radius);
        box-shadow: var(--shadow);
        position: relative;
        padding: 14px;
        min-width: 0;
        display: grid;
        gap: 12px;
        flex: 1 1 calc(50% - 6px);
        max-width: calc(50% - 6px);
      }

      .score-card:last-child:nth-child(odd) {
        margin: 0 auto;
      }

      .score-card.hero {
        background:
          linear-gradient(135deg, rgba(180, 41, 249, 0.12), rgba(0, 217, 255, 0.08)),
          var(--surface-soft);
        border-radius: var(--radius);
        display: flex;
        flex-direction: column;
        align-items: center;
        width: fit-content;
        flex-basis: 100%;
        max-width: none;
        margin: 0 auto;
        padding: 12px;
      }

      .score-card-title {
        color: var(--ink-muted);
        text-transform: uppercase;
        letter-spacing: 0.1em;
        font-size: 0.78rem;
        font-weight: 800;
      }

      .hero-empty,
      .empty-state {
        color: var(--ink-muted);
      }

      .grand-initials {
        font-size: 2.4rem;
        font-weight: 900;
        letter-spacing: 0.08em;
        color: var(--neon-cyan);
        text-shadow: var(--glow-cyan);
        text-align: center;
      }

      .grand-score {
        font-size: 1.6rem;
        font-weight: 800;
        text-align: center;
      }

      .score-list {
        display: grid;
        gap: 10px;
      }

      .score-row {
        display: grid;
        grid-template-columns: max-content 1fr max-content;
        gap: 12px;
        align-items: center;
        padding: 10px 12px;
        border-radius: 10px;
        border: 1px solid var(--line);
        background: var(--surface-2);
      }

      .score-rank {
        color: var(--neon-cyan);
        font-weight: 800;
        font-size: 0.82rem;
        text-transform: uppercase;
        text-shadow: var(--glow-cyan);
      }

      .score-initials {
        font-weight: 800;
        letter-spacing: 0.04em;
        font-size: 1rem;
        min-height: 1.2em;
        color: var(--ink);
      }

      .score-value {
        text-align: right;
        font-weight: 700;
        font-size: 1rem;
        min-width: 0;
        color: var(--ink);
      }

      @media (max-width: 900px) {
        .panel-picker {
          min-width: 100%;
        }

        .table-art {
          width: 100%;
          max-width: 320px;
          height: auto;
          aspect-ratio: 250 / 141;
        }

        .table-title {
          font-size: clamp(2rem, 8.4vw, 3rem);
        }

        .meta-line, .rating-line {
          font-size: 0.8rem;
        }

        .user-badge {
          text-align: center;
        }

        .scoreboard-header {
          grid-template-columns: 1fr;
          gap: 14px;
        }

        .score-card {
          min-width: 100%;
        }

        .score-row {
          gap: 8px;
          padding: 4px 6px;
          align-items: center;
        }

        .score-rank, .score-initials, .score-value {
          font-size: 0.8rem;
          font-weight: 500;
        }

        .score-initials {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .grand-initials {
          font-size: 2rem;
        }

        .grand-score {
          font-size: 1.3rem;
        }
      }
    </style>    
      <div class="panel-header">
        <div>
          <h3>Scoreboard Viewer</h3>
          <p class="panel-note">
            Choose a table with scores you have submitted.
          </p>
        </div>
        <div class="panel-picker" id="pickerContainer">
          <span>Scoreboard</span>
          <button id="pickerTrigger" class="picker-trigger" tabindex="0">Select a scoreboard...</button>
          <div id="pickerOptions" class="picker-options">
            </div>
        </div>
      </div>
      <div class="panel-body">
        <div class="scoreboard-header">
          <img class="table-art" src="" alt="Table backglass art" id="table-art">
          <div class="header-content">
            <div class="table-title" id="table-title">Loading table...</div>
            <div class="meta-stack">
            <div class="meta-line" id="table-subtitle">Loading metadata...</div>
              <div class="meta-line rating-line">
                <span class="rating-label">Rating</span>
                <span id="rating-display">Loading...</span>
              </div>
              <div class="meta-line" id="table-meta">Waiting for user score data.</div>
            </div>
          </div>
          <div class="user-badge" id="user-badge">No User</div>
        </div>

        <div class="status" id="status" hidden>Ready.</div>
        <div class="grid-score-panels" id="grid-score-panels"></div>
      </div>
    `;

    const trigger = this.shadowRoot.getElementById("pickerTrigger");
    const optionsMenu = this.shadowRoot.getElementById("pickerOptions");

    trigger.addEventListener("click", () => {
      if (
        optionsMenu.classList.contains("open-up") ||
        optionsMenu.classList.contains("open-down")
      ) {
        optionsMenu.classList.remove("open-up", "open-down");
        return;
      }
      const rect = trigger.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const menuHeight = 260;

      optionsMenu.classList.remove("open-up", "open-down");

      if (spaceBelow < menuHeight) {
        optionsMenu.classList.add("open-up");
      } else {
        optionsMenu.classList.add("open-down");
      }
    });

    this.shadowRoot.addEventListener("click", (e) => {
      if (!this.q("pickerContainer").contains(e.target)) {
        optionsMenu.classList.remove("open-up", "open-down");
      }
    });

    let highlightedIndex = -1;

    trigger.addEventListener("keydown", (e) => {
      const options = Array.from(
        optionsMenu.querySelectorAll(".picker-option"),
      );
      const isOpen =
        optionsMenu.classList.contains("open-up") ||
        optionsMenu.classList.contains("open-down");

      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (!isOpen) {
          trigger.click();
          return;
        }

        if (e.key === "ArrowDown") {
          highlightedIndex = (highlightedIndex + 1) % options.length;
        } else {
          highlightedIndex =
            (highlightedIndex - 1 + options.length) % options.length;
        }

        options.forEach((opt, idx) => {
          opt.classList.toggle("is-highlighted", idx === highlightedIndex);
          if (idx === highlightedIndex)
            opt.scrollIntoView({ block: "nearest" });
        });
      }

      if (e.key === "Enter" && isOpen) {
        e.preventDefault();
        if (highlightedIndex >= 0) {
          options[highlightedIndex].click();
        }
      }

      if (e.key === "Escape") {
        optionsMenu.classList.remove("open-up", "open-down");
      }
    });

    trigger.addEventListener("click", () => {
      highlightedIndex = this.availableTables.findIndex(
        (t) => t.vpsId === this.vpsId,
      );
    });
  }

  showPanel() {
    const panel = this.q("panel-body");
    if (panel) {
      panel.classList.add("visible");
    } else {
      requestAnimationFrame(() => this.showPanel());
    }
  }

  hidePanel() {
    const panel = this.q("panel-body");
    if (panel) {
      panel.classList.remove("visible");
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

    const offsetHeader = 73;
    const elementRect = this.getBoundingClientRect();
    const absoluteElementTop = elementRect.top + window.pageYOffset;

    window.scrollTo({
      top: absoluteElementTop - offsetHeader,
      behavior: "smooth",
    });
  }

  async loadAvailableTables() {
    if (!this.userId) return;
    const menu = this.shadowRoot.getElementById("pickerOptions");
    const trigger = this.shadowRoot.getElementById("pickerTrigger");

    try {
      const result = await this.api(
        `/api/v1/users/${encodeURIComponent(this.userId)}/tables/with-score?limit=100&offset=0`,
      );
      if (!result.ok) return;

      this.availableTables = result.data;

      menu.innerHTML = this.availableTables
        .map((table) => {
          const name = table.vpsdb?.name || table.tableTitle || table.vpsId;
          return `<div class="picker-option" data-value="${table.vpsId}">${name}</div>`;
        })
        .join("");

      if (this.vpsId) {
        const currentTable = this.availableTables.find(
          (t) => t.vpsId === this.vpsId,
        );
        if (currentTable) {
          trigger.textContent =
            currentTable.vpsdb?.name ||
            currentTable.tableTitle ||
            currentTable.vpsId;
        }
      }

      menu.querySelectorAll(".picker-option").forEach((opt) => {
        opt.addEventListener("click", () => {
          const val = opt.getAttribute("data-value");
          trigger.textContent = opt.textContent;
          menu.classList.remove("open-up", "open-down");

          this.handleScorePanelChange({ target: { value: val } });
        });
      });
    } catch (e) {
      trigger.textContent = "Error loading tables";
    }
  }

  q(selector) {
    return (
      this.shadowRoot.getElementById(selector) ||
      this.shadowRoot.querySelector(`.${selector}`)
    );
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

    this.showPanel();

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
      const gridPanels = this.q("grid-score-panels");
      if (gridPanels) gridPanels.innerHTML = "";
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
      const gridPanels = this.q("grid-score-panels");
      if (gridPanels) gridPanels.innerHTML = "";
      return;
    }

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

    const artUrl = `https://raw.githubusercontent.com/superhac/vpinmediadb/refs/heads/main/bg_thumbs/${this.vpsId}.png`;
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
