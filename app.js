// Yushin SaaS — client-applicatie (taak #72).
//
// Deze client praat uitsluitend met de server-API (taken #68/#69/#70/#71)
// voor authenticatie en de anamnese-kernlogica. GEEN vraag/antwoorddata of
// scoring-logica leeft hier — dat staat nu enkel op de server
// (src/lib/flowEngine.js, sectionsNl.js, sectionsEn.js, therapyPlanData.js).
// Deze client is verantwoordelijk voor: inloggen/registreren, de vier
// "intro"-stappen (taal/rol/geslacht/pediatrisch — puur UI-keuzes, geen
// klinische data), de vraag-voor-vraag interviewweergave, en het tonen van
// het resultaat dat de server teruggeeft.
//
// Bewust NIET meegenomen in deze eerste versie (t.o.v. de oude client-side
// tool) — zie README.md "Wat nog ontbreekt in de client (taak #72)":
// spraak/voorlezen, PDF-export, het instellingenpaneel (secties aan/uit),
// de "Vorige vraag"-knop, en de vervolgconsult-vergelijking. Dit is een
// bewuste scope-keuze om eerst een werkende, geteste eind-tot-eind flow te
// hebben; deze features kunnen incrementeel teruggebouwd worden bovenop
// dezelfde API.

(function () {
  "use strict";

  const API_BASE_KEY = "yushin_api_base";
  const TOKEN_KEY = "yushin_token";
  const USER_KEY = "yushin_user";

  let apiBase = localStorage.getItem(API_BASE_KEY) || "https://yushin-saas.dannycurrinckx.workers.dev";
  let token = localStorage.getItem(TOKEN_KEY) || null;
  let currentUser = JSON.parse(localStorage.getItem(USER_KEY) || "null");

  let lang = "nl";
  let screen = token ? "intro" : "auth";
  let authMode = "login";
  let authError = "";
  let authBusy = false;

  let introStep = "lang";
  let context = { role: null, female: null, pediatric: null };

  let answers = {};
  let currentQuestion = null;
  let progress = { answered: 0, total: 0 };
  let flowError = "";
  let flowBusy = false;

  let resultData = null;
  let resultSessionId = null;
  let patientLabelInput = "";

  // Beheerpaneel (taak #73) — enkel bereikbaar/zinvol voor role === "owner";
  // de server dwingt dit ook zelf af (auth: "owner" in src/index.js), dit is
  // enkel UI-gemak.
  let adminUsers = [];
  let adminBusy = false;
  let adminError = "";
  let adminInviteBusy = false;
  let adminInviteError = "";
  // Welk scherm er moet worden getoond na het verlaten van het beheerpaneel.
  let screenBeforeAdmin = "intro";

  // Onboarding (taak #74) — organisatie-info wordt na inloggen/registreren
  // apart opgehaald bij GET /api/organization (server is bron van waarheid,
  // net als bij de vraag-flow), enkel om de proefperiode-badge en het
  // welkomstscherm te tonen. Bevat bewust GEEN prijzen — zie
  // src/routes/organization.js.
  let orgInfo = null;

  // Kleine, eigen UI-stringtabel voor de NIEUWE schermen (login/registreren)
  // die in de oorspronkelijke client-side tool niet bestonden (die had geen
  // authenticatie nodig). Alle overige teksten (vragen, resultaten,
  // therapieplan, orgaanklok) komen uit STRINGS_BY_LANG (strings.js),
  // verbatim overgenomen — zie taak #71/#72.
  const UI = {
    nl: {
      appTitle: "Yushin",
      loginTitle: "Inloggen",
      registerTitle: "Nieuwe praktijk registreren",
      email: "E-mailadres",
      password: "Wachtwoord (min. 10 tekens)",
      organizationName: "Praktijknaam",
      ownerName: "Jouw naam",
      loginBtn: "Inloggen",
      registerBtn: "Praktijk registreren",
      switchToRegister: "Nog geen account? Registreer je praktijk",
      switchToLogin: "Al een account? Log in",
      logout: "Uitloggen",
      apiUrlLabel: "Server-adres (API)",
      newSession: "Nieuwe anamnese starten",
      patientLabelField: "Dossiernummer/label (optioneel)",
      loading: "Bezig…",
      sessionSaved: "Sessie opgeslagen",
      restart: "Nieuwe sessie",
      skip: "Overslaan / niet van toepassing",
      askLangTitle: "Kies je taal",
      chooseAnOption: "Kies een antwoord",
      welcomeBack: (name) => `Ingelogd als ${name}`,
      connectionError:
        "Kan de server niet bereiken. Controleer het server-adres hierboven (de Worker moet lokaal draaien via 'npm run dev', of gedeployed zijn).",
      manageTeam: "Team beheren",
      backToApp: "← Terug",
      teamTitle: "Team beheren",
      teamMembersTitle: "Leden",
      inviteTitle: "Nieuw lid uitnodigen",
      nameField: "Naam",
      roleField: "Rol",
      roleOwner: "Eigenaar",
      roleTherapist: "Therapeut",
      inviteBtn: "Uitnodigen",
      removeBtn: "Verwijderen",
      activeLabel: "Actief",
      deactivatedLabel: "Gedeactiveerd",
      youLabel: "(jij)",
      noMembersYet: "Nog geen andere leden.",
      trialBadge: "Proefperiode",
      onboardingTitle: (name) => `Welkom bij Yushin, ${name}!`,
      onboardingIntro:
        "Je praktijk is aangemaakt en klaar voor gebruik. Je kan meteen aan de slag met een eerste anamnese, of eerst collega's uitnodigen via het beheerpaneel.",
      onboardingGoTeam: "Ga naar Team beheren",
      onboardingGoIntake: "Start je eerste anamnese",
    },
    en: {
      appTitle: "Yushin",
      loginTitle: "Log in",
      registerTitle: "Register a new practice",
      email: "Email address",
      password: "Password (min. 10 characters)",
      organizationName: "Practice name",
      ownerName: "Your name",
      loginBtn: "Log in",
      registerBtn: "Register practice",
      switchToRegister: "No account yet? Register your practice",
      switchToLogin: "Already have an account? Log in",
      logout: "Log out",
      apiUrlLabel: "Server address (API)",
      newSession: "Start new intake",
      patientLabelField: "File number/label (optional)",
      loading: "Loading…",
      sessionSaved: "Session saved",
      restart: "New session",
      skip: "Skip / not applicable",
      askLangTitle: "Choose your language",
      chooseAnOption: "Choose an answer",
      welcomeBack: (name) => `Logged in as ${name}`,
      connectionError:
        "Could not reach the server. Check the server address above (the Worker must be running locally via 'npm run dev', or deployed).",
      manageTeam: "Manage team",
      backToApp: "← Back",
      teamTitle: "Manage team",
      teamMembersTitle: "Members",
      inviteTitle: "Invite a new member",
      nameField: "Name",
      roleField: "Role",
      roleOwner: "Owner",
      roleTherapist: "Therapist",
      inviteBtn: "Invite",
      removeBtn: "Remove",
      activeLabel: "Active",
      deactivatedLabel: "Deactivated",
      youLabel: "(you)",
      noMembersYet: "No other members yet.",
      trialBadge: "Trial",
      onboardingTitle: (name) => `Welcome to Yushin, ${name}!`,
      onboardingIntro:
        "Your practice has been created and is ready to use. You can start a first intake right away, or invite colleagues first via the admin panel.",
      onboardingGoTeam: "Go to Manage team",
      onboardingGoIntake: "Start your first intake",
    },
  };
  function ui(key) {
    const v = (UI[lang] && UI[lang][key]) || UI.nl[key];
    return v === undefined ? key : v;
  }
  // ?dev=1 toont het server-adresveld op het inlogscherm (enkel nuttig tijdens
  // ontwikkelen/testen, bv. om naar een lokale of staging-Worker te wijzen).
  // Voor gewone bezoekers/klanten blijft dit veld verborgen — de standaardwaarde
  // (production-Worker) is toch al correct, en het toont anders onnodige
  // technische infrastructuur op wat het eerste scherm is dat een (potentiële)
  // klant tijdens een demo te zien krijgt.
  function isDevMode() {
    return new URLSearchParams(location.search).get("dev") === "1";
  }
  // t(): dezelfde functie-vorm als het oorspronkelijke script — leest uit de
  // verbatim overgenomen STRINGS_BY_LANG (global, uit strings.js).
  function t(key) {
    const dict = STRINGS_BY_LANG[lang] || STRINGS_BY_LANG.nl;
    const val = dict[key];
    return val !== undefined ? val : STRINGS_BY_LANG.nl[key];
  }
  const GROUP_KEY = { strong: "groupStrong", moderate: "groupModerate", light: "groupLight" };

  // --- API-helper --------------------------------------------------------

  async function api(path, method, body) {
    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = "Bearer " + token;
    let res;
    try {
      res = await fetch(apiBase.replace(/\/$/, "") + path, {
        method,
        headers,
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

  // --- DOM-helpers ---------------------------------------------------------

  function el(tag, props, children) {
    const node = document.createElement(tag);
    if (props) {
      Object.entries(props).forEach(([k, v]) => {
        if (k === "class") node.className = v;
        else if (k === "text") node.textContent = v;
        else if (k === "html") node.innerHTML = v; // enkel voor eigen, vertrouwde markup (bv. renderOrganClockSVG)
        else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
        else if (v !== undefined && v !== null) node.setAttribute(k, v);
      });
    }
    (children || []).forEach((c) => {
      if (c) node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  }

  const root = document.getElementById("app");

  function render() {
    root.innerHTML = "";
    root.appendChild(renderTopBar());
    let body;
    if (screen === "auth") body = renderAuth();
    else if (screen === "onboarding") body = renderOnboarding();
    else if (screen === "intro") body = renderIntro();
    else if (screen === "interview") body = renderInterview();
    else if (screen === "results") body = renderResults();
    else if (screen === "admin") body = renderAdmin();
    root.appendChild(body);
  }

  function renderTopBar() {
    const bar = el("div", { class: "topbar" });
    bar.appendChild(el("div", { class: "brand", text: ui("appTitle") }));

    const langSwitch = el("div", { class: "lang-switch" });
    ["nl", "en"].forEach((code) => {
      langSwitch.appendChild(
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
    bar.appendChild(langSwitch);

    if (token && currentUser) {
      bar.appendChild(el("span", { class: "muted", text: ui("welcomeBack")(currentUser.name) }));

      if (orgInfo && orgInfo.subscriptionStatus === "trialing") {
        // Bewust enkel een statusbadge, geen bedrag — prijzen zijn nog een
        // openstaande beslissing (zie src/lib/plans.js).
        bar.appendChild(el("span", { class: "lang-btn", text: ui("trialBadge") }));
      }

      if (screen === "admin") {
        bar.appendChild(
          el("button", {
            class: "btn btn-ghost",
            text: ui("backToApp"),
            onclick: () => {
              screen = screenBeforeAdmin || "intro";
              render();
            },
          })
        );
      } else if (currentUser.role === "owner" && screen !== "auth") {
        // Beheerpaneel (taak #73) — enkel voor de praktijkeigenaar, en enkel
        // zinvol als er al ingelogd/gekozen is (niet op het auth-scherm).
        bar.appendChild(
          el("button", {
            class: "btn btn-ghost",
            text: ui("manageTeam"),
            onclick: () => {
              screenBeforeAdmin = screen;
              screen = "admin";
              fetchAdminUsers();
            },
          })
        );
      }

      bar.appendChild(
        el("button", {
          class: "btn btn-ghost",
          text: ui("logout"),
          onclick: doLogout,
        })
      );
    }
    return bar;
  }

  // --- Scherm: authenticatie ----------------------------------------------

  function renderAuth() {
    const wrap = el("div", { class: "card auth-card" });
    if (isDevMode()) {
      wrap.appendChild(
        el("div", { class: "field" }, [
          el("label", { text: ui("apiUrlLabel") }),
          el("input", {
            type: "text",
            value: apiBase,
            oninput: (e) => {
              apiBase = e.target.value;
              localStorage.setItem(API_BASE_KEY, apiBase);
            },
          }),
        ])
      );
    }

    wrap.appendChild(el("h2", { text: authMode === "login" ? ui("loginTitle") : ui("registerTitle") }));
    if (authError) wrap.appendChild(el("div", { class: "error", text: authError }));

    const form = el("form", {
      onsubmit: (e) => {
        e.preventDefault();
        authMode === "login" ? doLogin(form) : doRegister(form);
      },
    });

    if (authMode === "register") {
      form.appendChild(field("organizationName", ui("organizationName"), "text"));
      form.appendChild(field("ownerName", ui("ownerName"), "text"));
    }
    form.appendChild(field("email", ui("email"), "email"));
    form.appendChild(field("password", ui("password"), "password"));
    form.appendChild(
      el("button", {
        class: "btn btn-primary",
        type: "submit",
        text: authBusy ? ui("loading") : authMode === "login" ? ui("loginBtn") : ui("registerBtn"),
        disabled: authBusy ? "disabled" : undefined,
      })
    );
    wrap.appendChild(form);

    wrap.appendChild(
      el("button", {
        class: "btn btn-link",
        text: authMode === "login" ? ui("switchToRegister") : ui("switchToLogin"),
        onclick: () => {
          authMode = authMode === "login" ? "register" : "login";
          authError = "";
          render();
        },
      })
    );

    return wrap;

    function field(name, labelText, type) {
      return el("div", { class: "field" }, [
        el("label", { text: labelText }),
        el("input", { name, type, required: "required" }),
      ]);
    }
  }

  async function doLogin(form) {
    authBusy = true;
    authError = "";
    render();
    try {
      const data = await api("/api/auth/login", "POST", {
        email: form.email.value,
        password: form.password.value,
      });
      onAuthSuccess(data, { isNewRegistration: false });
    } catch (err) {
      authError = err.message;
    } finally {
      authBusy = false;
      render();
    }
  }

  async function doRegister(form) {
    authBusy = true;
    authError = "";
    render();
    try {
      const data = await api("/api/auth/register", "POST", {
        organizationName: form.organizationName.value,
        contactEmail: form.email.value,
        ownerName: form.ownerName.value,
        password: form.password.value,
      });
      onAuthSuccess(data, { isNewRegistration: true });
    } catch (err) {
      authError = err.message;
    } finally {
      authBusy = false;
      render();
    }
  }

  function onAuthSuccess(data, { isNewRegistration = false } = {}) {
    token = data.token;
    currentUser = data.user;
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(currentUser));
    // Onboarding (taak #74): vlak na een NIEUWE registratie tonen we eerst
    // een welkomstscherm i.p.v. meteen de intro-flow te starten — bij een
    // gewone login gaan bestaande gebruikers wél meteen door, zij hebben dat
    // scherm al gezien.
    screen = isNewRegistration ? "onboarding" : "intro";
    introStep = "lang";
    context = { role: null, female: null, pediatric: null };
    fetchOrganizationInfo();
    render();
  }

  async function fetchOrganizationInfo() {
    try {
      const data = await api("/api/organization", "GET");
      orgInfo = data.organization;
      render();
    } catch {
      // Niet kritiek voor de rest van de app (enkel gebruikt voor de
      // proefperiode-badge/onboarding-tekst) — stil negeren als dit faalt.
    }
  }

  function renderOnboarding() {
    const wrap = el("div", { class: "card" });
    wrap.appendChild(el("h2", { text: ui("onboardingTitle")(currentUser.name) }));
    wrap.appendChild(el("p", { text: ui("onboardingIntro") }));
    wrap.appendChild(
      el("button", {
        class: "btn btn-primary",
        text: ui("onboardingGoIntake"),
        onclick: () => {
          screen = "intro";
          introStep = "lang";
          render();
        },
      })
    );
    wrap.appendChild(
      el("button", {
        class: "btn btn-ghost",
        text: ui("onboardingGoTeam"),
        onclick: () => {
          screenBeforeAdmin = "intro";
          screen = "admin";
          fetchAdminUsers();
        },
      })
    );
    return wrap;
  }

  async function doLogout() {
    try {
      await api("/api/auth/logout", "POST");
    } catch {
      /* zelfs als dit faalt (bv. server niet bereikbaar), toch lokaal uitloggen */
    }
    token = null;
    currentUser = null;
    orgInfo = null;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    screen = "auth";
    render();
  }

  // --- Scherm: intro (taal/rol/geslacht/pediatrisch) ----------------------
  // Dit zijn UI-only keuzes — geen klinische data — en worden bewust NIET
  // via de server-flowroutes gesteld (zie flow.js-toelichting). Zodra ze
  // bekend zijn, gaat context mee als onderdeel van elke /api/flow/*-aanroep.

  function renderIntro() {
    const wrap = el("div", { class: "card" });

    if (introStep === "lang") {
      wrap.appendChild(el("h2", { text: ui("askLangTitle") }));
      const opts = el("div", { class: "options" });
      ["nl", "en"].forEach((code) => {
        opts.appendChild(
          optionButton(STRINGS_BY_LANG[code].langName, () => {
            lang = code;
            introStep = "role";
            render();
          })
        );
      });
      wrap.appendChild(opts);
      return wrap;
    }

    if (introStep === "role") {
      wrap.appendChild(el("h2", { text: t("askRole") }));
      const opts = el("div", { class: "options" });
      opts.appendChild(
        optionButton(t("roleTherapist"), () => {
          context.role = "therapeut";
          introStep = "gender";
          render();
        })
      );
      opts.appendChild(
        optionButton(t("rolePatient"), () => {
          context.role = "patient";
          introStep = "gender";
          render();
        })
      );
      wrap.appendChild(opts);
      return wrap;
    }

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

    if (introStep === "label") {
      // Dossiernummer/label opvragen VOOR de interview start (niet pas op
      // het resultaatscherm) — het wordt meegestuurd bij /api/flow/result,
      // dat de sessie op dat moment al persisteert.
      wrap.appendChild(
        el("div", { class: "field" }, [
          el("label", { text: ui("patientLabelField") }),
          el("input", {
            type: "text",
            value: patientLabelInput,
            oninput: (e) => (patientLabelInput = e.target.value),
          }),
        ])
      );
      wrap.appendChild(
        el("button", {
          class: "btn btn-primary",
          text: ui("newSession"),
          onclick: startInterview,
        })
      );
      return wrap;
    }

    return wrap;
  }

  function optionButton(label, onClick) {
    return el("button", { class: "opt-btn", text: label, onclick: onClick });
  }

  // --- Scherm: interview ----------------------------------------------------

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
      const data = await api("/api/flow/next", "POST", { lang, context, answers });
      flowBusy = false;
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
    const progressBar = el("div", { class: "progress" }, [el("div", { class: "progress-fill", style: `width:${pct}%` })]);
    wrap.appendChild(progressBar);
    wrap.appendChild(
      el("div", { class: "progress-label muted", text: t("progressLabel")(progress.answered + 1, progress.total) })
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
      // legitieme vraag/keuze is (zie flow.js) — vangt bv. een dubbelklik
      // op een verouderd scherm op.
      await api("/api/flow/answer", "POST", { lang, context, answers, key, optionIndex });
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
      const data = await api("/api/flow/result", "POST", {
        lang,
        context,
        answers,
        patientLabel: patientLabelInput || undefined,
      });
      resultData = data.result;
      resultSessionId = data.sessionId;
      screen = "results";
      render();
    } catch (err) {
      flowError = err.message;
      screen = "interview";
      render();
    }
  }

  function renderResults() {
    const wrap = el("div", { class: "card results-card" });
    wrap.appendChild(el("h2", { text: t("reportTitle") }));
    wrap.appendChild(el("div", { class: "muted", text: `${resultData.generatedAt.slice(0, 10)} · ${resultSessionId}` }));

    if (!resultData.patterns.length) {
      wrap.appendChild(el("p", { text: t("noPatterns") }));
    } else {
      wrap.appendChild(el("p", { class: "conclusion", text: t("allDone") }));

      const maxCount = resultData.patterns[0].count || 1;
      resultData.patterns.forEach((p, idx) => {
        const card = el("div", { class: "result-card" + (idx === 0 ? " rank1" : "") });
        card.appendChild(
          el("h3", { text: `${p.pattern} — ${t(GROUP_KEY[p.group])} (${p.count}×)` })
        );
        card.appendChild(
          el("div", { class: "meter" }, [
            el("div", { class: "meter-fill", style: `width:${Math.round((p.count / maxCount) * 100)}%` }),
          ])
        );
        if (p.evidence) {
          const det = el("details");
          det.appendChild(el("summary", { text: t("evidenceToggle") }));
          const ul = el("ul");
          p.evidence.forEach((e) => ul.appendChild(el("li", { text: e })));
          det.appendChild(ul);
          card.appendChild(det);
        }
        wrap.appendChild(card);
      });

      wrap.appendChild(
        el("p", { class: "conclusion", text: t("conclusion")(resultData.topPattern, resultData.secondPattern) })
      );

      const clockCard = el("div", { class: "clock-card" });
      clockCard.appendChild(el("h3", { text: t("clockCardTitle") }));
      clockCard.appendChild(el("div", { class: "clock-wrap", html: renderOrganClockSVG(220, new Set(resultData.clockHighlights)) }));
      clockCard.appendChild(
        el("p", { class: "muted", text: resultData.clockHighlights.length ? t("clockNoteHas") : t("clockNoteNone") })
      );
      wrap.appendChild(clockCard);
    }

    if (resultData.therapyPlan) {
      const tp = el("div", { class: "therapy-plan" });
      tp.appendChild(el("h3", { text: t("therapyPlanTitle") }));
      resultData.therapyPlan.matched.forEach((m) => {
        const card = el("div", { class: "therapy-plan-card" });
        card.appendChild(el("h4", { text: m.pattern }));
        if (m.mei_zin) card.appendChild(el("p", { text: m.mei_zin }));
        if (m.punten) card.appendChild(el("p", { text: `${t("therapyPlanPoints")}: ${m.punten}` }));
        if (m.leefstijl) card.appendChild(el("p", { text: `${t("therapyPlanLifestyle")}: ${m.leefstijl}` }));
        tp.appendChild(card);
      });
      if (resultData.therapyPlan.unmatchedCount) {
        tp.appendChild(el("p", { class: "muted", text: t("therapyPlanUnmatched")(resultData.therapyPlan.unmatchedCount) }));
      }
      wrap.appendChild(tp);
    }

    wrap.appendChild(
      el("button", {
        class: "btn btn-primary",
        text: ui("restart"),
        onclick: () => {
          context = { role: null, female: null, pediatric: null };
          introStep = "lang";
          answers = {};
          resultData = null;
          patientLabelInput = "";
          screen = "intro";
          render();
        },
      })
    );

    return wrap;
  }

  // --- Scherm: beheerpaneel (taak #73) --------------------------------------
  // Praat uitsluitend met /api/admin/users (src/routes/admin.js) — geen
  // organisatie-ID's of andere gevoelige gegevens leven hier client-side;
  // de server scoped alles zelf op ctx.session.organizationId.

  async function fetchAdminUsers() {
    adminBusy = true;
    adminError = "";
    render();
    try {
      const data = await api("/api/admin/users", "GET");
      adminUsers = data.users;
    } catch (err) {
      adminError = err.message;
    } finally {
      adminBusy = false;
      render();
    }
  }

  async function doInviteUser(form) {
    adminInviteBusy = true;
    adminInviteError = "";
    render();
    try {
      await api("/api/admin/users", "POST", {
        name: form.inviteName.value,
        email: form.inviteEmail.value,
        password: form.invitePassword.value,
        role: form.inviteRole.value,
      });
      form.inviteName.value = "";
      form.inviteEmail.value = "";
      form.invitePassword.value = "";
      await fetchAdminUsers();
    } catch (err) {
      adminInviteError = err.message;
      adminInviteBusy = false;
      render();
    }
    adminInviteBusy = false;
  }

  async function doRemoveUser(userId) {
    adminError = "";
    try {
      await api(`/api/admin/users?userId=${encodeURIComponent(userId)}`, "DELETE");
      await fetchAdminUsers();
    } catch (err) {
      adminError = err.message;
      render();
    }
  }

  function renderAdmin() {
    const wrap = el("div", { class: "card" });
    wrap.appendChild(el("h2", { text: ui("teamTitle") }));
    if (adminError) wrap.appendChild(el("div", { class: "error", text: adminError }));

    // --- Uitnodigingsformulier ---
    wrap.appendChild(el("h3", { text: ui("inviteTitle") }));
    if (adminInviteError) wrap.appendChild(el("div", { class: "error", text: adminInviteError }));
    const form = el("form", {
      onsubmit: (e) => {
        e.preventDefault();
        doInviteUser(form);
      },
    });
    form.appendChild(
      el("div", { class: "field" }, [
        el("label", { text: ui("nameField") }),
        el("input", { name: "inviteName", type: "text", required: "required" }),
      ])
    );
    form.appendChild(
      el("div", { class: "field" }, [
        el("label", { text: ui("email") }),
        el("input", { name: "inviteEmail", type: "email", required: "required" }),
      ])
    );
    form.appendChild(
      el("div", { class: "field" }, [
        el("label", { text: ui("password") }),
        el("input", { name: "invitePassword", type: "password", required: "required" }),
      ])
    );
    const roleSelect = el("select", { name: "inviteRole" }, [
      el("option", { value: "therapist", text: ui("roleTherapist") }),
      el("option", { value: "owner", text: ui("roleOwner") }),
    ]);
    form.appendChild(el("div", { class: "field" }, [el("label", { text: ui("roleField") }), roleSelect]));
    form.appendChild(
      el("button", {
        class: "btn btn-primary",
        type: "submit",
        text: adminInviteBusy ? ui("loading") : ui("inviteBtn"),
        disabled: adminInviteBusy ? "disabled" : undefined,
      })
    );
    wrap.appendChild(form);

    // --- Ledenlijst ---
    wrap.appendChild(el("h3", { text: ui("teamMembersTitle") }));
    if (adminBusy) {
      wrap.appendChild(el("p", { class: "muted", text: ui("loading") }));
    } else if (!adminUsers.length) {
      wrap.appendChild(el("p", { class: "muted", text: ui("noMembersYet") }));
    } else {
      adminUsers.forEach((u) => {
        const row = el("div", { class: "result-card" });
        const roleLabel = u.role === "owner" ? ui("roleOwner") : ui("roleTherapist");
        const isSelf = currentUser && u.id === currentUser.id;
        row.appendChild(
          el("h4", { text: `${u.name}${isSelf ? " " + ui("youLabel") : ""} — ${roleLabel}` })
        );
        row.appendChild(el("p", { class: "muted", text: u.email }));
        row.appendChild(
          el("p", { class: "muted", text: u.is_active ? ui("activeLabel") : ui("deactivatedLabel") })
        );
        if (u.is_active) {
          row.appendChild(
            el("button", {
              class: "btn btn-ghost",
              text: ui("removeBtn"),
              onclick: () => doRemoveUser(u.id),
            })
          );
        }
        wrap.appendChild(row);
      });
    }

    return wrap;
  }

  // Snelle demo-login (taak #83) — enkel actief via ?demo=1 in de URL, bv.
  // https://.../yushin-client/?demo=1, zodat Danny tijdens een live demo aan
  // een (potentiële) klant niet zelf hoeft in te loggen: de link opent direct
  // ingelogd op een apart demo-praktijkaccount. Bewust GEEN echte
  // patiëntgegevens in dit account — de inloggegevens staan hieronder in de
  // (publieke) broncode van deze client, dat is voor een demo-only account
  // aanvaardbaar maar zou dat niet zijn voor een echt praktijkaccount.
  const DEMO_CREDENTIALS = { email: "demo@yushin-demo.app", password: "YushinDemo2026!" };

  async function tryDemoAutoLogin() {
    authBusy = true;
    render();
    try {
      const data = await api("/api/auth/login", "POST", DEMO_CREDENTIALS);
      onAuthSuccess(data, { isNewRegistration: false });
    } catch (err) {
      authError = err.message;
      authBusy = false;
      render();
    }
  }

  // Bij een pagina-herlaad met een reeds bestaande, opgeslagen sessie (geen
  // verse login/registratie) is er nog geen orgInfo — haal die dan ook op,
  // zodat de proefperiode-badge ook na een herlaad zichtbaar blijft.
  if (token) {
    fetchOrganizationInfo();
    render();
  } else if (new URLSearchParams(location.search).get("demo") === "1") {
    tryDemoAutoLogin();
  } else {
    render();
  }
})();
