/* Page bootstrap for the public site (home + place detail). */
(function () {
  "use strict";

  var TM = (window.TM = window.TM || {});
  var t = function (k, v) {
    return TM.i18n.t(k, v);
  };
  var pick = function (f) {
    return TM.i18n.pick(f);
  };
  var esc = function (s) {
    return TM.ui.esc(s);
  };

  /* ---------- Shared chrome ---------- */
  function initHeader() {
    var header = document.querySelector(".site-header");
    if (!header) return;
    var solidAfter = header.hasAttribute("data-always-solid") ? -1 : 40;
    var lastY = window.scrollY;
    function onScroll() {
      var y = window.scrollY;
      header.classList.toggle("is-solid", y > solidAfter);
      header.classList.toggle("is-hidden", y > 400 && y > lastY + 4);
      if (y < lastY - 4 || y < 400) header.classList.remove("is-hidden");
      lastY = y;
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  function initFooter() {
    var y = document.querySelector("[data-year]");
    if (y) y.textContent = t("footer.rights", { year: new Date().getFullYear() });
  }

  /* ---------- Home ---------- */
  function initHero(places) {
    var slidesEl = document.querySelector(".hero-slides");
    var dotsEl = document.querySelector(".hero-dots");
    var labelEl = document.querySelector("[data-hero-place]");
    if (!slidesEl) return;
    var slides = TM.api.heroSlides();
    var current = 0;
    var timer = null;

    slidesEl.innerHTML = slides
      .map(function (s, i) {
        return (
          '<div class="hero-slide' + (i === 0 ? " is-active" : "") + '">' +
          '<img alt="" ' + (i === 0 ? 'fetchpriority="high"' : 'loading="lazy"') + ' src="' + esc(TM.api.mediaUrl(s.media, 2000, 1250)) + '" ' +
          'srcset="' + esc(TM.api.mediaUrl(s.media, 900, 1300) + " 900w, " + TM.api.mediaUrl(s.media, 1400, 1100) + " 1400w, " + TM.api.mediaUrl(s.media, 2000, 1250) + " 2000w") + '" sizes="100vw">' +
          "</div>"
        );
      })
      .join("");

    function renderDots() {
      dotsEl.innerHTML = slides
        .map(function (_, i) {
          return '<button type="button" aria-label="' + esc(t("hero.slide", { n: i + 1 })) + '" aria-current="' + (i === current) + '"></button>';
        })
        .join("");
      labelEl.textContent = pick(slides[current].place.name);
    }

    function show(i) {
      var nodes = slidesEl.children;
      nodes[current].classList.remove("is-active");
      current = (i + slides.length) % slides.length;
      /* Restart Ken Burns on re-entry. */
      var img = nodes[current].querySelector("img");
      img.style.animation = "none";
      void img.offsetWidth;
      img.style.animation = "";
      nodes[current].classList.add("is-active");
      renderDots();
    }

    function start() {
      clearInterval(timer);
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      timer = setInterval(function () {
        show(current + 1);
      }, 7000);
    }

    dotsEl.addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (!b) return;
      show(Array.prototype.indexOf.call(dotsEl.children, b));
      start();
    });
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) clearInterval(timer);
      else start();
    });
    TM.i18n.onChange(renderDots);
    renderDots();
    start();

    var countries = TM.filters.countries(places).length;
    var moments = places.reduce(function (n, p) {
      return n + p.media.length;
    }, 0);
    document.querySelector("[data-stat=places]").textContent = places.length;
    document.querySelector("[data-stat=countries]").textContent = countries;
    document.querySelector("[data-stat=moments]").textContent = moments;
  }

  function initHome() {
    var grid = document.getElementById("place-grid");
    var chipsEl = document.getElementById("country-chips");
    var input = document.getElementById("search");
    var clearBtn = document.querySelector(".search-clear");
    var meta = document.getElementById("result-meta");
    var empty = document.getElementById("empty");
    var all = [];
    var state = { query: "", country: "" };

    /* Restore filters from the URL so results can be shared / survive reloads. */
    var params = new URLSearchParams(location.search);
    state.query = params.get("q") || "";
    state.country = params.get("country") || "";
    input.value = state.query;

    TM.ui.renderSkeletons(grid, 6);
    meta.textContent = t("results.loading");

    function syncUrl() {
      var p = new URLSearchParams();
      if (state.query) p.set("q", state.query);
      if (state.country) p.set("country", state.country);
      var qs = p.toString();
      history.replaceState(null, "", location.pathname + (qs ? "?" + qs : "") + location.hash);
    }

    function renderChips() {
      var list = TM.filters.countries(all).sort(function (a, b) {
        return pick(a.name).localeCompare(pick(b.name), TM.i18n.lang);
      });
      chipsEl.innerHTML =
        '<button type="button" class="chip" data-country="" aria-pressed="' + (state.country === "") + '">' + esc(t("filters.all")) + ' <span class="count">' + all.length + "</span></button>" +
        list
          .map(function (c) {
            return '<button type="button" class="chip" data-country="' + c.code + '" aria-pressed="' + (state.country === c.code) + '">' + esc(pick(c.name)) + ' <span class="count">' + c.count + "</span></button>";
          })
          .join("");
    }

    function render() {
      var results = TM.filters.filterPlaces(all, state);
      clearBtn.hidden = !state.query;
      meta.textContent = results.length === 1 ? t("results.countOne") : t("results.count", { n: results.length });
      if (!results.length) {
        grid.innerHTML = "";
        empty.hidden = false;
        empty.querySelector("p").textContent = state.query ? t("empty.text", { q: state.query }) : t("empty.textNoQuery");
      } else {
        empty.hidden = true;
        TM.ui.renderPlaceCards(grid, results);
      }
    }

    var debounce;
    input.addEventListener("input", function () {
      clearTimeout(debounce);
      debounce = setTimeout(function () {
        state.query = input.value.trim();
        syncUrl();
        render();
      }, 120);
    });

    clearBtn.addEventListener("click", function () {
      input.value = "";
      state.query = "";
      syncUrl();
      render();
      input.focus();
    });

    chipsEl.addEventListener("click", function (e) {
      var b = e.target.closest(".chip");
      if (!b) return;
      state.country = b.getAttribute("data-country");
      chipsEl.querySelectorAll(".chip").forEach(function (c) {
        c.setAttribute("aria-pressed", String(c === b));
      });
      syncUrl();
      render();
    });

    empty.querySelector("button").addEventListener("click", function () {
      input.value = "";
      state.query = "";
      state.country = "";
      syncUrl();
      renderChips();
      render();
    });

    TM.i18n.onChange(function () {
      document.title = t("meta.homeTitle");
      renderChips();
      render();
    });

    TM.api.getPlaces().then(function (places) {
      all = places;
      initHero(places);
      renderChips();
      render();
    });
  }

  /* ---------- Place detail ---------- */
  function initPlace() {
    var slug = new URLSearchParams(location.search).get("slug") || "";
    var main = document.getElementById("place-root");
    var current = null;
    var nextPlace = null;

    main.innerHTML =
      '<section class="place-hero shimmer" style="background:var(--navy)"><div class="container place-hero-content"><p class="eyebrow" style="opacity:.6">' + esc(t("place.loading")) + "</p></div></section>";

    function render() {
      if (!current) {
        main.innerHTML =
          '<section class="section"><div class="container" style="padding-top:var(--header-h)"><div class="empty">' + TM.icons.compass +
          "<h3>" + esc(t("place.notFoundTitle")) + "</h3><p>" + esc(t("place.notFoundText")) + '</p><a class="btn btn-primary" href="index.html#destinations">' + TM.icons.arrowLeft + esc(t("place.back")) + "</a></div></div></section>";
        document.querySelector(".site-header").classList.add("is-solid");
        return;
      }
      var p = current;
      var c = TM.api.cover(p);
      var photos = p.media.filter(function (m) {
        return m.type === "image";
      }).length;
      var videos = p.media.length - photos;
      document.title = pick(p.name) + " — Travel Memories";

      var mediaCount = [photos === 1 ? t("card.photo") : t("card.photos", { n: photos })];
      if (videos) mediaCount.push(videos === 1 ? t("card.video") : t("card.videos", { n: videos }));

      main.innerHTML =
        '<section class="place-hero">' +
        '<img alt="' + esc(pick(c.altText)) + '" fetchpriority="high" src="' + esc(TM.api.mediaUrl(c, 2000, 1250)) + '" srcset="' +
        esc(TM.api.mediaUrl(c, 900, 1300) + " 900w, " + TM.api.mediaUrl(c, 1400, 1000) + " 1400w, " + TM.api.mediaUrl(c, 2000, 1250) + " 2000w") + '" sizes="100vw">' +
        '<div class="container place-hero-content hero-enter">' +
        '<a class="back-link" href="index.html#destinations">' + TM.icons.arrowLeft + esc(t("place.back")) + "</a>" +
        '<p class="eyebrow">' + esc(p.city) + " · " + esc(pick(p.country)) + "</p>" +
        "<h1>" + esc(pick(p.name)) + "</h1>" +
        "</div></section>" +
        '<div class="container">' +
        '<section class="place-intro">' +
        '<p class="place-description reveal">' + esc(pick(p.description)) + "</p>" +
        '<dl class="place-facts reveal">' +
        "<div><dt>" + esc(t("place.city")) + "</dt><dd>" + esc(p.city) + "</dd></div>" +
        "<div><dt>" + esc(t("place.country")) + "</dt><dd>" + esc(pick(p.country)) + "</dd></div>" +
        "<div><dt>" + esc(t("place.visited")) + "</dt><dd>" + esc(TM.i18n.formatMonth(p.visitedAt)) + "</dd></div>" +
        "<div><dt>" + esc(t("place.media")) + "</dt><dd>" + esc(mediaCount.join(" · ")) + "</dd></div>" +
        "</dl></section>" +
        '<section aria-labelledby="gallery-title">' +
        '<div class="gallery-head"><h2 id="gallery-title">' + esc(t("place.gallery")) + "</h2><p>" + esc(t("place.galleryHint")) + "</p></div>" +
        '<div class="media-grid" id="media-grid"></div>' +
        "</section></div>" +
        (nextPlace
          ? '<a class="next-place" href="' + TM.ui.placeHref(nextPlace) + '">' +
            '<img alt="" loading="lazy" src="' + esc(TM.api.mediaUrl(TM.api.cover(nextPlace), 1800, 900)) + '">' +
            '<div class="container"><div><p class="eyebrow">' + esc(t("place.next")) + "</p><h2>" + esc(pick(nextPlace.name)) + "</h2></div>" +
            '<span class="btn btn-light">' + esc(t("place.nextCta")) + TM.icons.arrowRight + "</span></div></a>"
          : "");

      TM.ui.renderMediaGrid(document.getElementById("media-grid"), p, function (i, el) {
        TM.lightbox.open(p, i, el);
      });
      TM.ui.reveal(main);
    }

    TM.i18n.onChange(render);

    Promise.all([TM.api.getPlace(slug), TM.api.getPlaces()]).then(function (res) {
      current = res[0];
      var list = res[1];
      if (current) {
        var i = list.findIndex(function (x) {
          return x.slug === current.slug;
        });
        nextPlace = list[(i + 1) % list.length];
      }
      main.classList.remove("shimmer");
      render();
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    TM.i18n.apply();
    TM.i18n.bindSwitch();
    TM.i18n.onChange(initFooter);
    initHeader();
    initFooter();
    var page = document.body.getAttribute("data-page");
    if (page === "home") initHome();
    if (page === "place") initPlace();
  });
})();
