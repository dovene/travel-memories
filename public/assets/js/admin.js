/*
 * Administration screen — visual prototype.
 * Everything happens in memory: no authentication, no network writes, no persistence.
 * Client-side checks here are UX only; the real Worker must validate everything server-side.
 */
(function () {
  "use strict";

  var TM = window.TM;
  var I = TM.icons;
  var esc = TM.ui.esc;

  var LIMITS = {
    image: { types: ["image/jpeg", "image/png", "image/webp", "image/heic"], ext: ["jpg", "jpeg", "png", "webp", "heic"], max: 25 * 1024 * 1024 },
    video: { types: ["video/mp4", "video/quicktime"], ext: ["mp4", "mov"], max: 500 * 1024 * 1024 }
  };

  var places = TM.api._placesSync();
  var selectedId = null;
  var draft = null;
  var dirty = false;
  var tab = "en";
  var newCounter = 0;

  var $ = function (id) {
    return document.getElementById(id);
  };

  function clone(v) {
    return JSON.parse(JSON.stringify(v));
  }

  function blank() {
    return {
      id: "",
      ownerId: "dovene",
      slug: "",
      name: { en: "", fr: "" },
      description: { en: "", fr: "" },
      city: "",
      country: { en: "", fr: "" },
      countryCode: "",
      coverMediaId: null,
      media: []
    };
  }

  function slugify(s) {
    return String(s || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }

  function fmtSize(b) {
    if (b > 1024 * 1024) return (b / 1024 / 1024).toFixed(1) + " MB";
    return Math.max(1, Math.round(b / 1024)) + " KB";
  }

  /* ---------- Dirty state ---------- */
  function setDirty(v) {
    dirty = v;
    var s = $("save-state");
    s.classList.toggle("is-dirty", v);
    s.textContent = v ? "Unsaved changes" : "All changes saved";
  }

  /* ---------- Sidebar ---------- */
  function renderList() {
    $("dest-list").innerHTML = places
      .map(function (p) {
        var c = TM.api.cover(p);
        var thumb = c && c.type === "image" ? '<img alt="" src="' + esc(TM.api.mediaUrl(c, 120, 120)) + '">' : '<span class="ph">' + I.image + "</span>";
        return (
          '<li><button type="button" class="dest-item" data-id="' + esc(p.id) + '" aria-current="' + (p.id === selectedId) + '">' +
          thumb +
          "<div><strong>" + esc(p.name.en || "Untitled") + "</strong><span>" + esc(p.city) + " · " + p.media.length + " items</span></div>" +
          '<span class="status-dot" title="Published"></span>' +
          "</button></li>"
        );
      })
      .join("");
    var countries = {};
    places.forEach(function (p) {
      countries[p.country.en] = 1;
    });
    $("country-list").innerHTML = Object.keys(countries)
      .sort()
      .map(function (c) {
        return '<option value="' + esc(c) + '">';
      })
      .join("");
  }

  /* ---------- Editor ---------- */
  function load(place) {
    selectedId = place ? place.id : null;
    draft = place ? clone(place) : blank();
    tab = "en";
    setDirty(false);
    $("upload-list").innerHTML = "";
    ["f-name", "f-city", "f-country"].forEach(function (id) {
      $(id).classList.remove("has-error");
    });
    renderEditor();
    renderList();
    closeSide();
  }

  function renderEditor() {
    var title = draft.name.en || "New destination";
    $("editor-title").textContent = title;
    $("crumb-name").textContent = title;
    $("delete-place").hidden = !selectedId;
    $("preview-link").hidden = !selectedId;
    if (selectedId) $("preview-link").href = "../place.html?slug=" + encodeURIComponent(draft.slug);
    renderTabs();
    $("city").value = draft.city;
    $("country").value = draft.country.en;
    renderMedia();
  }

  function renderTabs() {
    document.querySelectorAll("[data-tab]").forEach(function (b) {
      b.setAttribute("aria-selected", String(b.getAttribute("data-tab") === tab));
    });
    $("name").value = draft.name[tab] || "";
    $("description").value = draft.description[tab] || "";
    $("name").placeholder = tab === "fr" ? draft.name.en || "Nom en français" : "e.g. Berlin";
    $("description").placeholder = tab === "fr" ? "Laisser vide pour utiliser la version anglaise…" : "A few words about this place…";
    $("name-hint").textContent = tab === "fr" ? "falls back to English if empty" : "";
    $("desc-count").textContent = ($("description").value || "").length;
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
        $("crumb-name").textContent = e.target.value || "New destination";
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
      draft.country.en = e.target.value;
      var match = places.filter(function (p) {
        return p.country.en.toLowerCase() === e.target.value.trim().toLowerCase();
      })[0];
      draft.country.fr = match ? match.country.fr : "";
      draft.countryCode = match ? match.countryCode : "";
      $("f-country").classList.remove("has-error");
      setDirty(true);
    });
  }

  /* ---------- Media manager ---------- */
  function renderMedia() {
    var box = $("media-manager");
    var n = draft.media.length;
    var photos = draft.media.filter(function (m) {
      return m.type === "image";
    }).length;
    $("media-count").textContent = photos + " photo" + (photos === 1 ? "" : "s") + " · " + (n - photos) + " video" + (n - photos === 1 ? "" : "s");
    if (!n) {
      box.innerHTML = '<p class="mm-empty">No media yet. Add a few photos or videos above — the first one becomes the cover.</p>';
      return;
    }
    box.innerHTML = draft.media
      .map(function (m, i) {
        var isCover = m.id === draft.coverMediaId;
        var visual =
          m.type === "video"
            ? '<video muted playsinline preload="metadata" src="' + esc(TM.api.mediaUrl(m)) + '#t=0.5"></video>'
            : '<img alt="" loading="lazy" src="' + esc(TM.api.mediaUrl(m, 400, 400)) + '">';
        var name = TM.i18n.pick(m.altText) || "Media " + (i + 1);
        return (
          '<div class="mm-item' + (isCover ? " is-cover" : "") + (m.isNew ? " is-new" : "") + '" data-id="' + esc(m.id) + '">' +
          visual +
          '<div class="mm-top">' +
          '<button type="button" class="mm-handle" aria-label="Reorder ' + esc(name) + ' (position ' + (i + 1) + " of " + n + '). Use arrow keys to move.">' + I.grip + "</button>" +
          '<div class="mm-actions">' +
          '<button type="button" class="mm-btn' + (isCover ? " is-on" : "") + '" data-act="cover" aria-pressed="' + isCover + '" aria-label="Use as cover">' + (isCover ? I.starFill : I.star) + "</button>" +
          '<button type="button" class="mm-btn danger" data-act="remove" aria-label="Remove ' + esc(name) + '">' + I.trash + "</button>" +
          "</div></div>" +
          '<div class="mm-bottom"><span class="mm-pos">' + (i + 1) + "</span>" +
          (isCover ? '<span class="cover-badge">' + "Cover</span>" : '<span class="mm-type">' + (m.type === "video" ? I.video + "Video" : "") + "</span>") +
          "</div></div>"
        );
      })
      .join("");
  }

  function moveItem(from, to) {
    if (to < 0 || to >= draft.media.length || from === to) return;
    var item = draft.media.splice(from, 1)[0];
    draft.media.splice(to, 0, item);
    draft.media.forEach(function (m, i) {
      m.position = i;
    });
    setDirty(true);
    renderMedia();
  }

  function indexOfId(id) {
    for (var i = 0; i < draft.media.length; i++) if (draft.media[i].id === id) return i;
    return -1;
  }

  function bindMedia() {
    var box = $("media-manager");

    box.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-act]");
      if (!btn) return;
      var id = btn.closest(".mm-item").getAttribute("data-id");
      if (btn.getAttribute("data-act") === "cover") {
        draft.coverMediaId = id;
        TM.ui.toast("Cover updated");
      } else {
        var i = indexOfId(id);
        draft.media.splice(i, 1);
        if (draft.coverMediaId === id) draft.coverMediaId = draft.media[0] ? draft.media[0].id : null;
      }
      setDirty(true);
      renderMedia();
    });

    /* Keyboard reordering on the grip handle. */
    box.addEventListener("keydown", function (e) {
      if (!e.target.classList.contains("mm-handle")) return;
      var id = e.target.closest(".mm-item").getAttribute("data-id");
      var i = indexOfId(id);
      var to = null;
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") to = i - 1;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") to = i + 1;
      if (to === null) return;
      e.preventDefault();
      moveItem(i, to);
      var h = box.querySelector('.mm-item[data-id="' + CSS.escape(id) + '"] .mm-handle');
      if (h) h.focus();
    });

    /* Pointer drag & drop (mouse + touch) starting from anywhere on the tile except buttons. */
    var drag = null;
    box.addEventListener("pointerdown", function (e) {
      var item = e.target.closest(".mm-item");
      if (!item || (e.target.closest(".mm-btn")) || (e.pointerType === "mouse" && e.button !== 0)) return;
      if (e.pointerType !== "mouse" && !e.target.closest(".mm-handle")) return; /* touch: handle only, keep scrolling natural */
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
        var v = drag.el.querySelector("img, video").cloneNode();
        g.appendChild(v);
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
        moveItem(indexOfId(d.id), indexOfId(d.target.getAttribute("data-id")));
      }
    }
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
  }

  /* ---------- Uploads (simulated) ---------- */
  function classify(file) {
    var ext = (file.name.split(".").pop() || "").toLowerCase();
    var kind = LIMITS.image.ext.indexOf(ext) !== -1 ? "image" : LIMITS.video.ext.indexOf(ext) !== -1 ? "video" : null;
    if (!kind) return { error: "Unsupported file type ." + ext };
    if (file.type && LIMITS[kind].types.indexOf(file.type) === -1) return { error: "File content does not match its extension" };
    if (file.size > LIMITS[kind].max) return { error: "Too large — max " + fmtSize(LIMITS[kind].max) };
    return { kind: kind };
  }

  function dimensions(url, kind) {
    return new Promise(function (resolve) {
      if (kind === "image") {
        var img = new Image();
        img.onload = function () {
          resolve({ w: img.naturalWidth, h: img.naturalHeight });
        };
        img.onerror = function () {
          resolve({ w: 1200, h: 900 });
        };
        img.src = url;
      } else {
        var v = document.createElement("video");
        v.preload = "metadata";
        v.onloadedmetadata = function () {
          resolve({ w: v.videoWidth || 1280, h: v.videoHeight || 720 });
        };
        v.onerror = function () {
          resolve({ w: 1280, h: 720 });
        };
        v.src = url;
      }
    });
  }

  function upload(files) {
    Array.prototype.forEach.call(files, function (file) {
      var check = classify(file);
      var row = document.createElement("div");
      row.className = "upload-row";
      var url = check.kind ? URL.createObjectURL(file) : "";
      row.innerHTML =
        (check.kind === "image" ? '<img class="thumb" alt="" src="' + esc(url) + '">' : '<span class="thumb" style="display:grid;place-items:center;color:var(--ocean)">' + (check.kind === "video" ? I.video : I.alert) + "</span>") +
        '<div style="min-width:0"><div class="name">' + esc(file.name) + '</div><div class="sub">' + fmtSize(file.size) + '</div><div class="progress"><span></span></div></div>' +
        '<span class="state"></span>';
      $("upload-list").prepend(row);

      if (check.error) {
        row.classList.add("is-error");
        row.querySelector(".sub").textContent = check.error;
        row.querySelector(".progress").remove();
        row.querySelector(".state").innerHTML = I.alert;
        return;
      }

      var bar = row.querySelector(".progress span");
      var sub = row.querySelector(".sub");
      var pct = 0;
      var speed = 4 + Math.random() * 10;
      var timer = setInterval(function () {
        pct = Math.min(100, pct + speed * (0.6 + Math.random()));
        bar.style.width = pct + "%";
        sub.textContent = fmtSize(file.size) + " · " + Math.round(pct) + "%";
        if (pct >= 100) {
          clearInterval(timer);
          dimensions(url, check.kind).then(function (d) {
            newCounter++;
            var m = {
              id: "new-" + Date.now().toString(36) + "-" + newCounter,
              type: check.kind,
              filename: url,
              width: d.w,
              height: d.h,
              altText: { en: file.name.replace(/\.[^.]+$/, "") },
              position: draft.media.length,
              isNew: true
            };
            draft.media.push(m);
            if (!draft.coverMediaId) draft.coverMediaId = m.id;
            row.classList.add("is-done");
            sub.textContent = fmtSize(file.size) + " · Uploaded";
            row.querySelector(".state").innerHTML = I.check;
            setDirty(true);
            renderMedia();
            setTimeout(function () {
              row.style.transition = "opacity 400ms";
              row.style.opacity = "0";
              setTimeout(function () {
                row.remove();
              }, 400);
            }, 2200);
          });
        }
      }, 120);
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
        dz.classList.add("is-over");
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
    /* Avoid the browser opening a file dropped next to the zone. */
    window.addEventListener("dragover", function (e) {
      e.preventDefault();
    });
    window.addEventListener("drop", function (e) {
      e.preventDefault();
    });
  }

  /* ---------- Save / discard / delete ---------- */
  function validate() {
    var ok = true;
    [
      ["f-name", draft.name.en],
      ["f-city", draft.city],
      ["f-country", draft.country.en]
    ].forEach(function (pair) {
      var bad = !String(pair[1] || "").trim();
      $(pair[0]).classList.toggle("has-error", bad);
      if (bad) ok = false;
    });
    if (!ok) {
      tab = "en";
      renderTabs();
      var first = document.querySelector(".field.has-error .input");
      if (first) first.focus();
    }
    return ok;
  }

  function bindActions() {
    $("save").addEventListener("click", function () {
      if (!validate()) return;
      var btn = $("save");
      btn.classList.add("is-loading");
      btn.innerHTML = '<span class="spinner"></span> Saving…';
      setTimeout(function () {
        var now = new Date().toISOString();
        draft.media.forEach(function (m, i) {
          m.position = i;
          delete m.isNew;
        });
        if (!draft.id) {
          draft.slug = slugify(draft.name.en) || "place";
          draft.id = draft.slug + "-" + new Date().getFullYear();
          draft.createdAt = now;
          if (!draft.country.fr) draft.country.fr = draft.country.en;
          places.unshift(draft);
        } else {
          places = places.map(function (p) {
            return p.id === draft.id ? draft : p;
          });
        }
        draft.updatedAt = now;
        btn.classList.remove("is-loading");
        btn.innerHTML = "Save &amp; publish";
        TM.ui.toast("“" + draft.name.en + "” published");
        load(clone(draft));
      }, 800);
    });

    $("discard").addEventListener("click", function () {
      var saved = places.filter(function (p) {
        return p.id === selectedId;
      })[0];
      load(saved ? clone(saved) : null);
      TM.ui.toast("Changes discarded");
    });

    $("new-place").innerHTML = I.plus + "New destination";
    $("new-place").addEventListener("click", function () {
      load(null);
      $("name").focus();
    });

    $("dest-list").addEventListener("click", function (e) {
      var b = e.target.closest(".dest-item");
      if (!b) return;
      if (dirty && !window.confirm("You have unsaved changes. Leave this destination anyway?")) return;
      var p = places.filter(function (x) {
        return x.id === b.getAttribute("data-id");
      })[0];
      load(clone(p));
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    var dlg = $("confirm-delete");
    $("delete-place").addEventListener("click", function () {
      $("confirm-name").textContent = draft.name.en;
      if (dlg.showModal) dlg.showModal();
    });
    $("confirm-cancel").addEventListener("click", function () {
      dlg.close();
    });
    $("confirm-ok").addEventListener("click", function () {
      var name = draft.name.en;
      places = places.filter(function (p) {
        return p.id !== selectedId;
      });
      dlg.close();
      load(places[0] ? clone(places[0]) : null);
      TM.ui.toast("“" + name + "” deleted");
    });

    $("logout").addEventListener("click", function (e) {
      if (dirty && !window.confirm("You have unsaved changes. Sign out anyway?")) e.preventDefault();
    });
  }

  /* ---------- Mobile sidebar ---------- */
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
    load(clone(places[0]));
  });
})();
