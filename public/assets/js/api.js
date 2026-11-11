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
      return poster ? { src: poster.url, srcset: "", width: poster.width, height: poster.height, sharp: false } : null;
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
      sharp: Boolean(width && height && width >= HERO_MIN_WIDTH && width >= height * 1.2)
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

  /*
   * Up to four destinations for the full-screen homepage hero, in display order (featured
   * first). Only sharp landscape photos qualify — the cover if it is one, otherwise the
   * destination's first photo that is. Video frames, portrait and small photos are skipped:
   * they look soft when stretched across a screen. No qualifying photo → the plain hero.
   */
  function heroSlides(places) {
    var slides = [];
    for (var i = 0; i < places.length && slides.length < 4; i++) {
      var p = places[i];
      var candidates = [cover(p)].concat(p.media);
      for (var k = 0; k < candidates.length; k++) {
        var m = candidates[k];
        var pic = m && m.type === "image" ? image(m, "display") : null;
        if (pic && pic.sharp) {
          slides.push({ place: p, image: pic });
          break;
        }
      }
    }
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
