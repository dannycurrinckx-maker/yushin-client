// Client <-> server INTEGRATIE-test (taak #72), niet enkel een UI-smoke-test.
//
// Dit stubt `fetch` zodat elke aanroep die app.js doet rechtstreeks naar de
// ECHTE Worker-router (src/index.js) gaat, tegen een echte SQLite-gebaseerde
// D1-shim (tests/fake-d1.js) — exact dezelfde combinatie als de
// server-testsuite (tests/flow.test.js), maar nu aangestuurd via de
// daadwerkelijke client-knoppen/click-handlers i.p.v. rechtstreekse
// fetch()-aanroepen. Dit is de sterkste garantie die in deze sandbox
// mogelijk is dat client en server elkaars contract (request/response-vorm,
// key-formaat, therapyPlan-structuur, enz.) correct volgen — een echte
// browser + `wrangler dev` kan hier niet draaien (geen npm-registrytoegang).
//
// Uitvoeren met: node client/integration-test.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createFakeD1 } from "../tests/fake-d1.js";
import worker from "../src/index.js";
import { handleRegister } from "../src/routes/auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- Minimale DOM-shim (zelfde als smoke-test.mjs) -------------------------
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
}
function createElement(tag) { return new FakeElement(tag); }
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

// --- Server-omgeving: echte router + echte SQLite-gebaseerde D1-shim ------
const env = { DB: createFakeD1(), APP_ENV: "test" };

global.document = fakeDocument;
global.localStorage = fakeLocalStorage;
global.window = global;
global.fetch = async (url, options = {}) => {
  const req = new Request(url, options);
  return worker.fetch(req, env, {});
};
// Taak #118: de bootstrap onderaan app.js leest location.search (?demo=1).
// Hier is `token` altijd al gezet vóór de eval (zie storage[...] hieronder),
// dus dat pad wordt in deze test niet echt bereikt, maar de stub kost niets
// en voorkomt een ReferenceError als dat ooit verandert.
global.location = { search: "", origin: "https://x", pathname: "/", href: "https://x/" };

// Registreer een praktijk vooraf (via de echte handler, buiten de client om
// — net zoals een gebruiker dat via het registratiescherm zou doen; we doen
// het hier direct om de test kort te houden) en zet het token + user alvast
// klaar in de fake localStorage, zodat de client meteen op het intro-scherm
// start (net als na een succesvolle login/registratie).
const regRes = await handleRegister(
  new Request("https://x/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      organizationName: "Praktijk Integratietest",
      contactEmail: "integratie@example.com",
      ownerName: "Integratie Tester",
      password: "correcthorsebattery",
    }),
  }),
  env
);
const regData = await regRes.json();
storage["yushin_token"] = regData.token;
storage["yushin_user"] = JSON.stringify(regData.user);
storage["yushin_api_base"] = "https://x"; // wordt genegeerd, want fetch is volledig gestubt

// Taak #118: een gloednieuwe organisatie start 'trialing' (dus geblokkeerd
// door de poort — zie render() in app.js) tot er betaald is of een
// toegangscode ingewisseld werd. Voor DEZE test (die de intro-/vragenflow
// zelf test, niet de poort) activeren we de organisatie hier rechtstreeks
// in de database, net als in tests/flow.test.js.
await env.DB
  .prepare("UPDATE organizations SET subscription_status = 'active' WHERE id = ?")
  .bind(regData.organization.id)
  .run();

// --- Laad de client-scripts -------------------------------------------------
const stringsSrc = fs.readFileSync(path.join(__dirname, "strings.js"), "utf8");
const organClockSrc = fs.readFileSync(path.join(__dirname, "organClock.js"), "utf8");
const appSrc = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
(0, eval)(stringsSrc + "\n" + organClockSrc + "\n" + appSrc);

// Taak #118: de bootstrap hierboven roept (omdat er al een token in de fake
// localStorage staat) fetchOrganizationInfo() aan zonder daarop te wachten
// (fire-and-forget), gevolgd door een render() die zolang orgInfo nog null
// is het laadscherm van de poort toont i.p.v. het taalkeuzescherm. Die
// aanroep gaat hier via de ECHTE worker + D1 (geen gestubte fetch zoals in
// smoke-test.mjs), dus een korte macrotask-wachtbeurt is nodig om de keten
// (fetch -> worker.fetch -> D1 -> render) te laten afronden vóór de eerste
// klik hieronder.
await new Promise((r) => setTimeout(r, 20));

