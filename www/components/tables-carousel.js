class TablesCarousel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });

    // State
    this.items = [];
    this.offset = 0;
    this.limit = 10;
    this.loading = false;
    this.hasMore = true;
    this.observer = null;

    // Attributes
    this.shelfTitle = "";
    this.sortBy = "";
    this.sortOrder = -1;
    this.shelfStat = "";
    this.apiUrl = "/api/v1/tables-plus/search";
  }

  connectedCallback() {
    this.shelfTitle = this.getAttribute("title") || "";
    this.sortBy = this.getAttribute("sortBy") || "avgRating";
    this.sortOrder = parseInt(this.getAttribute("sortOrder")) || -1;
    this.shelfStat = this.getAttribute("shelfStat") || this.sortBy;
    this.apiUrl = this.getAttribute("api-url") || this.apiUrl;

    this.render();
    this.attachEventListeners();
    this.setupIntersectionObserver();
    this.loadData();
  }

  attachEventListeners() {
    const toggle = this.shadowRoot.getElementById("sort-toggle");
    toggle.addEventListener("click", () => {
      this.sortOrder = this.sortOrder === 1 ? -1 : 1;
      toggle.className = `sort-toggle ${this.sortOrder === 1 ? "asc" : "desc"}`;
      this.resetAndLoad();
    });

    const carouselTrack = this.shadowRoot.querySelector(".carousel-track");
    if (carouselTrack) {
      this._setupDragScroll(carouselTrack);
    }
  }

  _setupDragScroll(element) {
    let isDown = false;
    let isDragging = false;
    let startX;
    let scrollLeft;

    element.addEventListener("mousedown", (e) => {
      isDown = true;
      isDragging = false;
      element.style.cursor = "grabbing";
      startX = e.pageX - element.offsetLeft;
      scrollLeft = element.scrollLeft;
      e.preventDefault();
    });

    element.addEventListener("mouseleave", () => {
      isDown = false;
      element.style.cursor = "grab";
    });

    element.addEventListener("mouseup", () => {
      isDown = false;
      element.style.cursor = "grab";
    });

    element.addEventListener("mousemove", (e) => {
      if (!isDown) return;
      e.preventDefault();
      isDragging = true;
      const x = e.pageX - element.offsetLeft;
      const walk = (x - startX) * 2;
      element.scrollLeft = scrollLeft - walk;
    });

    element.addEventListener(
      "click",
      (e) => {
        if (isDragging) {
          e.preventDefault();
          e.stopPropagation();
        }
      },
      true,
    );

    element.addEventListener("dragstart", (e) => {
      e.preventDefault();
    });
  }

  async resetAndLoad() {
    const track = this.shadowRoot.getElementById("track");
    const cards = track.querySelectorAll(".card");
    cards.forEach((card) => {
      card.style.opacity = "0";
      card.style.transition = "opacity 0.15s ease";
    });

    await new Promise((resolve) => setTimeout(resolve, 150));

    cards.forEach((card) => card.remove());

    this.items = [];
    this.offset = 0;
    this.hasMore = true;

    await this.loadData();

    track.scrollLeft = 0;

    const newCards = track.querySelectorAll(".card");
    newCards.forEach((card) => {
      card.style.opacity = "0";
    });

    requestAnimationFrame(() => {
      newCards.forEach((card) => {
        card.style.transition = "opacity 0.15s ease";
        card.style.opacity = "1";
      });
    });
  }

  disconnectedCallback() {
    if (this.observer) {
      this.observer.disconnect();
    }
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          width: 100%;
          color: var(--ink);
          font-family: 'Rajdhani', sans-serif;
        }

        .shelf-header {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 12px;
        }

        .shelf-title {
          font-family: 'Orbitron', sans-serif;
          font-size: 1.2rem;
          color: var(--neon-purple);
          text-transform: uppercase;
          padding-left: 10px;
          border-left: 4px solid var(--neon-pink);
          margin: 0;
        }

        .sort-label {
          font-size: 1rem;
          color: var(--ink-muted);
          margin: 0;
          align-self: center;
        }

        .sort-toggle {
          cursor: pointer;
          font-size: 1rem;
          font-weight: 600;
          color: var(--neon-cyan);
          user-select: none;
          opacity: 0.7;
        }

        .sort-toggle:hover {
          opacity: 1;
          color: var(--neon-pink);
        }

        .sort-toggle::after {
          content: '⇅';
        }

        .sort-toggle.asc::after {
          content: '↑';
        }

        .sort-toggle.desc::after {
          content: '↓';
        }

        .see-all-link {
          font-size: 0.9rem;
          white-space: nowrap;
        }

        .see-all-link a {
          color: var(--link);
          text-decoration: none;
          font-weight: 600;
          display: flex;
          align-items: center;
          gap: 4px;
          opacity: 0.7;
          transition: opacity 0.3s ease, color 0.3s ease;
        }

        .see-all-link a:hover {
          opacity: 1;
          color: var(--neon-pink);
        }

        .see-all-link a::after {
          content: '»';
          font-size: 1.2em;
          line-height: 1;
        }

        .carousel-container {
          position: relative;
          width: 100%;
          min-height: 322px;
          overflow: hidden;
        }

        .carousel-track {
          display: flex;
          overflow-x: auto;
          gap: 20px;
          padding: 10px;
          cursor: grab;
          user-select: none;
          scroll-behavior: smooth;
          scrollbar-width: thin;
          scrollbar-color: var(--neon-purple) var(--bg-secondary);
          scroll-snap-type: x proximity;
          -webkit-overflow-scrolling: touch;
        }

        .carousel-track::-webkit-scrollbar {
          height: 6px;
        }

        .carousel-track::-webkit-scrollbar-track {
          background: var(--bg-secondary);
        }

        .carousel-track::-webkit-scrollbar-thumb {
          background-color: var(--neon-purple);
          border-radius: 10px;
        }

        #sentinel {
          width: 20px;
          flex-shrink: 0;
          height: 100%;
          visibility: hidden;
          margin-left: -20px;
        }

        .card {
          flex: 0 0 320px;
          height: 300px;
          background: var(--surface);
          border-radius: var(--radius);
          overflow: hidden;
          box-shadow: var(--shadow);
          transition: transform 0.3s ease, box-shadow 0.3s ease;
          scroll-snap-align: start;
          display: flex;
          flex-direction: column;
          border: 1px solid var(--line);
          user-select: none;
        }

        .card:hover {
          transform: translateY(-5px) scale(1.02);
          box-shadow: var(--shadow-intense), var(--glow-purple);
          border-color: var(--neon-purple);
          z-index: 2;
        }

        .image-container {
          position: relative;
          width: 100%;
          padding-top: 56.25%; /* 16:9 Aspect Ratio */
          background: var(--bg-secondary);
          overflow: hidden;
        }

        .image-container img {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          object-fit: contain;
          transition: transform 0.5s ease;
          pointer-events: none;
          user-select: none; 
        }

        .card:hover .image-container img {
          transform: scale(1.05);
        }

        .card-info {
          padding: 12px;
          display: flex;
          flex: 1;
          flex-wrap: wrap;
          gap: 6px;
          min-height: 80px;
          overflow: hidden;
          pointer-events: auto;
        }

        .info-left {
          flex: 1 1 180px;
          min-width: 0;
          display: flex;
          flex-direction: column;
          justify-content: flex-start;
          gap: 4px;
        }

        .info-right {
          flex: 0 0 80px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-left: 1px solid var(--line);
          padding-left: 8px;
        }

        .name-link {
          font-weight: 700;
          color: var(--ink);
          text-decoration: none;
          overflow: hidden;
          text-overflow: ellipsis;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          font-size: 1.1rem;
          line-height: 1.2;
          max-width: 100%;
        }

        .name-link:hover {
          color: var(--neon-cyan);
        }

        .vps-link {
          display: flex;
          flex: 1;
          margin-top: auto;
          justify-content: flex-start;
          align-self: flex-start;
          align-items: end;
          transition: transform 0.5s ease;
        }
        
        .vps-link:hover {
          transform: scale(1.3);
        }

        .card-link, .name-link, .vps-link {
          user-select: none;
          -webkit-user-drag: none;
        }
        
        .vps-logo {
          width: 1.5rem;
          height: 1.5rem;
          object-fit: contain;
          display: block;
          pointer-events: none;
          user-select: none;
          -webkit-user-drag: none;
        }

        .row-2 {
          font-size: 0.85rem;
          color: var(--ink-muted);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          margin-top: 2px;
        }

        .stat-prominent {
          color: var(--neon-yellow);
          text-shadow: var(--glow-yellow);
          display: flex;
          flex-direction: column;
          gap: 4px;
          align-items: center;
          justify-content: center;
          width: 100%;
        }

        .stat-prominent .stat-value {
          font-size: 1.5rem;
          font-weight: 900;
          font-family: 'Orbitron', sans-serif;
        }

        .stat-prominent .stat-label {
          font-size: 0.8rem;
          color: var(--ink-muted);
          text-transform: uppercase;
          line-height: 1;
          margin-bottom: 2px;
          letter-spacing: 0.05em;
        }

        .stat-prominent .stat-value.stat-date {
          font-size: 0.8rem;
        }

        .rating-stars {
          display: flex;
          align-items: center;
          gap: 1px;
        }

        .rating-star-cell {
          position: relative;
          display: inline-block;
          line-height: 1;
          width: 0.8rem;
          height: 0.8rem;
        }

        .rating-star {
          display: block;
          font-size: 0.8rem;
          line-height: 1;
        }

        .rating-star.empty {
          color: var(--ink-muted);
          opacity: 0.3;
        }

        .rating-star.fill {
          position: absolute;
          top: 0;
          left: 0;
          z-index: 1;
          overflow: hidden;
          color: var(--neon-yellow);
          text-shadow: var(--glow-yellow);
          filter: drop-shadow(0 0 2px var(--neon-yellow));
        }

        .rating-value-below {
          font-size: 1.1rem;
          color: var(--neon-yellow);
          font-weight: 900;
          line-height: 1;
          text-align: center;
          padding-top: 4px;
        }

        @media (max-width: 640px) {
          .carousel-container {
            min-height: 282px;
          }

          .sort-toggle {
            margin-left: auto;
          }

          .card {
            flex: 0 0 200px;
            max-height: 260px;
          }

          .card-info {
            display: flex;
            flex-direction: column;
            gap: 8px;
            padding: 8px;
          }

          .info-left {
            flex: 0 0 auto;
            position: relative;
          }

          .name-link,
          .row-2 {
            padding-right: 2rem;
          }

          .vps-link {
            position: absolute;
            top: 0;
            right: 0;
            margin-top: 0;
          }

          .info-right {
            display: flex;
            flex: 0 0 40px;
            border-left: none;
            margin-top: auto;
            align-items: end;
          }
          .stat-prominent {
            border-top: 1px solid var(--line);
            padding-top: 12px;
            flex-direction: row;
            justify-content: space-between;
            text-shadow: none;
          }
          .stat-value {
            font-size: 1rem;
          }
        }
      </style>
      <div class="shelf-header">
        <h3 class="shelf-title">${this.shelfTitle}</h3>
        <div id="sort-toggle" class="sort-toggle ${this.sortOrder === 1 ? "asc" : "desc"}">Sort</div>
        <div class="see-all-link">
          <a href="/tables?sort-order=${this.sortOrder}&sort-by=${this.sortBy}">See All</a>
        </div>
      </div>
      <div class="carousel-container">
        <div class="carousel-track" id="track">
          <!-- Cards will be inserted here -->
          <div id="sentinel" class="sentinel"></div>
        </div>
      </div>
    `;
  }

  setupIntersectionObserver() {
    const sentinel = this.shadowRoot.getElementById("sentinel");
    const track = this.shadowRoot.getElementById("track");

    this.observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !this.loading && this.hasMore) {
            this.loadData();
          }
        });
      },
      {
        root: track,
        threshold: 0.1,
      },
    );

    this.observer.observe(sentinel);
  }

  async loadData() {
    if (this.loading || !this.hasMore) return;

    this.loading = true;
    const track = this.shadowRoot.getElementById("track");
    const sentinel = this.shadowRoot.getElementById("sentinel");

    try {
      const params = new URLSearchParams({
        limit: this.limit,
        offset: this.offset,
        sort_by: this.sortBy,
        sort_order: this.sortOrder,
      });

      const fullUrl = this.apiUrl.startsWith("http")
        ? this.apiUrl
        : `${typeof API_BASE !== "undefined" ? API_BASE : ""}${this.apiUrl}`;

      const response = await fetch(`${fullUrl}?${params}`);
      const data = await response.json();

      if (data.items.length === 0) {
        this.hasMore = false;
      } else {
        this.items.push(...data.items);
        this.renderItems(data.items);
        this.offset += data.items.length;
        this.hasMore = data.pagination.hasNext;
      }
    } catch (error) {
      console.error("Error loading carousel data:", error);
    } finally {
      this.loading = false;
    }
  }

  renderItems(newItems) {
    const track = this.shadowRoot.getElementById("track");
    const sentinel = this.shadowRoot.getElementById("sentinel");

    newItems.forEach((item) => {
      const card = document.createElement("div");
      card.className = "card";

      const vpsId = item.vpsId;
      const bgUrl = `https://raw.githubusercontent.com/superhac/vpinmediadb/refs/heads/main/bg_thumbs/${encodeURIComponent(vpsId)}.png`;
      const tableUrl = `/tables?vpsid=${encodeURIComponent(vpsId)}`;
      const vpsUrl = `https://virtualpinballspreadsheet.github.io/games?game=${encodeURIComponent(vpsId)}`;

      const statDisplay = this.formatStat(item);

      card.innerHTML = `
        <a href="${tableUrl}" class="card-link">
          <div class="image-container">
            <img src="${bgUrl}" alt="${this.escapeHtml(item.name)}" loading="lazy" onerror="this.src='/img/logo.png'">
          </div>
        </a>
        <div class="card-info">
          <div class="info-left">
            <a href="${tableUrl}" class="name-link" title="${this.escapeHtml(item.name)}">${this.escapeHtml(item.name)}</a>
            <div class="row-2">
              ${this.escapeHtml(item.manufacturer || "Unknown")}, ${this.escapeHtml(item.year || "N/A")}
            </div>
            <a href="${vpsUrl}" target="_blank" class="vps-link" title="View on VPS">
              <img class="vps-logo" src="img/vpsLogo.png" alt="VPS">
            </a>
          </div>
          <div class="info-right">
            <div class="stat-prominent">
              ${statDisplay}
            </div>
          </div>
        </div>
      `;
      track.insertBefore(card, sentinel);
    });
  }

  formatStat(item) {
    const val = item[this.shelfStat];

    switch (this.shelfStat) {
      case "avgRating":
        return `<span class="stat-label">Rating</span><span class="stat-value">${this.renderStars(val)}</span>`;
      case "runTimeTotal":
        return `<span class="stat-label">Play Time</span> <span class="stat-value">${this.formatRunTime(val)}</span>`;
      case "playerCount":
        return `<span class="stat-label">Installed</span> <span class="stat-value">${val || 0}</span>`;
      case "startCountTotal":
        return `<span class="stat-label">Total Plays</span> <span class="stat-value">${val || 0}</span>`;
      case "firstSeenAt":
        return `<span class="stat-label">Added</span> <span class="stat-value stat-date">${new Date(val).toLocaleDateString()}</span>`;
      case "ratingCount":
        return `<span class="stat-label">Ratings</span> <span class="stat-value">${val || 0}</span>`;
      case "name":
        return `<span class="stat-label">A - Z</span>`;
      case "year":
        return `<span class="stat-label">Year</span>`;
      default:
        return `<span class="stat-label">${this.shelfStat}</span> <span class="stat-value">${val || "—"}</span>`;
    }
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
    return `<div class="rating-stars">${stars}</div><div class="rating-value-below">${clamped.toFixed(1)}</div>`;
  }

  formatRunTime(minutes) {
    if (!minutes || minutes <= 0) return "—";
    if (minutes < 60) return `${Math.round(minutes)}m`;
    const hours = minutes / 60;
    if (hours < 24) return `${hours.toFixed(1)}h`;
    const days = hours / 24;
    return `${days.toFixed(1)}d`;
  }

  escapeHtml(text) {
    if (text === null || text === undefined) return "";
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }
}

customElements.define("tables-carousel", TablesCarousel);
