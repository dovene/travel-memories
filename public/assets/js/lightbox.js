/* Fullscreen media viewer: keyboard, buttons, thumbnails, swipe (and swipe-down to close). */
(function () {
  "use strict";

  var TM = (window.TM = window.TM || {});
  var t = function (k, v) {
    return TM.i18n.t(k, v);
  };

  var root, track, stage, counter, caption, strip, prevBtn, nextBtn, closeBtn, titleEl;
  var items = [];
  var place = null;
  var index = 0;
  var opener = null;

  function build() {
    root = document.createElement("div");
    root.className = "lightbox";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-hidden", "true");
    root.innerHTML =
      '<div class="lb-top">' +
      '<span class="lb-counter" aria-live="polite"></span>' +
      '<span class="lb-title"></span>' +
      '<button type="button" class="lb-btn lb-close">' + TM.icons.close + "</button>" +
      "</div>" +
      '<div class="lb-stage">' +
      '<div class="lb-track"></div>' +
      '<button type="button" class="lb-btn lb-nav lb-prev">' + TM.icons.chevronLeft + "</button>" +
      '<button type="button" class="lb-btn lb-nav lb-next">' + TM.icons.chevronRight + "</button>" +
      "</div>" +
      '<div class="lb-bottom"><p class="lb-caption"></p><div class="lb-strip"></div></div>';
    document.body.appendChild(root);

    track = root.querySelector(".lb-track");
    stage = root.querySelector(".lb-stage");
    counter = root.querySelector(".lb-counter");
    caption = root.querySelector(".lb-caption");
    strip = root.querySelector(".lb-strip");
    prevBtn = root.querySelector(".lb-prev");
    nextBtn = root.querySelector(".lb-next");
    closeBtn = root.querySelector(".lb-close");
    titleEl = root.querySelector(".lb-title");

    prevBtn.addEventListener("click", function () {
      go(index - 1);
    });
    nextBtn.addEventListener("click", function () {
      go(index + 1);
    });
    closeBtn.addEventListener("click", close);
    strip.addEventListener("click", function (e) {
      var b = e.target.closest(".lb-thumb");
      if (b) go(+b.getAttribute("data-index"));
    });
    stage.addEventListener("click", function (e) {
      if (e.target.classList.contains("lb-slide")) close();
    });
    document.addEventListener("keydown", onKey);
    bindSwipe();
    labels();
    TM.i18n.onChange(function () {
      labels();
      if (isOpen()) update();
    });
  }

  function labels() {
    root.setAttribute("aria-label", t("viewer.label"));
    closeBtn.setAttribute("aria-label", t("viewer.close"));
    prevBtn.setAttribute("aria-label", t("viewer.prev"));
    nextBtn.setAttribute("aria-label", t("viewer.next"));
  }

  function isOpen() {
    return root && root.classList.contains("is-open");
  }

  function slideHtml(m) {
    var alt = TM.ui.esc(TM.i18n.pick(m.altText));
    if (m.type === "video") return '<div class="lb-slide" data-type="video"></div>';
    return '<div class="lb-slide" data-type="image" data-alt="' + alt + '"></div>';
  }

  /* Only the current item and its neighbours get real sources. */
  function hydrate(i) {
    [i - 1, i, i + 1].forEach(function (k) {
      if (k < 0 || k >= items.length) return;
      var slide = track.children[k];
      if (slide.getAttribute("data-ready")) return;
      slide.setAttribute("data-ready", "1");
      var m = items[k];
      if (m.type === "video") {
        var v = document.createElement("video");
        v.controls = true;
        v.playsInline = true;
        v.preload = "metadata";
        v.src = TM.api.mediaUrl(m);
        v.setAttribute("aria-label", TM.i18n.pick(m.altText));
        slide.appendChild(v);
      } else {
        var spin = document.createElement("span");
        spin.className = "lb-loading";
        slide.appendChild(spin);
        var img = new Image();
        img.alt = slide.getAttribute("data-alt");
        img.decoding = "async";
        img.sizes = "100vw";
        img.srcset = TM.api.srcset(m, [800, 1280, 1800, 2400]);
        img.src = TM.api.mediaUrl(m, 1800);
        img.draggable = false;
        img.style.opacity = "0";
        img.style.transition = "opacity 400ms ease";
        img.onload = img.onerror = function () {
          spin.remove();
          img.style.opacity = "1";
        };
        slide.appendChild(img);
      }
    });
  }

  function setTransform(dx, animate) {
    track.classList.toggle("is-animating", !!animate);
    track.style.transform = "translate3d(calc(" + -index * 100 + "% + " + (dx || 0) + "px),0,0)";
  }

  function pauseAll() {
    track.querySelectorAll("video").forEach(function (v) {
      v.pause();
    });
  }

  function update() {
    var m = items[index];
    counter.textContent = t("viewer.counter", { i: index + 1, n: items.length });
    caption.textContent = TM.i18n.pick(m.altText);
    titleEl.textContent = TM.i18n.pick(place.name);
    prevBtn.disabled = index === 0;
    nextBtn.disabled = index === items.length - 1;
    strip.querySelectorAll(".lb-thumb").forEach(function (b, k) {
      b.setAttribute("aria-current", String(k === index));
      b.setAttribute("aria-label", t("viewer.goto", { n: k + 1 }));
    });
    var active = strip.children[index];
    if (active && active.scrollIntoView) active.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }

  function go(i, animate) {
    if (i < 0 || i >= items.length) {
      setTransform(0, true);
      return;
    }
    pauseAll();
    index = i;
    hydrate(i);
    setTransform(0, animate !== false);
    update();
  }

  function open(p, startIndex, fromEl) {
    if (!root) build();
    place = p;
    items = p.media;
    opener = fromEl || document.activeElement;
    track.innerHTML = items.map(slideHtml).join("");
    strip.innerHTML = items
      .map(function (m, k) {
        var thumb =
          m.type === "video"
            ? TM.api.poster(p)
              ? '<img alt="" src="' + TM.ui.esc(TM.api.poster(p).replace(/w=\d+/, "w=120").replace(/h=\d+/, "h=86")) + '"><span class="mini-play">' + TM.icons.play + "</span>"
              : '<span class="mini-play">' + TM.icons.play + "</span>"
            : '<img alt="" loading="lazy" src="' + TM.ui.esc(TM.api.mediaUrl(m, 120, 86)) + '">';
        return '<button type="button" class="lb-thumb" data-index="' + k + '">' + thumb + "</button>";
      })
      .join("");
    index = startIndex || 0;
    hydrate(index);
    setTransform(0, false);
    update();
    root.setAttribute("aria-hidden", "false");
    document.body.classList.add("lb-locked");
    requestAnimationFrame(function () {
      root.classList.add("is-open");
      closeBtn.focus({ preventScroll: true });
    });
    var v = track.children[index].querySelector("video");
    if (v) v.play().catch(function () {});
  }

  function close() {
    if (!isOpen()) return;
    pauseAll();
    root.classList.remove("is-open");
    root.setAttribute("aria-hidden", "true");
    document.body.classList.remove("lb-locked");
    if (opener && opener.focus) opener.focus({ preventScroll: true });
  }

  function onKey(e) {
    if (!isOpen()) return;
    if (e.key === "Escape") close();
    else if (e.key === "ArrowRight") go(index + 1);
    else if (e.key === "ArrowLeft") go(index - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(items.length - 1);
    else if (e.key === "Tab") {
      /* Keep focus inside the dialog. */
      var f = Array.prototype.filter.call(root.querySelectorAll("button, video"), function (el) {
        return !el.disabled && el.offsetParent !== null;
      });
      if (!f.length) return;
      var first = f[0];
      var last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  function bindSwipe() {
    var startX = 0;
    var startY = 0;
    var dx = 0;
    var dy = 0;
    var t0 = 0;
    var active = false;
    var axis = null;

    stage.addEventListener("pointerdown", function (e) {
      if (e.target.closest("video, .lb-btn") || (e.pointerType === "mouse" && e.button !== 0)) return;
      active = true;
      axis = null;
      startX = e.clientX;
      startY = e.clientY;
      dx = dy = 0;
      t0 = Date.now();
    });

    window.addEventListener("pointermove", function (e) {
      if (!active) return;
      dx = e.clientX - startX;
      dy = e.clientY - startY;
      if (!axis && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (axis === "x") {
        var edge = (index === 0 && dx > 0) || (index === items.length - 1 && dx < 0);
        setTransform(edge ? dx * 0.3 : dx, false);
      } else if (axis === "y" && dy > 0) {
        track.style.transform = "translate3d(" + -index * 100 + "%," + dy + "px,0)";
        root.style.backgroundColor = "rgba(13,27,41," + Math.max(0.4, 0.97 - dy / 600) + ")";
      }
    });

    function end() {
      if (!active) return;
      active = false;
      var fast = Date.now() - t0 < 260;
      root.style.backgroundColor = "";
      if (axis === "x") {
        if (dx < -70 || (fast && dx < -25)) go(index + 1);
        else if (dx > 70 || (fast && dx > 25)) go(index - 1);
        else setTransform(0, true);
      } else if (axis === "y") {
        if (dy > 110) {
          close();
          setTimeout(function () {
            setTransform(0, false);
          }, 360);
        } else setTransform(0, true);
      }
    }

    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  }

  TM.lightbox = { open: open, close: close };
})();
