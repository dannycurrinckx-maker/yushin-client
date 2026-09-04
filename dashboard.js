// Yushin — Sessiedashboard (taak #127, "app-shell koppelen aan live
// sessiedata"). Eerste, bewust beperkte increment van de in de
// openstaande-puntentracker goedgekeurde werkvolgorde: read-only
// sessielijst → sessiedetail → patroonoverzicht/rationale.
//
// Bewust NIET meegenomen in deze increment (zie opleverboodschap aan
// Danny): Intake-checklist, Rationale-als-los-tabblad, Referenties,
// Meridianen, Notities, Team/Abonnement/Instellingen. Voor die laatste
// drie bestaat al een werkende, echte implementatie in app.js/index.html
// — dit dashboard verwijst er via "← Naar hoofdapp" naar door i.p.v. ze
// hier te dupliceren. Referenties/Meridianen tonen elders in de codebase
// nog altijd (goedgekeurde) placeholder- resp. ongeverifieerde inhoud;
// die worden hier bewust niet overgenomen zolang dat niet is opgelost.
//
// Auth: dit is BEWUST geen aparte inlogpagina. Het hergebruikt exact
// dezelfde localStorage-sleutels als app.js (yushin_token/yushin_api_base/
// yushin_user), zodat een therapeut die al in de hoofdapp is ingelogd hier
// direct verder kan zonder opnieuw in te loggen. Is er geen token, dan
// tonen we een duidelijke doorverwijzing naar index.html — nooit een eigen
// tweede login-implementatie die met de echte kan gaan afwijken.

