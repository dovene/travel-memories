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

  /* { src, srcset, width, height } for showing a photo (or a video's poster) at a given size. */
  function image(m, size) {
    if (!m) return null;
    if (m.type === "video") {
      var poster = variant(m, "poster");
      return poster ? { src: poster.url, srcset: "", width: poster.width, height: poster.height } : null;
    }
    var thumb = variant(m, "thumb");
    var display = variant(m, "display");
    var parts = [];
    if (thumb) parts.push(thumb.url + " " + thumb.width + "w");
    if (display) parts.push(display.url + " " + display.width + "w");
    var preferred = size === "thumb" ? thumb || display : display || thumb;
    return {
      src: preferred ? preferred.url : m.url,
      srcset: parts.length > 1 ? parts.join(", ") : "",
      width: m.width || (preferred && preferred.width),
      height: m.height || (preferred && preferred.height)
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

  /* Up to four destinations with a picture cover, for the homepage hero. */
  /*
   * Destinations shown in the home hero: every featured one first (in list order), then
   * HERO_EXTRA others picked at random on each visit, at most one per country, for at most
   * HERO_MAX slides. Only destinations whose cover can be shown as a photo take part.
   */
  var HERO_MAX = 9;
  var HERO_EXTRA = 4;

  function heroSlides(places, random) {
    random = random || Math.random;
    var withPhoto = places.filter(function (p) {
      return coverImage(p, "display");
    });
    var picked = withPhoto.filter(function (p) {
      return p.featured;
    }).slice(0, HERO_MAX);
    var others = withPhoto.filter(function (p) {
      return !p.featured;
    });
    for (var i = others.length - 1; i > 0; i--) {
      var j = Math.floor(random() * (i + 1));
      var tmp = others[i];
      others[i] = others[j];
      others[j] = tmp;
    }
    var countries = {};
    var room = Math.min(HERO_EXTRA, HERO_MAX - picked.length);
    for (var k = 0; k < others.length && room > 0; k++) {
      var c = others[k].countryCode || others[k].slug;
      if (countries[c]) continue;
      countries[c] = true;
      picked.push(others[k]);
      room--;
    }
    return picked.map(function (p) {
      return { place: p, image: coverImage(p, "display") };
    });
  }

  TM.api = {
    config: config,
    image: image,
    ratio: ratio,
    cover: cover,
    coverImage: coverImage,
    heroSlides: heroSlides,
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
