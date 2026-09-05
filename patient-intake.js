// Wachtkamer-QR-intake (taak #134) — publieke, ongeauthenticeerde
// patiënt-client. Draait volledig los van app.js: geen account, geen
// localStorage-sessietoken, geen navigatie naar de rest van de applicatie.
// Leest het patient_intake_token uit de URL (?t=...) en praat uitsluitend
// met de publieke /api/public/intake/*-routes (zie src/routes/patientIntake.js
// voor het volledige beveiligingsmodel — role wordt daar server-side altijd
// hard geforceerd naar "patient", ongeacht wat deze client meestuurt).
//
// Hergebruikt bewust dezelfde globals als app.js/dashboard.js
// (STRINGS_BY_LANG uit strings.js, renderOrganClockSVG uit organClock.js) en
// dezelfde CSS-klassen uit styles.css (.card/.options/.opt-btn/.result-card/
// .meter/.clock-card/...) voor visuele en inhoudelijke consistentie met de
// hoofdapp — zonder dat er ooit code tussen de twee gedeeld hoeft te worden.
(function () {
  "use strict";

  const API_BASE_KEY = "yushin_api_base";
  const apiBase = localStorage.getItem(API_BASE_KEY) || "https://yushin-saas.dannycurrinckx.workers.dev";

  // Het token leeft uitsluitend in de URL, nooit in localStorage: dit is een
  // eenmalig, gedeeld toestel-onafhankelijk bezoek (de patiënt scant de
  // QR-code op zijn EIGEN telefoon), geen ingelogde sessie om te bewaren.
  const token = new URLSearchParams(location.search).get("t") || "";

  let lang = "nl";
  let screen = token ? "consent" : "invalid";
  let introStep = "gender"; // gender -> pediatric -> label -> interview
  let context = { role: "patient", female: null, pediatric: null };
  let patientLabelInput = "";
  let answers = {};
  let currentQuestion = null;
  let progress = { answered: 0, total: 0 };
  let flowBusy = false;
  let flowError = "";
  let resultData = null;

  // Kleine, eigen UI-woordenschat (paginachrome) — analoog aan de lokale
  // `UI`-tabel in app.js. Bewust GEEN eigen klinische/juridische tekst: de
  // kernclausule op het consent-scherm en alle vraag-/rapportteksten komen
  // altijd uit de gedeelde STRINGS_BY_LANG (strings.js), nooit hieronder.
  const UI = {
    nl: {
      appTitle: "Yushin",
      consentTitle: "Voordat je start",
      consentContinueBtn: "Ik ga akkoord en start",
      privacyLinkText: "Privacybeleid",
      termsLinkText: "Gebruiksvoorwaarden",
      andWord: " en ",
      labelFieldPatient: "Je naam (optioneel, zodat je therapeut je herkent)",
      startBtn: "Start de vragenlijst",
      loading: "Bezig…",
      connectionError: "Kan de server niet bereiken. Probeer het opnieuw, of vraag het aan de balie.",
      invalidLinkTitle: "Ongeldige link",
      invalidLinkText:
        "Deze link mist een geldige toegangscode. Scan de QR-code opnieuw, of vraag een nieuwe link aan de balie.",
      doneTitle: "Bedankt!",
      doneCloseHint: "Je antwoorden zijn automatisch doorgestuurd naar je therapeut. Je kan dit scherm nu sluiten.",
      restartBtn: "Opnieuw invullen",
      progressLabel: (n, totalQ) => `Vraag ${n} van ${totalQ}`,
    },
    en: {
      appTitle: "Yushin",
      consentTitle: "Before you start",
      consentContinueBtn: "I agree and continue",
      privacyLinkText: "Privacy policy",
      termsLinkText: "Terms of service",
      andWord: " and ",
      labelFieldPatient: "Your name (optional, so your therapist recognizes you)",
      startBtn: "Start the questionnaire",
      loading: "Loading…",
      connectionError: "Could not reach the server. Please try again, or ask the front desk.",
      invalidLinkTitle: "Invalid link",
      invalidLinkText:
        "This link is missing a valid access code. Scan the QR code again, or ask the front desk for a new link.",
      doneTitle: "Thank you!",
      doneCloseHint: "Your answers have automatically been sent to your therapist. You can close this screen now.",
      restartBtn: "Fill in again",
      progressLabel: (n, totalQ) => `Question ${n} of ${totalQ}`,
    },
  };
  function ui(key) {
    const v = (UI[lang] && UI[lang][key]) || UI.nl[key];
    return v === undefined ? key : v;
  }
  // t(): leest uit de gedeelde STRINGS_BY_LANG (global, uit strings.js) —
  // exact dezelfde functie-vorm als app.js/dashboard.js.
  function t(key) {
    const dict = (typeof STRINGS_BY_LANG !== "undefined" && STRINGS_BY_LANG[lang]) || STRINGS_BY_LANG.nl;
    const val = dict[key];
    return val !== undefined ? val : STRINGS_BY_LANG.nl[key];
  }
  const GROUP_KEY = { strong: "groupStrong", moderate: "groupModerate", light: "groupLight" };

  function el(tag, props, children) {
    const node = document.createElement(tag);
    if (props) {
      Object.entries(props).forEach(([k, v]) => {
        if (k === "class") node.className = v;
        else if (k === "text") node.textContent = v;
        else if (k === "html") node.innerHTML = v; // enkel eigen, vertrouwde markup (bv. renderOrganClockSVG)
        else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
        else if (v !== undefined && v !== null) node.setAttribute(k, v);
      });
    }
    (children || []).forEach((c) => {
      if (c) node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  }
  function optionButton(label, onClick) {
    return el("button", { class: "opt-btn", text: label, onclick: onClick });
  }

  async function api(path, method, body) {
    let res;
    try {
      res = await fetch(apiBase.replace(/\/$/, "") + path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (networkErr) {
      const err = new Error(ui("connectionError"));
      err.isNetworkError = true;
      throw err;
    }
    let data = null;
    try {
      data = await res.json();
    } catch {
      /* lege/geen body, bv. bij sommige foutresponses */
    }
    if (!res.ok) {
      const err = new Error((data && data.error) || `HTTP ${res.status}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  const root = document.getElementById("app");

  function render() {
    root.innerHTML = "";
    root.appendChild(renderTopBar());
    let body;
    if (screen === "invalid") body = renderInvalid();
    else if (screen === "consent") body = renderConsent();
    else if (screen === "intro") body = renderIntro();
    else if (screen === "interview") body = renderInterview();
    else body = renderResult();
    root.appendChild(body);
  }

  function renderTopBar() {
    const bar = el("div", { class: "topbar" });
    bar.appendChild(el("div", { class: "brand", text: ui("appTitle") }));
    const switcher = el("div", { class: "lang-switch" });
    ["nl", "en"].forEach((code) => {
      switcher.appendChild(
        el("button", {
          class: "lang-btn" + (lang === code ? " active" : ""),
          text: code.toUpperCase(),
          onclick: () => {
            lang = code;
            render();
          },
        })
      );
    });
    bar.appendChild(switcher);
    return bar;
  }

  function renderInvalid() {
    const wrap = el("div", { class: "card" });
    wrap.appendChild(el("h2", { text: ui("invalidLinkTitle") }));
    wrap.appendChild(el("p", { text: ui("invalidLinkText") }));
    return wrap;
  }

  // --- Scherm: consent (taak #134) -----------------------------------------
  // Toont de reeds door Danny's team vastgelegde, juridisch afgestemde
  // kernclausule (intendedUseStatement, "BESLIST"-status — zie strings.js)
  // vóór een ongeauthenticeerde bezoeker ook maar één vraag beantwoordt.
  // Bewust GEEN eigen, nieuw geformuleerde disclaimertekst: enkel hergebruik
  // van de bestaande, al goedgekeurde tekst + links naar de bestaande
  // privacy-/gebruiksvoorwaardenpagina's.
  function renderConsent() {
    const wrap = el("div", { class: "card" });
    wrap.appendChild(el("h2", { text: ui("consentTitle") }));
    wrap.appendChild(el("p", { class: "intended-use-statement", html: t("intendedUseStatement") }));
    const links = el("p", { class: "muted" });
    const privacyHref = lang === "en" ? "privacy-en.html" : "privacy.html";
    const termsHref = lang === "en" ? "terms-en.html" : "terms.html";
    links.appendChild(el("a", { href: privacyHref, target: "_blank", rel: "noopener", text: ui("privacyLinkText") }));
    links.appendChild(document.createTextNode(ui("andWord")));
    links.appendChild(el("a", { href: termsHref, target: "_blank", rel: "noopener", text: ui("termsLinkText") }));
    wrap.appendChild(links);
    wrap.appendChild(
      el("button", {
        class: "btn btn-primary",
        text: ui("consentContinueBtn"),
        onclick: () => {
          screen = "intro";
          introStep = "gender";
          render();
        },
      })
    );
    return wrap;
  }

  // --- Scherm: intro (geslacht/pediatrisch/label) --------------------------
  // Rol ligt al vast ("patient", zie context hierboven) — geen rolvraag
  // zoals in app.js's renderIntro(), en geen taalstap (de taalkeuze zit al
  // permanent in de topbar hierboven).
  function renderIntro() {
    const wrap = el("div", { class: "card" });

    if (introStep === "gender") {
      wrap.appendChild(el("h2", { text: t("askGender") }));
      const opts = el("div", { class: "options" });
      opts.appendChild(
        optionButton(t("genderFemale"), () => {
          context.female = true;
          introStep = "pediatric";
          render();
        })
      );
      opts.appendChild(
        optionButton(t("genderMale"), () => {
          context.female = false;
          introStep = "pediatric";
          render();
        })
      );
      opts.appendChild(
        optionButton(t("genderOther"), () => {
          context.female = false;
          introStep = "pediatric";
          render();
        })
      );
      wrap.appendChild(opts);
      return wrap;
    }

    if (introStep === "pediatric") {
      wrap.appendChild(el("h2", { text: t("askPediatric") }));
      const opts = el("div", { class: "options" });
      opts.appendChild(
        optionButton(t("pediatricYes"), () => {
          context.pediatric = true;
          introStep = "label";
          render();
        })
      );
      opts.appendChild(
        optionButton(t("pediatricNo"), () => {
          context.pediatric = false;
          introStep = "label";
          render();
        })
      );
      wrap.appendChild(opts);
      return wrap;
    }

    // introStep === "label"
    wrap.appendChild(
      el("div", { class: "field" }, [
        el("label", { text: ui("labelFieldPatient") }),
        el("input", {
          type: "text",
          value: patientLabelInput,
          oninput: (e) => (patientLabelInput = e.target.value),
        }),
      ])
    );
    wrap.appendChild(el("button", { class: "btn btn-primary", text: ui("startBtn"), onclick: startInterview }));
    return wrap;
  }

  // --- Scherm: interview ------------------------------------------------

  function startInterview() {
    answers = {};
    currentQuestion = null;
    flowError = "";
    screen = "interview";
    fetchNext();
  }

  async function fetchNext() {
    flowBusy = true;
    flowError = "";
    render();
    try {
      const data = await api("/api/public/intake/next", "POST", { token, lang, context, answers });
      flowBusy = false;
      // safetyChecklist komt van de server hier per definitie altijd leeg
      // terug (role is server-side hard "patient", zie
      // buildSafetyChecklistPayload in flow.js) — er is dus bewust geen
      // veiligheidschecklist-toggle op dit scherm, in tegenstelling tot
      // app.js's renderTopBar(). Dezelfde therapeut-only beperking als
      // evidence/therapyPlan.
      if (data.done) {
        await fetchResult();
        return;
      }
      currentQuestion = data;
      progress = data.progress;
      render();
    } catch (err) {
      flowBusy = false;
      flowError = err.message;
      render();
    }
  }

  function renderInterview() {
    const wrap = el("div", { class: "card" });

    if (flowError) {
      wrap.appendChild(el("div", { class: "error", text: flowError }));
      wrap.appendChild(el("button", { class: "btn btn-primary", text: ui("loading"), onclick: fetchNext }));
      return wrap;
    }

    if (flowBusy || !currentQuestion) {
      wrap.appendChild(el("p", { class: "muted", text: ui("loading") }));
      return wrap;
    }

    const pct = progress.total ? Math.round((progress.answered / progress.total) * 100) : 0;
    wrap.appendChild(el("div", { class: "progress" }, [el("div", { class: "progress-fill", style: `width:${pct}%` })]));
    wrap.appendChild(
      el("div", { class: "progress-label muted", text: ui("progressLabel")(progress.answered + 1, progress.total) })
    );

    if (currentQuestion.isNewSection) {
      wrap.appendChild(el("div", { class: "section-title", text: currentQuestion.sectionTitle }));
    }
    wrap.appendChild(el("h2", { text: currentQuestion.question.text }));

    const opts = el("div", { class: "options" });
    currentQuestion.question.options.forEach((opt) => {
      opts.appendChild(optionButton(opt.label, () => chooseOption(opt.index)));
    });
    wrap.appendChild(opts);

    return wrap;
  }

  async function chooseOption(optionIndex) {
    const key = currentQuestion.key;
    flowBusy = true;
    render();
    try {
      // Server-side validatie dat dit daadwerkelijk de eerstvolgende
      // legitieme vraag/keuze is — zelfde defensieve check als in app.js.
      await api("/api/public/intake/answer", "POST", { token, lang, context, answers, key, optionIndex });
      answers = { ...answers, [key]: optionIndex };
      await fetchNext();
    } catch (err) {
      flowBusy = false;
      flowError = err.message;
      render();
    }
  }

  // --- Scherm: resultaat ----------------------------------------------------

  async function fetchResult() {
    try {
      const data = await api("/api/public/intake/result", "POST", {
        token,
        lang,
        context,
        answers,
        patientLabel: patientLabelInput || undefined,
      });
      resultData = data.result;
      screen = "result";
      render();
    } catch (err) {
      flowError = err.message;
      screen = "interview";
      render();
    }
  }

  // Rendert het eigen rapport van de patiënt — hergebruikt bewust dezelfde
  // CSS-klassen als app.js's renderResults() (.results-card/.result-card/
  // .meter/.clock-card/...) voor een identieke visuele weergave. Bevat GEEN
  // evidence-toggle, therapieplan-blok, contradicties- of
  // vervolgvragen-sectie: die komen van de server voor een patiëntrol
  // sowieso nooit mee (zie buildResultPayload in flow.js), dus er is niets
  // om hier weg te filteren — in tegenstelling tot app.js, dat zowel
  // therapeut- als patiëntresultaten met dezelfde functie rendert.
  function renderResult() {
    const wrap = el("div", { class: "card results-card" });
    wrap.appendChild(el("h2", { text: t("reportTitle") }));
    wrap.appendChild(el("p", { class: "intended-use-statement muted", text: t("intendedUseFooter") }));

    if (!resultData.patterns.length) {
      wrap.appendChild(el("p", { text: t("noPatterns") }));
    } else {
      wrap.appendChild(el("p", { class: "conclusion", text: t("allDone") }));

      const maxCount = resultData.patterns[0].count || 1;
      resultData.patterns.forEach((p, idx) => {
        const card = el("div", { class: "result-card" + (idx === 0 ? " rank1" : "") });
        card.appendChild(el("h3", { text: `${p.pattern} — ${t(GROUP_KEY[p.group])} (${p.count}×)` }));
        card.appendChild(
          el("div", { class: "meter" }, [
            el("div", { class: "meter-fill", style: `width:${Math.round((p.count / maxCount) * 100)}%` }),
          ])
        );
        if (p.confidence) {
          card.appendChild(
            el("div", {
              class: "muted",
              text: `${t("confidencePrefix")}: ${t("confidence" + p.confidence[0].toUpperCase() + p.confidence.slice(1))}`,
            })
          );
        }
        wrap.appendChild(card);
      });

      wrap.appendChild(
        el("p", { class: "conclusion", text: t("conclusion")(resultData.topPattern, resultData.secondPattern) })
      );

      if (typeof renderOrganClockSVG === "function") {
        const clockCard = el("div", { class: "clock-card" });
        clockCard.appendChild(el("h3", { text: t("clockCardTitle") }));
        clockCard.appendChild(
          el("div", { class: "clock-wrap", html: renderOrganClockSVG(220, new Set(resultData.clockHighlights || [])) })
        );
        clockCard.appendChild(
          el("p", {
            class: "muted",
            text: (resultData.clockHighlights || []).length ? t("clockNoteHas") : t("clockNoteNone"),
          })
        );
        wrap.appendChild(clockCard);
      }
    }

    const doneCard = el("div", { class: "result-card" });
    doneCard.appendChild(el("h3", { text: ui("doneTitle") }));
    doneCard.appendChild(el("p", { text: ui("doneCloseHint") }));
    doneCard.appendChild(
      el("button", {
        class: "btn btn-ghost",
        text: ui("restartBtn"),
        onclick: () => {
          answers = {};
          currentQuestion = null;
          resultData = null;
          patientLabelInput = "";
          context = { role: "patient", female: null, pediatric: null };
          screen = "intro";
          introStep = "gender";
          render();
        },
      })
    );
    wrap.appendChild(doneCard);

    return wrap;
  }

  render();
})();
