/* Internationalization: interface strings live in assets/js/i18n/<lang>.js. */
(function () {
  "use strict";

  var TM = (window.TM = window.TM || {});
  var DEFAULT = "en";
  var SUPPORTED = ["en", "fr"];
  var STORAGE_KEY = "tm.lang";
  var listeners = [];

  function readStored() {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      return null;
    }
  }

  /*
   * Language of the visitor's browser: French when their preferred language is French
   * (fr, fr-FR, fr-CA…), English for English and every other language.
   */
  function browserLang(languages) {
    var first = (languages && languages[0]) || "";
    return /^fr\b/i.test(first) ? "fr" : DEFAULT;
  }

  /* A language picked with the EN/FR switch wins; otherwise the browser's language. */
  function detect() {
    var stored = readStored();
    if (stored && SUPPORTED.indexOf(stored) !== -1) return stored;
    var nav = window.navigator || {};
    return browserLang(nav.languages && nav.languages.length ? nav.languages : [nav.language]);
  }

  var current = detect();

  function t(key, vars) {
    var dict = TM.locales[current] || {};
    var str = dict[key];
    if (str == null) str = (TM.locales[DEFAULT] || {})[key];
    if (str == null) return key;
    if (vars) {
      str = str.replace(/\{(\w+)\}/g, function (_, k) {
        return vars[k] != null ? vars[k] : "";
      });
    }
    return str;
  }

  /* Localized content field: { en, fr } → string, falling back to English. */
  function pick(field) {
    if (field == null) return "";
    if (typeof field === "string") return field;
    return field[current] || field[DEFAULT] || "";
  }

  function apply(root) {
    root = root || document;
    root.querySelectorAll("[data-i18n]").forEach(function (el) {
      el.textContent = t(el.getAttribute("data-i18n"));
    });
    root.querySelectorAll("[data-i18n-html]").forEach(function (el) {
      el.innerHTML = t(el.getAttribute("data-i18n-html"));
    });
    root.querySelectorAll("[data-i18n-attr]").forEach(function (el) {
      el.getAttribute("data-i18n-attr")
        .split(";")
        .forEach(function (pair) {
          var parts = pair.split(":");
          if (parts.length === 2) el.setAttribute(parts[0].trim(), t(parts[1].trim()));
        });
    });
    document.documentElement.lang = current;
    document.querySelectorAll("[data-lang]").forEach(function (btn) {
      btn.setAttribute("aria-pressed", String(btn.getAttribute("data-lang") === current));
    });
  }

  function setLang(lang) {
    if (SUPPORTED.indexOf(lang) === -1 || lang === current) return;
    current = lang;
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch (e) {}
    apply();
    listeners.forEach(function (fn) {
      fn(lang);
    });
  }

  function formatMonth(yyyyMm) {
    if (!yyyyMm) return "";
    var parts = yyyyMm.split("-");
    var d = new Date(Date.UTC(+parts[0], +(parts[1] || 1) - 1, 1));
    return d.toLocaleDateString(current === "fr" ? "fr-FR" : "en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  }

  TM.i18n = {
    t: t,
    pick: pick,
    apply: apply,
    setLang: setLang,
    formatMonth: formatMonth,
    browserLang: browserLang,
    get lang() {
      return current;
    },
    onChange: function (fn) {
      listeners.push(fn);
    },
    bindSwitch: function (root) {
      (root || document).querySelectorAll("[data-lang]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          setLang(btn.getAttribute("data-lang"));
        });
      });
    }
  };
})();