(function () {
  "use strict";

  const API_BASE_KEY = "yushin_api_base";
  const TOKEN_KEY = "yushin_token";
  const USER_KEY = "yushin_user";

  const apiBase = localStorage.getItem(API_BASE_KEY) || "https://yushin-saas.dannycurrinckx.workers.dev";
  const token = localStorage.getItem(TOKEN_KEY) || null;
  const currentUser = JSON.parse(localStorage.getItem(USER_KEY) || "null");

  const GROUP_KEY = { strong: "groupStrong", moderate: "groupModerate", light: "groupLight" };
  const CONFIDENCE_KEY = { strong: "confidenceStrong", moderate: "confidenceModerate", weak: "confidenceWeak" };

  function strings(lang) {
    return (typeof STRINGS_BY_LANG !== "undefined" && STRINGS_BY_LANG[lang]) || STRINGS_BY_LANG.nl;
  }

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach((k) => {
      if (k === "text") node.textContent = attrs[k];
      else if (k === "html") node.innerHTML = attrs[k];
      else if (k === "class") node.className = attrs[k];
      else if (k.startsWith("on") && typeof attrs[k] === "function") node.addEventListener(k.slice(2), attrs[k]);
      else node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach((c) => node.appendChild(c));
    return node;
  }

  function formatDate(iso) {
    if (!iso) return "";
    try {
      const d = new Date(iso);
      return d.toLocaleDateString("nl-BE", { year: "numeric", month: "short", day: "numeric" }) +
        " " + d.toLocaleTimeString("nl-BE", { hour: "2-digit", minute: "2-digit" });
    } catch (e) {
      return iso.slice(0, 10);
    }
  }

  async function apiGet(path) {
    const res = await fetch(apiBase + path, {
      headers: { Authorization: "Bearer " + token },
    });
    if (res.status === 401) {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      showLoginGate();
      throw new Error("Niet (meer) ingelogd.");
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || ("Serverfout (" + res.status + ")"));
    return data;
  }

  function showLoginGate() {
    document.getElementById("loginGate").style.display = "block";
    document.getElementById("pageList").style.display = "none";
    document.getElementById("pageDetail").classList.remove("page-active");
  }

  function showPage(id) {
    document.querySelectorAll(".page").forEach((p) => p.classList.toggle("page-active", p.dataset.page === id));
    document.querySelectorAll(".nav-item").forEach((n) => n.classList.toggle("active", n.dataset.page === id));
    document.getElementById("backLink").classList.toggle("is-hidden", id !== "detail");
    window.scrollTo(0, 0);
  }

  function renderSessionList(sessions) {
    const box = document.getElementById("sessionListBox");
    box.innerHTML = "";
    if (!sessions.length) {
      box.appendChild(el("div", { class: "empty-state", text: "Nog geen afgeronde sessies." }));
      return;
    }
    sessions
      .slice()
      .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))
      .forEach((s) => {
        const roleLabel = s.role === "therapist" ? "therapeut" : "patiënt";
        const row = el(
          "button",
          { class: "session-row", onclick: () => openSession(s.id) },
          [
            el("span", { class: "session-row-label", text: s.patientLabel || "Naamloze sessie" }),
            el("span", { class: "role-pill", text: "ingevuld door " + roleLabel }),
            el("span", { class: "session-row-meta", text: formatDate(s.createdAt) }),
            el("svg", {
              class: "session-row-chev",
              viewBox: "0 0 24 24",
              fill: "none",
              stroke: "currentColor",
              "stroke-width": "2.2",
              html: '<polyline points="9 18 15 12 9 6"/>',
            }),
          ]
        );
        box.appendChild(row);
      });
  }

  async function loadSessionList() {
    try {
      const data = await apiGet("/api/sessions");
      renderSessionList(data.sessions || []);
    } catch (err) {
      document.getElementById("sessionListBox").innerHTML = "";
      document
        .getElementById("sessionListBox")
        .appendChild(el("div", { class: "error-state", text: "Kon sessielijst niet laden: " + err.message }));
    }
  }

  function renderPatternCard(p, S, maxCount) {
    const wrap = el("div");
    const top = el("div", { class: "pattern-row-top" }, [
      el("span", { class: "pattern-name", text: p.pattern + " — " + S[GROUP_KEY[p.group]] }),
      el("span", { class: "pattern-count", text: p.count + "×" }),
    ]);
    wrap.appendChild(top);
    const pct = maxCount ? Math.round((p.count / maxCount) * 100) : 0;
    wrap.appendChild(
      el("div", { class: "pattern-track" }, [el("div", { class: "pattern-fill", style: "width:" + pct + "%" })])
    );
    if (p.confidence) {
      wrap.appendChild(
        el("div", {
          class: "pattern-confidence",
          text: S.confidencePrefix + ": " + S[CONFIDENCE_KEY[p.confidence]],
        })
      );
    }
    if (p.evidence && p.evidence.length) {
      const det = el("details", { class: "pattern-evidence" });
      det.appendChild(el("summary", { text: S.evidenceToggle }));
      const ul = el("ul");
      p.evidence.forEach((e) => ul.appendChild(el("li", { text: e })));
      det.appendChild(ul);
      wrap.appendChild(det);
    }
    return wrap;
  }

  function renderSessionDetail(session) {
    const result = session.result || {};
    const lang = session.lang || "nl";
    const S = strings(lang);

    document.getElementById("detailTitle").textContent = session.patientLabel || "Naamloze sessie";
    document.getElementById("detailSubtitle").textContent =
      formatDate(session.createdAt) + " · " + session.id;

    const box = document.getElementById("detailBox");
    box.innerHTML = "";

    const patterns = result.patterns || [];
    if (!patterns.length) {
      box.appendChild(el("div", { class: "card" }, [el("p", { text: S.noPatterns || "Geen patronen gevonden." })]));
      return;
    }

    const maxCount = patterns[0].count || 1;
    const patternCard = el("div", { class: "card" }, [el("div", { class: "card-title", text: S.reportTitle || "Patroonoverzicht" })]);
    const list = el("div", { class: "pattern-list" });
    patterns.forEach((p) => list.appendChild(renderPatternCard(p, S, maxCount)));
    patternCard.appendChild(list);
    if (result.topPattern && typeof S.conclusion === "function") {
      patternCard.appendChild(
        el("p", { class: "conclusion-text", text: S.conclusion(result.topPattern, result.secondPattern) })
      );
    }
    box.appendChild(patternCard);

    // Orgaanklok — hergebruikt exact dezelfde renderer als het live
    // patiëntrapport in app.js (organClock.js), dus geen visuele of
    // inhoudelijke afwijking tussen dit dashboard en de hoofdapp.
    if (typeof renderOrganClockSVG === "function") {
      const clockCard = el("div", { class: "card" }, [
        el("div", { class: "card-title", text: S.clockCardTitle || "Orgaanklok" }),
      ]);
      clockCard.appendChild(
        el("div", { class: "clock-wrap", html: renderOrganClockSVG(200, new Set(result.clockHighlights || [])) })
      );
      clockCard.appendChild(
        el("p", {
          class: "clock-note",
          text: (result.clockHighlights || []).length ? S.clockNoteHas : S.clockNoteNone,
        })
      );
      box.appendChild(clockCard);
    }

    if (result.contradictions && result.contradictions.length) {
      const contraCard = el("div", { class: "card" }, [
        el("div", { class: "card-title", text: S.contradictionsSectionTitle || "Tegenstrijdige patronen" }),
      ]);
      result.contradictions.forEach((c) => {
        contraCard.appendChild(
          el("div", { class: "contradiction-item" }, [
            el("strong", { text: '"' + c.patternA + '" (' + c.countA + "×) ↔ \"" + c.patternB + '" (' + c.countB + "×)" }),
            el("span", { text: c.note || "" }),
          ])
        );
      });
      if (result.contradictionNote) {
        contraCard.appendChild(el("div", { class: "contradiction-note", text: result.contradictionNote }));
      }
      box.appendChild(contraCard);
    }

    if (result.redFlags && result.redFlags.length) {
      const rfCard = el("div", { class: "card" }, [el("div", { class: "card-title", text: "Veiligheidssignalen" })]);
      result.redFlags.forEach((f) => {
        rfCard.appendChild(
          el("div", { class: "contradiction-item" }, [
            el("strong", { text: f.label + " (" + f.tier + ")" }),
            el("span", { text: f.message || "" }),
          ])
        );
      });
      box.appendChild(rfCard);
    }

    // Therapieplan-voorstel per patroon — reële, door Danny klinisch
    // nagekeken data uit therapyPlanData.js (server stuurt dit al gefilterd
    // tot exact dezelfde patronen als hierboven getoond, zie flow.js). Dit
    // is bewust de vervanging voor het "Rationale"-tabblad met verzonnen
    // tags/tekst uit het ontwerp-prototype: hier staat enkel wat de server
    // ook echt teruggeeft, nooit een eigen samenvattende interpretatie.
    if (result.therapyPlan && result.therapyPlan.matched && result.therapyPlan.matched.length) {
      const tpCard = el("div", { class: "card" }, [
        el("div", { class: "card-title", text: "Therapieplan-voorstel per patroon" }),
        el("p", {
          class: "clock-note",
          style: "text-align:left;margin:-6px 0 16px",
          text: "Referentie-informatie, geen behandeladvies — bepaalt of optimaliseert geen behandeling.",
        }),
      ]);
      result.therapyPlan.matched.forEach((m) => {
        const item = el("div", { class: "contradiction-item" });
        item.appendChild(el("strong", { text: m.pattern + (m.type ? " (" + m.type + ")" : "") }));
        if (m.mei_zin) item.appendChild(el("div", { text: m.mei_zin, style: "margin:4px 0" }));
        if (m.punten) item.appendChild(el("div", { text: "Punten: " + m.punten }));
        if (m.leefstijl) item.appendChild(el("div", { text: "Leefstijl: " + m.leefstijl }));
        tpCard.appendChild(item);
      });
      if (result.therapyPlan.unmatchedCount) {
        tpCard.appendChild(
          el("div", {
            class: "contradiction-note",
            text: result.therapyPlan.unmatchedCount + " van de getoonde patronen heeft nog geen therapieplan-vermelding.",
          })
        );
      }
      box.appendChild(tpCard);
    }
  }

  async function openSession(id) {
    showPage("detail");
    document.getElementById("detailBox").innerHTML = '<div class="loading-state">Bezig met laden…</div>';
    try {
      const data = await apiGet("/api/sessions/" + encodeURIComponent(id));
      renderSessionDetail(data.session);
    } catch (err) {
      document.getElementById("detailBox").innerHTML = "";
      document
        .getElementById("detailBox")
        .appendChild(el("div", { class: "error-state", text: "Kon sessie niet laden: " + err.message }));
    }
  }

  document.querySelectorAll(".nav-item").forEach((item) => {
    item.addEventListener("click", () => showPage(item.dataset.page));
  });
  document.getElementById("backLink").addEventListener("click", () => showPage("list"));

  if (!token) {
    showLoginGate();
  } else {
    if (currentUser && currentUser.name) {
      document.getElementById("avatarInitials").textContent = currentUser.name
        .split(/\s+/)
        .map((p) => p[0])
        .join("")
        .slice(0, 2)
        .toUpperCase();
    }
    loadSessionList();
  }
})();
