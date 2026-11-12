/*
 * Admin › Visitors: page views of the public site over the last 7, 30 or 90 days.
 * The API returns raw visits (at most 31 days per call); totals are computed here.
 */
(function () {
  "use strict";

  var TM = window.TM;
  var A = TM.admin;
  var esc = TM.ui.esc;
  var DAY_MS = 86400000;
  var BAR = "#1d7fb5"; // validated chart blue, close to the site's ocean colour

  var cache = {};
  var placeNames = {};
  var countryNames = null;
  try {
    countryNames = new Intl.DisplayNames(["en"], { type: "region" });
  } catch (e) {
    countryNames = null;
  }

  var $ = function (id) {
    return document.getElementById(id);
  };

  function iso(ms) {
    return new Date(ms).toISOString().slice(0, 10);
  }

  function country(code) {
    if (!code) return "Unknown";
    try {
      return (countryNames && countryNames.of(code)) || code;
    } catch (e) {
      return code;
    }
  }

  function flag(code) {
    if (!code || !/^[A-Z]{2}$/.test(code)) return "";
    return String.fromCodePoint(0x1f1e6 + code.charCodeAt(0) - 65, 0x1f1e6 + code.charCodeAt(1) - 65);
  }

  function fmt(n) {
    return n.toLocaleString("en");
  }

  /* Visits of the last `days` days (today included), in calls of at most 31 days. */
  function load(days) {
    if (cache[days]) return Promise.resolve(cache[days]);
    var today = Date.parse(iso(Date.now()) + "T00:00:00Z");
    var first = today - (days - 1) * DAY_MS;
    var calls = [];
    for (var start = first; start <= today; start += 31 * DAY_MS) {
      var end = Math.min(start + 30 * DAY_MS, today);
      calls.push(A.request("GET", "/visits?from=" + iso(start) + "&to=" + iso(end)));
    }
    return Promise.all(calls).then(function (parts) {
      var visits = [];
      parts.forEach(function (p) {
        visits = visits.concat(p.visits);
      });
      var dayList = [];
      for (var d = first; d <= today; d += DAY_MS) dayList.push(iso(d));
      return (cache[days] = { days: dayList, visits: visits });
    });
  }

  /* Counts per key: [{ key, label, visits, visitors }] sorted by visits. */
  function tally(visits, keyOf, labelOf) {
    var map = {};
    visits.forEach(function (v) {
      var k = keyOf(v);
      if (!map[k]) map[k] = { key: k, label: labelOf(v), visits: 0, ids: {} };
      map[k].visits++;
      map[k].ids[v.t.slice(0, 10) + v.v] = 1;
    });
    return Object.keys(map)
      .map(function (k) {
        var r = map[k];
        return { key: r.key, label: r.label, visits: r.visits, visitors: Object.keys(r.ids).length };
      })
      .sort(function (a, b) {
        return b.visits - a.visits || a.label.localeCompare(b.label);
      });
  }

  function uniqueVisitors(visits) {
    var ids = {};
    visits.forEach(function (v) {
      ids[v.t.slice(0, 10) + v.v] = 1;
    });
    return Object.keys(ids).length;
  }

  function renderStats(data) {
    var v = data.visits;
    var countries = tally(v, function (x) { return x.cc || "?"; }, function (x) { return x.cc || "?"; }).filter(function (r) { return r.key !== "?"; });
    var cities = tally(v, function (x) { return (x.ci || "") + "|" + (x.cc || ""); }, function (x) { return x.ci || ""; }).filter(function (r) { return r.label; });
    var tiles = [
      ["Visits", fmt(v.length), "pages opened"],
      ["Visitors", fmt(uniqueVisitors(v)), "different people, counted per day"],
      ["Countries", fmt(countries.length), countries[0] ? "most: " + country(countries[0].key) : "—"],
      ["Cities", fmt(cities.length), cities[0] ? "most: " + cities[0].label : "—"]
    ];
    $("stats").innerHTML = tiles
      .map(function (t) {
        return '<div class="stat-tile"><span class="stat-label">' + esc(t[0]) + '</span><strong class="stat-value">' + esc(t[1]) + '</strong><span class="stat-note">' + esc(t[2]) + "</span></div>";
      })
      .join("");
  }

  /* Column chart of visits per day, with a tooltip per day. */
  var lastData = null;
  function renderChart(data) {
    lastData = data;
    var perDay = {};
    data.visits.forEach(function (v) {
      var d = v.t.slice(0, 10);
      perDay[d] = (perDay[d] || 0) + 1;
    });
    var values = data.days.map(function (d) {
      return perDay[d] || 0;
    });
    var max = Math.max.apply(null, values);
    var wrap = $("chart");
    if (!max) {
      wrap.innerHTML = '<p class="empty-note">No visits in this period yet. Counting started when this page was added; new visits appear within a minute.</p>';
      return;
    }
    var step = max <= 4 ? 1 : Math.ceil(max / 4 / Math.pow(10, Math.floor(Math.log10(max / 4)))) * Math.pow(10, Math.floor(Math.log10(max / 4)));
    var top = Math.ceil(max / step) * step;
    // Drawn at the real width so labels keep their size on phones.
    var W = Math.max(300, Math.round(wrap.clientWidth || 900));
    var H = W < 600 ? 200 : 260;
    var padL = 40;
    var padB = 28;
    var padT = 12;
    var plotW = W - padL - 8;
    var plotH = H - padB - padT;
    var slot = plotW / values.length;
    var bw = Math.min(24, Math.max(3, slot - 2));
    var y = function (n) {
      return padT + plotH - (n / top) * plotH;
    };
    var svg = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Visits per day, highest ' + max + '">';
    for (var g = 0; g <= top; g += step) {
      svg += '<line class="grid" x1="' + padL + '" x2="' + (W - 8) + '" y1="' + y(g) + '" y2="' + y(g) + '"/>';
      svg += '<text class="axis" x="' + (padL - 8) + '" y="' + (y(g) + 4) + '" text-anchor="end">' + g + "</text>";
    }
    var every = Math.ceil(values.length / Math.max(3, Math.floor(plotW / 80)));
    values.forEach(function (n, i) {
      var cx = padL + slot * i + slot / 2;
      var x = cx - bw / 2;
      if (n) {
        var h = y(0) - y(n);
        var r = Math.min(4, bw / 2, h);
        // Rounded top, square at the baseline.
        svg +=
          '<path class="bar" fill="' + BAR + '" d="M' + x + "," + y(0) + "V" + (y(n) + r) + "Q" + x + "," + y(n) + " " + (x + r) + "," + y(n) +
          "H" + (x + bw - r) + "Q" + (x + bw) + "," + y(n) + " " + (x + bw) + "," + (y(n) + r) + "V" + y(0) + 'Z"/>';
      }
      svg += '<rect class="hit" data-i="' + i + '" x="' + (padL + slot * i) + '" y="' + padT + '" width="' + slot + '" height="' + plotH + '"/>';
      if (i % every === 0 || i === values.length - 1) {
        var d = new Date(data.days[i] + "T00:00:00Z");
        svg += '<text class="axis" x="' + cx + '" y="' + (H - 8) + '" text-anchor="middle">' + d.toLocaleDateString("en", { day: "numeric", month: "short", timeZone: "UTC" }) + "</text>";
      }
    });
    svg += '<line class="baseline" x1="' + padL + '" x2="' + (W - 8) + '" y1="' + y(0) + '" y2="' + y(0) + '"/></svg>';
    wrap.innerHTML = svg + '<div class="chart-tip" hidden></div>';

    var tip = wrap.querySelector(".chart-tip");
    wrap.querySelectorAll(".hit").forEach(function (hit) {
      hit.addEventListener("mouseenter", function () {
        var i = Number(hit.getAttribute("data-i"));
        var d = new Date(data.days[i] + "T00:00:00Z");
        tip.innerHTML = "<strong>" + values[i] + " visit" + (values[i] === 1 ? "" : "s") + "</strong><span>" + d.toLocaleDateString("en", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }) + "</span>";
        tip.hidden = false;
        var r = hit.getBoundingClientRect();
        var w = wrap.getBoundingClientRect();
        tip.style.left = Math.min(Math.max(r.left - w.left + r.width / 2, 60), w.width - 60) + "px";
        tip.style.top = Math.max(0, (y(values[i]) / H) * w.height - 8) + "px";
        hit.classList.add("is-hover");
      });
      hit.addEventListener("mouseleave", function () {
        tip.hidden = true;
        hit.classList.remove("is-hover");
      });
    });
  }

  function table(rows, columns, empty) {
    if (!rows.length) return '<p class="empty-note">' + esc(empty) + "</p>";
    var max = rows[0].visits;
    return (
      '<table class="data-table"><thead><tr>' +
      columns.map(function (c) { return '<th scope="col"' + (c.num ? ' class="num"' : "") + ">" + esc(c.title) + "</th>"; }).join("") +
      "</tr></thead><tbody>" +
      rows
        .slice(0, 10)
        .map(function (r) {
          return (
            "<tr>" +
            '<td><span class="cell-bar" style="--w:' + Math.max(2, (r.visits / max) * 100).toFixed(1) + '%"></span><span class="cell-text">' + r.html + "</span></td>" +
            '<td class="num">' + fmt(r.visits) + "</td>" +
            '<td class="num">' + fmt(r.visitors) + "</td></tr>"
          );
        })
        .join("") +
      "</tbody></table>" +
      (rows.length > 10 ? '<p class="table-more">+ ' + (rows.length - 10) + " more</p>" : "")
    );
  }

  var COLS = [{ title: "" }, { title: "Visits", num: true }, { title: "Visitors", num: true }];

  function renderTables(data) {
    var v = data.visits;
    var cities = tally(v, function (x) { return (x.ci || "?") + "|" + (x.cc || ""); }, function (x) { return x.ci || ""; }).map(function (r) {
      var cc = r.key.split("|")[1];
      r.html = r.label ? esc(r.label) + ' <span class="muted">' + flag(cc) + " " + esc(country(cc)) + "</span>" : '<span class="muted">Unknown city</span>';
      return r;
    });
    $("cities").innerHTML = table(cities, [{ title: "City" }].concat(COLS.slice(1)), "No visits yet.");

    var countries = tally(v, function (x) { return x.cc || ""; }, function (x) { return x.cc || ""; }).map(function (r) {
      r.html = r.key ? flag(r.key) + " " + esc(country(r.key)) : '<span class="muted">Unknown</span>';
      return r;
    });
    $("countries").innerHTML = table(countries, [{ title: "Country" }].concat(COLS.slice(1)), "No visits yet.");

    var opened = tally(v, function (x) { return x.p === "home" ? "~home" : x.s; }, function (x) { return x.p === "home" ? "Homepage" : x.s; }).map(function (r) {
      r.html = r.key === "~home" ? "<em>Homepage</em>" : esc(placeNames[r.key] || r.key);
      return r;
    });
    $("places").innerHTML = table(opened, [{ title: "Page" }].concat(COLS.slice(1)), "No visits yet.");

    var sources = tally(v, function (x) { return x.rf || ""; }, function (x) { return x.rf || ""; }).map(function (r) {
      r.html = r.key ? esc(r.key) : '<span class="muted">Direct, or link from an app</span>';
      return r;
    });
    $("sources").innerHTML = table(sources, [{ title: "Site" }].concat(COLS.slice(1)), "No visits yet.");
  }

  function renderRecent(data) {
    var rows = data.visits
      .slice()
      .sort(function (a, b) {
        return a.t < b.t ? 1 : -1;
      })
      .slice(0, 50);
    if (!rows.length) {
      $("recent").innerHTML = '<p class="empty-note">No visits yet.</p>';
      return;
    }
    $("recent").innerHTML =
      '<table class="data-table recent"><thead><tr><th scope="col">When</th><th scope="col">Where</th><th scope="col">Page</th><th scope="col">Device</th><th scope="col">From</th></tr></thead><tbody>' +
      rows
        .map(function (v) {
          var when = new Date(v.t).toLocaleString("en", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
          var where = [v.ci, v.rg && v.rg !== v.ci ? v.rg : "", v.cc ? flag(v.cc) + " " + country(v.cc) : ""].filter(Boolean).join(", ") || "Unknown";
          var page = v.p === "home" ? "Homepage" : placeNames[v.s] || v.s;
          return "<tr><td>" + esc(when) + "</td><td>" + esc(where) + "</td><td>" + esc(page) + "</td><td>" + esc(v.dv || "") + "</td><td>" + esc(v.rf || "—") + "</td></tr>";
        })
        .join("") +
      "</tbody></table>";
  }

  function show(days) {
    document.querySelectorAll("#range button").forEach(function (b) {
      b.setAttribute("aria-pressed", String(Number(b.getAttribute("data-days")) === days));
    });
    $("stats").classList.add("is-loading");
    return load(days)
      .then(function (data) {
        $("stats").classList.remove("is-loading");
        $("daily-sub").textContent = "Page views of the public site, last " + days + " days (UTC).";
        renderStats(data);
        renderChart(data);
        renderTables(data);
        renderRecent(data);
      })
      .catch(A.failed);
  }

  document.addEventListener("DOMContentLoaded", function () {
    var resizeTimer = 0;
    window.addEventListener("resize", function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        if (lastData) renderChart(lastData);
      }, 150);
    });
    document.querySelectorAll("#range button").forEach(function (b) {
      b.addEventListener("click", function () {
        show(Number(b.getAttribute("data-days")));
      });
    });
    A.start()
      .then(function () {
        return A.request("GET", "/places").then(function (data) {
          data.places.forEach(function (p) {
            placeNames[p.slug] = p.name.en;
          });
        });
      })
      .then(function () {
        return show(30);
      })
      .catch(A.failed);
  });
})();
