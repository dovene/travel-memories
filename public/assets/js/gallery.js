/* Rendering of destination cards and media galleries. */
(function () {
  "use strict";

  var TM = (window.TM = window.TM || {});
  var t = function (k, v) {
    return TM.i18n.t(k, v);
  };
  var pick = function (f) {
    return TM.i18n.pick(f);
  };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* Fade images in once decoded; shimmer placeholder until then. */
  function wireLazy(root) {
    root.querySelectorAll("img.lazy-img:not([data-wired])").forEach(function (img) {
      img.setAttribute("data-wired", "");
      var holder = img.closest(".media");
      function done() {
        img.classList.add("is-loaded");
        if (holder) holder.classList.remove("shimmer");
      }
      if (img.complete && img.naturalWidth) done();
      else {
        img.addEventListener("load", done, { once: true });
        img.addEventListener("error", done, { once: true });
      }
    });
  }

  /* Reveal-on-scroll with a small stagger. */
  var io =
    "IntersectionObserver" in window
      ? new IntersectionObserver(
          function (entries) {
            entries.forEach(function (e) {
              if (e.isIntersecting) {
                e.target.classList.add("is-visible");
                io.unobserve(e.target);
              }
            });
          },
          { rootMargin: "0px 0px -6% 0px", threshold: 0.05 }
        )
      : null;

  function reveal(root) {
    var items = root.querySelectorAll(".reveal:not(.is-visible)");
    items.forEach(function (el, i) {
      el.style.setProperty("--reveal-delay", (i % 6) * 70 + "ms");
      if (io) io.observe(el);
      else el.classList.add("is-visible");
    });
  }

  function countLabel(place) {
    if (!place.media.length) return "<span>" + TM.icons.camera + esc(t("card.soon")) + "</span>";
    var photos = place.media.filter(function (m) {
      return m.type === "image";
    }).length;
    var videos = place.media.length - photos;
    var out = photos ? '<span>' + TM.icons.camera + (photos === 1 ? t("card.photo") : t("card.photos", { n: photos })) + "</span>" : "";
    if (videos) out += "<span>" + TM.icons.video + (videos === 1 ? t("card.video") : t("card.videos", { n: videos })) + "</span>";
    return out;
  }

  function placeHref(place) {
    return "place.html?slug=" + encodeURIComponent(place.slug);
  }

  /* <img> markup for a photo/poster with lazy loading and responsive sources; "" when none. */
  function imgTag(img, alt, opts) {
    if (!img) return "";
    return (
      '<img class="lazy-img" loading="' + (opts.eager ? "eager" : "lazy") + '" decoding="async" alt="' + esc(alt) + '" src="' + esc(img.src) + '"' +
      (img.srcset ? ' srcset="' + esc(img.srcset) + '" sizes="' + opts.sizes + '"' : "") +
      ">"
    );
  }

  /* Placeholder for destinations without photos yet: brand gradient with a compass. */
  function noCover() {
    return '<div class="no-cover" aria-hidden="true">' + TM.icons.compass + "</div>";
  }

  function placeCard(place, index) {
    var c = TM.api.cover(place);
    var img = TM.api.coverImage(place, "thumb");
    /* Alternate tall / wide crops for an editorial rhythm. */
    var ratios = ["4 / 5", "1 / 1", "3 / 4", "5 / 4", "4 / 5", "2 / 3"];
    var ratio = ratios[index % ratios.length];
    var name = pick(place.name);
    return (
      '<a class="place-card reveal' + (img ? "" : " is-empty") + '" href="' + placeHref(place) + '" style="--ratio:' + ratio + '" aria-label="' + esc(t("card.open", { name: name })) + '">' +
      '<div class="media' + (img ? " shimmer" : "") + '">' +
      (img ? imgTag(img, pick(c.altText), { eager: index < 3, sizes: "(max-width: 640px) 50vw, (max-width: 1100px) 50vw, 33vw" }) : noCover()) +
      "</div>" +
      '<span class="go">' + TM.icons.arrowUpRight + "</span>" +
      '<div class="body">' +
      '<span class="loc">' + esc(place.city) + " · " + esc(pick(place.country)) + "</span>" +
      "<h3>" + esc(name) + "</h3>" +
      '<p class="desc">' + esc(pick(place.description)) + "</p>" +
      '<div class="meta">' + countLabel(place) + "</div>" +
      "</div></a>"
    );
  }

  function renderPlaceCards(container, places) {
    container.innerHTML = places.map(placeCard).join("");
    wireLazy(container);
    reveal(container);
  }

  function renderSkeletons(container, n) {
    var ratios = ["4 / 5", "1 / 1", "3 / 4", "5 / 4", "4 / 5", "2 / 3"];
    var out = "";
    for (var i = 0; i < n; i++) out += '<div class="skeleton shimmer" style="aspect-ratio:' + ratios[i % ratios.length] + '"></div>';
    container.innerHTML = out;
  }

  function mediaTile(place, m, i) {
    var ratio = TM.api.ratio(m);
    var alt = pick(m.altText);
    if (m.type === "video") {
      var poster = TM.api.image(m);
      return (
        '<button type="button" class="media-tile reveal" data-index="' + i + '" style="--ratio:' + ratio + '" aria-label="' + esc(t("media.play", { alt: alt })) + '">' +
        '<div class="media shimmer"><video muted loop playsinline preload="' + (poster ? "none" : "metadata") + '"' +
        (poster ? ' poster="' + esc(poster.src) + '"' : "") + ' src="' + esc(m.url) + (poster ? "" : "#t=0.5") + '"></video></div>' +
        '<span class="play-orb">' + TM.icons.play + "</span>" +
        '<span class="media-badge">' + TM.icons.video + esc(t("media.video")) + "</span>" +
        "</button>"
      );
    }
    return (
      '<button type="button" class="media-tile reveal" data-index="' + i + '" style="--ratio:' + ratio + '" aria-label="' + esc(t("media.view", { alt: alt })) + '">' +
      '<div class="media shimmer">' + imgTag(TM.api.image(m, "thumb"), alt, { sizes: "(max-width: 640px) 50vw, (max-width: 1100px) 50vw, 33vw" }) + "</div>" +
      "</button>"
    );
  }

  function renderMediaGrid(container, place, onOpen) {
    container.innerHTML = place.media
      .map(function (m, i) {
        return mediaTile(place, m, i);
      })
      .join("");
    wireLazy(container);
    reveal(container);

    container.querySelectorAll("video").forEach(function (v) {
      var holder = v.closest(".media");
      if (v.poster) {
        // The poster is a small image: show it as soon as it has loaded, without fetching the video.
        var probe = new Image();
        probe.onload = probe.onerror = function () {
          holder.classList.remove("shimmer");
        };
        probe.src = v.poster;
      } else {
        v.addEventListener("loadeddata", function () {
          holder.classList.remove("shimmer");
        }, { once: true });
      }
      var tile = v.closest(".media-tile");
      /* Silent preview on hover (pointer devices only). */
      if (window.matchMedia("(hover: hover)").matches) {
        tile.addEventListener("mouseenter", function () {
          tile.classList.add("is-previewing");
          v.play().catch(function () {});
        });
        tile.addEventListener("mouseleave", function () {
          tile.classList.remove("is-previewing");
          v.pause();
        });
      }
    });

    container.addEventListener("click", function (e) {
      var tile = e.target.closest(".media-tile");
      if (tile) onOpen(+tile.getAttribute("data-index"), tile);
    });
  }

  TM.ui = {
    esc: esc,
    wireLazy: wireLazy,
    reveal: reveal,
    placeHref: placeHref,
    imgTag: imgTag,
    noCover: noCover,
    renderPlaceCards: renderPlaceCards,
    renderSkeletons: renderSkeletons,
    renderMediaGrid: renderMediaGrid,
    toast: function (msg) {
      var region = document.querySelector(".toast-region");
      if (!region) {
        region = document.createElement("div");
        region.className = "toast-region";
        region.setAttribute("role", "status");
        region.setAttribute("aria-live", "polite");
        document.body.appendChild(region);
      }
      var el = document.createElement("div");
      el.className = "toast";
      el.innerHTML = TM.icons.check + "<span>" + esc(msg) + "</span>";
      region.appendChild(el);
      setTimeout(function () {
        el.classList.add("is-leaving");
        el.addEventListener("animationend", function () {
          el.remove();
        });
      }, 2600);
    }
  };
})();
