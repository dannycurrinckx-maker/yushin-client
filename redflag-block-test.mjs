// Gerichte client<->server-test voor de veiligheidschecklist na
// MDR-veilig-lanceren (04/09, launch-blocker). Vervangt de vroegere
// "redflag-block-test.mjs" die het blokkerende NOODSIGNAAL-gedrag testte
// (sectie s0safety, tier "hard"/"soft" gekoppeld aan specifieke antwoorden —
// zie git-geschiedenis voor het origineel). Die koppeling met `answers` is
// bewust losgemaakt: de veiligheidschecklist is nu een statische lijst die
// de server ALTIJD teruggeeft (voor de therapeut-rol), ongeacht welke
// antwoorden ingevuld worden, en die de flow op geen enkel moment blokkeert.
//
// Deze test verifieert precies dat:
//   1. De sectie s0safety niet meer bestaat als interactieve vraag — de
//      eerste TCM-vraag verschijnt meteen, geen "veiligheidscontrole"-stap.
//   2. Er, ongeacht welke antwoorden gekozen worden, nooit een blokkerende
//      overlay verschijnt en de flow altijd gewoon doorloopt tot het einde.
//   3. De veiligheidschecklist-toggle in de topbar aanwezig is (therapeut-
//      rol) en het niet-blokkerende paneel toont/verbergt op klik, zonder
//      ooit de rest van de pagina te blokkeren.
//
// Uitvoeren met: node client/redflag-block-test.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createFakeD1 } from "../tests/fake-d1.js";
import worker from "../src/index.js";
import { handleRegister } from "../src/routes/auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

const env = { DB: createFakeD1(), APP_ENV: "test" };

global.document = fakeDocument;
global.localStorage = fakeLocalStorage;
global.window = global;
global.fetch = async (url, options = {}) => {
  const req = new Request(url, options);
  return worker.fetch(req, env, {});
};

const regRes = await handleRegister(
  new Request("https://x/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      organizationName: "Praktijk Redflagtest",
      contactEmail: "redflag@example.com",
      ownerName: "Redflag Tester",
      password: "correcthorsebattery",
    }),
  }),
  env
);
const regData = await regRes.json();
storage["yushin_token"] = regData.token;
storage["yushin_user"] = JSON.stringify(regData.user);
storage["yushin_api_base"] = "https://x";

// Taak #118: een gloednieuwe organisatie start 'trialing' — activeer haar
// rechtstreeks, deze test test de veiligheidschecklist, niet de poort.
await env.DB
  .prepare("UPDATE organizations SET subscription_status = 'active' WHERE id = ?")
  .bind(regData.organization.id)
  .run();

const stringsSrc = fs.readFileSync(path.join(__dirname, "strings.js"), "utf8");
const organClockSrc = fs.readFileSync(path.join(__dirname, "organClock.js"), "utf8");
const appSrc = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
(0, eval)(stringsSrc + "\n" + organClockSrc + "\n" + appSrc);

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
function clickOptionWithText(text) {
  const found = [];
  findButtons(fakeDocument._root, found);
  const opt = found.find((b) => b._attrs.class && b._attrs.class.includes("opt-btn") && b._text === text);
  if (!opt) throw new Error(`Geen optie-knop gevonden met tekst "${text}"`);
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
  await new Promise((r) => setTimeout(r, 0));
}

function fail(msg) {
  console.error("FOUT:", msg);
  console.error("Huidige gerenderde tekst:", renderedText().slice(0, 500));
  process.exit(1);
}

// --- Scenario 1: s0safety bestaat niet meer als interactieve vraag --------
clickButtonWithText("Nederlands");
clickButtonWithText("🩺 Ik ben de therapeut (volledige vragenlijst incl. polsdiagnose)");
clickButtonWithText("Man");
clickButtonWithText("Nee, overslaan");
clickButtonWithText("Nieuwe anamnese starten");
await settle();

