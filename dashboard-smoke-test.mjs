// Eenmalige, lokale smoke-test voor dashboard.js (taak #127/#134) — zelfde
// aanpak en beperkingen als client/smoke-test.mjs voor app.js: GEEN
// jsdom/echte browser, enkel een minimale eigen DOM-shim (nu met classList/
// dataset/querySelector(All)-ondersteuning, want dashboard.js gebruikt dat
// actief) om te controleren dat dashboard.js foutloos laadt en correct
// reageert op klikken, zonder tegen een echte server te praten.
//
// Dekt in het bijzonder de nieuwe "Wachtkamer-QR"-pagina (taak #134):
// leeg->genereren->opnieuw genereren->intrekken, de confirm()-vergrendeling
// vóór het overschrijven/intrekken van een bestaande code, het kopieer-pad,
// en het nette (niet-crashende) gedrag als de qrcode-generator-bibliotheek
// (cdnjs) om wat voor reden dan ook niet geladen is.
//
// Uitvoeren met: node client/dashboard-smoke-test.mjs
// Maakt ook deel uit van: npm run test:client

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- Minimale DOM-shim met classList/dataset/querySelector(All) -----------

function matchesSelector(elm, selector) {
  if (selector.startsWith(".")) return elm._classes && elm._classes.has(selector.slice(1));
  if (selector.startsWith("#")) return elm._attrs.id === selector.slice(1);
  return elm.tagName === selector;
}

function walk(node, selector, out) {
  (node.children || []).forEach((c) => {
    if (matchesSelector(c, selector)) out.push(c);
    walk(c, selector, out);
  });
}

