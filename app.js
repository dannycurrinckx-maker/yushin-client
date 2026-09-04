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

  // Het echte Yushin-embleem (zilveren drakengolf met gouden acupunctuurnaald).
  // Voorheen als een grote base64 data-URL ingebed in deze file — dat bleek
  // op de live GitHub Pages-site niet altijd betrouwbaar te laden (broken
  // image). Nu een gewoon statisch bestand (yushin-logo-128.webp, meegecommit
  // in de root van deze repo naast index.html), betrouwbaarder en kleiner.
  const LOGO_DATAURL = "yushin-logo-128.webp";

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
  // Verplicht akkoordvakje bij registratie (03/09, launch-blocker) — enkel
  // relevant zolang authMode === "register"; bij het wisselen tussen
  // login/registreren wordt dit teruggezet (zie de switchToRegister/
  // switchToLogin-knop in renderAuth()).
  let agreedToTerms = false;

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

  // Red-flag / safety-laag (Spoor 1.4, taak #104/#105). `redFlags` komt van
  // de server (resolveRedFlags-output: [{id, tier:"hard"|"soft", label,
  // ernstniveau, message}]) en wordt zowel tijdens het interview
  // (fetchNext) als bij het resultaat (fetchResult) ververst — een
  // NOODSIGNAAL moet direct na dat antwoord zichtbaar zijn, niet pas na de
  // resterende vragen (zie toelichting in src/routes/flow.js). `tier`
  // "hard" (NOODSIGNAAL) blokkeert de hele app tot een nieuwe sessie start
  // — dat is bewust GEEN dismissible state. `tier` "soft" (ALARM/
  // WAARSCHUWING) is niet-blokkerend: ackedRedFlagIds houdt bij welke de
  // therapeut expliciet als "gelezen" heeft aangevinkt (Danny's instructie,
  // chat 2026-08-26); dit blijft opzettelijk staan over vragen heen binnen
  // dezelfde sessie (eenmaal gelezen, blijft gelezen), en wordt enkel
  // gereset bij een nieuwe sessie (zie restartBtn-handler).
  let redFlags = [];
  let ackedRedFlagIds = new Set();
  // Sluitstatus van de Yushin-assistent-pop-up (taak #89) — apart van
  // resultData zodat een klik op het sluitkruisje niet het hele
  // resultaatscherm laat herrenderen zonder de pop-up. Wordt gereset
  // telkens een nieuw resultaat binnenkomt (zie fetchResult hieronder).
  let assistantPopupDismissed = false;
  // Gespreksstatus van de Yushin-assistent-pop-up (taak #91) — het
  // therapieplan-voorstel wordt niet meer standaard in de resultaten
  // getoond. De assistent stelt eerst een keuzemenu voor ("wil je het
  // voorstel zien?"); enkel als de therapeut daar expliciet op ingaat,
  // opent het gesprek verder en verschijnt de inhoud als losse
  // chatberichten — vergelijkbaar met hoe een WhatsApp-gesprek verder
  // opengaat. Wordt samen met assistantPopupDismissed gereset bij elk
  // nieuw resultaat (zie fetchResult).
  let assistantConversationOpen = false;
  // Welke patroon-titels de therapeut al heeft aangeklikt in de assistent-
  // pop-up (taak #92) — het keuzemenu toont bewust enkel de titels van de
  // gevonden patronen; de volledige inhoud (mei_zin/punten/leefstijl) van
  // een patroon verschijnt pas als losse chatbubbel nadat de therapeut
  // expliciet op die titel klikt, i.p.v. alles in één keer te tonen zodra
  // "Ja, toon het voorstel" gekozen is. Bevat indices in
  // therapyPlan.matched; de "overige bevindingen"-notitie wordt apart
  // bijgehouden via assistantUnmatchedOpened. Wordt samen met de andere
  // assistant*-variabelen gereset bij elk nieuw resultaat (zie
  // fetchResult).
  let assistantOpenedPatterns = [];
  let assistantUnmatchedOpened = false;

  // Automatische demo-invulling (taak #90) — herbouwde, SaaS-versie van
  // autoFillDemo() uit de oude client-side tool. autoDemoBusy voorkomt
  // dubbele runs; autoDemoActive blijft aan tot een ECHTE nieuwe sessie
  // start (zie startInterview) en beperkt dan het resultaatscherm tot 5
  // bevindingen (zie renderResults) zodat een prospect snel een indruk
  // krijgt zonder de volle 78-vragen-uitkomst te moeten doorworstelen.
  let autoDemoBusy = false;
  let autoDemoActive = false;

  // Verborgen demo-toegang op het landingsscherm (taak #87) — een
  // ingeklapt "Demo-toegang?"-linkje dat een codeveld toont; bij de juiste
  // code (zie DEMO_ACCESS_CODE verderop) logt dit meteen in op het
  // demo-praktijkaccount, net als de ?demo=1 querystring-shortcut. Bedoeld
  // voor Danny om tijdens een live demo snel toegang te tonen zonder de
  // link met ?demo=1 te moeten kennen/typen.
  let showDemoCodeInput = false;
  let demoCodeValue = "";
  let demoCodeError = "";

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

  // Abonnementsscherm (taak #117) — tot nu toe bestond er GEEN zichtbare
  // prijs-/plankeuzepagina in de client, enkel de "Proefperiode"-badge
  // hierboven. Dit vulde dat gat aan, nu prijzen vastliggen (taak #113).
  // Bewust enkel voor de eigenaar (server staat /api/billing/checkout ook
  // enkel toe voor role "owner", zie index.js) — zelfde patroon als
  // screenBeforeAdmin hierboven.
  let screenBeforeBilling = "intro";
  let billingBusy = false;
  let billingError = "";

  // Referenties-sectie (placeholder, 03/09) — enkel de navigatie/het scherm
  // zelf, zie renderReferences() verderop. Geen eigen data-ophaling: de
  // inhoud wordt in een latere taak toegevoegd.
  let screenBeforeReferences = "intro";
  // "monthly" of "yearly" — kiest enkel welke kaarten getoond worden, de
  // uiteindelijke plan-sleutel (bv. "solo_yearly") die naar de server gaat
  // hangt hiervan af (zie PLAN_CATALOG hieronder).
  let billingInterval = "monthly";

  // Betaalpoort / toegangscode (taak #118) — VERVANGT de eerdere automatische
  // proefperiode. Zolang orgInfo.subscriptionStatus === "trialing" heeft de
  // organisatie GEEN toegang: render() toont dan (zie isAccessBlocked()
  // hieronder) altijd renderGate() (eigenaar) of renderLocked() (overig
  // teamlid) in plaats van het scherm dat `screen` eigenlijk aangeeft — dit is
  // de daadwerkelijke poort, niet enkel een badge zoals voorheen. De server
  // blijft hoe dan ook de echte grens (flow.js/accessCodes.js): dit is enkel
  // de UI-routering.
  let gateCodeValue = "";
  let gateBusy = false;
  let gateError = "";

  // Gedeelde poort-check — gebruikt in zowel render() (welk scherm getoond
  // wordt) als renderTopBar() (welke navigatieknoppen zinvol zijn terwijl de
  // poort actief is).
  function isAccessBlocked() {
    return Boolean(token && currentUser && orgInfo && orgInfo.subscriptionStatus === "trialing");
  }

  // Patiënt-vergrendeling (03/09) — zolang een patiënt zelf de vragenlijst
  // invult (context.role === "patient", gekozen bij "Wie vult deze anamnese
  // in?") mag de bovenbalk geen praktijk-/beheerknoppen tonen: het toestel
  // blijft ingelogd als de therapeut/eigenaar, dus zonder deze check zou een
  // patiënt via de balk naar Team beheren, Abonnement of Referenties kunnen
  // klikken terwijl hij het toestel even vasthoudt. Enkel relevant tijdens
  // het invullen/bekijken van de anamnese zelf (interview/results) — op elk
  // ander scherm is er sowieso geen patiënt aan het toestel.
  function isPatientFilling() {
    return context.role === "patient" && (screen === "interview" || screen === "results");
  }

  // Kleine, eigen UI-stringtabel voor de NIEUWE schermen (login/registreren)
  // die in de oorspronkelijke client-side tool niet bestonden (die had geen
  // authenticatie nodig). Alle overige teksten (vragen, resultaten,
  // therapieplan, orgaanklok) komen uit STRINGS_BY_LANG (strings.js),
  // verbatim overgenomen — zie taak #71/#72.
  const UI = {
    nl: {
      appTitle: "Yushin",
      // Positionering herzien (Spoor 2.1, beslissing Danny 2026-08-26) en
      // opnieuw herzien naar de niet-medische positionering (taak #111,
      // bron: Yushin_DPA_Privacy_SaaS_NietMedische_Positionering_
      // PreLegal_v2.xlsx, tabblad D, status "BESLIST"). De vorige versie
      // ("gestructureerde klinische intake & patroonherkenning") gebruikte
      // nog "klinisch", wat expliciet vermeden moet worden (tab D rij 5:
      // "vermijd... 'diagnostiek'"; Extra-tabblad: "vermijd in
      // klantgerichte juridische teksten termen als 'clinical decision
      // support', 'diagnostiek', 'therapieplan', 'behandeladvies'... Deze
      // keuze moet ook functioneel in UI/output worden doorgevoerd.").
      heroTitle: "Yushin — educatief patroonoverzicht voor TCM & Japanse acupunctuur",
      heroDescription:
        "Yushin is een educatieve en informatieve softwaretoepassing voor professionele TCM-/acupunctuurbeoefenaars: het begeleidt je (of je patiënt) stap voor stap door een vaste vragenlijst van 78 vragen en toont automatisch een overzicht van traditionele patroonrelaties, een orgaanklok-overzicht en bijpassende traditionele referentie-informatie. Yushin stelt geen diagnose en bepaalt geen behandeling — de interpretatie en beoordeling blijven bij jou. Log in of registreer je praktijk om te starten.",
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
      // Verplicht akkoordvakje bij registratie (03/09) — link naar de
      // schone, klantgerichte privacy.html/terms.html (naast index.html in
      // client/). Vervangt géén jurist-review, zie de bestaande interne
      // masterdossiers; dit is puur het UI-blokje dat registratie
      // tegenhoudt zolang niet aangevinkt.
      agreeToTermsPrefix: "Ik ga akkoord met de ",
      agreeToTermsLink: "gebruiksvoorwaarden",
      agreeToTermsAnd: " en de ",
      agreeToPrivacyLink: "privacyverklaring",
      agreeToTermsRequired: "Je moet akkoord gaan met de voorwaarden en de privacyverklaring om te registreren.",
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
      sessionDashboardNavBtn: "Sessiedashboard",
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
      demoCodeToggle: "Demo-toegang?",
      demoCodeLabel: "Admin-code",
      demoCodeButton: "Ga",
      demoCodeInvalid: "Ongeldige code.",
      // Taak #111 — "therapieplan-voorstel" hernoemd: geen behandelvoorstel,
      // enkel traditionele referentie-informatie (tab D rij 8/22).
      assistantAskShowPlan: "Wil je dat ik traditionele referentie-informatie toon voor dit patroon?",
      assistantShowPlanBtn: "Ja, toon de informatie",
      assistantDismissBtn: "Nee, bedankt",
      assistantChooseTitle: "Kies een patroon om de referentie-informatie te zien:",
      assistantUnmatchedTitle: "Overige bevindingen",
      autoDemoBtn: "🧪 Demo: automatisch invullen",
      autoDemoConfirm:
        "Dit vult de vragenlijst automatisch in met telkens de eerste antwoordoptie, enkel om snel een indruk te geven van de app. Gebruik dit nooit tijdens een echt consult — de resultaten zijn nep. Doorgaan?",
      autoDemoCapped: (shown, total) => `Demo: toont de eerste ${shown} van de ${total} gevonden bevindingen.`,

      // Abonnementsscherm (taak #117).
      billingNavBtn: "Abonnement",
      billingTitle: "Abonnement",
      billingCurrentPlanLabel: "Huidig abonnement",
      billingStatusTrialing: "Proefperiode",
      billingStatusActive: "Actief",
      billingStatusPastDue: "Betaling mislukt — controleer je betaalmethode",
      billingIntervalMonthly: "Maandelijks",
      billingIntervalYearly: "Jaarlijks (2 maanden gratis)",
      billingChoosePlanBtn: "Kies dit abonnement",
      billingChoosingBusy: "Bezig…",
      billingCurrentPlanBtn: "Dit is je huidige abonnement",
      planSoloName: "Yushin Professional",
      planSoloDesc: "Voor een solo-praktijk. Onbeperkt aantal patroonverkenningen, 1 gebruiker.",
      planTeamName: "Yushin Practice",
      planTeamDesc: "Voor een praktijk met een team. Onbeperkt aantal patroonverkenningen, tot 3 gebruikers.",
      billingEducationNote:
        "Ben je student, opleider of net afgestudeerd? Voor het Education-tarief nemen we dit nog handmatig op — neem contact op.",

      // Toegangspoort (taak #118) — vervangt de vroegere automatische
      // proefperiode. Wordt getoond meteen na inloggen/registreren zolang de
      // organisatie nog geen toegang heeft.
      gateTitle: "Toegang vereist",
      gateIntro:
        "Deze praktijk heeft nog geen toegang tot Yushin. Kies een abonnement, of voer een toegangscode in als je die van ons hebt gekregen.",
      gateViewPlansBtn: "Bekijk abonnementen",
      gateOrDivider: "— of —",
      gateCodeLabel: "Toegangscode",
      gateCodeButton: "Code inwisselen",
      gateDiscountApplied: (percent) =>
        `Kortingscode toegepast: ${percent}% korting wordt automatisch verrekend bij het afrekenen hieronder.`,
      lockedMessage:
        "Deze praktijk heeft nog geen toegang tot Yushin. Neem contact op met de praktijkbeheerder om een abonnement te kiezen of een toegangscode in te voeren.",

      // Referenties-sectie (placeholder) — 03/09: enkel de sectie zelf
      // aangemaakt, de effectieve inhoud (klassieke bronteksten, zie de
      // ontwerp-prototype) wordt in een latere taak overgezet.
      referencesNavBtn: "Referenties",
      referencesTitle: "Referenties",
      referencesPlaceholder:
        "Deze sectie is in ontwikkeling. Klassieke bronteksten en canonieke referentie-informatie worden hier binnenkort toegevoegd.",
    },
    en: {
      appTitle: "Yushin",
      heroTitle: "Yushin — educational pattern overview for TCM & Japanese acupuncture",
      heroDescription:
        "Yushin is an educational and informational software application for professional TCM/acupuncture practitioners: it guides you (or your patient) step by step through a fixed 78-question intake and automatically shows an overview of traditional pattern relationships, an organ-clock overview, and matching traditional reference information. Yushin does not provide a diagnosis and does not determine treatment — interpretation and assessment remain yours. Log in or register your practice to get started.",
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
      agreeToTermsPrefix: "I agree to the ",
      agreeToTermsLink: "terms of service",
      agreeToTermsAnd: " and the ",
      agreeToPrivacyLink: "privacy policy",
      agreeToTermsRequired: "You must agree to the terms of service and privacy policy to register.",
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
      sessionDashboardNavBtn: "Session dashboard",
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
      demoCodeToggle: "Demo access?",
      demoCodeLabel: "Admin code",
      demoCodeButton: "Go",
      demoCodeInvalid: "Invalid code.",
      assistantAskShowPlan: "Would you like me to show traditional reference information for this pattern?",
      assistantShowPlanBtn: "Yes, show the information",
      assistantDismissBtn: "No, thanks",
      assistantChooseTitle: "Choose a pattern to see the reference information:",
      assistantUnmatchedTitle: "Other findings",
      autoDemoBtn: "🧪 Demo: auto-fill",
      autoDemoConfirm:
        "This automatically fills in the questionnaire by always picking the first answer option, just to quickly show what the app can do. Never use this during a real consultation — the results are fake. Continue?",
      autoDemoCapped: (shown, total) => `Demo: showing the first ${shown} of ${total} findings.`,

      billingNavBtn: "Subscription",
      billingTitle: "Subscription",
      billingCurrentPlanLabel: "Current plan",
      billingStatusTrialing: "Trial",
      billingStatusActive: "Active",
      billingStatusPastDue: "Payment failed — please check your payment method",
      billingIntervalMonthly: "Monthly",
      billingIntervalYearly: "Yearly (2 months free)",
      billingChoosePlanBtn: "Choose this plan",
      billingChoosingBusy: "Loading…",
      billingCurrentPlanBtn: "This is your current plan",
      planSoloName: "Yushin Professional",
      planSoloDesc: "For a solo practice. Unlimited pattern explorations, 1 user.",
      planTeamName: "Yushin Practice",
      planTeamDesc: "For a practice with a team. Unlimited pattern explorations, up to 3 users.",
      billingEducationNote:
        "Student, educator, or recent graduate? We still handle the Education rate manually — get in touch.",

      gateTitle: "Access required",
      gateIntro:
        "This practice doesn't have access to Yushin yet. Choose a subscription, or enter an access code if we gave you one.",
      gateViewPlansBtn: "View subscriptions",
      gateOrDivider: "— or —",
      gateCodeLabel: "Access code",
      gateCodeButton: "Redeem code",
      gateDiscountApplied: (percent) =>
        `Discount code applied: ${percent}% off will be applied automatically at checkout below.`,
      lockedMessage:
        "This practice doesn't have access to Yushin yet. Contact your practice owner to choose a subscription or enter an access code.",

      referencesNavBtn: "References",
      referencesTitle: "References",
      referencesPlaceholder:
        "This section is in development. Classical source texts and canonical reference information will be added here soon.",
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

  // Prijs-catalogus voor het abonnementsscherm (taak #117) — bewust ENKEL
  // voor weergave. Het daadwerkelijke bedrag dat aan Mollie doorgegeven
  // wordt, komt nooit hiervandaan: dat wordt server-side opgezocht in
  // src/lib/plans.js op basis van de plan-SLEUTEL die hier gekozen wordt
  // (zie handleStartCheckout in billing.js). Als deze twee ooit uit elkaar
  // lopen is het ergste gevolg een verkeerd getoond bedrag vóór het
  // afrekenen — nooit een verkeerd geïnd bedrag.
  const PLAN_CATALOG = [
    {
      soloKey: "solo",
      monthlyKey: "solo",
      yearlyKey: "solo_yearly",
      nameKey: "planSoloName",
      descKey: "planSoloDesc",
      monthlyPrice: "€ 8,95",
      yearlyPrice: "€ 89",
    },
    {
      soloKey: "team",
      monthlyKey: "team",
      yearlyKey: "team_yearly",
      nameKey: "planTeamName",
      descKey: "planTeamDesc",
      monthlyPrice: "€ 19,95",
      yearlyPrice: "€ 199",
    },
  ];

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
    // Taak #118 — de eigenlijke poort. token/currentUser bestaan al (anders
    // is screen sowieso "auth"), maar orgInfo kan bij een pagina-herlaad met
    // een reeds bestaande sessie nog niet geladen zijn (fetchOrganizationInfo
    // loopt dan nog): toon in dat tussenmoment een neutraal laadscherm i.p.v.
    // even het echte scherm te laten flitsen. Zodra orgInfo bekend is, geldt:
    // subscriptionStatus === "trialing" -> GEEN toegang, altijd de poort
    // tonen — behalve het abonnementsscherm zelf (screen === "billing"),
    // want dat IS de "betalen"-kant van de poort (zie renderGate() hieronder).
    if (token && currentUser && orgInfo === null && screen !== "auth") {
      body = renderGateLoading();
    } else if (isAccessBlocked() && screen !== "billing") {
      body = currentUser.role === "owner" ? renderGate() : renderLocked();
    } else if (screen === "auth") body = renderAuth();
    else if (screen === "onboarding") body = renderOnboarding();
    else if (screen === "intro") body = renderIntro();
    else if (screen === "interview") body = renderInterview();
    else if (screen === "results") body = renderResults();
    else if (screen === "admin") body = renderAdmin();
    else if (screen === "billing") body = renderBilling();
    else if (screen === "references") body = renderReferences();
    root.appendChild(body);

    // Red-flag / safety-laag (Spoor 1.4, taak #105) — bewust NA de rest van
    // de pagina toegevoegd zodat de blokkerende overlay (tier "hard") er
    // altijd bovenop ligt (z-index 2000, hoger dan de assistant-popup). Enkel
    // relevant tijdens interview/results — op andere schermen (auth, intro,
    // admin) zijn er per definitie nog geen redFlags opgehaald.
    const flagOverlay = renderRedFlagLayer();
    if (flagOverlay) root.appendChild(flagOverlay);
  }

  // Spoor 1.4 (taak #104/#105). Zie de toelichting bij de state-declaratie
  // van redFlags/ackedRedFlagIds hierboven voor de twee gedragsniveaus.
  function renderRedFlagLayer() {
    if (!redFlags.length) return null;
    const hardFlags = redFlags.filter((f) => f.tier === "hard");
    if (hardFlags.length) return renderRedFlagOverlay(hardFlags);

    const unackedSoft = redFlags.filter((f) => f.tier === "soft" && !ackedRedFlagIds.has(f.id));
    if (!unackedSoft.length) return null;
    return renderRedFlagBanner(unackedSoft);
  }

  // Tier "hard" (NOODSIGNAAL) — volledig blokkerende overlay, GEEN
  // "toch doorgaan"-knop: Danny's expliciete instructie was "noodsignaal is
  // stop". De enige uitweg is een nieuwe sessie starten (zelfde handler als
  // de gewone "Opnieuw beginnen"-knop in renderResults).
  function renderRedFlagOverlay(hardFlags) {
    const overlay = el("div", { class: "redflag-overlay" });
    const modal = el("div", { class: "redflag-modal" });
    modal.appendChild(el("h2", { text: t("redflagModalTitle") }));
    modal.appendChild(el("p", { text: t("redflagModalIntro") }));
    hardFlags.forEach((f) => {
      const item = el("div", { class: "redflag-item" });
      item.appendChild(el("strong", { text: f.label }));
      item.appendChild(el("span", { text: f.message }));
      modal.appendChild(item);
    });
    modal.appendChild(el("p", { class: "muted", text: t("redflagRestartCta") }));
    modal.appendChild(
      el("button", {
        class: "btn btn-primary",
        text: ui("restart"),
        onclick: restartSession,
      })
    );
    overlay.appendChild(modal);
    return overlay;
  }

  // Tier "soft" (ALARM/WAARSCHUWING) — niet-blokkerende banner. De therapeut
  // kan gewoon verder klikken in de vragenlijst/resultaten (deze banner
  // onderschept geen klikken op de rest van de pagina); elke melding moet
  // wel individueel aangevinkt worden voor ze uit de banner verdwijnt.
  function renderRedFlagBanner(unackedSoft) {
    const banner = el("div", { class: "redflag-banner" });
    banner.appendChild(el("h3", { text: t("redflagBannerTitle") }));
    banner.appendChild(el("p", { class: "muted", text: t("redflagBannerIntro") }));
    unackedSoft.forEach((f) => {
      const item = el("div", { class: "redflag-item redflag-item-soft" });
      item.appendChild(el("strong", { text: f.label }));
      item.appendChild(el("span", { text: f.message }));
      const ackRow = el("div", { class: "redflag-ack-row" });
      const checkboxId = `redflag-ack-${f.id}`;
      const checkbox = el("input", { type: "checkbox", id: checkboxId });
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          ackedRedFlagIds.add(f.id);
          render();
        }
      });
      ackRow.appendChild(checkbox);
      const label = el("label", { text: t("redflagAckLabel") });
      label.setAttribute("for", checkboxId);
      ackRow.appendChild(label);
      item.appendChild(ackRow);
      banner.appendChild(item);
    });
    return banner;
  }

  // Gedeelde restart-logica (Spoor 1.4, taak #105) — dezelfde reset als de
  // bestaande "Opnieuw beginnen"-knop in renderResults, nu ook aanroepbaar
  // vanuit de blokkerende red-flag-overlay. Reset bewust ook
  // redFlags/ackedRedFlagIds: een nieuwe sessie start zonder de
  // veiligheidsmeldingen van de vorige sessie.
  function restartSession() {
    context = { role: null, female: null, pediatric: null };
    introStep = "lang";
    answers = {};
    resultData = null;
    patientLabelInput = "";
    redFlags = [];
    ackedRedFlagIds = new Set();
    screen = "intro";
    render();
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
        // Statusbadge — klikbaar naar het abonnementsscherm (taak #117) voor
        // de eigenaar, zodat de proefperiode-badge zelf ook meteen de weg
        // wijst naar waar je een abonnement kan kiezen.
        bar.appendChild(
          el("span", {
            class: "lang-btn",
            text: ui("trialBadge"),
            title: currentUser.role === "owner" && !isPatientFilling() ? ui("billingNavBtn") : undefined,
            onclick:
              currentUser.role === "owner" && screen !== "billing" && !isPatientFilling()
                ? () => {
                    screenBeforeBilling = screen;
                    screen = "billing";
                    render();
                  }
                : undefined,
          })
        );
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
      } else if (screen === "billing") {
        bar.appendChild(
          el("button", {
            class: "btn btn-ghost",
            text: ui("backToApp"),
            onclick: () => {
              screen = screenBeforeBilling || "intro";
              render();
            },
          })
        );
      } else if (screen === "references") {
        bar.appendChild(
          el("button", {
            class: "btn btn-ghost",
            text: ui("backToApp"),
            onclick: () => {
              screen = screenBeforeReferences || "intro";
              render();
            },
          })
        );
      } else if (currentUser.role === "owner" && screen !== "auth" && !isPatientFilling()) {
        // Beheerpaneel (taak #73) — enkel voor de praktijkeigenaar, en enkel
        // zinvol als er al ingelogd/gekozen is (niet op het auth-scherm).
        // Taak "patiënt-vergrendeling" (03/09): ook verborgen zolang een
        // patiënt zelf de vragenlijst invult, zie isPatientFilling() hierboven.
        bar.appendChild(
          el("button", {
            class: "btn btn-ghost",
            text: ui("billingNavBtn"),
            onclick: () => {
              screenBeforeBilling = screen;
              screen = "billing";
              render();
            },
          })
        );
        // Taak #118: "Team beheren" verbergen zolang de poort actief is —
        // anders leidt de knop nergens heen (render() toont sowieso de poort
        // opnieuw zolang subscriptionStatus "trialing" is), wat verwarrend
        // aanvoelt als een dode klik.
        if (!isAccessBlocked()) {
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
      }

      // Sessiedashboard (taak #127) — link naar de nieuwe, aparte
      // dashboard.html (sessielijst + patroonoverzicht/rationale/
      // therapieplan per sessie, taak "app-shell koppelen aan live
      // sessiedata"). Bewust een gewone <a>-link i.p.v. een screen-state in
      // deze SPA: dashboard.html hergebruikt gewoon dezelfde yushin_token/
      // yushin_api_base/yushin_user uit localStorage (zelfde patroon als de
      // demo-account-detectie hieronder), dus geen nieuwe loginflow nodig.
      // Zichtbaar voor elke ingelogde gebruiker (niet owner-only, in
      // tegenstelling tot Team beheren/Abonnement): elke therapeut mag zijn
      // eigen sessiegeschiedenis terugzien, net als handleListSessions dat
      // server-side ook al per-therapeut scoped. Verborgen op dezelfde
      // schermen/gate-toestanden als de Referenties-knop hierboven.
      if (
        screen !== "admin" &&
        screen !== "billing" &&
        screen !== "references" &&
        !isAccessBlocked() &&
        !isPatientFilling()
      ) {
        bar.appendChild(
          el("a", {
            class: "btn btn-ghost",
            href: "dashboard.html",
            text: ui("sessionDashboardNavBtn"),
          })
        );
      }

      // Referenties-knop (placeholder, 03/09) — bewust NIET owner-only:
      // beide rollen (owner/therapist) mogen dit later zien, in
      // tegenstelling tot Team beheren/Abonnement die owner-only blijven.
      // Verborgen op de schermen die zelf al een "Terug"-knop tonen, en
      // zolang de toegangspoort actief is (zelfde reden als Team beheren).
      if (
        screen !== "admin" &&
        screen !== "billing" &&
        screen !== "references" &&
        !isAccessBlocked() &&
        !isPatientFilling()
      ) {
        bar.appendChild(
          el("button", {
            class: "btn btn-ghost",
            text: ui("referencesNavBtn"),
            onclick: () => {
              screenBeforeReferences = screen;
              screen = "references";
              render();
            },
          })
        );
      }

      // Automatische demo-invulknop (taak #90) — bewust enkel zichtbaar op
      // het demo-account (isDemoAccount hieronder) en enkel op de schermen
      // waar een interview aan de gang kan zijn; een echte praktijk mag dit
      // testhulpmiddel nooit tijdens een echt consult te zien krijgen.
      if (isDemoAccount() && (screen === "intro" || screen === "interview")) {
        bar.appendChild(
          el("button", {
            class: "btn btn-ghost btn-demo-autofill",
            text: autoDemoBusy ? ui("loading") : ui("autoDemoBtn"),
            disabled: autoDemoBusy ? "disabled" : undefined,
            onclick: handleAutoDemoClick,
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

  // Het inlogscherm is tegelijk de landingspagina (eerste scherm dat iedereen
  // — ook een demo-bezoeker die nog nooit van Yushin gehoord heeft — te zien
  // krijgt), dus toont behalve het logo ook in het kort wat de tool doet,
  // vóór het inlog-/registratieblok.
  function renderHero() {
    const hero = el("div", { class: "hero" });
    hero.appendChild(el("img", { class: "hero-logo", src: LOGO_DATAURL, alt: "Yushin logo" }));
    hero.appendChild(el("h1", { class: "hero-title", text: ui("heroTitle") }));
    hero.appendChild(el("p", { class: "hero-description", text: ui("heroDescription") }));

    return hero;
  }

  function renderAuth() {
    const outer = el("div", { class: "landing" });
    outer.appendChild(renderHero());

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
    // Verplicht akkoordvakje (03/09, launch-blocker) — enkel bij registratie
    // getoond; login-gebruikers hebben dit al bij hun eerdere registratie
    // aanvaard. De links openen privacy.html/terms.html (of de Engelse
    // varianten privacy-en.html/terms-en.html, afhankelijk van de huidige
    // `lang`, naast index.html) in een nieuw tabblad, zodat het
    // registratieformulier niet verloren gaat. doRegister() blokkeert de
    // submit hard zolang niet aangevinkt — zie de check daar.
    if (authMode === "register") {
      form.appendChild(
        el("div", { class: "field agree-terms-field" }, [
          el("label", { class: "agree-terms-label" }, [
            el("input", {
              type: "checkbox",
              name: "agreeToTerms",
              checked: agreedToTerms ? "checked" : undefined,
              onchange: (e) => {
                agreedToTerms = e.target.checked;
              },
            }),
            el("span", {}, [
              ui("agreeToTermsPrefix"),
              el("a", {
                href: lang === "en" ? "terms-en.html" : "terms.html",
                target: "_blank",
                rel: "noopener",
                text: ui("agreeToTermsLink"),
              }),
              ui("agreeToTermsAnd"),
              el("a", {
                href: lang === "en" ? "privacy-en.html" : "privacy.html",
                target: "_blank",
                rel: "noopener",
                text: ui("agreeToPrivacyLink"),
              }),
            ]),
          ]),
        ])
      );
    }
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
          agreedToTerms = false;
          render();
        },
      })
    );

    outer.appendChild(wrap);
    outer.appendChild(renderDemoCodeBlock());
    return outer;

    function field(name, labelText, type) {
      return el("div", { class: "field" }, [
        el("label", { text: labelText }),
        el("input", { name, type, required: "required" }),
      ]);
    }
  }

  // Verborgen demo-toegang (taak #87) — ingeklapt onder het inlog-/
  // registratieblok, bewust NIET prominent (dit is geen feature voor gewone
  // bezoekers, enkel een snelkoppeling voor Danny tijdens een live demo).
  // Zelfde bestemming als de ?demo=1 querystring-shortcut (taak #83).
  function renderDemoCodeBlock() {
    const block = el("div", { class: "demo-code-block" });

    if (!showDemoCodeInput) {
      block.appendChild(
        el("button", {
          class: "btn-link demo-code-toggle",
          type: "button",
          text: ui("demoCodeToggle"),
          onclick: () => {
            showDemoCodeInput = true;
            render();
          },
        })
      );
      return block;
    }

    const form = el("form", {
      class: "demo-code-form",
      onsubmit: (e) => {
        e.preventDefault();
        submitDemoCode();
      },
    });
    form.appendChild(
      el("input", {
        type: "password",
        placeholder: ui("demoCodeLabel"),
        value: demoCodeValue,
        autofocus: "autofocus",
        oninput: (e) => (demoCodeValue = e.target.value),
      })
    );
    form.appendChild(el("button", { class: "btn btn-ghost", type: "submit", text: ui("demoCodeButton") }));
    block.appendChild(form);
    if (demoCodeError) block.appendChild(el("div", { class: "error", text: demoCodeError }));
    return block;
  }

  function submitDemoCode() {
    if (demoCodeValue.trim() === DEMO_ACCESS_CODE) {
      demoCodeError = "";
      tryDemoAutoLogin();
    } else {
      demoCodeError = ui("demoCodeInvalid");
      render();
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
    // Launch-blocker (03/09): registratie hard tegenhouden zolang het
    // akkoordvakje niet is aangevinkt — dit is de enige server-onafhankelijke
    // plek waar we dit kunnen afdwingen; de server zelf slaat geen "akkoord"
    // op (geen apart consent-veld/-tabel, bewust simpel gehouden voor v1).
    if (!agreedToTerms) {
      authError = ui("agreeToTermsRequired");
      render();
      return;
    }
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
    // scherm al gezien. LET OP (taak #118): dit is enkel de VOORKEUR — als de
    // organisatie nog geen toegang heeft (subscriptionStatus "trialing"),
    // overschrijft render() dit sowieso met de poort (renderGate/
    // renderLocked), ongeacht wat `screen` hier gezet wordt.
    screen = isNewRegistration ? "onboarding" : "intro";
    introStep = "lang";
    context = { role: null, female: null, pediatric: null };
    // Taak #118: login/registratie geven nu allebei al een volledig
    // organization-object terug (zie auth.js) — meteen synchroon zetten
    // i.p.v. te wachten op fetchOrganizationInfo() voorkomt dat de poort
    // (of, erger, het echte intro-/onboardingscherm) even flitst vóór de
    // aparte GET /api/organization-aanroep terugkomt.
    orgInfo = data.organization || null;
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

  // Yushin-assistent als losstaande chatbubbel-pop-up (taak #89), nu
  // uitgebreid met een keuzemenu (taak #91): het therapieplan-voorstel
  // verschijnt bewust NIET meer automatisch in de resultatentekst. De
  // assistent vraagt eerst of de therapeut het wil zien; enkel bij "Ja"
  // opent het gesprek verder en verschijnt de inhoud als losse
  // chatberichten, zoals een doorlopend WhatsApp-gesprek.
  // assistantConversationOpen (taak #91) onthoudt die keuze binnen dit
  // resultaat; assistantPopupDismissed (taak #89) sluit de hele pop-up.
  function renderAssistantPopup(therapyPlan) {
    if (assistantPopupDismissed) return null;
    const hasPlan = therapyPlan && (therapyPlan.matched.length > 0 || therapyPlan.unmatchedCount);
    if (!hasPlan) return null;

    const wrap = el("div", { class: "assistant-popup" });
    wrap.appendChild(
      el("button", {
        class: "assistant-popup-close",
        type: "button",
        "aria-label": "close",
        text: "×",
        onclick: () => {
          assistantPopupDismissed = true;
          render();
        },
      })
    );
    wrap.appendChild(el("img", { class: "assistant-avatar", src: LOGO_DATAURL, alt: "Yushin" }));

    const thread = el("div", { class: "assistant-thread" });

    if (!assistantConversationOpen) {
      // Eerste bericht: enkel een vraag + keuzemenu, geen inhoud.
      thread.appendChild(el("div", { class: "assistant-speech", text: ui("assistantAskShowPlan") }));
      const menu = el("div", { class: "assistant-menu" });
      menu.appendChild(
        el("button", {
          class: "assistant-menu-btn",
          type: "button",
          text: ui("assistantShowPlanBtn"),
          onclick: () => {
            assistantConversationOpen = true;
            render();
          },
        })
      );
      menu.appendChild(
        el("button", {
          class: "assistant-menu-btn assistant-menu-btn-secondary",
          type: "button",
          text: ui("assistantDismissBtn"),
          onclick: () => {
            assistantPopupDismissed = true;
            render();
          },
        })
      );
      thread.appendChild(menu);
    } else {
      // Gesprek geopend (taak #91), maar toont bewust NIET meteen alle
      // inhoud (taak #92): eerst enkel de patroon-titels als keuzemenu.
      // Reeds aangeklikte titels blijven als losse chatbubbel staan (in de
      // volgorde waarin ze geopend zijn), zodat de thread aanvoelt als een
      // doorlopend gesprek; het menu met de resterende titels staat
      // steeds onderaan, als eerstvolgende actie — net als quick-reply-
      // knoppen in een chatapp.
      thread.appendChild(el("div", { class: "assistant-speech", text: ui("assistantChooseTitle") }));

      assistantOpenedPatterns.forEach((idx) => {
        const m = therapyPlan.matched[idx];
        if (!m) return;
        const parts = [el("strong", { text: m.pattern })];
        if (m.mei_zin) parts.push(el("p", { text: m.mei_zin }));
        if (m.punten) parts.push(el("p", { text: `${t("therapyPlanPoints")}: ${m.punten}` }));
        if (m.leefstijl) parts.push(el("p", { text: `${t("therapyPlanLifestyle")}: ${m.leefstijl}` }));
        thread.appendChild(el("div", { class: "assistant-speech" }, parts));
      });
      if (assistantUnmatchedOpened && therapyPlan.unmatchedCount) {
        thread.appendChild(
          el("div", {
            class: "assistant-speech assistant-speech-muted",
            text: t("therapyPlanUnmatched")(therapyPlan.unmatchedCount),
          })
        );
      }

      const pendingTitles = [];
      therapyPlan.matched.forEach((m, idx) => {
        if (!assistantOpenedPatterns.includes(idx)) pendingTitles.push({ key: idx, label: m.pattern });
      });
      if (therapyPlan.unmatchedCount && !assistantUnmatchedOpened) {
        pendingTitles.push({ key: "unmatched", label: ui("assistantUnmatchedTitle") });
      }
      if (pendingTitles.length) {
        const menu = el("div", { class: "assistant-menu" });
        pendingTitles.forEach(({ key, label }) => {
          menu.appendChild(
            el("button", {
              class: "assistant-menu-btn",
              type: "button",
              text: label,
              onclick: () => {
                if (key === "unmatched") assistantUnmatchedOpened = true;
                else assistantOpenedPatterns = [...assistantOpenedPatterns, key];
                render();
              },
            })
          );
        });
        thread.appendChild(menu);
      }
    }

    wrap.appendChild(thread);
    return wrap;
  }

  // --- Scherm: interview ----------------------------------------------------

  function startInterview() {
    answers = {};
    currentQuestion = null;
    flowError = "";
    // Een ECHTE nieuwe sessie herstelt altijd de volledige resultaatweergave
    // (i.t.t. handleAutoDemoClick hieronder, dat dit bewust op true zet).
    autoDemoActive = false;
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
      redFlags = data.redFlags || [];
      // NOODSIGNAAL (tier "hard") — de flow stopt hier bewust: currentQuestion
      // wordt NIET bijgewerkt naar de volgende vraag (die blijft dus
      // onbereikbaar/onbeantwoord), enkel de overlay wordt getoond. Zonder
      // deze vroege return zou de interview-flow gewoon naar de volgende
      // vraag doorlopen terwijl de blokkerende melding er toevallig
      // bovenop ligt — het chooseOption()-guard hierboven voorkomt dan wel
      // een VOLGEND antwoord, maar de vraag zelf zou al onterecht
      // verspringen. Zie redflag-block-test.mjs scenario 1.
      if (redFlags.some((f) => f.tier === "hard")) {
        render();
        return;
      }
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
    // Spoor 1.4 (taak #104/#105) — functionele blokkade, niet enkel
    // visueel. De redflag-overlay ligt weliswaar bovenop de rest van de
    // pagina (CSS z-index), maar dat houdt enkel echte muisklikken tegen;
    // een onderliggende knop blijft anders technisch nog aanklikbaar/
    // programmatisch bereikbaar (bv. toetsenbordnavigatie, of automatische
    // tests — zie de bugfix-toelichting bij dit commit). Zolang er een
    // tier "hard" (NOODSIGNAAL) redFlag actief is, mag chooseOption() dus
    // sowieso niets versturen, ongeacht hoe de aanroep tot stand kwam.
    if (redFlags.some((f) => f.tier === "hard")) return;

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
      redFlags = data.result.redFlags || [];
      assistantPopupDismissed = false;
      assistantConversationOpen = false;
      assistantOpenedPatterns = [];
      assistantUnmatchedOpened = false;
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

    // Spoor 3.1 van het Verbeterplan (taak #110) — UI-zichtbare intended-use
    // / disclaimerverklaring. Staat hier bewust bovenaan het rapport, vóór
    // de patronen, en altijd zichtbaar (ook in de noPatterns-tak hieronder)
    // — dit is precies het gat dat Spoor 3.1 signaleerde: er stond nog
    // nergens in de nieuwe SaaS-client een zichtbare disclaimer, enkel in
    // het (niet meer gebruikte) contract-/legal-concept-document.
    wrap.appendChild(el("p", { class: "muted intended-use-statement", text: t("intendedUseStatement") }));

    // Welke patronen effectief als kaart in het rapport verschijnen — bv.
    // begrensd tot 5 tijdens de demo-cap (taak #90). Buiten het if/else
    // gedeclareerd zodat het therapieplan-blok hieronder er ook bij kan: de
    // Yushin-assistent mag NOOIT een voorstel aanbieden voor een patroon dat
    // de therapeut hier niet ook effectief ziet staan.
    let patternsToShow = resultData.patterns;

    if (!resultData.patterns.length) {
      wrap.appendChild(el("p", { text: t("noPatterns") }));
    } else {
      wrap.appendChild(el("p", { class: "conclusion", text: t("allDone") }));

      const maxCount = resultData.patterns[0].count || 1;
      // Demo-cap (taak #90): tijdens de automatische demo-invulling tonen
      // we bewust maximaal 5 bevindingen — genoeg om een prospect snel een
      // indruk te geven van wat de app doet, zonder de volle, mogelijk
      // langere lijst te moeten doorscrollen. Bij een echte sessie
      // (autoDemoActive === false) blijft dit gewoon de volledige lijst.
      patternsToShow = autoDemoActive ? resultData.patterns.slice(0, 5) : resultData.patterns;
      patternsToShow.forEach((p, idx) => {
        const card = el("div", { class: "result-card" + (idx === 0 ? " rank1" : "") });
        card.appendChild(
          el("h3", { text: `${p.pattern} — ${t(GROUP_KEY[p.group])} (${p.count}×)` })
        );
        card.appendChild(
          el("div", { class: "meter" }, [
            el("div", { class: "meter-fill", style: `width:${Math.round((p.count / maxCount) * 100)}%` }),
          ])
        );
        // Spoor 1.1 (taak #101/#105) — confidence-label, apart van de
        // group-tekst hierboven: zegt hoe duidelijk dit patroon zich
        // onderscheidt van het volgende in de ranglijst (score-afstand),
        // niet enkel hoe vaak het voorkwam.
        if (p.confidence) {
          card.appendChild(
            el("div", {
              class: "muted",
              text: `${t("confidencePrefix")}: ${t("confidence" + p.confidence[0].toUpperCase() + p.confidence.slice(1))}`,
            })
          );
        }
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

      if (autoDemoActive && resultData.patterns.length > patternsToShow.length) {
        wrap.appendChild(
          el("p", { class: "muted", text: ui("autoDemoCapped")(patternsToShow.length, resultData.patterns.length) })
        );
      }

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

      // Spoor 1.3 (taak #103/#105) — contradictiedetectie. Server stuurt
      // enkel iets mee voor de therapeut-rol + NL-sessies (zie flow.js);
      // hier dus gewoon niets renderen als de array leeg is.
      if (resultData.contradictions && resultData.contradictions.length) {
        const contraCard = el("div", { class: "result-card" });
        contraCard.appendChild(el("h3", { text: t("contradictionsSectionTitle") }));
        resultData.contradictions.forEach((c) => {
          const item = el("div", { class: "redflag-item" + (c.tier === "nuance" ? " redflag-item-soft" : "") });
          item.appendChild(
            el("strong", { text: `"${c.patternA}" (${c.countA}×) ↔ "${c.patternB}" (${c.countB}×)` })
          );
          item.appendChild(el("span", { text: c.note }));
          contraCard.appendChild(item);
        });
        if (resultData.contradictionNote) {
          contraCard.appendChild(el("p", { class: "muted", text: resultData.contradictionNote }));
        }
        wrap.appendChild(contraCard);
      }

      // Spoor 1.2 (taak #102/#105) — vervolgvragen-detectie. Enkel gevuld
      // als er dicht-bij-elkaar scorende patronen zijn ÉN er onbeantwoorde/
      // overgeslagen vragen bestaan die daartussen zouden discrimineren
      // (zie suggestDiscriminatingQuestions in flowEngine.js) — in de
      // huidige client (geen instellingenpaneel, taak #72-scopekeuze) komt
      // dit vooral voor bij vragen die door een `requires`-gate onbereikbaar
      // bleven.
      if (resultData.suggestedQuestions && resultData.suggestedQuestions.length) {
        const suggestCard = el("div", { class: "result-card" });
        suggestCard.appendChild(el("h3", { text: t("suggestedQuestionsTitle") }));
        suggestCard.appendChild(el("p", { class: "muted", text: t("suggestedQuestionsIntro") }));
        const ul = el("ul");
        resultData.suggestedQuestions.forEach((sq) => {
          const [a, b] = sq.discriminatesBetween;
          ul.appendChild(
            el("li", { text: `${sq.questionText} — ${t("suggestedQuestionsDiscriminates")(a, b)}` })
          );
        });
        suggestCard.appendChild(ul);
        wrap.appendChild(suggestCard);
      }
    }

    if (resultData.therapyPlan) {
      // Therapieplan-voorstel (taak #91) — verschijnt bewust NIET meer
      // standaard in de resultatentekst. De Yushin-assistent-pop-up stelt
      // eerst een keuzemenu voor; enkel als de therapeut expliciet "Ja,
      // toon het voorstel" kiest, verschijnt de inhoud alsnog — dan als
      // losse chatberichten in de pop-up, in de stijl van een doorlopend
      // WhatsApp-gesprek. Zie renderAssistantPopup hieronder.
      //
      // Bugfix (naar aanleiding van Danny's feedback): de assistent mag
      // ENKEL voorstellen aanbieden voor patronen die ook echt in het
      // rapport hierboven te zien zijn. resultData.therapyPlan komt van de
      // server en is intussen al beperkt tot dezelfde top-8 als
      // resultData.patterns (zie flow.js), maar hier filteren we bovendien
      // nog eens op patternsToShow — nodig voor de demo-cap (taak #90),
      // waar het rapport tot 5 kaarten wordt afgekapt terwijl de server tot
      // 8 patronen meestuurt. Zonder deze filter zou de assistent tijdens
      // een demo een titel kunnen tonen voor een patroon dat helemaal niet
      // zichtbaar is in het (afgekapte) rapport.
      const shownPatternNames = new Set(patternsToShow.map((p) => p.pattern));
      const isReportTruncated = patternsToShow.length < resultData.patterns.length;
      const visibleTherapyPlan = {
        matched: resultData.therapyPlan.matched.filter((m) => shownPatternNames.has(m.pattern)),
        // De "overige bevindingen"-samenvatting (unmatchedCount) is enkel
        // betrouwbaar toe te schrijven aan patronen die de therapeut ook
        // effectief ziet — bij een afgekapt rapport laten we die daarom
        // weg i.p.v. te gokken of ze binnen of buiten beeld vallen.
        unmatchedCount: isReportTruncated ? 0 : resultData.therapyPlan.unmatchedCount,
      };
      const bubble = renderAssistantPopup(visibleTherapyPlan);
      if (bubble) wrap.appendChild(bubble);
    }

    // Taak #111 — vaste rapportfooter met de niet-medische positionering
    // (Yushin_DPA_Privacy_SaaS_NietMedische_Positionering_PreLegal_v2.xlsx,
    // tabblad D, rij 10: "Rapport bevat vaste footer met niet-medische
    // positionering"). Losse, kortere tekst dan de intendedUseStatement
    // bovenaan — bewust nog een keer onderaan, zodat het rapport ook als
    // afzonderlijk gedeelde/afgedrukte pagina altijd deze context toont.
    wrap.appendChild(el("p", { class: "muted intended-use-footer", text: t("intendedUseFooter") }));

    wrap.appendChild(
      el("button", {
        class: "btn btn-primary",
        text: ui("restart"),
        onclick: restartSession,
      })
    );

    return wrap;
  }

  // --- Automatische demo-invulling (taak #90) --------------------------------
  // Herbouwde SaaS-versie van autoFillDemo() uit de oude client-side tool
  // (tcm_10plus2_chatbot.html): klikt telkens de eerste antwoordoptie aan
  // tot het resultaatscherm bereikt is, zodat een prospect in een paar
  // seconden een indruk krijgt van de app zonder de vragenlijst manueel te
  // moeten doorlopen. Bewust enkel zichtbaar/bruikbaar op het demo-account
  // (isDemoAccount) — nooit voor een echte praktijk tijdens een echt
  // consult (zie ook de confirm()-waarschuwing in handleAutoDemoClick).

  function isDemoAccount() {
    return !!(currentUser && currentUser.email === DEMO_CREDENTIALS.email);
  }

  async function handleAutoDemoClick() {
    if (autoDemoBusy) return;
    if (!confirm(ui("autoDemoConfirm"))) return;

    autoDemoBusy = true;
    autoDemoActive = true;

    // Vanaf een intro-stap (taal/rol/geslacht/pediatrisch/label) kiezen we
    // vaste, neutrale standaardwaarden (therapeut-rol, volwassene) en
    // starten meteen de interview — zo werkt de knop ook al vóór de eerste
    // echte vraag, net als in de oude tool. We hergebruiken startInterview()
    // hier bewust NIET, omdat die autoDemoActive terug op false zet.
    if (screen !== "interview") {
      context.role = context.role || "therapeut";
      context.female = context.female === null ? false : context.female;
      context.pediatric = context.pediatric === null ? false : context.pediatric;
      patientLabelInput = patientLabelInput || "DEMO";
      answers = {};
      currentQuestion = null;
      flowError = "";
      screen = "interview";
      render();
      await fetchNext();
    } else {
      render();
    }

    let guard = 0;
    while (screen === "interview" && currentQuestion && guard++ < 200) {
      // Bugfix (na klantfeedback): niet blindelings options[0] kiezen. De
      // veiligheidscontrole (sectie s0safety, taak #104) heeft per vraag als
      // EERSTE optie steeds het ernstigste NOODSIGNAAL-antwoord staan (bv.
      // "Plotse verlamming, spraakverlies of scheve mond"), dus options[0]
      // triggerde tijdens de demo-autofill gegarandeerd meteen een
      // blokkerende hard-redFlag-melding. We kiezen daarom de eerste optie
      // ZONDER redFlag-koppeling (voor de veiligheidsvragen is dat steeds
      // "Geen van deze"); voor alle overige, normale vragen (die geen enkele
      // optie met .redFlag hebben) blijft dit gewoon options[0], identiek
      // aan het oude gedrag.
      const opts = currentQuestion.question.options;
      const opt = opts.find((o) => !o.redFlag) || opts[0];
      await chooseOption(opt.index);
    }

    autoDemoBusy = false;
    render();
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

  // --- Scherm: toegangspoort (taak #118) ----------------------------------
  //
  // Dit is de daadwerkelijke vervanging van de automatische proefperiode: zo
  // lang orgInfo.subscriptionStatus === "trialing" toont render() (zie
  // hierboven) ALTIJD dit scherm (eigenaar) of renderLocked() (overig
  // teamlid) in plaats van het scherm dat de gebruiker eigenlijk wilde
  // bereiken. De server blijft de echte grens (isTrialLimitReached in
  // trial.js + de aparte check in accessCodes.js) — dit is enkel de
  // client-routering, bedoeld om iemand meteen naar de juiste actie te
  // sturen i.p.v. pas na een mislukte serveraanvraag.

  function renderGateLoading() {
    return el("div", { class: "card" }, [el("p", { class: "muted", text: ui("loading") })]);
  }

  // Enkel getoond aan NIET-eigenaars (uitgenodigde teamleden): zij kunnen
  // zelf niets ontgrendelen — /api/billing/checkout en
  // /api/access-code/redeem staan in index.js allebei op auth:"owner". Dus
  // enkel een duidelijke boodschap, geen actie-knoppen.
  function renderLocked() {
    const wrap = el("div", { class: "card" });
    wrap.appendChild(el("h2", { text: ui("gateTitle") }));
    wrap.appendChild(el("p", { text: ui("lockedMessage") }));
    return wrap;
  }

  async function handleRedeemCode() {
    if (!gateCodeValue.trim()) return;
    gateBusy = true;
    gateError = "";
    render();
    try {
      const data = await api("/api/access-code/redeem", "POST", { code: gateCodeValue.trim() });
      gateCodeValue = "";
      if (data.kind === "free") {
        // Meteen ontgrendeld — orgInfo lokaal bijwerken i.p.v. opnieuw op te
        // vragen, zodat de poort direct verdwijnt in dezelfde render().
        orgInfo = { ...orgInfo, subscriptionStatus: "active", plan: data.plan };
        screen = "intro";
        introStep = "lang";
      } else {
        // kind === "discount": de organisatie blijft "trialing" (dus de
        // poort blijft actief) — enkel het bedrag bij de eerstvolgende
        // checkout is nu lager. Stuur meteen door naar het
        // abonnementsscherm (dat blijft, zoals hierboven, uitgezonderd van
        // de poort) zodat de eigenaar meteen kan afrekenen; renderBilling()
        // toont daar de kortingsmelding op basis van orgInfo.discountPercent.
        orgInfo = { ...orgInfo, discountPercent: data.discountPercent };
        screen = "billing";
      }
    } catch (err) {
      gateError = err.message;
    } finally {
      gateBusy = false;
      render();
    }
  }

  function renderGate() {
    const wrap = el("div", { class: "card" });
    wrap.appendChild(el("h2", { text: ui("gateTitle") }));
    wrap.appendChild(el("p", { text: ui("gateIntro") }));

    wrap.appendChild(
      el("button", {
        class: "btn btn-primary",
        text: ui("gateViewPlansBtn"),
        onclick: () => {
          screen = "billing";
          render();
        },
      })
    );

    wrap.appendChild(el("p", { class: "muted gate-or", text: ui("gateOrDivider") }));

    const form = el("form", {
      class: "gate-code-form",
      onsubmit: (e) => {
        e.preventDefault();
        handleRedeemCode();
      },
    });
    form.appendChild(
      el("div", { class: "field" }, [
        el("label", { text: ui("gateCodeLabel") }),
        el("input", {
          type: "text",
          value: gateCodeValue,
          oninput: (e) => (gateCodeValue = e.target.value),
        }),
      ])
    );
    form.appendChild(
      el("button", {
        class: "btn btn-ghost",
        type: "submit",
        text: gateBusy ? ui("loading") : ui("gateCodeButton"),
        disabled: gateBusy ? "disabled" : undefined,
      })
    );
    wrap.appendChild(form);

    if (gateError) wrap.appendChild(el("div", { class: "error", text: gateError }));

    return wrap;
  }

  // --- Scherm: abonnement (taak #117) -------------------------------------
  //
  // Start de Mollie-checkout voor een gekozen plan-sleutel. De sleutel is
  // enkel een NAAM ("solo"/"team"/"solo_yearly"/"team_yearly") — het bedrag
  // wordt, zoals overal in deze app, altijd server-side opgezocht (zie
  // handleStartCheckout in src/routes/billing.js). redirectUrl wijst terug
  // naar de huidige pagina; bij terugkeer haalt de bestaande
  // token-bootstrap-logica (onderaan dit bestand) orgInfo automatisch
  // opnieuw op, dus de status/plan-weergave hier klopt vanzelf weer bij.
  async function handleChoosePlan(planKey) {
    billingBusy = true;
    billingError = "";
    render();
    try {
      const redirectUrl = location.origin + location.pathname;
      const data = await api("/api/billing/checkout", "POST", { plan: planKey, redirectUrl });
      if (!data || !data.checkoutUrl) {
        throw new Error("Geen checkout-URL ontvangen.");
      }
      location.href = data.checkoutUrl;
    } catch (err) {
      billingError = err.message;
      billingBusy = false;
      render();
    }
  }

  function renderBilling() {
    const wrap = el("div", { class: "card" });
    wrap.appendChild(el("h2", { text: ui("billingTitle") }));

    if (orgInfo) {
      const statusKey =
        orgInfo.subscriptionStatus === "active"
          ? "billingStatusActive"
          : orgInfo.subscriptionStatus === "past_due"
          ? "billingStatusPastDue"
          : "billingStatusTrialing";
      const statusLine = el("p", { class: "muted" });
      statusLine.appendChild(el("strong", { text: ui("billingCurrentPlanLabel") + ": " }));
      statusLine.appendChild(document.createTextNode(ui(statusKey)));
      wrap.appendChild(statusLine);
    }

    // Taak #118: kortingsmelding — puur informatief, hetzelfde principe als
    // discountPercent zelf (zie organization.js): het daadwerkelijk
    // afgerekende bedrag wordt hoe dan ook server-side herberekend
    // (applyDiscount in billing.js), dit is enkel om vooraf duidelijk te
    // maken dat een ingevoerde kortingscode geregistreerd staat.
    if (orgInfo && orgInfo.discountPercent) {
      wrap.appendChild(el("div", { class: "gate-discount-notice", text: ui("gateDiscountApplied")(orgInfo.discountPercent) }));
    }

    if (billingError) wrap.appendChild(el("div", { class: "error", text: billingError }));

    // Maandelijks/jaarlijks-toggel — bepaalt enkel welke plan-sleutel de
    // "Kies dit abonnement"-knop straks meestuurt.
    const toggle = el("div", { class: "lang-switch" });
    [
      { code: "monthly", label: ui("billingIntervalMonthly") },
      { code: "yearly", label: ui("billingIntervalYearly") },
    ].forEach(({ code, label }) => {
      toggle.appendChild(
        el("button", {
          class: "lang-btn" + (billingInterval === code ? " active" : ""),
          text: label,
          onclick: () => {
            billingInterval = code;
            render();
          },
        })
      );
    });
    wrap.appendChild(toggle);

    const cardRow = el("div", { class: "plan-cards" });
    PLAN_CATALOG.forEach((plan) => {
      const planKey = billingInterval === "yearly" ? plan.yearlyKey : plan.monthlyKey;
      const price = billingInterval === "yearly" ? plan.yearlyPrice : plan.monthlyPrice;
      const per = billingInterval === "yearly" ? ui("billingIntervalYearly") : ui("billingIntervalMonthly");
      const isCurrent = orgInfo && orgInfo.plan === planKey && orgInfo.subscriptionStatus !== "trialing";

      const card = el("div", { class: "card plan-card" });
      card.appendChild(el("h3", { text: ui(plan.nameKey) }));
      card.appendChild(el("p", { class: "muted", text: ui(plan.descKey) }));
      card.appendChild(el("p", { class: "plan-price", text: price }));
      card.appendChild(el("p", { class: "muted", text: per }));
      card.appendChild(
        el("button", {
          class: "btn btn-primary",
          text: isCurrent ? ui("billingCurrentPlanBtn") : billingBusy ? ui("billingChoosingBusy") : ui("billingChoosePlanBtn"),
          disabled: isCurrent || billingBusy ? "disabled" : undefined,
          onclick: () => handleChoosePlan(planKey),
        })
      );
      cardRow.appendChild(card);
    });
    wrap.appendChild(cardRow);

    wrap.appendChild(el("p", { class: "muted billing-education-note", text: ui("billingEducationNote") }));

    return wrap;
  }

  // --- Scherm: referenties (placeholder, 03/09) ---------------------------
  // Enkel de sectie zelf: geen data-ophaling, geen inhoud. De klassieke
  // bronteksten (Huangdi Neijing/Nanjing, al goedgekeurd en uitgewerkt in de
  // ontwerp-prototype yushin-app-shell-prototype.html) worden in een latere
  // taak effectief overgezet naar hier.
  function renderReferences() {
    const wrap = el("div", { class: "card" });
    wrap.appendChild(el("h2", { text: ui("referencesTitle") }));
    wrap.appendChild(el("p", { class: "muted", text: ui("referencesPlaceholder") }));
    return wrap;
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
  // Code voor het verborgen "Demo-toegang?"-veld op het landingsscherm
  // (renderDemoCodeBlock/submitDemoCode hierboven, taak #87) — bewust apart
  // van DEMO_CREDENTIALS: dit is geen wachtwoord voor het demo-account zelf,
  // enkel een korte, makkelijk te onthouden/deel-bare toegangscode voor
  // tijdens een live demo.
  const DEMO_ACCESS_CODE = "yushin2026";

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
