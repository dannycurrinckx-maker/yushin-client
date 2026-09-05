// Eenmalige, lokale smoke-test voor de client (GEEN onderdeel van npm test —
// dit is geen jsdom/echte browser, enkel een minimale eigen DOM-shim om te
// controleren dat app.js foutloos laadt en het eerste scherm rendert zonder
// te crashen. Een echte eind-tot-eind test (in een browser, tegen een
// draaiende `wrangler dev`) kan in deze sandbox niet — zie README.md
// "Wat nog ontbreekt" voor de reden (geen npm-registrytoegang, dus wrangler
// kan hier niet draaien). Uitvoeren met: node client/smoke-test.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- Minimale DOM-shim -----------------------------------------------------
class FakeClassList {
  constructor(el) { this.el = el; }
}
class FakeElement {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this._attrs = {};
    this._text = "";
    this._html = "";
    this._listeners = {};
    this.style = {};
  }
  appendChild(child) { this.children.push(child); return child; }
  setAttribute(k, v) { this._attrs[k] = v; }
  addEventListener(evt, fn) { this._listeners[evt] = fn; }
  get textContent() { return this._text; }
  set textContent(v) { this._text = v; this.children = []; }
  get innerHTML() { return this._html; }
  set innerHTML(v) { this._html = v; this.children = []; }
  set className(v) { this._attrs.class = v; }
  get className() { return this._attrs.class || ""; }
  set value(v) { this._value = v; }
  get value() { return this._value || ""; }
  set name(v) { this._attrs.name = v; }
  get name() { return this._attrs.name; }
  // ondersteunt form.email.value-stijl toegang zoals in app.js gebruikt
}

function createElement(tag) {
  const el = new FakeElement(tag);
  return el;
}

const fakeDocument = {
  _root: null,
  createElement,
  createTextNode: (text) => ({ nodeType: 3, text }),
  getElementById: (id) => {
    if (id === "app") {
      if (!fakeDocument._root) fakeDocument._root = createElement("div");
      return fakeDocument._root;
    }
    return null;
  },
};

let storage = {};
const fakeLocalStorage = {
  getItem: (k) => (k in storage ? storage[k] : null),
  setItem: (k, v) => { storage[k] = String(v); },
  removeItem: (k) => { delete storage[k]; },
};

global.document = fakeDocument;
global.localStorage = fakeLocalStorage;
global.window = global;
// Taak #118: de poort (render() in app.js) toont een laadscherm zolang
// orgInfo nog null is, en wacht daarvoor op GET /api/organization. Die ene
// aanroep moet dus WEL iets teruggeven (een actieve organisatie, zodat de
// rest van deze smoke test — de intro-flow doorlopen — kan verdergaan);
// alle andere endpoints (bv. /api/flow/next) falen bewust nog steeds, om te
// controleren dat een onbereikbare server daar netjes wordt opgevangen.
global.fetch = async (url) => {
  if (typeof url === "string" && url.includes("/api/organization")) {
    return {
      ok: true,
      json: async () => ({
        organization: { id: "org1", name: "Smoke Test Praktijk", plan: "solo", subscriptionStatus: "active", createdAt: "2026-01-01" },
      }),
    };
  }
  throw new Error("fetch not stubbed in smoke test");
};
// Taak #118: de bootstrap-code onderaan app.js leest bij het laden altijd
// location.search (voor de ?demo=1-snelkoppeling), ook als er nog geen
// token is — dus deze stub is nodig zelfs voor het allereerste (uitgelogde)
// scherm, niet enkel voor de "ingelogde staat"-herlaad verderop.
global.location = { search: "", origin: "https://smoke-test.example", pathname: "/", href: "https://smoke-test.example/" };

// --- Laad de drie bestanden in dezelfde volgorde als index.html -----------
const stringsSrc = fs.readFileSync(path.join(__dirname, "strings.js"), "utf8");
const organClockSrc = fs.readFileSync(path.join(__dirname, "organClock.js"), "utf8");
const appSrc = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");

// Alle drie zijn klassieke (niet-module) scripts die top-level `const`/IIFE
// gebruiken — evalueren in dezelfde globale scope zoals <script>-tags dat ook
// zouden doen.
try {
  (0, eval)(stringsSrc + "\n" + organClockSrc + "\n" + appSrc);
} catch (err) {
  console.error("FOUT bij laden van de client-scripts:", err);
  process.exit(1);
}

const root = fakeDocument._root;
if (!root) {
  console.error("FOUT: #app werd niet gerenderd.");
  process.exit(1);
}

