(() => {
  "use strict";

  const root = document.documentElement;

  const storedTheme = () => {
    try {
      return localStorage.getItem("theme");
    } catch {
      return null;
    }
  };
  const saveTheme = (value) => {
    try {
      if (value) localStorage.setItem("theme", value);
      else localStorage.removeItem("theme");
    } catch {
      // storage unavailable — keep the change for this page only
    }
  };

  const systemDark = window.matchMedia("(prefers-color-scheme: dark)");
  const isDark = () => (root.dataset.theme ? root.dataset.theme === "dark" : systemDark.matches);

  const svg = (inner) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  const sunIcon = svg(
    '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>'
  );
  const moonIcon = svg('<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>');

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "theme-toggle";
  const updateToggle = () => {
    const mode = storedTheme();
    const label =
      mode === "light"
        ? "主题：浅色 · 点击切换为深色"
        : mode === "dark"
          ? "主题：深色 · 点击恢复跟随系统"
          : `主题：自动跟随系统（当前${isDark() ? "深色" : "浅色"}）· 点击切换`;
    toggle.innerHTML = isDark() ? moonIcon : sunIcon;
    toggle.setAttribute("aria-label", label);
    toggle.title = label;
  };
  toggle.addEventListener("click", () => {
    const mode = storedTheme();
    if (!mode) {
      root.dataset.theme = isDark() ? "light" : "dark";
      saveTheme(root.dataset.theme);
    } else if (mode === "light") {
      root.dataset.theme = "dark";
      saveTheme("dark");
    } else {
      delete root.dataset.theme;
      saveTheme(null);
    }
    updateToggle();
  });
  document.body.appendChild(toggle);
  updateToggle();
  systemDark.addEventListener("change", updateToggle);

  if (document.querySelector("article")) {
    const bar = document.createElement("div");
    bar.className = "progress";
    bar.setAttribute("aria-hidden", "true");
    document.body.appendChild(bar);

    let ticking = false;
    const render = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const ratio = max > 0 ? window.scrollY / max : 0;
      bar.style.transform = `scaleX(${Math.min(1, Math.max(0, ratio))})`;
      ticking = false;
    };
    const request = () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(render);
      }
    };
    window.addEventListener("scroll", request, { passive: true });
    window.addEventListener("resize", request);
    render();
  }

  const backToTop = document.createElement("button");
  backToTop.type = "button";
  backToTop.className = "back-to-top";
  backToTop.setAttribute("aria-label", "回到顶部");
  backToTop.innerHTML = svg('<line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>');
  const updateBack = () => backToTop.classList.toggle("show", window.scrollY > 600);
  backToTop.addEventListener("click", () => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
  });
  window.addEventListener("scroll", updateBack, { passive: true });
  document.body.appendChild(backToTop);
  updateBack();

  const postNav = document.querySelector(".post-nav");
  if (postNav) {
    const prev = postNav.querySelector("a.prev");
    const next = postNav.querySelector("a.next");
    window.addEventListener("keydown", (event) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      const active = document.activeElement;
      if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable)) return;
      if (window.getSelection && window.getSelection().toString()) return;
      if (event.key === "ArrowLeft" && prev) {
        event.preventDefault();
        window.location.href = prev.href;
      } else if (event.key === "ArrowRight" && next) {
        event.preventDefault();
        window.location.href = next.href;
      }
    });
  }
})();