let text = renderedText();
if (text.includes("Zijn er nu of recent tekenen van een acute neurologische")) {
  fail("de oude s0safety-veiligheidsvraag staat er nog — die had verwijderd moeten zijn.");
}
if (!text.includes("1. Koorts en rillingen")) {
  fail("verwachtte meteen de eerste echte TCM-sectie te zien (geen s0safety meer ervoor), maar die staat er niet.");
}

console.log("Scenario 1 geslaagd: s0safety bestaat niet meer als interactieve vraag; de flow start meteen met de echte TCM-vragen.");

// --- Scenario 2: geen enkel antwoord blokkeert de flow ooit nog -----------
// We doorlopen de VOLLEDIGE vragenlijst door telkens de eerste optie te
// kiezen (dus ook opties die vroeger een NOODSIGNAAL/ALARM zouden hebben
// getriggerd, mocht zo'n optie nu nog ergens voorkomen) en controleren dat
// er nooit een blokkerende melding verschijnt en het resultatenscherm
// gewoon bereikt wordt.
let guard = 0;
while (renderedText().includes("Overslaan / niet van toepassing") === false && guard < 500) {
  const found = [];
  findButtons(fakeDocument._root, found);
  const optBtn = found.find((b) => b._attrs.class && b._attrs.class.includes("opt-btn"));
  if (!optBtn) break;
  optBtn._listeners.click();
  await settle();
  guard++;
  if (renderedText().includes("veiligheidsmelding") || renderedText().includes("NOODSIGNAAL")) {
    fail("er verscheen alsnog een blokkerende veiligheidsmelding — de ontkoppeling van patiëntantwoorden werkt niet.");
  }
  if (renderedText().includes("TCM Patroonoverzicht")) break; // resultatenscherm bereikt
}

text = renderedText();
if (!text.includes("TCM Patroonoverzicht")) {
  fail("het resultatenscherm werd niet bereikt — mogelijk is de flow ergens onterecht geblokkeerd.");
}

console.log("Scenario 2 geslaagd: de volledige vragenlijst doorloopt zonder ooit geblokkeerd te worden, ongeacht de gekozen antwoorden.");

// --- Scenario 3: veiligheidschecklist-toggle is niet-blokkerend -----------
if (!text.includes("⚠️ Veiligheidsinformatie (altijd te raadplegen)")) {
  fail("de veiligheidschecklist-toggle staat niet in de topbar op het resultatenscherm.");
}
if (text.includes("Zijn er nu of recent tekenen")) {
  fail("de checklist-inhoud staat al zichtbaar vóór er op de toggle geklikt is — die moet standaard dicht staan.");
}

clickButtonWithText("⚠️ Veiligheidsinformatie (altijd te raadplegen)");
await settle();
text = renderedText();
if (!text.includes("Veiligheidsinformatie")) {
  fail("na het openklappen van de toggle staat de paneeltitel 'Veiligheidsinformatie' er niet.");
}
if (!text.includes("NOODSIGNAAL: plots krachtsverlies/verlamming")) {
  fail("na het openklappen van de toggle staat de statische checklist-inhoud er niet — verwachtte het NOODSIGNAAL-item over beroerte (redFlagData.js: red_verlamming_spraak).");
}

// De rest van de pagina moet gewoon aanklikbaar/leesbaar blijven: het
// "Opnieuw beginnen"/"Nieuwe sessie"-knop moet nog gewoon werken terwijl het
// paneel openstaat (geen overlay die de rest van de pagina blokkeert).
clickButtonWithText("Nieuwe sessie");
await settle();
text = renderedText();
if (!text.includes("Kies je taal") && !text.includes("Nederlands")) {
  fail("kon niet doorklikken naar een nieuwe sessie terwijl het veiligheidspaneel openstond — het lijkt de pagina toch te blokkeren.");
}

console.log("Scenario 3 geslaagd: de veiligheidschecklist is een niet-blokkerend, zelf te openen/sluiten paneel.");

console.log("\nVEILIGHEIDSCHECKLIST-TEST GESLAAGD.");