function collectText(el, out) {
  if (el._text) out.push(el._text);
  (el.children || []).forEach((c) => collectText(c, out));
}
const texts = [];
collectText(root, texts);
const joined = texts.join(" | ");

console.log("Gerenderde tekst-fragmenten (auth-scherm, geen token):");
console.log(joined);

const mustContain = ["Yushin", "Inloggen", "E-mailadres", "Wachtwoord"];
const missing = mustContain.filter((s) => !joined.includes(s));
if (missing.length) {
  console.error("FOUT: verwachte tekst ontbreekt in het gerenderde auth-scherm:", missing);
  process.exit(1);
}

// --- Simuleer een reeds ingelogde gebruiker + doorloop de intro-stappen ----
// (taal -> rol -> geslacht -> pediatrisch -> label), puur door de opgeslagen
// onclick-handlers rechtstreeks aan te roepen (zoals een klik dat zou doen).
// Dit dekt de synchrone state-machine-logica; de daadwaardelijke
// netwerkaanroep (fetchNext) faalt bewust in deze stub-omgeving (geen echte
// server), maar mag de app niet laten crashen — enkel een foutmelding tonen.
storage["yushin_token"] = "fake-token-for-smoke-test";
storage["yushin_user"] = JSON.stringify({ id: "u1", name: "Smoke Tester", email: "smoke@example.com", role: "owner" });

function findButtonByText(el, text, out) {
  if (el.tagName === "button" && el._text === text) out.push(el);
  (el.children || []).forEach((c) => findButtonByText(c, text, out));
}
function clickButtonWithText(root, text) {
  const found = [];
  findButtonByText(root, text, found);
  if (!found.length) throw new Error(`Geen knop gevonden met tekst "${text}"`);
  found[0]._listeners.click();
}

// Herlaad de app in "ingelogde" staat (een nieuwe module-evaluatie, want de
// vorige IIFE heeft al zijn eigen closure-state).
fakeDocument._root = null;
try {
  (0, eval)(stringsSrc + "\n" + organClockSrc + "\n" + appSrc);
} catch (err) {
  console.error("FOUT bij herladen (ingelogde staat):", err);
  process.exit(1);
}

// Taak #118: fetchOrganizationInfo() (aangeroepen vanuit de bootstrap
// hierboven zodra token bekend is) loopt async — even wachten tot die
// resolvet en opnieuw gerenderd heeft, anders staat de DOM hier nog op het
// laadscherm van de poort (render() toont dat zolang orgInfo nog null is)
// i.p.v. het taalkeuzescherm.
await new Promise((r) => setTimeout(r, 20));

let root2 = fakeDocument._root;
try {
  clickButtonWithText(root2, "Nederlands");
  clickButtonWithText(fakeDocument._root, "🩺 Ik ben de therapeut (volledige vragenlijst incl. polsdiagnose)");
  clickButtonWithText(fakeDocument._root, "Vrouw");
  clickButtonWithText(fakeDocument._root, "Nee, overslaan");
} catch (err) {
  console.error("FOUT tijdens het doorlopen van de intro-flow:", err);
  process.exit(1);
}

const introTexts = [];
collectText(fakeDocument._root, introTexts);
const introJoined = introTexts.join(" | ");
console.log("\nGerenderde tekst-fragmenten (label-scherm na intro):");
console.log(introJoined);
if (!introJoined.includes("Dossiernummer/label")) {
  console.error("FOUT: label-scherm werd niet correct gerenderd na de intro-flow.");
  process.exit(1);
}

// Start-knop indrukken: dit triggert fetchNext() -> onze stub-fetch gooit een
// fout -> app.js moet dit opvangen en een foutmelding tonen, niet crashen.
try {
  clickButtonWithText(fakeDocument._root, "Nieuwe anamnese starten");
  await new Promise((r) => setTimeout(r, 20)); // even wachten op de async catch-afhandeling
} catch (err) {
  console.error("FOUT: het starten van de interview zonder bereikbare server crashte de app:", err);
  process.exit(1);
}
const afterStartTexts = [];
collectText(fakeDocument._root, afterStartTexts);
console.log("\nNa 'start interview' zonder bereikbare server (verwacht: nette foutmelding, geen crash):");
console.log(afterStartTexts.join(" | "));

console.log("\nSMOKE TEST GESLAAGD: app.js laadt zonder fouten, rendert het auth-scherm, doorloopt de intro-flow, en vangt een onbereikbare server netjes op.");
