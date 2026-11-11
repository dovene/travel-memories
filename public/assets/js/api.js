/*
 * Public content client for /api/public/:username/*.
 *
 * Media come with generated URLs: `url` is the original file, and `variants.thumb`,
 * `variants.display` and `variants.poster` are smaller copies when they exist.
 * Helpers below always pick the lightest version that fits, falling back to the original.
 */
(function () {
  "use strict";

  var TM = (window.TM = window.TM || {});

  var config = {
    /* The journal shown by this site. A <html data-username="…"> attribute can override it. */
    username: document.documentElement.getAttribute("data-username") || "dovene"
  };

  function base() {
    return "/api/public/" + encodeURIComponent(config.username);
  }

  function ApiError(status, message) {
    this.status = status;
    this.message = message;
  }

  function getJson(path) {
    return fetch(base() + path, { headers: { Accept: "application/json" } }).then(function (res) {
      if (res.status === 404) return null;
      if (!res.ok) throw new ApiError(res.status, "Request failed");
      return res.json();
    });
  }

  function sortMedia(place) {
    place.media.sort(function (a, b) {
      return a.position - b.position;
    });
    return place;
  }

  /* ---------- media helpers ---------- */

  function variant(m, name) {
    return m && m.variants && m.variants[name] ? m.variants[name] : null;
  }

  /* Formats every browser can show directly (HEIC is not one of them). */
  var WEB_SAFE = { "image/jpeg": true, "image/png": true, "image/webp": true, "image/avif": true };
  var DISPLAY_MAX = 2048;
  /* A photo is sharp enough to fill the screen when it is landscape and at least this wide. */
  var HERO_MIN_WIDTH = 1600;
  /* Below this long side a picture looks pixelated when enlarged: show it whole on a solid colour. */
  var LOW_RES_MAX = 1000;
  function isLowRes(w, h) {
    return Boolean(w && h && Math.max(w, h) < LOW_RES_MAX);
  }

  /*
   * The original can stand in for the "display" copy when browsers can show it and it is no
   * larger than a display copy would be — this avoids a needless second JPEG compression.
   */
  function originalIsDisplay(m) {
    return Boolean(WEB_SAFE[m.contentType] && m.width && m.height && Math.max(m.width, m.height) <= DISPLAY_MAX);
  }

  /*
   * { src, srcset, width, height, sharp } for showing a photo (or a video's poster) at a given size.
   * `sharp` tells whether it can fill a wide screen without visible enlargement.
   */
  function image(m, size) {
    if (!m) return null;
    if (m.type === "video") {
      var poster = variant(m, "poster");
      return poster
        ? { src: poster.url, srcset: "", width: poster.width, height: poster.height, sharp: false, lowRes: isLowRes(m.width || poster.width, m.height || poster.height) }
        : null;
    }
    var thumb = variant(m, "thumb");
    var display = originalIsDisplay(m) ? { url: m.url, width: m.width } : variant(m, "display");
    var parts = [];
    if (thumb) parts.push(thumb.url + " " + thumb.width + "w");
    if (display && (!thumb || display.width > thumb.width)) parts.push(display.url + " " + display.width + "w");
    var preferred = size === "thumb" ? thumb || display : display || thumb;
    var width = m.width || (preferred && preferred.width);
    var height = m.height || (preferred && preferred.height);
    return {
      src: preferred ? preferred.url : m.url,
      srcset: parts.length > 1 ? parts.join(", ") : "",
      width: width,
      height: height,
      sharp: Boolean(width && height && width >= HERO_MIN_WIDTH && width >= height * 1.2),
      lowRes: isLowRes(width, height)
    };
  }

  function ratio(m) {
    var w = m && (m.width || (variant(m, "poster") || variant(m, "display") || {}).width);
    var h = m && (m.height || (variant(m, "poster") || variant(m, "display") || {}).height);
    return w && h ? w + " / " + h : "4 / 3";
  }

  function cover(place) {
    if (!place || !place.media.length) return null;
    return (
      place.media.filter(function (m) {
        return m.id === place.coverMediaId;
      })[0] || place.media[0]
    );
  }

  /*
   * A cover that can be shown as a picture: the chosen cover if it is a photo (or a video
   * with a poster), otherwise the first media item that can be shown as a picture.
   */
  function coverImage(place, size) {
    var chosen = image(cover(place), size);
    if (chosen || !place) return chosen;
    for (var i = 0; i < place.media.length; i++) {
      var candidate = image(place.media[i], size);
      if (candidate) return candidate;
    }
    return null;
  }

  /* The destination's first sharp landscape photo (cover first), or null. */
  function sharpPhoto(p) {
    var candidates = [cover(p)].concat(p.media);
    for (var k = 0; k < candidates.length; k++) {
      var m = candidates[k];
      var pic = m && m.type === "image" ? image(m, "display") : null;
      if (pic && pic.sharp) return pic;
    }
    return null;
  }

  var HERO_MAX = 6;

  /*
   * Homepage hero slides, in display order:
   *   1. every featured destination (up to the limit): its sharp landscape photo fills the
   *      screen ("fill"); if it has none, its cover picture is shown whole on a solid colour
   *      taken from it ("contained") — never stretched;
   *   2. then sharp landscape photos of other destinations fill the remaining slots.
   * No slide at all → the plain gradient hero.
   */
  function heroSlides(places) {
    var slides = [];
    places.forEach(function (p) {
      if (!p.featured || slides.length >= HERO_MAX) return;
      var sharp = sharpPhoto(p);
      var any = sharp || coverImage(p, "display");
      if (any) slides.push({ place: p, image: any, mode: sharp ? "fill" : "contained" });
    });
    places.forEach(function (p) {
      if (p.featured || slides.length >= HERO_MAX) return;
      var sharp = sharpPhoto(p);
      if (sharp) slides.push({ place: p, image: sharp, mode: "fill" });
    });
    return slides;
  }

  TM.api = {
    config: config,
    image: image,
    ratio: ratio,
    cover: cover,
    coverImage: coverImage,
    heroSlides: heroSlides,
    originalIsDisplay: originalIsDisplay,
    getProfile: function () {
      return getJson("/profile");
    },
    getPlaces: function () {
      return getJson("/places").then(function (data) {
        return data ? data.places.map(sortMedia) : [];
      });
    },
    getPlace: function (slug) {
      return getJson("/places/" + encodeURIComponent(slug)).then(function (p) {
        return p ? sortMedia(p) : null;
      });
    }
  };
})();
