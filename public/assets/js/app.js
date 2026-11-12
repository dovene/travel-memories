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

  /*
   * Footer quote: one of the "quote.N" translations, chosen at random on each page view.
   * The previous quote is skipped so the same phrase never appears twice in a row,
   * and the same quote stays in place when the language changes.
   */
  function quoteKeys() {
    return Object.keys(TM.locales.en).filter(function (k) {
      return /^quote\.\d+$/.test(k);
    });
  }

  function pickQuote(keys, last, random) {
    var pool = keys.length > 1 ? keys.filter(function (k) {
      return k !== last;
    }) : keys;
    return pool[Math.floor((random || Math.random)() * pool.length)];
  }

  function initQuote() {
    var el = document.querySelector("[data-quote]");
    if (!el) return;
    var last = null;
    try {
      last = localStorage.getItem("tm.lastQuote");
    } catch (e) {}
    var key = pickQuote(quoteKeys(), last);
    try {
      localStorage.setItem("tm.lastQuote", key);
    } catch (e) {}
    function render() {
      el.innerHTML = t(key);
    }
    render();
    TM.i18n.onChange(render);
  }

  TM.quotes = { keys: quoteKeys, pick: pickQuote };
  function initHero(places) {
    var slidesEl = document.querySelector(".hero-slides");
    var dotsEl = document.querySelector(".hero-dots");
    var labelEl = document.querySelector("[data-hero-place]");
    if (!slidesEl) return;

    var countries = TM.filters.countries(places).length;
    var moments = places.reduce(function (n, p) {
      return n + p.media.length;
    }, 0);
    document.querySelector("[data-stat=places]").textContent = places.length;
    document.querySelector("[data-stat=countries]").textContent = countries;
    document.querySelector("[data-stat=moments]").textContent = moments;

    var slides = TM.api.heroSlides(places);
    var current = 0;
    var timer = null;

    /* No photos published yet: keep the hero as a calm brand gradient. */
    var hero = document.querySelector(".hero");
    hero.classList.toggle("is-plain", !slides.length);
    if (!slides.length) {
      slidesEl.innerHTML = "";
      document.querySelector(".hero-caption").hidden = true;
      return;
    }

    slidesEl.innerHTML = slides
      .map(function (s, i) {
        return (
          '<div class="hero-slide' + (i === 0 ? " is-active" : "") + '">' +
          '<img alt="" ' + (i === 0 ? 'fetchpriority="high"' : 'loading="lazy"') + ' src="' + esc(s.image.src) + '"' +
          (s.image.srcset ? ' srcset="' + esc(s.image.srcset) + '" sizes="100vw"' : "") + ">" +
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
        TM.ui.renderPlaceCards(grid, results, state);
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

    TM.api
      .getPlaces()
      .then(function (places) {
        all = places;
        initHero(places);
        renderChips();
        render();
      })
      .catch(function () {
        initHero([]);
        meta.textContent = "";
        grid.innerHTML = loadError();
      });
  }

  /* Shown when the content API cannot be reached; the button simply reloads the page. */
  function loadError() {
    return (
      '<div class="empty" style="column-span:all">' + TM.icons.compass +
      "<h3>" + esc(t("errors.loadTitle")) + "</h3><p>" + esc(t("errors.loadText")) + "</p>" +
      '<button type="button" class="btn btn-primary" data-reload>' + esc(t("errors.retry")) + "</button></div>"
    );
  }

  /* ---------- Place pages: one continuous journey ----------
   *
   * The page opens on the requested destination and keeps adding the following ones as
   * the visitor scrolls, in the order of the list they came from (homepage order, or their
   * search/filter results). After the last one it loops back to the first.
   * The address bar and tab title follow the destination in view; Back returns home.
   */
  function initPlace() {
    var params = new URLSearchParams(location.search);
    var slug = params.get("slug") || "";
    var criteria = { query: params.get("q") || "", country: params.get("country") || "" };
    var main = document.getElementById("place-root");
    var journey = null; // { list, start, filtered }
    var shown = 0; // how many sections have been added
    var activeSlug = slug;

    main.innerHTML =
      '<section class="place-hero shimmer" style="background:var(--navy)"><div class="container place-hero-content"><p class="eyebrow" style="opacity:.6">' + esc(t("place.loading")) + "</p></div></section>";

    function homeHref() {
      var p = new URLSearchParams();
      if (journey && journey.filtered) {
        if (criteria.query) p.set("q", criteria.query);
        if (criteria.country) p.set("country", criteria.country);
      }
      var qs = p.toString();
      return "index.html" + (qs ? "?" + qs : "") + "#destinations";
    }

    function sectionHtml(p, n) {
      var c = TM.api.cover(p);
      var heroImg = TM.api.coverImage(p, "display");
      var photos = p.media.filter(function (m) {
        return m.type === "image";
      }).length;
      var videos = p.media.length - photos;
      var mediaCount = [];
      if (photos) mediaCount.push(photos === 1 ? t("card.photo") : t("card.photos", { n: photos }));
      if (videos) mediaCount.push(videos === 1 ? t("card.video") : t("card.videos", { n: videos }));
      if (!mediaCount.length) mediaCount.push(t("card.soon"));
      var position = (journey.list.indexOf(p) + 1) + " / " + journey.list.length;
      var Heading = n === 0 ? "h1" : "h2"; // one h1 per page; later destinations are h2
      var Sub = n === 0 ? "h2" : "h3"; // gallery heading sits one level below its destination
      var id = "g-" + n;

      return (
        '<section class="place-hero' + (heroImg ? "" : " is-plain") + '">' +
        (heroImg
          ? '<img alt="' + esc(pick(c.altText)) + '" ' + (n === 0 ? 'fetchpriority="high"' : 'loading="lazy"') + ' src="' + esc(heroImg.src) + '"' +
            (heroImg.srcset ? ' srcset="' + esc(heroImg.srcset) + '" sizes="100vw"' : "") + ">"
          : "") +
        '<div class="container place-hero-content' + (n === 0 ? " hero-enter" : "") + '">' +
        '<a class="back-link" href="' + esc(homeHref()) + '">' + TM.icons.arrowLeft + esc(t(journey.filtered ? "journey.backFiltered" : "place.back")) + "</a>" +
        '<p class="eyebrow">' + esc(p.city) + " · " + esc(pick(p.country)) +
        (p.featured ? '<span class="featured-tag">' + TM.icons.crown + esc(t("featured.badge")) + "</span>" : "") +
        '<span class="journey-pos">' + esc(position) + "</span></p>" +
        "<" + Heading + ' class="place-title">' + esc(pick(p.name)) + "</" + Heading + ">" +
        (p.media.length > 1
          ? '<button type="button" class="hero-play" data-play aria-label="' + esc(t("slideshow.playLabel", { name: pick(p.name) })) + '">' +
            '<span class="hero-play-orb">' + TM.icons.play + '</span><span class="hero-play-text">' + esc(t("slideshow.play")) + "</span></button>"
          : "") +
        "</div></section>" +
        '<div class="container">' +
        '<section class="place-intro">' +
        '<p class="place-description reveal">' + esc(pick(p.description)) + "</p>" +
        '<dl class="place-facts reveal">' +
        "<div><dt>" + esc(t("place.city")) + "</dt><dd>" + esc(p.city) + "</dd></div>" +
        "<div><dt>" + esc(t("place.country")) + "</dt><dd>" + esc(pick(p.country)) + "</dd></div>" +
        (p.visitedAt ? "<div><dt>" + esc(t("place.visited")) + "</dt><dd>" + esc(TM.i18n.formatMonth(p.visitedAt)) + "</dd></div>" : "") +
        "<div><dt>" + esc(t("place.media")) + "</dt><dd>" + esc(mediaCount.join(" · ")) + "</dd></div>" +
        "</dl></section>" +
        '<section aria-label="' + esc(t("place.gallery") + " — " + pick(p.name)) + '">' +
        '<div class="gallery-head"><' + Sub + ' class="gallery-title" id="' + id + '">' + esc(t("place.gallery")) + "</" + Sub + ">" +
        (p.media.length ? "<p>" + esc(t("place.galleryHint")) + "</p>" : "") + "</div>" +
        (p.media.length
          ? '<div class="media-grid"></div>'
          : '<div class="empty journey-empty">' + TM.icons.camera + "<h3>" + esc(t("place.noMediaTitle")) + "</h3><p>" + esc(t("place.noMediaText")) + "</p></div>") +
        "</section></div>"
      );
    }

    function fillSection(article, p, n) {
      article.innerHTML = sectionHtml(p, n);
      var grid = article.querySelector(".media-grid");
      if (grid) {
        TM.ui.renderMediaGrid(grid, p, function (i, el) {
          TM.lightbox.open(p, i, el);
        });
      }
      var play = article.querySelector("[data-play]");
      if (play) {
        glowWhenSeen(play);
        play.addEventListener("click", function () {
          TM.slideshow.open(p, { from: play, next: nextAfter(article) });
        });
      }
      TM.ui.wireLazy(article);
      TM.ui.reveal(article);
    }

    /* The Play button glows briefly the first time its cover comes into view. */
    var glowObserver =
      "IntersectionObserver" in window
        ? new IntersectionObserver(
            function (entries) {
              entries.forEach(function (e) {
                if (!e.isIntersecting) return;
                e.target.classList.add("is-glowing");
                glowObserver.unobserve(e.target);
              });
            },
            { threshold: 1 }
          )
        : null;

    function glowWhenSeen(button) {
      if (glowObserver) glowObserver.observe(button);
    }

    /*
     * The destination after this section in the journey, for the slideshow's end screen:
     * "Next" scrolls the page to it (adding it if needed) and plays its slideshow.
     */
    function nextAfter(article) {
      if (journey.list.length < 2) return null;
      var p = journey.list[(journey.list.indexOf(journey.list.filter(function (x) {
        return x.slug === article.getAttribute("data-slug");
      })[0]) + 1) % journey.list.length];
      return {
        place: p,
        go: function () {
          var el = article.nextElementSibling;
          while (el && !el.classList.contains("journey-item")) {
            if (el === sentinel) {
              appendNext();
              el = article.nextElementSibling;
              continue;
            }
            el = el.nextElementSibling;
          }
          if (!el) return;
          window.scrollTo({ top: el.getBoundingClientRect().top + window.pageYOffset, behavior: "instant" });
          var play = el.querySelector("[data-play]");
          if (play) play.click();
        }
      };
    }

    /* Adds the next destination (and, when wrapping around, a "back to the beginning" divider). */
    function appendNext() {
      var list = journey.list;
      var index = (journey.start + shown) % list.length;
      if (shown > 0 && list.length === 1) return false; // a single destination does not repeat
      if (shown > 0 && index === 0 && list.length > 1) {
        var divider = document.createElement("div");
        divider.className = "journey-loop";
        divider.innerHTML = TM.icons.compass + "<p>" + esc(t("journey.loop")) + "</p>";
        main.insertBefore(divider, sentinel);
      }
      var p = list[index];
      var article = document.createElement("article");
      article.className = "journey-item";
      article.setAttribute("data-slug", p.slug);
      article.setAttribute("data-n", String(shown));
      fillSection(article, p, shown);
      main.insertBefore(article, sentinel);
      sectionObserver.observe(article);
      shown++;
      return true;
    }

    /* Address bar and tab title follow the destination crossing the middle of the screen. */
    function setActive(article) {
      var s = article.getAttribute("data-slug");
      if (s === activeSlug) return;
      activeSlug = s;
      var p = journey.list.filter(function (x) {
        return x.slug === s;
      })[0];
      var qs = new URLSearchParams();
      qs.set("slug", s);
      if (journey.filtered) {
        if (criteria.query) qs.set("q", criteria.query);
        if (criteria.country) qs.set("country", criteria.country);
      }
      history.replaceState(null, "", location.pathname + "?" + qs.toString());
      document.title = pick(p.name) + " — Travel Memories";
    }

    var sectionObserver =
      "IntersectionObserver" in window
        ? new IntersectionObserver(
            function (entries) {
              entries.forEach(function (e) {
                if (e.isIntersecting) setActive(e.target);
              });
            },
            { rootMargin: "-50% 0px -50% 0px" }
          )
        : { observe: function () {} };

    /* Invisible marker after the last section: when it gets close, the next destination is added. */
    var sentinel = document.createElement("div");
    sentinel.className = "journey-sentinel";
    sentinel.setAttribute("aria-hidden", "true");
    var loadMore =
      "IntersectionObserver" in window
        ? new IntersectionObserver(
            function (entries) {
              if (!entries[0].isIntersecting) return;
              // Keep adding while the marker is still close (short destinations), a few at a time.
              for (var k = 0; k < 3; k++) {
                if (!appendNext()) break;
                if (sentinel.getBoundingClientRect().top > window.innerHeight + 1200) break;
              }
            },
            { rootMargin: "0px 0px 1200px 0px" }
          )
        : null;

    /* Language change: rebuild every section's text, keeping the reader's place on screen. */
    function relabel() {
      var articles = main.querySelectorAll(".journey-item");
      var anchor = null;
      var offset = 0;
      articles.forEach(function (a) {
        var r = a.getBoundingClientRect();
        if (!anchor && r.bottom > 0) {
          anchor = a;
          offset = r.top;
        }
      });
      articles.forEach(function (a) {
        var p = journey.list.filter(function (x) {
          return x.slug === a.getAttribute("data-slug");
        })[0];
        fillSection(a, p, Number(a.getAttribute("data-n")));
      });
      main.querySelectorAll(".journey-loop p").forEach(function (el) {
        el.textContent = t("journey.loop");
      });
      if (anchor) window.scrollBy(0, anchor.getBoundingClientRect().top - offset);
      var current = journey.list.filter(function (x) {
        return x.slug === activeSlug;
      })[0];
      if (current) document.title = pick(current.name) + " — Travel Memories";
    }

    function notFound() {
      main.innerHTML =
        '<section class="section"><div class="container" style="padding-top:var(--header-h)"><div class="empty">' + TM.icons.compass +
        "<h3>" + esc(t("place.notFoundTitle")) + "</h3><p>" + esc(t("place.notFoundText")) + '</p><a class="btn btn-primary" href="index.html#destinations">' + TM.icons.arrowLeft + esc(t("place.back")) + "</a></div></div></section>";
      document.querySelector(".site-header").classList.add("is-solid");
    }

    TM.api
      .getPlaces()
      .then(function (places) {
        journey = TM.filters.journey(places, slug, criteria);
        if (!journey) return notFound();
        main.innerHTML = "";
        main.appendChild(sentinel);
        document.title = pick(journey.list[journey.start].name) + " — Travel Memories";
        appendNext();
        if (loadMore) loadMore.observe(sentinel);
        else for (var i = 1; i < journey.list.length; i++) appendNext(); // old browsers: show the whole list once
        TM.i18n.onChange(relabel);
      })
      .catch(function () {
        document.querySelector(".site-header").classList.add("is-solid");
        main.innerHTML = '<section class="section"><div class="container" style="padding-top:var(--header-h)">' + loadError() + "</div></section>";
      });
  }

  /* "Try again" buttons (no inline handlers: the Content-Security-Policy forbids them). */
  document.addEventListener("click", function (e) {
    if (e.target.closest && e.target.closest("[data-reload]")) location.reload();
  });

  document.addEventListener("DOMContentLoaded", function () {
    TM.i18n.apply();
    TM.i18n.bindSwitch();
    TM.i18n.onChange(initFooter);
    initHeader();
    initFooter();
    initQuote();
    // Static elements marked .reveal also fade in on scroll.
    TM.ui.reveal(document);
    var page = document.body.getAttribute("data-page");
    if (page === "home") initHome();
    if (page === "place") initPlace();
  });
})();
