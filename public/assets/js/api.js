/*
 * Content API client.
 *
 * Phase 0: resolves against in-memory mock data with a small artificial delay
 * so loading states can be reviewed. The method names mirror the planned
 * public endpoints (GET /api/public/:username/...) so the UI code will not
 * change when the Worker API arrives.
 */
(function () {
  "use strict";

  var TM = (window.TM = window.TM || {});

  var config = {
    username: "dovene",
    /* Production: media URLs are generated from a configurable base URL,
       e.g. "/api/public/{username}/media/{mediaId}". */
    mediaBaseUrl: "https://images.unsplash.com/photo-",
    latency: 450
  };

  function clone(v) {
    return JSON.parse(JSON.stringify(v));
  }

  function delay(value) {
    return new Promise(function (resolve) {
      setTimeout(function () {
        resolve(clone(value));
      }, config.latency);
    });
  }

  function sortMedia(place) {
    place.media.sort(function (a, b) {
      return a.position - b.position;
    });
    return place;
  }

  function allPlaces() {
    return TM.mock.places.places.map(sortMedia);
  }

  /* Build a URL for a media item at a given display width. */
  function mediaUrl(media, width, height) {
    if (media.type === "video") return media.filename;
    if (/^(https?:|blob:|data:)/.test(media.filename)) return media.filename;
    var w = width || 1200;
    var h = height || Math.round((w * media.height) / media.width);
    return config.mediaBaseUrl + media.filename + "?auto=format&fit=crop&q=78&w=" + w + "&h=" + h;
  }

  function srcset(media, widths) {
    if (media.type === "video" || /^(blob:|data:)/.test(media.filename)) return "";
    return (widths || [400, 640, 900, 1280, 1800])
      .map(function (w) {
        return mediaUrl(media, w) + " " + w + "w";
      })
      .join(", ");
  }

  function cover(place) {
    var found = place.media.filter(function (m) {
      return m.id === place.coverMediaId;
    })[0];
    return found || place.media[0];
  }

  /* Poster image for a video tile: the place cover. */
  function poster(place) {
    var c = cover(place);
    return c && c.type === "image" ? mediaUrl(c, 900) : "";
  }

  TM.api = {
    config: config,
    mediaUrl: mediaUrl,
    srcset: srcset,
    cover: cover,
    poster: poster,
    getProfile: function () {
      return delay(TM.mock.profile);
    },
    getPlaces: function () {
      return delay(allPlaces());
    },
    getPlace: function (slug) {
      var p = allPlaces().filter(function (x) {
        return x.slug === slug;
      })[0];
      return p ? delay(p) : delay(null);
    },
    /* Synchronous access for the admin mockup only. */
    _placesSync: allPlaces,
    heroSlides: function () {
      var places = allPlaces();
      return TM.mock.heroSlides
        .map(function (s) {
          var p = places.filter(function (x) {
            return x.slug === s.slug;
          })[0];
          var m = p && p.media.filter(function (x) {
            return x.id === s.mediaId;
          })[0];
          return p && m ? { place: p, media: m } : null;
        })
        .filter(Boolean);
    }
  };
})();
