// Yushin — dynamisch watermerk (bescherming tegen screenshots/lekken).
//
// Belangrijk om te begrijpen: dit VOORKOMT geen enkele screenshot — dat kan
// geen enkele webpagina, ongeacht welke JS-truc gebruikt wordt (rechtsklik
// blokkeren, devtools detecteren, enz. zijn allemaal omzeilbaar, en een foto
// met een andere telefoon werkt sowieso altijd). Wat dit WEL doet: een
// gelekte screenshot direct herleidbaar maken tot het account waarmee hij
// gemaakt is — naam, e-mail en tijdstip van de ingelogde gebruiker, licht
// doorschijnend en herhaald over het volledige scherm. Zelfde principe als
// Netflix, banken-apps en vertrouwelijke documentviewers.
//
// Bewust een volledig zelfstandig scriptje, los van app.js/dashboard.js: het
// leest enkel uit localStorage ("yushin_token"/"yushin_user", dezelfde sleutels
// als beide apps al gebruiken) en tekent zijn eigen overlay-element rechtstreeks
// op <body>, buiten de door app.js/dashboard.js beheerde containers. Zo kan dit
// nooit de bestaande render()-logica van die apps verstoren, en werkt het
// identiek op elke pagina waar dit bestand wordt ingeladen (index.html,
// dashboard.html) zonder dat die pagina's er zelf iets voor hoeven te doen.
(function () {
  "use strict";

  const TOKEN_KEY = "yushin_token";
  const USER_KEY = "yushin_user";
  const EL_ID = "yushin-watermark-overlay";
  const REFRESH_MS = 30000; // houdt het tijdstip in het watermerk vers, ook als de gebruiker niets doet

  function currentLabel() {
    let token;
    try {
      token = localStorage.getItem(TOKEN_KEY);
    } catch (err) {
      return null; // bv. privé-navigatie zonder opslag — dan gewoon geen watermerk
    }
    if (!token) return null;

    let user = null;
    try {
      user = JSON.parse(localStorage.getItem(USER_KEY) || "null");
    } catch (err) {
      user = null;
    }
    if (!user || !user.email) return null;

    const now = new Date();
    const stamp = now.toLocaleString("nl-BE", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    const namePart = user.name ? user.name + "  ·  " : "";
    return (namePart + user.email + "  ·  " + stamp).trim();
  }

  function escapeForSvg(text) {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // Eén SVG-tegel met de tekst tweemaal, licht gekanteld, die de browser zelf
  // herhaalt via background-repeat — goedkoper dan honderden losse DOM-nodes,
  // en schaalt vanzelf mee op elk schermformaat.
  function buildTileDataUrl(label) {
    const safe = escapeForSvg(label);
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="460" height="240">' +
      '<g transform="rotate(-28 230 120)" fill="rgba(120,120,120,0.16)" ' +
      'font-family="Arial, Helvetica, sans-serif" font-size="14">' +
      '<text x="0" y="60">' + safe + '</text>' +
      '<text x="0" y="180">' + safe + '</text>' +
      '</g></svg>';
    return "data:image/svg+xml," + encodeURIComponent(svg);
  }

  function ensureOverlay() {
    let overlay = document.getElementById(EL_ID);
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = EL_ID;
      overlay.setAttribute("aria-hidden", "true");
      Object.assign(overlay.style, {
        position: "fixed",
        top: "0",
        left: "0",
        right: "0",
        bottom: "0",
        zIndex: "2147483647", // altijd bovenop, ongeacht z-index-gebruik elders
        pointerEvents: "none", // nooit klikken/selecteren blokkeren
        backgroundRepeat: "repeat",
      });
      document.body.appendChild(overlay);
    }
    return overlay;
  }

  function update() {
    const label = currentLabel();
    const existing = document.getElementById(EL_ID);
    if (!label) {
      if (existing) existing.remove();
      return;
    }
    const overlay = ensureOverlay();
    if (overlay.dataset.label !== label) {
      overlay.style.backgroundImage = 'url("' + buildTileDataUrl(label) + '")';
      overlay.dataset.label = label;
    }
  }

  function init() {
    update();
    setInterval(update, REFRESH_MS);
    // Andere tab logt in/uit -> hier meteen mee bijwerken.
    window.addEventListener("storage", update);
    // Tabblad was even inactief -> tijdstip meteen verversen bij terugkeer.
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) update();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