function findButtons(el, out) {
  if (el.tagName === "button") out.push(el);
  (el.children || []).forEach((c) => findButtons(c, out));
}
function clickButtonWithText(text) {
  const found = [];
  findButtons(fakeDocument._root, found);
  const match = found.find((b) => b._text === text);
  if (!match) throw new Error(`Geen knop gevonden met tekst "${text}"`);
  return match._listeners.click();
}
function clickFirstOptionButton() {
  const found = [];
  findButtons(fakeDocument._root, found);
  const optionButtons = found.filter((b) => b._attrs.class && b._attrs.class.includes("opt-btn"));
  // Spoor 1.4 (taak #104) — de nieuwe veiligheidscontrole (sectie
  // "s0safety") staat nu vooraan in de flow. Als deze happy-path-test
  // gewoon "altijd de eerste optie" zou blijven klikken, zou dat op de
  // allereerste vraag al de zwaarste NOODSIGNAAL-optie triggeren en de rest
  // van deze (bewust bredere) end-to-end-test blokkeren — zie
  // redflag-block-test.mjs voor de gerichte test van dat blokkeer-gedrag
  // zelf. Hier kiezen we daarom expliciet "Geen van deze" wanneer die
  // optie aanwezig is in de huidige vraag, zodat de rest van de vragenlijst
  // (en dus de bestaande regressiedekking) ongewijzigd blijft functioneren.
  const noneOption = optionButtons.find((b) => b._text === "Geen van deze");
  const opt = noneOption || optionButtons[0];
  if (!opt) throw new Error("Geen optie-knop gevonden om op te klikken.");
  return opt._listeners.click();
}
function collectText(el, out) {
  if (el._text) out.push(el._text);
  (el.children || []).forEach((c) => collectText(c, out));
}
function renderedText() {
  const out = [];
  collectText(fakeDocument._root, out);
  return out.join(" | ");
}
async function settle() {
  // De click-handlers zijn async (roepen fetch aan, dat via de echte Worker
  // synchroon-genoeg afhandelt binnen microtasks) — een korte macrotask-wachtbeurt
  // is voldoende om de volledige keten (fetch -> worker.fetch -> D1 -> render) af te ronden.
  await new Promise((r) => setTimeout(r, 0));
}

// --- Doorloop de intro ------------------------------------------------------
clickButtonWithText("Nederlands");
clickButtonWithText("🩺 Ik ben de therapeut (volledige vragenlijst incl. polsdiagnose)");
clickButtonWithText("Vrouw");
clickButtonWithText("Ja, neem de pediatrie-sectie mee"); // volledige flow, inclusief pediatrie+gynaecologie+polsdiagnose

clickButtonWithText("Nieuwe anamnese starten");
await settle();

let currentText = renderedText();
if (currentText.includes("Kan de server niet bereiken")) {
  console.error("FOUT: de client kon de (gestubte) server niet bereiken — er zit een contractfout tussen client en server.");
  console.error(currentText);
  process.exit(1);
}

// Let op: STRINGS_BY_LANG zelf is niet vanuit deze module-scope bereikbaar
// (het is een `const` binnen de eval-scope hierboven, en top-level
// const/let/class-bindings uit indirect eval lekken niet naar de
// omringende scope — enkel `var`/function-declaraties zouden dat wel doen).
// Daarom gebruiken we hier de letterlijke NL-teksten uit strings.js (al
// eerder in dit project geverifieerd, zie tests hierboven) i.p.v. ze
// dynamisch op te vragen.
// Taak #111 (niet-medische positionering) — reportTitle en de
// assistant-popup-copy zijn herzien; deze constanten volgen die wijziging.
const REPORT_TITLE_NL = "TCM Patroonoverzicht";
const CLOCK_CARD_TITLE_NL = "Orgaanklok — jouw aandachtspunten";
const THERAPY_PLAN_ASK_NL = "Wil je dat ik traditionele referentie-informatie toon voor dit patroon?";

// --- Doorloop de volledige vragenlijst (klik telkens de eerste optie) -----
const MAX_STEPS = 300;
let steps = 0;
while (steps < MAX_STEPS) {
  const text = renderedText();
  if (text.includes(REPORT_TITLE_NL)) break; // resultatenscherm bereikt
  if (text.includes("FOUT") || text.startsWith("Kan de server")) {
    console.error("FOUT tijdens het doorlopen van de vragenlijst:", text);
    process.exit(1);
  }
  clickFirstOptionButton();
  await settle();
  steps += 1;
}
if (steps >= MAX_STEPS) {
  console.error("FOUT: resultatenscherm niet bereikt binnen", MAX_STEPS, "stappen — mogelijk oneindige lus.");
  process.exit(1);
}

console.log(`Vragenlijst doorlopen in ${steps} stappen. Resultatenscherm bereikt.`);

const finalText = renderedText();
console.log("\nGerenderde tekst-fragmenten (resultatenscherm):");
console.log(finalText.slice(0, 800) + (finalText.length > 800 ? " …" : ""));

const mustContainOnResults = [REPORT_TITLE_NL, CLOCK_CARD_TITLE_NL];
const missing = mustContainOnResults.filter((s) => !finalText.includes(s));
if (missing.length) {
  console.error("FOUT: verwachte secties ontbreken op het resultatenscherm:", missing);
  process.exit(1);
}
// Therapeut-rol + NL -> therapieplan-titel moet aanwezig zijn (tenzij toevallig
// geen enkel patroon matchte, wat met "eerste optie steeds"-antwoorden
// statistisch zeer onwaarschijnlijk is over 78 vragen).
if (!finalText.includes(THERAPY_PLAN_ASK_NL)) {
  console.warn("WAARSCHUWING: geen referentie-informatie-sectie gerenderd (kan kloppen als toevallig geen enkel herkend patroon matcht in de therapieplan-data).");
}

console.log("\nINTEGRATIETEST GESLAAGD: de client doorloopt de volledige anamnese via de ECHTE serverroutes (auth, flow/next, flow/answer, flow/result) en rendert een correct resultatenscherm.");
