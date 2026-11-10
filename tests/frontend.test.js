/* Tests for the browser modules, loaded into a sandbox the way <script> tags load them. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function loadTM(files) {
  const store = {};
  const ctx = {
    window: {},
    localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => (store[k] = v) },
    document: { querySelectorAll: () => [], documentElement: {}, addEventListener: () => {} },
  };
  for (const f of files) {
    const path = f.startsWith("fixtures/") ? `../scripts/${f}` : `../public/assets/js/${f}`;
    vm.runInNewContext(readFileSync(new URL(path, import.meta.url), "utf8"), ctx);
  }
  return ctx.window.TM;
}

const TM = loadTM(["i18n/en.js", "i18n/fr.js", "i18n.js", "fixtures/starter-content.js", "filters.js", "app.js"]);
const places = TM.mock.places.places;
// Array.from builds the array in this realm (the sandbox has its own Array).
const names = (list) => Array.from(list, (p) => p.slug).sort();

test("search is case- and accent-insensitive", () => {
  assert.deepEqual(names(TM.filters.filterPlaces(places, { query: "GRÈCE" })), ["santorini"]);
  assert.deepEqual(names(TM.filters.filterPlaces(places, { query: "grece" })), ["santorini"]);
});

test("search matches French and English names, city and country", () => {
  assert.deepEqual(names(TM.filters.filterPlaces(places, { query: "allemagne" })), ["berlin"]);
  assert.deepEqual(names(TM.filters.filterPlaces(places, { query: "oia" })), ["santorini"]);
});

test("query words and country filter combine", () => {
  assert.deepEqual(names(TM.filters.filterPlaces(places, { query: "italy ven" })), ["venice"]);
  assert.deepEqual(names(TM.filters.filterPlaces(places, { query: "", country: "IT" })), ["dolomites", "rome", "venice"]);
  assert.deepEqual(names(TM.filters.filterPlaces(places, { query: "berlin", country: "IT" })), []);
});

test("empty query returns everything", () => {
  assert.equal(TM.filters.filterPlaces(places, { query: "  " }).length, places.length);
});

test("translations fall back to English", () => {
  TM.i18n.setLang("fr");
  assert.equal(TM.i18n.pick({ en: "Hello", fr: "Bonjour" }), "Bonjour");
  assert.equal(TM.i18n.pick({ en: "Hello" }), "Hello");
  assert.equal(TM.i18n.t("results.count", { n: 3 }), "3 destinations");
  TM.i18n.setLang("en");
});

test("mock content respects storage invariants", () => {
  const ids = new Set();
  for (const p of places) {
    assert.ok(p.ownerId, `${p.id} has an owner`);
    assert.ok(!ids.has(p.id), `${p.id} is unique`);
    ids.add(p.id);
    assert.ok(p.media.some((m) => m.id === p.coverMediaId), `${p.id} cover references existing media`);
    p.media.forEach((m, i) => assert.equal(m.position, i, `${p.id}/${m.id} position`));
  }
});

test("there are at least 20 quotes, each with an emphasised word in both languages", () => {
  const keys = Array.from(TM.quotes.keys());
  assert.ok(keys.length >= 20, `only ${keys.length} quotes`);
  for (const k of keys) for (const lang of ["en", "fr"]) assert.match(TM.locales[lang][k], /<em>[^<]+<\/em>/, `${lang} ${k}`);
});

test("the quote never repeats the previous visit's quote", () => {
  const keys = TM.quotes.keys();
  for (const last of keys)
    for (const r of [0, 0.5, 0.999]) assert.notEqual(TM.quotes.pick(keys, last, () => r), last);
  assert.equal(TM.quotes.pick(["only"], "only", () => 0), "only");
});
