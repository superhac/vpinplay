class VPinPlayHeader extends HTMLElement {
  constructor() {
    super();
    this.lastRefreshTime = null;
    this.updateInterval = null;
    this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    const h1Id = this.getAttribute("h1-id") || "";
    const refreshBtnId =
      this.getAttribute("refresh-btn-id") || "refreshDashboardBtn";

    const path = window.location.pathname;

    const navItems = [
      { name: "Global", href: "/" },
      { name: "Tables", href: "/tables" },
      { name: "Players", href: "/players" },
      { name: "Scores", href: "/scores" },
    ];

    const navHtml = navItems
      .map((item) => {
        let isActive = false;

        if (item.href === "/") {
          isActive = path === "/" || path === "" || path === "/index.html";
        } else {
          isActive = path === item.href || path === `${item.href}/`;
        }

        return `<li><a href="${item.href}" class="nav-link ${isActive ? "active" : ""}">${item.name}</a></li>`;
      })
      .join("");

    this.shadowRoot.innerHTML = `
            <link rel="stylesheet" href="css/base.css">
            <style>
              :host {
                display: block;
                position: sticky;
                top: 0;
                left: 0;
                width: 100%;
                z-index: 10;
              }

              .header {
                background: var(--header-gradient);
                color: var(--ink);
                padding: 10px 36px;
                box-shadow: var(--shadow-intense);
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 20px;
              }

              .header::before {
                content: "";
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                height: 100%;
                background: var(--sunset-gradient);
                opacity: 0.15;
                pointer-events: none;
              }

              .header-left {
                display: flex;
                align-items: center;
                gap: 16px;
                position: relative;
                z-index: 1;
              }

              .header-logo img {
                display: block;
                height: 50px;
                width: auto;
                filter: drop-shadow(0 0 10px rgba(0, 217, 255, 0.5));
              }

              .header-content h1 {
                margin: 0;
                font-size: 1.4rem;
                font-weight: 900;
                letter-spacing: 0.05em;
                text-shadow: var(--glow-cyan);
              }

              .menu-toggle {
                display: none;
                background: transparent;
                border: none;
                color: var(--ink);
                font-size: 1.8rem;
                cursor: pointer;
                z-index: 10;
              }

              .header-nav {
                display: flex;
                align-items: center;
                gap: 24px;
                z-index: 1;
              }

              .nav-links {
                display: flex;
                gap: 20px;
                list-style: none;
                margin: 0;
                padding: 0;
              }

              .nav-link {
                color: var(--ink);
                font-weight: 700;
                font-size: 0.9rem;
                text-transform: uppercase;
                letter-spacing: 0.1em;
                padding: 8px 0;
                border-bottom: 2px solid transparent;
                text-decoration: none;
                transition: all 150ms ease;
              }

              .nav-link:hover,
              .nav-link.active {
                color: var(--neon-cyan);
                text-shadow: var(--glow-cyan);
                border-bottom-color: var(--neon-cyan);
              }

              .header-actions {
                display: flex;
                gap: 12px;
                align-items: center;
              }

              @media (max-width: 900px) {
                .menu-toggle {
                  display: block;
                }

                .header-nav {
                  position: fixed;
                  top: 73px;
                  left: 0;
                  width: 100%;
                  background: var(--bg-secondary);
                  flex-direction: column;
                  padding: 40px 20px;
                  gap: 30px;
                  transform: translateY(-150%);
                  transition: transform 0.3s ease-in-out;
                  box-shadow: 0 10px 20px rgba(0, 0, 0, 0.5);
                }

                .header-nav.open {
                  transform: translateY(0);
                }

                .nav-links {
                  flex-direction: column;
                  align-items: center;
                  width: 100%;
                }

                .nav-link {
                  font-size: 1.2rem;
                }

                .header-actions {
                  width: 100%;
                  justify-content: center;
                }
              }
            </style>
            <header class="header">
                <div class="header-left">
                    <div class="header-logo">
                        <a href="/"><img src="img/header-logo.png" height="50" width="100" style="height: 50px; width: auto;" alt="VPinPlay Logo"></a>
                    </div>
                    <div class="header-content">
                        <h1 ${h1Id ? `id="${h1Id}"` : ""}>VPin Play</h1>
                    </div>
                </div>

                <button class="menu-toggle" aria-label="Toggle navigation">☰</button>

                <nav class="header-nav">
                    <ul class="nav-links">
                        ${navHtml}
                    </ul>
                    <div class="header-actions">
                        <slot></slot>
                        <button id="themeToggleBtn" class="btn btn-theme" aria-label="Toggle Theme">
                            <span id="theme-icon-container"></span>
                            <span id="theme-text">Dark</span>
                        </button>
                        <button id="${refreshBtnId}" class="btn">
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M14 8C14 11.3137 11.3137 14 8 14C4.68629 14 2 11.3137 2 8C2 4.68629 4.68629 2 8 2C10.0825 2 11.9242 3.02974 13 4.58579" 
                                        stroke="currentColor" 
                                        stroke-width="2" 
                                        stroke-linecap="round"/>
                                <path d="M13 1V5H9" 
                                        stroke="currentColor" 
                                        stroke-width="2" 
                                        stroke-linecap="round" 
                                        stroke-linejoin="round"/>
                            </svg>
                        </button>
                    </div>
                </nav>
            </header>
        `;

    // Dark mode light mode toggle
    const initialTheme = this.getSystemTheme();
    document.documentElement.setAttribute("data-theme", initialTheme);
    this.syncThemeUI();
    this.shadowRoot
      .querySelector("#themeToggleBtn")
      .addEventListener("click", () => this.handleThemeToggle());

    // Mobile menu toggle logic
    const toggle = this.shadowRoot.querySelector(".menu-toggle");
    const nav = this.shadowRoot.querySelector(".header-nav");
    if (toggle && nav) {
      toggle.addEventListener("click", () => {
        nav.classList.toggle("open");
        toggle.textContent = nav.classList.contains("open") ? "✕" : "☰";
      });

      // Close menu when clicking outside
      this._outsideClickHandler = (e) => {
        if (nav.classList.contains("open")) {
          const path = e.composedPath();
          if (!path.includes(nav) && !path.includes(toggle)) {
            nav.classList.remove("open");
            toggle.textContent = "☰";
          }
        }
      };
      document.addEventListener("click", this._outsideClickHandler);
    }

    // Refresh button
    const refreshBtn = this.shadowRoot.querySelector(`#${refreshBtnId}`);
    if (refreshBtn) {
      this.updateButtonText();

      refreshBtn.addEventListener("click", () => {
        if (typeof window.refreshDashboard === "function") {
          window.refreshDashboard();
        } else {
          console.warn("refreshDashboard function not yet loaded.");
        }
      });
    }

    this.startUpdateTimer();
  }

  disconnectedCallback() {
    this.stopUpdateTimer();
    if (this._outsideClickHandler) {
      document.removeEventListener("click", this._outsideClickHandler);
    }
  }

  startUpdateTimer() {
    this.updateButtonText();

    this.updateInterval = setInterval(() => {
      this.updateButtonText();
    }, 1000);
  }

  stopUpdateTimer() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }

  getSystemTheme() {
    const saved = localStorage.getItem("vpin-theme");
    if (saved) return saved;
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }

  syncThemeUI() {
    const currentTheme =
      document.documentElement.getAttribute("data-theme") || "dark";
    const btn = this.shadowRoot.querySelector("#themeToggleBtn");
    if (!btn) return;

    const nextTheme = currentTheme === "dark" ? "light" : "dark";
    const label = nextTheme.charAt(0).toUpperCase() + nextTheme.slice(1);

    const sunIcon = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="sunGradient" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stop-color="#FF00CC" /><stop offset="100%" stop-color="#FFCC00" /></linearGradient></defs><circle cx="12" cy="12" r="10" fill="url(#sunGradient)" /><path d="M2 12H22M2 15H22M2 18H22" stroke="#121212" stroke-width="1.5" /></svg>`;
    const moonIcon = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="moonGradient" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#00D2FF" /><stop offset="100%" stop-color="#9D50BB" /></linearGradient></defs><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" fill="url(#moonGradient)" stroke="#00D2FF" stroke-width="0.5" /><circle cx="18" cy="5" r="0.8" fill="#FFFFFF" /><circle cx="15" cy="8" r="0.5" fill="#FFFFFF" /></svg>`;

    btn.innerHTML = `
        <span class="icon-wrapper">${nextTheme === "light" ? sunIcon : moonIcon}</span>
        <span class="btn-text">${label}</span>
    `;
  }

  handleThemeToggle() {
    const current =
      document.documentElement.getAttribute("data-theme") || "dark";
    const next = current === "dark" ? "light" : "dark";

    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("vpin-theme", next);

    // Now just call the sync method to refresh the button
    this.syncThemeUI();

    // Trigger animation
    const btn = this.shadowRoot.querySelector("#themeToggleBtn");
    btn.classList.add("refreshing");
    setTimeout(() => btn.classList.remove("refreshing"), 600);
  }

  updateButtonText() {
    const refreshBtnId =
      this.getAttribute("refresh-btn-id") || "refreshDashboardBtn";
    const btn = this.shadowRoot.querySelector(`#${refreshBtnId}`);
    if (!btn) return;

    const refreshIcon = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style="vertical-align: middle; margin-right: 6px;">
      <path d="M14 8C14 11.3137 11.3137 14 8 14C4.68629 14 2 11.3137 2 8C2 4.68629 4.68629 2 8 2C10.0825 2 11.9242 3.02974 13 4.58579" 
              stroke="currentColor" 
              stroke-width="2" 
              stroke-linecap="round"/>
      <path d="M13 1V5H9" 
              stroke="currentColor" 
              stroke-width="2" 
              stroke-linecap="round" 
              stroke-linejoin="round"/>
      </svg>`;

    if (this.lastRefreshTime) {
      const timeAgo = this.fmtTimeAgo(this.lastRefreshTime);
      btn.innerHTML = `${refreshIcon} <span style="font-size: 0.8rem; opacity: 0.8;">(${timeAgo})</span>`;
    } else {
      // This is what shows on a fresh page load
      btn.innerHTML = `${refreshIcon} <span style="font-size: 0.8rem; opacity: 0.8;">(Never)</span>`;
    }
  }

  fmtTimeAgo(date) {
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

  setRefreshing(isRefreshing) {
    const refreshBtnId =
      this.getAttribute("refresh-btn-id") || "refreshDashboardBtn";
    const btn = this.shadowRoot.querySelector(`#${refreshBtnId}`);
    if (btn) {
      if (isRefreshing) {
        btn.classList.add("refreshing");
      } else {
        setTimeout(() => btn.classList.remove("refreshing"), 600);
      }
    }
  }

  markRefresh() {
    this.lastRefreshTime = new Date();
    this.updateButtonText();
    this.setRefreshing(false);
  }
}
customElements.define("vpinplay-header", VPinPlayHeader);