class FakeElement {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.parentNode = null;
    this._attrs = {};
    this._text = "";
    this._html = "";
    this._listeners = {};
    this.style = {};
    this._classes = new Set();
    this.__dataset = {};
    const self = this;
    this.classList = {
      add: (c) => { self._classes.add(c); self._syncClassAttr(); },
      remove: (c) => { self._classes.delete(c); self._syncClassAttr(); },
      toggle: (c, force) => {
        if (force === undefined) {
          if (self._classes.has(c)) self._classes.delete(c);
          else self._classes.add(c);
        } else if (force) self._classes.add(c);
        else self._classes.delete(c);
        self._syncClassAttr();
      },
      contains: (c) => self._classes.has(c),
    };
  }
  _syncClassAttr() { this._attrs.class = Array.from(this._classes).join(" "); }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  setAttribute(k, v) {
    if (k === "class") {
      this._classes = new Set(String(v).split(/\s+/).filter(Boolean));
      this._syncClassAttr();
      return;
    }
    this._attrs[k] = v;
    if (k.startsWith("data-")) {
      const camel = k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      this.__dataset[camel] = v;
    }
  }
  getAttribute(k) { return this._attrs[k]; }
  get dataset() { return this.__dataset; }
  addEventListener(evt, fn) { (this._listeners[evt] = this._listeners[evt] || []).push(fn); }
  click() { (this._listeners.click || []).forEach((fn) => fn()); }
  get textContent() { return this._text; }
  set textContent(v) { this._text = v; this.children = []; }
  get innerHTML() { return this._html; }
  set innerHTML(v) { this._html = v; this.children = []; }
  set className(v) { this.setAttribute("class", v); }
  get className() { return this._attrs.class || ""; }
  set value(v) { this._value = v; }
  get value() { return this._value !== undefined ? this._value : (this._attrs.value || ""); }
  querySelectorAll(selector) {
    const out = [];
    walk(this, selector, out);
    return out;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function createElement(tag) {
  return new FakeElement(tag);
}

// Bouwt een minimale kopie van de relevante delen van dashboard.html: de
// twee nav-items (Sessies/Wachtkamer-QR) en de drie pagina's, met dezelfde
// id's/classes/data-page-attributen als het echte bestand. dashboard.js
// bouwt deze scaffold zelf NIET op (in tegenstelling tot app.js, dat alles
// vanuit render() opbouwt) — het hergebruikt bestaande markup, dus die moet
// hier net als in de browser al aanwezig zijn vóór dashboard.js laadt.
function buildInitialDom() {
  const root = createElement("div");

  const navList = createElement("nav");
  const navSessies = createElement("button");
  navSessies.setAttribute("class", "nav-item active");
  navSessies.setAttribute("data-page", "list");
  navList.appendChild(navSessies);
  const navQr = createElement("button");
  navQr.setAttribute("class", "nav-item");
  navQr.setAttribute("data-page", "qr");
  navList.appendChild(navQr);
  root.appendChild(navList);

  const backLink = createElement("button");
  backLink.setAttribute("id", "backLink");
  backLink.setAttribute("class", "back-link is-hidden");
  root.appendChild(backLink);

  const avatarInitials = createElement("div");
  avatarInitials.setAttribute("id", "avatarInitials");
  root.appendChild(avatarInitials);

  const loginGate = createElement("div");
  loginGate.setAttribute("id", "loginGate");
  loginGate.style.display = "none";
  root.appendChild(loginGate);

  const pageList = createElement("section");
  pageList.setAttribute("id", "pageList");
  pageList.setAttribute("class", "page page-active");
  pageList.setAttribute("data-page", "list");
  const sessionListBox = createElement("div");
  sessionListBox.setAttribute("id", "sessionListBox");
  pageList.appendChild(sessionListBox);
  root.appendChild(pageList);

  const pageQr = createElement("section");
  pageQr.setAttribute("id", "pageQr");
  pageQr.setAttribute("class", "page");
  pageQr.setAttribute("data-page", "qr");
  const qrBox = createElement("div");
  qrBox.setAttribute("id", "qrBox");
  pageQr.appendChild(qrBox);
  root.appendChild(pageQr);

  const pageDetail = createElement("section");
  pageDetail.setAttribute("id", "pageDetail");
  pageDetail.setAttribute("class", "page");
  pageDetail.setAttribute("data-page", "detail");
  const detailTitle = createElement("div");
  detailTitle.setAttribute("id", "detailTitle");
  pageDetail.appendChild(detailTitle);
  const detailSubtitle = createElement("div");
  detailSubtitle.setAttribute("id", "detailSubtitle");
  pageDetail.appendChild(detailSubtitle);
  const detailBox = createElement("div");
  detailBox.setAttribute("id", "detailBox");
  pageDetail.appendChild(detailBox);
  root.appendChild(pageDetail);

  return root;
}

let docRoot = buildInitialDom();

const fakeDocument = {
  createElement,
  getElementById(id) {
    let found = null;
    (function search(node) {
      if (found) return;
      if (node._attrs && node._attrs.id === id) { found = node; return; }
      (node.children || []).forEach(search);
    })(docRoot);
    return found;
  },
  querySelectorAll(selector) {
    const out = [];
    walk(docRoot, selector, out);
    return out;
  },
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
};

let storage = {};
const fakeLocalStorage = {
  getItem: (k) => (k in storage ? storage[k] : null),
  setItem: (k, v) => { storage[k] = String(v); },
  removeItem: (k) => { delete storage[k]; },
};

// --- Netwerk-/omgevingsstubs -----------------------------------------------

const tokenState = { current: null, generateCount: 0 };
let lastRevokeCalled = false;

global.fetch = async (url, opts) => {
  const method = (opts && opts.method) || "GET";
  if (url.includes("/api/sessions") && method === "GET") {
    return { status: 200, ok: true, json: async () => ({ sessions: [] }) };
  }
  if (url.includes("/api/patient-intake/token")) {
    if (method === "GET") {
      return { status: 200, ok: true, json: async () => ({ token: tokenState.current }) };
    }
    if (method === "POST") {
      tokenState.generateCount += 1;
      tokenState.current = "generated-token-" + tokenState.generateCount;
      return { status: 200, ok: true, json: async () => ({ token: tokenState.current }) };
    }
    if (method === "DELETE") {
      tokenState.current = null;
      lastRevokeCalled = true;
      return { status: 200, ok: true, json: async () => ({ ok: true }) };
    }
  }
  throw new Error("fetch not stubbed in dashboard smoke test: " + method + " " + url);
};

// Simuleert het cdnjs-geladen qrcode-generator-bibliotheek-object. We testen
// bewust NIET de correctheid van die (ongewijzigde, externe) bibliotheek
// zelf, enkel dat ONZE code hem correct aanroept (addData/make/createSvgTag)
// en het resultaat correct in de DOM zet — en dat het ontbreken ervan de
// pagina niet laat crashen (zie test hieronder).
let qrLibCalls = [];
function installFakeQrLib() {
  global.qrcode = (typeNumber, level) => ({
    addData: (text) => qrLibCalls.push(["addData", text]),
    make: () => qrLibCalls.push(["make"]),
    createSvgTag: () => '<svg data-fake-qr="1"></svg>',
  });
}
function removeQrLib() {
  delete global.qrcode;
}

let confirmReturnValue = true;
global.confirm = () => confirmReturnValue;

let lastClipboardText = null;
// Node (21+) heeft zelf al een `navigator`-global (read-only getter) —
// vandaar defineProperty i.p.v. een gewone toekenning, anders faalt dit met
// "Cannot set property navigator of #<Object> which has only a getter".
Object.defineProperty(global, "navigator", {
  value: { clipboard: { writeText: async (text) => { lastClipboardText = text; } } },
  configurable: true,
  writable: true,
});

global.document = fakeDocument;
global.localStorage = fakeLocalStorage;
global.window = global;
global.scrollTo = () => {};
global.location = {
  href: "https://dannycurrinckx-maker.github.io/yushin-client/dashboard.html",
  origin: "https://dannycurrinckx-maker.github.io",
  pathname: "/yushin-client/dashboard.html",
  search: "",
};

storage["yushin_token"] = "fake-token-for-dashboard-smoke-test";
storage["yushin_user"] = JSON.stringify({ id: "u1", name: "Smoke Tester", email: "smoke@example.com", role: "owner" });

// --- Laad de client-scripts in dezelfde volgorde als dashboard.html -------

const stringsSrc = fs.readFileSync(path.join(__dirname, "strings.js"), "utf8");
const organClockSrc = fs.readFileSync(path.join(__dirname, "organClock.js"), "utf8");
const dashboardSrc = fs.readFileSync(path.join(__dirname, "dashboard.js"), "utf8");

try {
  (0, eval)(stringsSrc + "\n" + organClockSrc + "\n" + dashboardSrc);
} catch (err) {
  console.error("FOUT bij laden van dashboard.js:", err);
  process.exit(1);
}

// --- Helpers ----------------------------------------------------------------

function findButtonByText(node, text, out) {
  if (node.tagName === "button" && node._text === text) out.push(node);
  (node.children || []).forEach((c) => findButtonByText(c, text, out));
}
function clickButtonWithText(text) {
  const found = [];
  findButtonByText(docRoot, text, found);
  if (!found.length) throw new Error(`Geen knop gevonden met tekst "${text}"`);
  found[0].click();
}
function collectText(node, out) {
  if (node._text) out.push(node._text);
  (node.children || []).forEach((c) => collectText(c, out));
}
function textOf(node) {
  const out = [];
  collectText(node, out);
  return out.join(" | ");
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- 1) Navigeren naar de nieuwe "Wachtkamer-QR"-pagina: lege staat -------

const navQr = document.querySelectorAll(".nav-item")[1];
assert.equal(navQr.dataset.page, "qr");
navQr.click();
await sleep(10);

const pageQr = document.getElementById("pageQr");
const pageList = document.getElementById("pageList");
assert.ok(pageQr.classList.contains("page-active"), "pageQr moet actief zijn na navigatie");
assert.ok(!pageList.classList.contains("page-active"), "pageList mag niet meer actief zijn");

const qrBox = document.getElementById("qrBox");
assert.match(textOf(qrBox), /nog geen wachtkamer-QR-code/i, "lege staat moet getoond worden zonder token");
console.log("OK  - lege staat correct getoond na navigatie naar Wachtkamer-QR");

// --- 2) Genereren terwijl de qrcode-bibliotheek (nog) niet geladen is -----
// (bv. cdnjs traag/geblokkeerd) — mag de pagina niet laten crashen, moet een
// nette foutmelding tonen i.p.v. een QR-afbeelding.

removeQrLib();
clickButtonWithText("QR-code genereren");
await sleep(10);

assert.equal(tokenState.current, "generated-token-1");
assert.ok(qrBox.querySelector(".qr-wrap"), "qr-wrap moet er zijn zodra er een token is, ook zonder QR-bibliotheek");
const qrCodeBoxNoLib = qrBox.querySelector(".qr-code-box");
assert.match(textOf(qrCodeBoxNoLib), /QR-bibliotheek kon niet geladen worden/);
const linkInputNoLib = qrBox.querySelector(".link-input");
assert.ok(linkInputNoLib.value.includes("patient-intake.html?t=generated-token-1"), "link moet het token bevatten: " + linkInputNoLib.value);
console.log("OK  - ontbrekende QR-bibliotheek geeft een nette foutmelding i.p.v. te crashen, link werkt gewoon");

// --- 3) Opnieuw genereren (met bibliotheek aanwezig, en bevestiging) ------

installFakeQrLib();
confirmReturnValue = true;
clickButtonWithText("Nieuwe QR-code genereren");
await sleep(10);

assert.equal(tokenState.current, "generated-token-2");
const qrCodeBoxWithLib = qrBox.querySelector(".qr-code-box");
assert.match(qrCodeBoxWithLib.innerHTML, /data-fake-qr/, "de (gestubde) QR-bibliotheek moet effectief aangeroepen zijn");
assert.deepEqual(qrLibCalls.map((c) => c[0]), ["addData", "make"], "addData/make moeten in die volgorde aangeroepen zijn");
const linkInputWithLib = qrBox.querySelector(".link-input");
assert.ok(linkInputWithLib.value.includes("generated-token-2"), "link moet bijgewerkt zijn naar de nieuwe token");
console.log("OK  - opnieuw genereren (met bevestiging) overschrijft de code en toont de echte QR-svg");

// --- 4) Regenereren annuleren laat de bestaande code ongemoeid ------------

confirmReturnValue = false;
const generateCountBeforeCancel = tokenState.generateCount;
clickButtonWithText("Nieuwe QR-code genereren");
await sleep(10);
assert.equal(tokenState.generateCount, generateCountBeforeCancel, "geannuleerde regeneratie mag geen nieuwe token aanmaken");
assert.ok(qrBox.querySelector(".link-input").value.includes("generated-token-2"), "link mag niet gewijzigd zijn na annuleren");
console.log("OK  - annuleren van de bevestigingsdialoog laat de bestaande QR-code/link ongemoeid");

// --- 5) Kopieerknop -------------------------------------------------------

clickButtonWithText("Kopieer");
await sleep(10);
assert.ok(lastClipboardText && lastClipboardText.includes("generated-token-2"), "de juiste link moet gekopieerd zijn");
assert.match(textOf(document.getElementById("qrCopyFeedback")), /gekopieerd/i);
console.log("OK  - kopieerknop kopieert de juiste link en toont bevestiging");

// --- 6) Intrekken ----------------------------------------------------------

confirmReturnValue = true;
clickButtonWithText("QR-code intrekken");
await sleep(10);
assert.equal(tokenState.current, null);
assert.ok(lastRevokeCalled, "DELETE /api/patient-intake/token moet effectief aangeroepen zijn");
assert.match(textOf(qrBox), /nog geen wachtkamer-QR-code/i, "na intrekken moet de lege staat weer getoond worden");
console.log("OK  - intrekken (met bevestiging) wist de QR-code en toont de lege staat");

// --- 7) Terugnavigeren naar Sessies werkt nog normaal ----------------------

const navSessies = document.querySelectorAll(".nav-item")[0];
navSessies.click();
await sleep(10);
assert.ok(pageList.classList.contains("page-active"));
assert.ok(!pageQr.classList.contains("page-active"));
console.log("OK  - terugnavigeren naar Sessies werkt nog normaal na gebruik van de Wachtkamer-QR-pagina");

console.log("\nDASHBOARD-SMOKE-TEST GESLAAGD: dashboard.js laadt zonder fouten en de Wachtkamer-QR-pagina (genereren/opnieuw genereren/intrekken/kopiëren, met en zonder QR-bibliotheek, met en zonder bevestiging) werkt zoals verwacht.");
