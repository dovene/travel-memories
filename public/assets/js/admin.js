/*
 * Administration screen, connected to the Worker API.
 *
 * - Text fields (name, description, city, country, visit date) are edited locally and saved
 *   with "Save & publish". Saves send the place version in If-Match, so an edit made from
 *   another tab or device is never silently overwritten.
 * - Media actions (upload, remove, reorder, cover) are applied immediately; each response
 *   returns the updated place, which keeps the local version current.
 * - File checks here only improve the experience; the server re-checks everything.
 */
(function () {
  "use strict";

  var TM = window.TM;
  var I = TM.icons;
  var esc = TM.ui.esc;
  var API = "/api/admin";

  var LIMITS = {
    image: { types: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/avif"], ext: ["jpg", "jpeg", "png", "webp", "heic", "heif", "avif"], max: 25 * 1024 * 1024 },
    video: { types: ["video/mp4", "video/quicktime", "video/webm"], ext: ["mp4", "m4v", "mov", "webm"], max: 95 * 1024 * 1024 }
  };
  var EXT_TYPES = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", heif: "image/heic", avif: "image/avif", mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm" };

  /* ISO 3166-1 alpha-2 codes; names come from the browser in English and French. */
  var COUNTRY_CODES = ("AD AE AF AG AI AL AM AO AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GT GU GW GY HK HN HR HT HU ID IE IL IM IN IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW").split(" ");
  var regionNames = {};
  function countryName(code, lang) {
    try {
      regionNames[lang] = regionNames[lang] || new Intl.DisplayNames([lang], { type: "region" });
      return regionNames[lang].of(code) || code;
    } catch (e) {
      return code;
    }
  }
  var COUNTRIES = COUNTRY_CODES.map(function (code) {
    return { code: code, en: countryName(code, "en"), fr: countryName(code, "fr") };
  }).sort(function (a, b) {
    return a.en.localeCompare(b.en);
  });
  function findCountry(text) {
    var t = String(text || "").trim().toLowerCase();
    if (!t) return null;
    return COUNTRIES.filter(function (c) {
      return c.en.toLowerCase() === t || c.fr.toLowerCase() === t || c.code.toLowerCase() === t;
    })[0] || null;
  }

  var places = [];
  var current = null; // server copy of the selected place (null = new destination)
  var draft = null;   // locally edited text fields
  var dirty = false;
  var tab = "en";

  var $ = function (id) {
    return document.getElementById(id);
  };

  /* ---------- API ---------- */
  function ApiError(status, body) {
    this.status = status;
    this.code = body && body.error && body.error.code;
    this.message = (body && body.error && body.error.message) || "Something went wrong.";
    this.details = body && body.error && body.error.details;
  }

  function request(method, path, body, headers) {
    var init = { method: method, credentials: "same-origin", headers: headers || {} };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
      init.headers["Content-Type"] = "application/json";
    }
    return fetch(API + path, init).then(function (res) {
      if (res.status === 401) {
        location.href = "/admin/login";
        throw new ApiError(401, null);
      }
      if (res.status === 204) return null;
      return res.json().catch(function () {
        return null;
      }).then(function (data) {
        if (!res.ok) throw new ApiError(res.status, data);
        return data;
      });
    });
  }

  function failed(err) {
    if (err && err.status === 401) return;
    TM.ui.toast((err && err.message) || "Network error — check your connection.");
  }

  /* ---------- helpers ---------- */
  function fmtSize(b) {
    if (b > 1024 * 1024) return (b / 1024 / 1024).toFixed(1) + " MB";
    return Math.max(1, Math.round(b / 1024)) + " KB";
  }

  function setDirty(v) {
    dirty = v;
    var s = $("save-state");
    s.classList.toggle("is-dirty", v);
    s.textContent = v ? "Unsaved changes" : current ? "All changes saved" : "New destination — not saved yet";
  }

  function draftFrom(place) {
    return {
      name: { en: (place && place.name.en) || "", fr: (place && place.name.fr) || "" },
      description: { en: (place && place.description && place.description.en) || "", fr: (place && place.description && place.description.fr) || "" },
      city: (place && place.city) || "",
      countryCode: (place && place.countryCode) || "",
      countryText: place ? (findCountry(place.countryCode) || { en: place.country.en }).en : "",
      visitedAt: (place && place.visitedAt) || ""
    };
  }

  function replacePlace(place) {
    var i = places.findIndex(function (p) {
      return p.id === place.id;
    });
    if (i === -1) places.unshift(place);
    else places[i] = place;
    if (current && current.id === place.id) current = place;
  }

  function coverOf(place) {
    return place.media.filter(function (m) {
      return m.id === place.coverMediaId;
    })[0];
  }

  /* ---------- sidebar ---------- */
  function renderList() {
    $("dest-list").innerHTML = places.length
      ? places
          .map(function (p) {
            var c = coverOf(p);
            var thumb = c && c.type === "image" ? '<img alt="" loading="lazy" src="' + esc(c.url) + '">' : '<span class="ph">' + (c ? I.video : I.image) + "</span>";
            return (
              '<li><button type="button" class="dest-item" data-id="' + esc(p.id) + '" aria-current="' + Boolean(current && p.id === current.id) + '">' +
              thumb +
              "<div><strong>" + esc(p.name.en) + "</strong><span>" + esc(p.city) + " · " + p.media.length + " item" + (p.media.length === 1 ? "" : "s") + "</span></div>" +
              '<span class="status-dot" title="Published"></span></button></li>'
            );
          })
          .join("")
      : '<li class="mm-empty" style="padding:var(--space-4)">No destinations yet. Create your first one.</li>';
  }

  /* ---------- editor ---------- */
  function clearErrors() {
    document.querySelectorAll(".field.has-error").forEach(function (f) {
      f.classList.remove("has-error");
    });
  }

  function load(place) {
    current = place;
    draft = draftFrom(place);
    tab = "en";
    clearErrors();
    $("upload-list").innerHTML = "";
    var title = place ? place.name.en : "New destination";
    $("editor-title").textContent = title;
    $("crumb-name").textContent = title;
    $("delete-place").hidden = !place;
    $("city").value = draft.city;
    $("country").value = draft.countryText;
    $("visited").value = /^\d{4}-\d{2}$/.test(draft.visitedAt) ? draft.visitedAt : "";
    renderTabs();
    renderMedia();
    renderList();
    setDirty(false);
    closeSide();
  }

  function renderTabs() {
    document.querySelectorAll("[data-tab]").forEach(function (b) {
      b.setAttribute("aria-selected", String(b.getAttribute("data-tab") === tab));
    });
    $("name").value = draft.name[tab];
    $("description").value = draft.description[tab];
    $("name").placeholder = tab === "fr" ? draft.name.en || "Nom en français" : "e.g. Berlin";
    $("description").placeholder = tab === "fr" ? "Laisser vide pour utiliser la version anglaise…" : "A few words about this place…";
    $("name-hint").textContent = tab === "fr" ? "falls back to English if empty" : "";
    $("desc-count").textContent = draft.description[tab].length;
  }

  function bindForm() {
    document.querySelectorAll("[data-tab]").forEach(function (b) {
      b.addEventListener("click", function () {
        tab = b.getAttribute("data-tab");
        renderTabs();
      });
    });
    $("name").addEventListener("input", function (e) {
      draft.name[tab] = e.target.value;
      if (tab === "en") {
        $("editor-title").textContent = e.target.value || "New destination";
        $("f-name").classList.remove("has-error");
      }
      setDirty(true);
    });
    $("description").addEventListener("input", function (e) {
      draft.description[tab] = e.target.value;
      $("desc-count").textContent = e.target.value.length;
      setDirty(true);
    });
    $("city").addEventListener("input", function (e) {
      draft.city = e.target.value;
      $("f-city").classList.remove("has-error");
      setDirty(true);
    });
    $("country").addEventListener("input", function (e) {
      draft.countryText = e.target.value;
      var match = findCountry(e.target.value);
      draft.countryCode = match ? match.code : "";
      if (match) $("f-country").classList.remove("has-error");
      setDirty(true);
    });
    $("visited").addEventListener("input", function (e) {
      draft.visitedAt = e.target.value;
      setDirty(true);
    });
    $("country-list").innerHTML = COUNTRIES.map(function (c) {
      return '<option value="' + esc(c.en) + '">' + esc(c.fr !== c.en ? c.fr : "") + "</option>";
    }).join("");
  }

  function payload() {
    var country = findCountry(draft.countryText);
    var body = {
      name: { en: draft.name.en.trim(), fr: draft.name.fr.trim() },
      description: { en: draft.description.en.trim(), fr: draft.description.fr.trim() },
      city: draft.city.trim(),
      visitedAt: draft.visitedAt || ""
    };
    if (country) {
      body.countryCode = country.code;
      body.country = { en: country.en, fr: country.fr };
    }
    if (!current && !body.visitedAt) delete body.visitedAt;
    return body;
  }

  function validateLocally() {
    clearErrors();
    var bad = [];
    if (!draft.name.en.trim()) bad.push("f-name");
    if (!draft.city.trim()) bad.push("f-city");
    if (!findCountry(draft.countryText)) bad.push("f-country");
    bad.forEach(function (id) {
      $(id).classList.add("has-error");
    });
    if (bad.length) {
      tab = "en";
      renderTabs();
      var first = document.querySelector(".field.has-error .input");
      if (first) first.focus();
    }
    return !bad.length;
  }

  /* Maps server validation paths (e.g. "/name/en") onto form fields. */
  function showServerErrors(details) {
    var map = { name: "f-name", city: "f-city", country: "f-country", countryCode: "f-country", visitedAt: "f-visited" };
    (details || []).forEach(function (d) {
      var key = String(d.path || "").split("/")[1];
      var field = map[key] && $(map[key]);
      if (field) {
        field.classList.add("has-error");
        var msg = field.querySelector(".error");
        if (msg && key !== "name" && key !== "country" && key !== "countryCode") msg.textContent = key + " " + d.message;
      }
    });
  }

  function save() {
    if (!validateLocally()) return;
    var btn = $("save");
    btn.classList.add("is-loading");
    btn.innerHTML = '<span class="spinner"></span> Saving…';
    var op = current
      ? request("PUT", "/places/" + encodeURIComponent(current.id), payload(), { "If-Match": '"' + current.version + '"' })
      : request("POST", "/places", payload());
    op.then(function (place) {
      replacePlace(place);
      load(place);
      TM.ui.toast("“" + place.name.en + "” saved");
    })
      .catch(function (err) {
        if (err.status === 412) {
          if (window.confirm("This destination was changed in another tab or device. Load the latest version? (Your unsaved text edits will be lost.)")) reloadCurrent();
          return;
        }
        if (err.status === 422) showServerErrors(err.details);
        failed(err);
      })
      .then(function () {
        btn.classList.remove("is-loading");
        btn.innerHTML = "Save &amp; publish";
      });
  }

  function reloadCurrent() {
    if (!current) return;
    request("GET", "/places/" + encodeURIComponent(current.id))
      .then(function (place) {
        replacePlace(place);
        load(place);
      })
      .catch(failed);
  }

  /* ---------- media ---------- */
  function renderMedia() {
    var box = $("media-manager");
    var locked = !current;
    $("dropzone").classList.toggle("is-locked", locked);
    $("dz-title").textContent = locked ? "Save the details first" : "Drop photos and videos here";
    $("dz-text").innerHTML = locked
      ? "Photos and videos can be added once the destination exists."
      : "or <u>browse your files</u> — JPG, PNG, WEBP, HEIC, AVIF, MP4, MOV, WEBM · up to 25 MB per photo, 95 MB per video";

    var media = current ? current.media.slice().sort(function (a, b) {
      return a.position - b.position;
    }) : [];
    var photos = media.filter(function (m) {
      return m.type === "image";
    }).length;
    $("media-count").textContent = photos + " photo" + (photos === 1 ? "" : "s") + " · " + (media.length - photos) + " video" + (media.length - photos === 1 ? "" : "s");

    if (!media.length) {
      box.innerHTML = locked ? "" : '<p class="mm-empty">No media yet. Add a few photos or videos above — the first one becomes the cover.</p>';
      return;
    }
    var n = media.length;
    box.innerHTML = media
      .map(function (m, i) {
        var isCover = m.id === current.coverMediaId;
        var name = TM.i18n.pick(m.altText) || m.originalFilename || "Media " + (i + 1);
        var visual =
          m.type === "video"
            ? '<video muted playsinline preload="metadata" src="' + esc(m.url) + '#t=0.5"></video>'
            : '<img alt="" loading="lazy" decoding="async" src="' + esc(m.url) + '">';
        return (
          '<div class="mm-item' + (isCover ? " is-cover" : "") + '" data-id="' + esc(m.id) + '">' +
          visual +
          '<div class="mm-top">' +
          '<button type="button" class="mm-handle" aria-label="Reorder ' + esc(name) + " (position " + (i + 1) + " of " + n + '). Use arrow keys to move.">' + I.grip + "</button>" +
          '<div class="mm-actions">' +
          '<button type="button" class="mm-btn' + (isCover ? " is-on" : "") + '" data-act="cover" aria-pressed="' + isCover + '" aria-label="Use as cover">' + (isCover ? I.starFill : I.star) + "</button>" +
          '<button type="button" class="mm-btn danger" data-act="remove" aria-label="Remove ' + esc(name) + '">' + I.trash + "</button>" +
          "</div></div>" +
          '<div class="mm-bottom"><span class="mm-pos">' + (i + 1) + "</span>" +
          (isCover ? '<span class="cover-badge">Cover</span>' : '<span class="mm-type">' + (m.type === "video" ? I.video + "Video" : "") + "</span>") +
          "</div></div>"
        );
      })
      .join("");
    /* Formats the browser cannot preview (e.g. HEIC outside Safari) show a label instead. */
    box.querySelectorAll("img").forEach(function (img) {
      img.addEventListener("error", function () {
        var label = document.createElement("span");
        label.className = "mm-fallback";
        label.textContent = "Preview not available in this browser";
        img.replaceWith(label);
      });
    });
  }

  function mediaAction(promise, item) {
    if (item) item.classList.add("is-busy");
    return promise
      .then(function (place) {
        replacePlace(place);
        renderMedia();
        renderList();
        return place;
      })
      .catch(function (err) {
        if (item) item.classList.remove("is-busy");
        if (err.status === 409 || err.status === 404) reloadCurrent();
        failed(err);
      });
  }

  function orderedIds() {
    return current.media.slice().sort(function (a, b) {
      return a.position - b.position;
    }).map(function (m) {
      return m.id;
    });
  }

  function moveItem(from, to) {
    var ids = orderedIds();
    if (to < 0 || to >= ids.length || from === to) return;
    var moved = ids.splice(from, 1)[0];
    ids.splice(to, 0, moved);
    // Show the new order right away, then confirm with the server.
    ids.forEach(function (id, i) {
      current.media.filter(function (m) {
        return m.id === id;
      })[0].position = i;
    });
    renderMedia();
    mediaAction(request("PUT", "/places/" + encodeURIComponent(current.id) + "/media/order", { order: ids }));
  }

  function bindMedia() {
    var box = $("media-manager");

    box.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-act]");
      if (!btn || !current) return;
      var item = btn.closest(".mm-item");
      var id = item.getAttribute("data-id");
      var base = "/places/" + encodeURIComponent(current.id) + "/media";
      if (btn.getAttribute("data-act") === "cover") {
        mediaAction(request("PUT", base + "/cover", { mediaId: id }), item).then(function (p) {
          if (p) TM.ui.toast("Cover updated");
        });
      } else if (window.confirm("Remove this item? The original file will be deleted.")) {
        mediaAction(request("DELETE", base + "/" + encodeURIComponent(id)), item).then(function (p) {
          if (p) TM.ui.toast("Removed");
        });
      }
    });

    box.addEventListener("keydown", function (e) {
      if (!e.target.classList.contains("mm-handle")) return;
      var id = e.target.closest(".mm-item").getAttribute("data-id");
      var ids = orderedIds();
      var i = ids.indexOf(id);
      var to = null;
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") to = i - 1;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") to = i + 1;
      if (to === null) return;
      e.preventDefault();
      moveItem(i, to);
      var h = box.querySelector('.mm-item[data-id="' + CSS.escape(id) + '"] .mm-handle');
      if (h) h.focus();
    });

    /* Pointer drag & drop (mouse anywhere on the tile, touch on the handle). */
    var drag = null;
    box.addEventListener("pointerdown", function (e) {
      var item = e.target.closest(".mm-item");
      if (!item || e.target.closest(".mm-btn") || (e.pointerType === "mouse" && e.button !== 0)) return;
      if (e.pointerType !== "mouse" && !e.target.closest(".mm-handle")) return;
      e.preventDefault();
      var r = item.getBoundingClientRect();
      drag = { id: item.getAttribute("data-id"), el: item, ox: e.clientX - r.left, oy: e.clientY - r.top, w: r.width, h: r.height, sx: e.clientX, sy: e.clientY, ghost: null, target: null };
    });

    window.addEventListener("pointermove", function (e) {
      if (!drag) return;
      if (!drag.ghost) {
        if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) < 6) return;
        var g = document.createElement("div");
        g.className = "mm-ghost";
        g.style.width = drag.w + "px";
        g.style.height = drag.h + "px";
        var visual = drag.el.querySelector("img, video, .mm-fallback");
        if (visual) g.appendChild(visual.cloneNode(true));
        document.body.appendChild(g);
        drag.ghost = g;
        drag.el.classList.add("is-dragging");
      }
      drag.ghost.style.left = e.clientX - drag.ox + "px";
      drag.ghost.style.top = e.clientY - drag.oy + "px";
      var under = document.elementFromPoint(e.clientX, e.clientY);
      var t = under && under.closest(".mm-item");
      if (drag.target && drag.target !== t) drag.target.classList.remove("is-drop-target");
      if (t && t !== drag.el) {
        t.classList.add("is-drop-target");
        drag.target = t;
      } else drag.target = null;
    });

    function endDrag() {
      if (!drag) return;
      var d = drag;
      drag = null;
      if (d.ghost) d.ghost.remove();
      d.el.classList.remove("is-dragging");
      if (d.target) {
        d.target.classList.remove("is-drop-target");
        var ids = orderedIds();
        moveItem(ids.indexOf(d.id), ids.indexOf(d.target.getAttribute("data-id")));
      }
    }
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
  }

  /* ---------- uploads ---------- */
  function classify(file) {
    var ext = (file.name.split(".").pop() || "").toLowerCase();
    var type = (file.type || EXT_TYPES[ext] || "").toLowerCase();
    if (type === "image/heif") type = "image/heic";
    var kind = LIMITS.image.types.indexOf(type) !== -1 ? "image" : LIMITS.video.types.indexOf(type) !== -1 ? "video" : null;
    if (!kind || LIMITS[kind].ext.indexOf(ext) === -1) return { error: "Unsupported file type" + (ext ? " ." + ext : "") };
    if (file.size > LIMITS[kind].max) return { error: "Too large — max " + fmtSize(LIMITS[kind].max) };
    if (!file.size) return { error: "The file is empty" };
    return { kind: kind, type: type };
  }

  function dimensions(file, kind) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(file);
      var done = function (w, h) {
        URL.revokeObjectURL(url);
        resolve(w && h ? { w: w, h: h } : null);
      };
      if (kind === "image") {
        var img = new Image();
        img.onload = function () {
          done(img.naturalWidth, img.naturalHeight);
        };
        img.onerror = function () {
          done();
        };
        img.src = url;
      } else {
        var v = document.createElement("video");
        v.preload = "metadata";
        v.onloadedmetadata = function () {
          done(v.videoWidth, v.videoHeight);
        };
        v.onerror = function () {
          done();
        };
        v.src = url;
      }
      setTimeout(function () {
        done();
      }, 8000);
    });
  }

  /* XMLHttpRequest because fetch() cannot report upload progress. */
  function send(placeId, file, type, size, onProgress) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open("POST", API + "/places/" + encodeURIComponent(placeId) + "/media");
      xhr.setRequestHeader("Content-Type", type);
      xhr.setRequestHeader("X-Filename", encodeURIComponent(file.name));
      if (size) {
        xhr.setRequestHeader("X-Media-Width", String(size.w));
        xhr.setRequestHeader("X-Media-Height", String(size.h));
      }
      xhr.upload.onprogress = function (e) {
        if (e.lengthComputable) onProgress(e.loaded / e.total);
      };
      xhr.onload = function () {
        var data = null;
        try {
          data = JSON.parse(xhr.responseText);
        } catch (e) {}
        if (xhr.status === 401) location.href = "/admin/login";
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(new ApiError(xhr.status, data));
      };
      xhr.onerror = function () {
        reject(new ApiError(0, { error: { message: "Network error during upload" } }));
      };
      xhr.send(file);
    });
  }

  var queue = Promise.resolve();

  function upload(files) {
    if (!current) return;
    var placeId = current.id;
    Array.prototype.forEach.call(files, function (file) {
      var check = classify(file);
      var row = document.createElement("div");
      row.className = "upload-row";
      row.innerHTML =
        '<span class="thumb" style="display:grid;place-items:center;color:var(--ocean)">' + (check.kind === "video" ? I.video : check.kind ? I.image : I.alert) + "</span>" +
        '<div style="min-width:0"><div class="name">' + esc(file.name) + '</div><div class="sub">' + fmtSize(file.size) + (check.error ? "" : " · Waiting…") + '</div><div class="progress"><span></span></div></div>' +
        '<span class="state"></span>';
      $("upload-list").prepend(row);
      var sub = row.querySelector(".sub");
      var bar = row.querySelector(".progress span");

      if (check.error) {
        row.classList.add("is-error");
        sub.textContent = check.error;
        row.querySelector(".progress").remove();
        row.querySelector(".state").innerHTML = I.alert;
        return;
      }

      // One upload at a time keeps the place version predictable and the connection free.
      queue = queue.then(function () {
        return dimensions(file, check.kind)
          .then(function (size) {
            return send(placeId, file, check.type, size, function (p) {
              bar.style.width = Math.round(p * 100) + "%";
              sub.textContent = fmtSize(file.size) + " · " + Math.round(p * 100) + "%";
            });
          })
          .then(function (place) {
            replacePlace(place);
            if (current && current.id === place.id) renderMedia();
            renderList();
            row.classList.add("is-done");
            bar.style.width = "100%";
            sub.textContent = fmtSize(file.size) + " · Uploaded";
            row.querySelector(".state").innerHTML = I.check;
            setTimeout(function () {
              row.style.transition = "opacity 400ms";
              row.style.opacity = "0";
              setTimeout(function () {
                row.remove();
              }, 400);
            }, 2200);
          })
          .catch(function (err) {
            row.classList.add("is-error");
            var progress = row.querySelector(".progress");
            if (progress) progress.remove();
            sub.textContent = err.message;
            row.querySelector(".state").innerHTML = I.alert;
          });
      });
    });
  }

  function bindUploads() {
    var dz = $("dropzone");
    $("dz-icon").innerHTML = I.upload;
    $("file-input").addEventListener("change", function (e) {
      upload(e.target.files);
      e.target.value = "";
    });
    ["dragenter", "dragover"].forEach(function (ev) {
      dz.addEventListener(ev, function (e) {
        e.preventDefault();
        if (current) dz.classList.add("is-over");
      });
    });
    ["dragleave", "drop"].forEach(function (ev) {
      dz.addEventListener(ev, function () {
        dz.classList.remove("is-over");
      });
    });
    dz.addEventListener("drop", function (e) {
      e.preventDefault();
      if (e.dataTransfer && e.dataTransfer.files.length) upload(e.dataTransfer.files);
    });
    window.addEventListener("dragover", function (e) {
      e.preventDefault();
    });
    window.addEventListener("drop", function (e) {
      e.preventDefault();
    });
  }

  /* ---------- actions ---------- */
  function confirmLeave() {
    return !dirty || window.confirm("You have unsaved changes. Leave this destination anyway?");
  }

  function bindActions() {
    $("save").addEventListener("click", save);
    $("discard").addEventListener("click", function () {
      load(current);
      TM.ui.toast("Changes discarded");
    });

    $("new-place").innerHTML = I.plus + "New destination";
    $("new-place").addEventListener("click", function () {
      if (!confirmLeave()) return;
      load(null);
      $("name").focus();
    });

    $("dest-list").addEventListener("click", function (e) {
      var b = e.target.closest(".dest-item");
      if (!b || !confirmLeave()) return;
      var p = places.filter(function (x) {
        return x.id === b.getAttribute("data-id");
      })[0];
      load(p);
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    var dlg = $("confirm-delete");
    $("delete-place").addEventListener("click", function () {
      $("confirm-name").textContent = current.name.en;
      if (dlg.showModal) dlg.showModal();
    });
    $("confirm-cancel").addEventListener("click", function () {
      dlg.close();
    });
    $("confirm-ok").addEventListener("click", function () {
      var gone = current;
      request("DELETE", "/places/" + encodeURIComponent(gone.id), undefined, { "If-Match": '"' + gone.version + '"' })
        .then(function () {
          places = places.filter(function (p) {
            return p.id !== gone.id;
          });
          dlg.close();
          load(places[0] || null);
          TM.ui.toast("“" + gone.name.en + "” deleted");
        })
        .catch(function (err) {
          dlg.close();
          if (err.status === 412) {
            TM.ui.toast("This destination changed meanwhile — reloaded, please check before deleting.");
            reloadCurrent();
            return;
          }
          failed(err);
        });
    });

    $("logout").addEventListener("click", function (e) {
      e.preventDefault();
      if (!confirmLeave()) return;
      fetch(API + "/logout", { method: "POST", credentials: "same-origin" }).then(function () {
        location.href = "/admin/login";
      });
    });

    window.addEventListener("beforeunload", function (e) {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    });
  }

  /* ---------- mobile sidebar ---------- */
  function closeSide() {
    $("admin-side").classList.remove("is-open");
    $("side-toggle").setAttribute("aria-expanded", "false");
  }

  function bindSide() {
    var t = $("side-toggle");
    t.innerHTML = I.menu;
    t.addEventListener("click", function () {
      var open = !$("admin-side").classList.contains("is-open");
      $("admin-side").classList.toggle("is-open", open);
      t.setAttribute("aria-expanded", String(open));
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    bindForm();
    bindMedia();
    bindUploads();
    bindActions();
    bindSide();
    request("GET", "/session")
      .then(function (s) {
        if (!s.authenticated) {
          location.href = "/admin/login";
          return;
        }
        $("avatar").textContent = (s.username || "?").charAt(0).toUpperCase();
        $("view-live").href = "/";
        return request("GET", "/places").then(function (data) {
          places = data.places;
          load(places[0] || null);
        });
      })
      .catch(failed);
  });
})();
