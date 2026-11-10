/* Search & filtering: case- and accent-insensitive, criteria combine with AND. */
(function () {
  "use strict";

  var TM = (window.TM = window.TM || {});

  function normalize(str) {
    return String(str || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  /* Every localized variant is searchable, so "Allemagne" finds Berlin in English too. */
  function haystack(place) {
    var parts = [place.city, place.countryCode];
    [place.name, place.country].forEach(function (field) {
      if (typeof field === "string") parts.push(field);
      else if (field) Object.keys(field).forEach(function (k) {
        parts.push(field[k]);
      });
    });
    return normalize(parts.join(" "));
  }

  /*
   * criteria: { query: string, country: countryCode | "" }
   * Each word in the query must match (AND), and the country filter applies on top.
   */
  function filterPlaces(places, criteria) {
    var tokens = normalize(criteria.query).split(" ").filter(Boolean);
    var country = criteria.country || "";
    return places.filter(function (p) {
      if (country && p.countryCode !== country) return false;
      if (!tokens.length) return true;
      var hay = haystack(p);
      return tokens.every(function (tok) {
        return hay.indexOf(tok) !== -1;
      });
    });
  }

  function countries(places) {
    var map = {};
    places.forEach(function (p) {
      if (!map[p.countryCode]) map[p.countryCode] = { code: p.countryCode, name: p.country, count: 0 };
      map[p.countryCode].count++;
    });
    return Object.keys(map).map(function (k) {
      return map[k];
    });
  }

  TM.filters = { normalize: normalize, filterPlaces: filterPlaces, countries: countries };
})();
