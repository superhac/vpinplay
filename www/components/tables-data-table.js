class TablesDataTable extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });

    // Pagination State
    this.items = [];
    this.offset = 0;
    this.limit = 20;
    this.sortBy = "";
    this.sortOrder = 1;
    this.loading = false;
    this.hasMore = true;
    this.observer = null;
    this.columns = [];
    this.total = 0;

    // Search State
    this.searchCache = [];
    this.searchKey = "";
    this.searchTerm = "";
    this.searchDebounceTimer = null;
    this.searchDebounceMs = 500;
    this.currentFocusIndex = -1;
    this.listenersAttached = false;
  }

  connectedCallback() {
    this.sortBy = this.getAttribute("sortBy") || this.sortBy;
    this.sortOrder = parseInt(this.getAttribute("sortOrder")) || this.sortOrder;
    this.render();
    this.attachEventListeners();
    this.setupIntersectionObserver();
    this.loadData();
  }

  disconnectedCallback() {
    if (this.observer) {
      this.observer.disconnect();
    }
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
    }
    if (this._pickerCloseHandler) {
      document.removeEventListener("click", this._pickerCloseHandler);
    }
  }

  extractColumns(obj, prefix = "") {
    const columns = [];

    for (const key in obj) {
      if (!obj.hasOwnProperty(key)) continue;

      const fullKey = prefix ? `${prefix}.${key}` : key;
      const value = obj[key];

      if (Array.isArray(value)) {
        if (value.length > 0 && typeof value[0] !== "object") {
          columns.push({
            key: fullKey,
            label: this.formatLabel(key),
            sortable: true,
          });
        }
        continue;
      }
      if (
        typeof value === "object" &&
        value !== null &&
        prefix.split(".").length < 2
      ) {
        columns.push(...this.extractColumns(value, fullKey));
      } else if (key !== "_id") {
        columns.push({
          key: fullKey,
          label: this.formatLabel(key),
          sortable: key !== "vpsId",
        });
      }
    }

    return columns;
  }

  formatLabel(str) {
    const labels = {
      avgRating: "Avg Rating",
      ratingCount: "Ratings",
      playerCount: "Players",
      startCountTotal: "Starts",
      runTimeTotal: "Run Time",
      variationCount: "Vars",
      vpsId: "VPS Game ID",
      firstSeenAt: "First Seen",
      manufacturer: "Make",
      authors: "Author",
    };

    if (labels[str]) return labels[str];

    return str
      .replace(/([A-Z])/g, " $1")
      .replace(/_/g, " ")
      .replace(/^./, (s) => s.toUpperCase())
      .trim();
  }

  getNestedValue(obj, path) {
    return path.split(".").reduce((current, key) => {
      if (current && typeof current === "object") {
        return current[key];
      }
      return undefined;
    }, obj);
  }

  getOrderedColumns() {
    const orderAttr = this.getAttribute("columns-order");
    if (!orderAttr) return this.columns;

    const order = orderAttr.split(",").map((s) => s.trim());
    const ordered = [];
    const remaining = [...this.columns];

    order.forEach((key) => {
      const index = remaining.findIndex((c) => c.key === key);
      if (index !== -1) {
        ordered.push(remaining.splice(index, 1)[0]);
      }
    });

    return [...ordered, ...remaining];
  }

  renderStars(rating) {
    const numeric = Number(rating);
    if (!Number.isFinite(numeric)) return "-";
    const clamped = Math.max(0, Math.min(5, numeric));
    const roundedToHalf = Math.round(clamped * 2) / 2;
    const fullStars = Math.floor(roundedToHalf);
    const hasHalf = roundedToHalf - fullStars >= 0.5;

    let stars = "";
    for (let i = 0; i < 5; i += 1) {
      const fillPercent =
        i < fullStars ? 100 : i === fullStars && hasHalf ? 50 : 0;
      stars += `<span class="rating-star-cell"><span class="rating-star empty">★</span><span class="rating-star fill" style="width:${fillPercent}%">★</span></span>`;
    }
    return `<span class="rating-stars">${stars}</span> <span class="rating-value">${clamped.toFixed(1)}</span>`;
  }

  formatRunTime(minutes) {
    if (!minutes || minutes <= 0) return "—";
    if (minutes < 60)
      return `${Math.round(minutes)} min${minutes === 1 ? "" : "s"}`;

    const hours = minutes / 60;
    if (hours < 24) return `${hours.toFixed(1)} hr${hours >= 2 ? "s" : ""}`;

    const days = hours / 24;
    return `${days.toFixed(1)} day${days >= 2 ? "s" : ""}`;
  }

  formatValue(value, key) {
    if (value === null || value === undefined || value === "") return "—";

    if (key === "firstSeenAt") {
      const date = new Date(value);
      const fullDateTime = date.toLocaleString();
      const formattedDate = date.toLocaleDateString();
      return `<span title="${this.escapeHtml(fullDateTime)}">${this.escapeHtml(formattedDate)}</span>`;
    }

    if (typeof value === "boolean") return value ? "✓" : "✗";
    if (Array.isArray(value)) return value.join(", ");
    if (
      value instanceof Date ||
      (typeof value === "string" && value.match(/^\d{4}-\d{2}-\d{2}T/))
    ) {
      return new Date(value).toLocaleString();
    }
    return String(value);
  }

  render() {
    this.shadowRoot.innerHTML = `
      <link rel="stylesheet" href="/css/base.css">
      <style>
        :host {
          position: relative;
          color: var(--ink);
          z-index: 1;
          display: block;
          width: 100%;
        }

        :host,
        :host * {
          box-sizing: border-box;
          font-family: inherit;
        }
        
        .container {
          background: var(--bg);
          color: var(--ink);
          border-radius: var(--radius);
          overflow: hidden;
          width: 100%;
          max-width: 100%;
          box-sizing: border-box;
          margin: 0;
        }

        .table-title-panel {
          display: flex;
          flex-direction: row;
          gap: 12px;
          align-items: center;
          padding: 16px;
          background: var(--bg-secondary);
          overflow: visible;
        }

        .table-title-panel h3 {
          margin: 0;
          font-size: 1rem;
        }

        .filters {
          display: flex;
          justify-content: flex-end;
          gap: 12px;
          background: var(--bg-secondary);
          overflow: visible;
          box-sizing: border-box;
          max-width: 100%;
          margin-left: auto;
        }

        .filter-group {
          display: flex;
          flex-direction: row;
          align-items: center;
          gap: 6px;
        }

        .filter-group span{
          min-width: fit-content;
        }
        
        input {
          padding: 8px 12px;
          min-width: 200px;
          background: var(--bg);
          border-radius: 4px;
          color: var(--ink);
          font-size: 0.88rem;
        }
        
        input:focus {
          outline: none;
          border: 1px solid var(--neon-pink);
          box-shadow: var(--glow-pink);
        }
        
        .field {
          position: relative;
          display: flex;
          align-items: center;
        }

        .field input {
          flex: 1;
          padding-right: 32px;
        }

        .clear-icon {
          position: absolute;
          right: 10px;
          top: 50%;
          transform: translateY(-50%);
          cursor: pointer;
          color: var(--ink-muted);
          font-size: 1.4rem;
          line-height: 1;
          display: none; /* Hidden by default */
          user-select: none;
        }

        .clear-icon:hover {
          color: var(--neon-pink);
        }

        .picker {
          position: relative;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .picker span {
          font-size: 0.88rem;
          color: var(--ink-muted);
          margin: 0;
        }

        .picker-trigger {
          min-width: 160px;
          border: 1px solid var(--line);
          border-radius: 10px;
          background: var(--surface-2);
          color: var(--ink);
          padding: 8px 10px;
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
          max-height: 200px;
          overflow-y: auto;
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
          border-left: 3px solid var(--neon-pink);
        }

        .picker-option.is-highlighted {
          background: var(--surface);
          color: var(--neon-cyan);
        }

        .picker-trigger:focus {
          outline: none;
          border-color: var(--neon-pink);
          box-shadow: var(--glow-pink);
        }

        .table-wrapper {
          overflow-x: auto;
          overflow-y: auto;
          width: 100%;
          max-height: 530px;
          box-sizing: border-box;
          white-space: nowrap;
        }
        
        table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.88rem;
        }

        thead {
          position: sticky;
          top: 0;
          background: var(--bg-secondary);
          z-index: 10;
        }

        th,
        td {
          padding: 8px;
          border-bottom: 1px solid var(--line);
        }

        th {
          color: var(--neon-cyan);
          font-size: 0.88rem;
          font-family: 'Rajdhani', sans-serif;
          text-transform: uppercase;
          vertical-align: middle;
          text-shadow: var(--glow-cyan);
          background: var(--surface-2);
          border-bottom: 1px solid var(--line);
          cursor: pointer;
          user-select: none;
          white-space: nowrap;
        }

        tr td {
          background: var(--table-row);
          font-family: 'Rajdhani', sans-serif;
          font-size: 0.88rem;
          vertical-align: middle;
        }

        th:hover {
          background: var(--table-hover);
        }
        
        th.sortable::after {
          content: '⇅';
          margin-left: 6px;
          opacity: 0.3;
        }
        
        th.sorted-asc::after {
          content: '↑';
          opacity: 1;
          color: var(--neon-pink);
        }
        
        th.sorted-desc::after {
          content: '↓';
          opacity: 1;
          color: var(--neon-pink);
        }
        
        tr:hover {
          background: var(--table-hover);
        }

        tbody tr:nth-child(even) td {
          background: var(--table-row-alt);
        }

        tbody tr:hover td {
          background: var(--table-hover);
        }

        tbody tr:hover td:first-child {
          border-left: 2px solid var(--neon-pink);
        }
        
        .loading-row {
          text-align: center;
          padding: 20px;
          color: var(--ink-muted);
        }
        
        .sentinel {
          height: 20px;
        }
        
        .empty-state {
          text-align: center;
          padding: 40px 20px;
          color: var(--ink-muted);
        }
        
        .stats {
          padding: 12px 16px;
          background: var(--bg-secondary);
          border-top: 1px solid var(--line);
          font-size: 1rem;
          color: var(--ink-muted);
        }

        .rating-stars {
          display: inline-flex;
          align-items: center;
          gap: 2px;
        }

        .rating-star-cell {
          position: relative;
          display: inline-block;
          line-height: 1;
          }

        .rating-star {
          font-size: 1rem;
        } 
          
        .rating-star.empty {
          color: var(--neon-yellow);
        }

        .rating-star.fill {
          position: absolute;
          top: 0;
          left: 0;
          overflow: hidden;
          color: var(--neon-yellow);
          text-shadow: var(--glow-yellow);
        }

        .rating-value {
          font-size: 0.8rem;
          color: var(--ink-muted);
          margin-left: 4px;
        }

        .column-name {
          min-width: 310px;
          max-width: 310px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .table-link, .vps-link {
          color: var(--neon-cyan);
          text-decoration: none;
        }

        .table-link:hover, .vps-link:hover {
          text-decoration: underline;
        }

        .external-link-icon {
          color: var(--neon-cyan);
        }

        @media (max-width: 900px) {
          .container {
            max-height: calc(90vh - 140px);;
          }
          
          .table-title-panel {
            padding: 10px;
          }

          .filters {
            flex-wrap: wrap;
            justify-content: flex-end;
            gap: 8px;
          }
            
          .filter-group {
            display: flex;
            gap: 8px;
            align-items: center;
            }
              
          .filter-group input {
            flex: 1;
            min-width: 0;
          }

          .filter-group, .filter-group input {
            font-size: 0.7rem;
          }

          .picker-trigger, input {
            padding: 4px 6px;
          }

          .table-wrapper {
            max-height: calc(90vh - 220px);
          }

          th {
            font-size: 0.7rem;
          }
          tr td {
            font-size: 0.8rem;
          }

          .column-name {
            min-width: 240px;
            max-width: 240px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }

          .stats {
            padding: 6px 8px;
            font-size: 0.8rem;
          }
        }
        @media (max-width: 600px) {
          .table-wrapper {
            max-height: calc(90vh - 300px);
          }

          .column-name {
            max-width: 140px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }

          .table-title-panel {
            display: flex;
            flex-direction: column;
            align-items: flex-start;
          }

          .rating-star {
            font-size: 0.7rem;
          }

          .rating-value {
            font-size: 0.6rem;
          }
        }
      </style>
      
      <div class="container">
        <div class="table-title-panel">
          <h3>Tables</h3>
          <div class="filters" id="filters">
            <!-- Will be populated dynamically -->
          </div>
        </div>
        
        <div class="table-wrapper" id="table-wrapper">
          <table>
            <thead id="table-head">
              <!-- Columns will be inserted here -->
            </thead>
            <tbody id="table-body">
              <!-- Rows will be inserted here -->
            </tbody>
          </table>
          <div class="sentinel" id="sentinel"></div>
        </div>
        
        <div class="stats">
          Showing <span id="showing-count">0</span> of <span id="total-count">0</span> items
        </div>
      </div>
    `;
  }

  renderFilters() {
    const filtersDiv = this.shadowRoot.getElementById("filters");
    const orderedCols = this.getOrderedColumns();
    const searchableCols = orderedCols.filter((col) =>
      ["name", "manufacturer", "year", "authors", "vpsId"].includes(col.key),
    );

    if (!this.searchKey && searchableCols.length > 0) {
      this.searchKey = searchableCols[0].key;
    }

    const pickerOptionsHtml = searchableCols
      .map(
        (col) =>
          `<div class="picker-option ${this.searchKey === col.key ? "active" : ""}" data-key="${col.key}">${col.label}</div>`,
      )
      .join("");

    const currentCol = searchableCols.find((col) => col.key === this.searchKey);
    const currentLabel = currentCol ? currentCol.label : "Select a column...";

    filtersDiv.innerHTML = `
        <div class="filter-group">
        <span>Search By</span>
          <div class="picker" id="pickerContainer">
            <button id="pickerTrigger" class="picker-trigger" tabindex="0">${currentLabel}</button>
            <div id="pickerOptions" class="picker-options">
              ${pickerOptionsHtml}
            </div>
          </div>
        </div>
        
        <div class="filter-group">
          <div class="field">
            <input
              id="search-input"
              type="text"
              placeholder="Type to search..."
              autocomplete="off"
            />
            <span id="search-clear" class="clear-icon">&times;</span>
          </div>
        </div>
    `;

    if (!this.listenersAttached) {
      this.attachPickerListeners();
      this.attachSearchListeners();
      this.listenersAttached = true;
    }
  }

  attachPickerListeners() {
    const trigger = this.shadowRoot.getElementById("pickerTrigger");
    const optionsMenu = this.shadowRoot.getElementById("pickerOptions");
    const pickerContainer = this.shadowRoot.getElementById("pickerContainer");

    let highlightedIndex = -1;

    trigger.addEventListener("click", (e) => {
      e.stopPropagation();

      const isOpen =
        optionsMenu.classList.contains("open-up") ||
        optionsMenu.classList.contains("open-down");

      if (isOpen) {
        optionsMenu.classList.remove("open-up", "open-down");
        highlightedIndex = -1;
        optionsMenu.querySelectorAll(".picker-option").forEach((opt) => {
          opt.classList.remove("is-highlighted");
        });
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

    const closeDropdown = (e) => {
      if (!pickerContainer.contains(e.target)) {
        optionsMenu.classList.remove("open-up", "open-down");
        highlightedIndex = -1;
        optionsMenu.querySelectorAll(".picker-option").forEach((opt) => {
          opt.classList.remove("is-highlighted");
        });
      }
    };

    this._pickerCloseHandler = closeDropdown;
    document.addEventListener("click", closeDropdown);

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

      if (e.key === "Enter" && isOpen && highlightedIndex >= 0) {
        e.preventDefault();
        options[highlightedIndex].click();
        highlightedIndex = -1;
      }

      if (e.key === "Escape") {
        optionsMenu.classList.remove("open-up", "open-down");
        highlightedIndex = -1;
        options.forEach((opt) => opt.classList.remove("is-highlighted"));
      }
    });

    optionsMenu.addEventListener("click", (e) => {
      const option = e.target.closest(".picker-option");
      if (!option) return;

      this.searchKey = option.dataset.key;
      trigger.textContent = option.textContent;

      optionsMenu.querySelectorAll(".picker-option").forEach((opt) => {
        opt.classList.remove("active");
      });

      option.classList.add("active");

      optionsMenu.classList.remove("open-up", "open-down");
      highlightedIndex = -1;

      optionsMenu.querySelectorAll(".picker-option").forEach((opt) => {
        opt.classList.remove("is-highlighted");
      });

      if (this.searchTerm) {
        this.resetAndLoad();
      }
    });
  }

  attachSearchListeners() {
    const searchInput = this.shadowRoot.getElementById("search-input");
    const clearIcon = this.shadowRoot.getElementById("search-clear");

    searchInput.addEventListener("input", (e) => {
      const value = e.target.value.trim();

      clearIcon.style.display = value.length > 0 ? "block" : "none";

      if (this.searchDebounceTimer) {
        clearTimeout(this.searchDebounceTimer);
      }

      this.searchDebounceTimer = setTimeout(() => {
        this.searchTerm = value;
        this.resetAndLoad();
      }, this.searchDebounceMs);
    });

    clearIcon.addEventListener("click", () => {
      searchInput.value = "";
      clearIcon.style.display = "none";
      this.searchTerm = "";
      searchInput.focus();
      this.resetAndLoad();
    });
  }

  renderTableHeader() {
    const thead = this.shadowRoot.getElementById("table-head");
    const headerRow = document.createElement("tr");

    const alignMap = {
      year: "center",
      avgRating: "center",
      ratingCount: "center",
      playerCount: "center",
      startCountTotal: "center",
      runTimeTotal: "center",
      variationCount: "center",
    };

    const columns = this.getOrderedColumns();
    columns.forEach((col) => {
      const th = document.createElement("th");
      th.className = col.sortable ? "sortable" : "";
      th.dataset.key = col.key;
      th.textContent = col.label;
      if (alignMap[col.key]) th.style.textAlign = alignMap[col.key];
      headerRow.appendChild(th);
    });

    thead.innerHTML = "";
    thead.appendChild(headerRow);
  }

  attachEventListeners() {
    const thead = this.shadowRoot.getElementById("table-head");
    thead.addEventListener("click", (e) => {
      const th = e.target.closest("th.sortable");
      if (!th) return;

      e.stopImmediatePropagation();

      const sortKey = th.dataset.key;
      if (this.sortBy === sortKey) {
        this.sortOrder = Number(this.sortOrder) === 1 ? -1 : 1;
      } else {
        this.sortBy = sortKey;
        this.sortOrder =
          sortKey === "name" || sortKey === "manufacturer" ? 1 : -1;
      }

      this.resetAndLoad();
    });
  }

  setupIntersectionObserver() {
    const sentinel = this.shadowRoot.getElementById("sentinel");

    this.observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !this.loading && this.hasMore) {
            this.loadData();
          }
        });
      },
      {
        root: this.shadowRoot.getElementById("table-wrapper"),
        threshold: 0.1,
      },
    );

    this.observer.observe(sentinel);
  }

  async loadData() {
    if (this.loading || !this.hasMore) return;

    this.loading = true;
    this.showLoadingRow();

    try {
      const params = new URLSearchParams({
        limit: this.getAttribute("limit") || this.limit,
        offset: this.getAttribute("offset") || this.offset,
      });

      if (this.sortBy) {
        params.append("sort_by", this.sortBy);
        params.append("sort_order", Number(this.sortOrder));
      }

      if (this.searchTerm) {
        params.append("search_key", this.searchKey);
        params.append("search_term", this.searchTerm);
      }

      const apiUrl = this.getAttribute("api-url") || "/api/tables-plus";
      const fullUrl = apiUrl.startsWith("http")
        ? apiUrl
        : `${API_BASE || ""}${apiUrl}`;

      const response = await fetch(`${fullUrl}?${params}`);
      const data = await response.json();

      if (this.columns.length === 0 && data.items.length > 0) {
        this.columns = this.extractColumns(data.items[0]);
        this.renderTableHeader();
        this.renderFilters();
      }

      this.items.push(...data.items);
      this.total = data.pagination.total;
      this.hasMore = data.pagination.hasNext;
      this.offset += this.limit;

      this.renderRows();
      this.updateStats();
      this.updateSortIndicators();
    } catch (error) {
      console.error("Error loading data:", error);
      this.showError();
    } finally {
      this.loading = false;
      this.removeLoadingRow();
    }
  }

  resetAndLoad() {
    this.items = [];
    this.offset = 0;
    this.hasMore = true;
    const tbody = this.shadowRoot.getElementById("table-body");
    tbody.innerHTML = "";
    this.loadData();
  }

  renderRows() {
    const tbody = this.shadowRoot.getElementById("table-body");

    if (this.items.length === 0 && !this.loading) {
      tbody.innerHTML = `
        <tr>
          <td colspan="${this.columns.length}" class="empty-state">No tables found</td>
        </tr>
      `;
      return;
    }

    const emptyState = tbody.querySelector(".empty-state");
    if (emptyState) {
      emptyState.parentElement.remove();
    }

    const alignMap = {
      year: "center",
      avgRating: "center",
      ratingCount: "center",
      playerCount: "center",
      startCountTotal: "center",
      runTimeTotal: "center",
      variationCount: "center",
    };

    const startIndex = tbody.querySelectorAll("tr:not(.loading-row)").length;
    const fragment = document.createDocumentFragment();
    const columns = this.getOrderedColumns();

    for (let i = startIndex; i < this.items.length; i++) {
      const item = this.items[i];
      const row = document.createElement("tr");

      columns.forEach((col) => {
        const td = document.createElement("td");
        const value = this.getNestedValue(item, col.key);
        if (alignMap[col.key]) td.style.textAlign = alignMap[col.key];

        if (col.key === "avgRating" && value !== "—") {
          td.innerHTML = this.renderStars(Number(value));
        } else if (col.key === "runTimeTotal") {
          td.innerHTML = this.escapeHtml(this.formatRunTime(value));
        } else if (col.key === "name") {
          td.classList.add("column-name");
          td.innerHTML = `<a href="/tables?vpsid=${item.vpsId}" class="table-link">${this.escapeHtml(this.formatValue(value, col.key))}</a>`;
        } else if (col.key === "vpsId") {
          td.innerHTML = `<a href="https://virtualpinballspreadsheet.github.io/games?game=${value}" target="_blank" class="vps-link">
            ${this.escapeHtml(this.formatValue(value, col.key))}
            <svg class="external-link-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6m4-3h6v6m-11 5L21 3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </a>`;
        } else if (col.key === "firstSeenAt") {
          td.innerHTML = this.formatValue(value, col.key);
        } else {
          td.innerHTML = this.escapeHtml(this.formatValue(value, col.key));
        }
        row.appendChild(td);
      });

      fragment.appendChild(row);
    }

    tbody.appendChild(fragment);
  }

  updateSortIndicators() {
    const headers = this.shadowRoot.querySelectorAll("th.sortable");
    headers.forEach((header) => {
      header.classList.remove("sorted-asc", "sorted-desc");
      if (header.dataset.key === this.sortBy) {
        header.classList.add(
          this.sortOrder === 1 ? "sorted-asc" : "sorted-desc",
        );
      }
    });
  }

  updateStats() {
    this.shadowRoot.getElementById("showing-count").textContent =
      this.items.length;
    this.shadowRoot.getElementById("total-count").textContent = this.total;
  }

  showLoadingRow() {
    const tbody = this.shadowRoot.getElementById("table-body");
    const existingLoader = tbody.querySelector(".loading-row");
    if (!existingLoader && this.columns.length > 0) {
      const row = document.createElement("tr");
      row.className = "loading-row";
      row.innerHTML = `<td colspan="${this.columns.length}">Loading...</td>`;
      tbody.appendChild(row);
    }
  }

  removeLoadingRow() {
    const loader = this.shadowRoot.querySelector(".loading-row");
    if (loader) {
      loader.remove();
    }
  }

  showError() {
    const tbody = this.shadowRoot.getElementById("table-body");
    tbody.innerHTML = `
      <tr>
        <td colspan="${this.columns.length || 1}" class="empty-state">Error loading data. Please try again.</td>
      </tr>
    `;
  }

  escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }
}

customElements.define("tables-data-table", TablesDataTable);
