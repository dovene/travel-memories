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

test("the browser language picks French for French, English for everything else", () => {
  const pickLang = (l) => TM.i18n.browserLang(l);
  assert.equal(pickLang(["fr-FR", "en"]), "fr");
  assert.equal(pickLang(["fr"]), "fr");
  assert.equal(pickLang(["FR-ca"]), "fr");
  assert.equal(pickLang(["en-US", "fr"]), "en", "the first preference decides");
  assert.equal(pickLang(["de-DE"]), "en");
  assert.equal(pickLang(["fy"]), "en", "not mistaken for French");
  assert.equal(pickLang([]), "en");
  assert.equal(pickLang(undefined), "en");
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

test("cover pictures fall back to a photo when the cover is a video without poster", () => {
  const ctx = { window: {}, document: { documentElement: { getAttribute: () => null } } };
  vm.runInNewContext(readFileSync(new URL("../public/assets/js/api.js", import.meta.url), "utf8"), ctx);
  const api = ctx.window.TM.api;
  const video = { id: "v", type: "video", url: "/m/v", variants: {} };
  const photo = { id: "p", type: "image", url: "/m/p", variants: { thumb: { url: "/m/p?variant=thumb", width: 640, height: 427 } } };
  assert.equal(api.coverImage({ coverMediaId: "v", media: [video, photo] }, "thumb").src, "/m/p?variant=thumb");
  assert.equal(api.coverImage({ coverMediaId: "v", media: [video] }, "thumb"), null);
  const posterVideo = { ...video, variants: { poster: { url: "/m/v?variant=poster", width: 1600, height: 900 } } };
  assert.equal(api.coverImage({ coverMediaId: "v", media: [posterVideo, photo] }, "thumb").src, "/m/v?variant=poster");
  assert.equal(api.coverImage({ coverMediaId: null, media: [] }, "thumb"), null);
  assert.equal(api.image(photo, "display").src, "/m/p?variant=thumb", "missing display falls back to thumb");
  assert.equal(api.image({ id: "o", type: "image", url: "/m/o", variants: {} }, "display").src, "/m/o", "no previews → original");
});

test("the hero shows every featured destination first, then fills up to 9 with others", () => {
  const ctx = { window: {}, document: { documentElement: { getAttribute: () => null } } };
  vm.runInNewContext(readFileSync(new URL("../public/assets/js/api.js", import.meta.url), "utf8"), ctx);
  const api = ctx.window.TM.api;
  const photo = { id: "p", type: "image", url: "/m/p", variants: {} };
  const place = (slug, countryCode, featured) => ({ slug, countryCode, featured, coverMediaId: "p", media: [photo] });
  const list = [
    place("f1", "MA", true), place("f2", "GB", true), place("f3", "TR", true), place("f4", "IT", true), place("f5", "FR", true),
    place("london-1", "GB"), place("london-2", "GB"), place("london-3", "GB"), place("accra", "GH"), place("dakar", "SN"),
    place("lisbon", "PT"), place("no-photo", "IS"),
  ];
  list[11].media = [];
  list[11].coverMediaId = null;
  const slugs = (r) => Array.from(api.heroSlides(list, r), (s) => s.place.slug);
  for (const r of [() => 0, () => 0.5, () => 0.999, Math.random]) {
    const got = slugs(r);
    assert.deepEqual(got.slice(0, 5), ["f1", "f2", "f3", "f4", "f5"], "featured first, in order");
    assert.equal(got.length, 9);
    const extra = got.slice(5);
    assert.equal(extra.filter((s) => s.startsWith("london")).length <= 1, true, "at most one pick per country");
    assert.ok(!extra.includes("no-photo"));
  }
  const many = Array.from({ length: 12 }, (_, i) => place("f" + i, "C" + i, true));
  assert.equal(api.heroSlides(many).length, 9, "never more than 9 slides");

  // No featured destination: 9 others, one per country while countries last.
  const plain = Array.from({ length: 14 }, (_, i) => place("p" + i, "K" + (i % 10)));
  for (const r of [() => 0, () => 0.5, () => 0.999, Math.random]) {
    const got = Array.from(api.heroSlides(plain, r), (s) => s.place.countryCode);
    assert.equal(got.length, 9);
    assert.equal(new Set(got).size, 9, "9 different countries when there are enough");
  }
  // Fewer countries than slots: a country may then appear twice.
  const twoCountries = Array.from({ length: 6 }, (_, i) => place("q" + i, i % 2 ? "AA" : "BB"));
  assert.equal(api.heroSlides(twoCountries).length, 6, "every destination with a photo when fewer than 9");
});

test("the journey follows the list the visitor came from", () => {
  const slugs = (r) => Array.from(r.list, (p) => p.slug);
  const all = TM.filters.journey(places, "kyoto", {});
  assert.equal(all.list[all.start].slug, "kyoto");
  assert.deepEqual(slugs(all), Array.from(places, (p) => p.slug), "same order as the homepage");
  assert.equal(all.filtered, false);

  const italy = TM.filters.journey(places, "rome", { country: "IT" });
  assert.deepEqual(slugs(italy), ["dolomites", "rome", "venice"]);
  assert.equal(italy.start, 1);
  assert.equal(italy.filtered, true);

  const searched = TM.filters.journey(places, "venice", { query: "ven" });
  assert.deepEqual(slugs(searched), ["venice"]);

  const outside = TM.filters.journey(places, "kyoto", { country: "IT" });
  assert.equal(outside.list.length, places.length, "a link outside the filter falls back to the full list");
  assert.equal(TM.filters.journey(places, "atlantis", {}), null);
});

test("backup archives: tar headers round-trip, including long paths", async () => {
  const ctx = { window: {}, TextEncoder, TextDecoder, Blob };
  vm.runInNewContext(readFileSync(new URL("../public/assets/js/tar.js", import.meta.url), "utf8"), ctx);
  const tar = ctx.window.TM.tar;
  const top = "travel-memories-production-2026-11-12T10-00";
  const files = [
    [`${top}/content/users/dovene/places.json`, new TextEncoder().encode('{"a":1}')],
    [`${top}/media/users/dovene/kwame-nkrumah-memorial-park-2025/img-abcdefghij.display-k3x9q2.jpg`, new Uint8Array(1000).fill(7)],
    [`${top}/__MACOSX/._junk`, new Uint8Array(3)],
  ];
  const parts = [];
  for (const [path, bytes] of files) parts.push(tar.header(path, bytes.length, Date.now()), bytes, tar.padding(bytes.length));
  parts.push(tar.end());
  const blob = new Blob(parts);
  assert.equal(blob.size % 512, 0);
  const entries = Array.from(await tar.list(blob));
  assert.deepEqual(entries.map((e) => e.path), files.slice(0, 2).map((f) => f[0]), "macOS metadata skipped");
  assert.equal(await entries[0].blob.text(), '{"a":1}');
  assert.equal(entries[1].size, 1000);
  assert.ok(files[1][0].length > 100, "the long path used the prefix field");
  await assert.rejects(() => tar.list(new Blob([new Uint8Array(512).fill(65)])), /not a tar file/);
});
