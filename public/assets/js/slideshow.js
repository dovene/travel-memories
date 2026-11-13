/*
 * Slideshow ("Play" on a destination's cover): every photo and video of the destination,
 * one after another, full screen, like stories.
 *  - Photos stay about 5 seconds, videos play to the end. It starts muted; turning sound on
 *    is remembered for the next slideshows.
 *  - Progress bars on top; tap the right side for next, left side for previous;
 *    press and hold to pause; swipe down to close.
 *  - Keyboard: Space pauses, arrows skip, M toggles sound, Esc closes.
 *  - At the end: Replay, or go on to the next destination of the journey. When there is one,
 *    it starts by itself after a short countdown ("Next destination in 8 s"), unless the
 *    visitor chooses "Stay here", replays, or closes.
 */
(function () {
  "use strict";

  var TM = (window.TM = window.TM || {});
  var t = function (k, v) {
    return TM.i18n.t(k, v);
  };

  var PHOTO_MS = 5000;
  var HOLD_MS = 220;
  var UP_NEXT_MS = 8000; // countdown on the end screen before the next destination plays

  var root, bars, stage, titleEl, counterEl, pauseBtn, muteBtn, closeBtn, endPanel, endTitle, replayBtn, nextBtn, upNextEl, upNextText, stayBtn;
  var upNext = -1; // milliseconds left before the next destination plays; -1 when no countdown runs
  var place = null;
  var next = null; // { place, go } — the following destination, when there is one
  var items = [];
  var slides = []; // index → { el, type, img|video, loaded }
  var index = 0;
  var opener = null;
  var paused = false;
  var held = false;
  var ended = false;
  var SOUND_KEY = "tm.slideshowSound";
  var muted = soundPreference() !== "on"; // starts muted unless the visitor turned sound on before
  var elapsed = 0;
  var lastFrame = 0;
  var raf = 0;

  function build() {
    root = document.createElement("div");
    root.className = "slideshow";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-hidden", "true");
    root.innerHTML =
      '<div class="ss-top">' +
      '<div class="ss-bars" aria-hidden="true"></div>' +
      '<div class="ss-head">' +
      '<p class="ss-title"></p><span class="ss-counter" aria-live="polite"></span>' +
      '<div class="ss-actions">' +
      '<button type="button" class="ss-btn ss-pause"></button>' +
      '<button type="button" class="ss-btn ss-mute"></button>' +
      '<button type="button" class="ss-btn ss-close">' + TM.icons.close + "</button>" +
      "</div></div></div>" +
      '<div class="ss-stage"></div>' +
      '<div class="ss-end" hidden>' +
      '<p class="ss-end-title"></p>' +
      '<div class="ss-end-actions">' +
      '<button type="button" class="btn btn-glass ss-replay">' + TM.icons.replay + "<span></span></button>" +
      '<button type="button" class="btn btn-light ss-next"><span class="ss-next-fill" aria-hidden="true"></span><span class="ss-next-label"></span>' + TM.icons.arrowRight + "</button>" +
      "</div>" +
      '<p class="ss-upnext" hidden><span class="ss-upnext-text" aria-live="polite"></span> · <button type="button" class="ss-stay"></button></p>' +
      "</div>";
    document.body.appendChild(root);

    bars = root.querySelector(".ss-bars");
    stage = root.querySelector(".ss-stage");
    titleEl = root.querySelector(".ss-title");
    counterEl = root.querySelector(".ss-counter");
    pauseBtn = root.querySelector(".ss-pause");
    muteBtn = root.querySelector(".ss-mute");
    closeBtn = root.querySelector(".ss-close");
    endPanel = root.querySelector(".ss-end");
    endTitle = root.querySelector(".ss-end-title");
    replayBtn = root.querySelector(".ss-replay");
    nextBtn = root.querySelector(".ss-next");
    upNextEl = root.querySelector(".ss-upnext");
    upNextText = root.querySelector(".ss-upnext-text");
    stayBtn = root.querySelector(".ss-stay");
    stayBtn.addEventListener("click", function () {
      stopUpNext();
      nextBtn.focus({ preventScroll: true });
    });

    pauseBtn.addEventListener("click", function () {
      setPaused(!paused);
    });
    muteBtn.addEventListener("click", function () {
      setMuted(!muted, true);
    });
    closeBtn.addEventListener("click", close);
    replayBtn.addEventListener("click", function () {
      setPaused(false);
      show(0);
      pauseBtn.focus({ preventScroll: true });
    });
    nextBtn.addEventListener("click", goNext);
    document.addEventListener("keydown", onKey);
    document.addEventListener("visibilitychange", function () {
      if (document.hidden && isOpen() && !ended) setPaused(true);
    });
    bindPointer();
    TM.i18n.onChange(function () {
      if (root) labels();
    });
  }

  function isOpen() {
    return !!root && root.classList.contains("is-open");
  }

  function labels() {
    root.setAttribute("aria-label", t("slideshow.label"));
    closeBtn.setAttribute("aria-label", t("slideshow.close"));
    pauseBtn.setAttribute("aria-label", t(paused ? "slideshow.resume" : "slideshow.pause"));
    pauseBtn.innerHTML = paused ? TM.icons.play : TM.icons.pause;
    muteBtn.setAttribute("aria-label", t(muted ? "slideshow.unmute" : "slideshow.mute"));
    muteBtn.innerHTML = muted ? TM.icons.volumeOff : TM.icons.volume;
    if (!place) return;
    titleEl.textContent = TM.i18n.pick(place.name);
    endTitle.textContent = t("slideshow.endTitle", { name: TM.i18n.pick(place.name) });
    replayBtn.querySelector("span").textContent = t("slideshow.replay");
    nextBtn.hidden = !next;
    if (next) nextBtn.querySelector(".ss-next-label").textContent = t("slideshow.next", { name: TM.i18n.pick(next.place.name) });
    stayBtn.textContent = t("slideshow.stay");
    renderUpNext();
    if (items[index]) counterEl.textContent = t("viewer.counter", { i: index + 1, n: items.length });
  }

  function soundPreference() {
    try {
      return localStorage.getItem(SOUND_KEY);
    } catch (e) {
      return null;
    }
  }

  /* ---------- slides ---------- */

  function ensure(i) {
    if (i < 0 || i >= items.length) return null;
    if (slides[i]) return slides[i];
    var m = items[i];
    var el = document.createElement("div");
    el.className = "ss-slide";
    var s = { el: el, type: m.type, loaded: false };
    if (m.type === "video") {
      var v = document.createElement("video");
      v.playsInline = true;
      v.preload = "auto";
      v.muted = muted;
      var poster = TM.api.image(m);
      if (poster) v.poster = poster.src;
      v.src = m.url;
      v.setAttribute("aria-label", TM.i18n.pick(m.altText) || "");
      v.addEventListener("ended", function () {
        if (slides[index] === s && !ended) show(index + 1);
      });
      v.addEventListener("error", function () {
        if (slides[index] === s && !ended) show(index + 1);
      });
      s.video = v;
      s.loaded = true;
      el.appendChild(v);
    } else {
      var spin = document.createElement("span");
      spin.className = "lb-loading";
      el.appendChild(spin);
      var img = new Image();
      img.alt = TM.i18n.pick(m.altText) || "";
      img.decoding = "async";
      img.draggable = false;
      var pic = TM.api.image(m, "display");
      if (pic.srcset) {
        img.sizes = "100vw";
        img.srcset = pic.srcset;
      }
      img.onload = img.onerror = function () {
        s.loaded = true;
        spin.remove();
      };
      img.src = pic.src;
      s.img = img;
      el.appendChild(img);
    }
    slides[i] = s;
    stage.appendChild(el);
    return s;
  }

  /* Keep only the current item and its neighbours in the page (videos are heavy). */
  function prune() {
    slides.forEach(function (s, k) {
      if (s && Math.abs(k - index) > 1) discard(k);
    });
  }

  function discard(k) {
    var s = slides[k];
    if (!s) return;
    if (s.video) {
      s.video.pause();
      s.video.removeAttribute("src");
      s.video.load();
    }
    s.el.remove();
    slides[k] = null;
  }

  function renderBars() {
    bars.innerHTML = items
      .map(function () {
        return '<span class="ss-bar"><i></i></span>';
      })
      .join("");
  }

  function fill(k, fraction) {
    var bar = bars.children[k];
    if (bar) bar.firstChild.style.transform = "scaleX(" + Math.max(0, Math.min(1, fraction)) + ")";
  }

  function show(i) {
    if (i >= items.length) return finish();
    if (i < 0) i = 0;
    var previous = slides[index];
    if (previous && previous.video && i !== index) previous.video.pause();
    ended = false;
    upNext = -1;
    endPanel.hidden = true;
    root.classList.remove("is-ended");
    index = i;
    elapsed = 0;
    var s = ensure(i);
    ensure(i + 1); // start loading what comes next
    prune();
    slides.forEach(function (x, k) {
      if (x) x.el.classList.toggle("is-active", k === i);
    });
    for (var k = 0; k < items.length; k++) fill(k, k < i ? 1 : 0);
    labels();
    if (s.video) {
      try {
        s.video.currentTime = 0;
      } catch (e) {
        /* not loaded yet: it starts at 0 anyway */
      }
      apply();
    }
  }

  function finish() {
    ended = true;
    var s = slides[index];
    if (s && s.video) s.video.pause();
    for (var k = 0; k < items.length; k++) fill(k, 1);
    endPanel.hidden = false;
    root.classList.add("is-ended");
    if (next) upNext = UP_NEXT_MS;
    labels();
    (next ? nextBtn : replayBtn).focus({ preventScroll: true });
  }

  /* ---------- "up next" countdown on the end screen ---------- */

  function goNext() {
    var n = next;
    close();
    if (n) n.go();
  }

  function stopUpNext() {
    upNext = -1;
    renderUpNext();
  }

  function renderUpNext() {
    var on = upNext >= 0 && ended && !!next;
    upNextEl.hidden = !on;
    nextBtn.classList.toggle("is-counting", on);
    nextBtn.style.setProperty("--upnext", on ? String(1 - upNext / UP_NEXT_MS) : "0");
    var text = on ? t("slideshow.upNext", { n: Math.max(1, Math.ceil(upNext / 1000)) }) : "";
    if (upNextText.textContent !== text) upNextText.textContent = text; // only once a second, for screen readers
  }

  /* ---------- playback ---------- */

  function playVideo(v) {
    v.muted = muted;
    var p = v.play();
    if (p && p.catch)
      p.catch(function () {
        // The browser refused sound without a fresh tap: carry on muted.
        if (!v.muted && isOpen()) {
          setMuted(true);
          v.play().catch(function () {});
        }
      });
  }

  /* Starts or stops the current video according to the pause/hold state. */
  function apply() {
    var s = slides[index];
    if (!s || !s.video || ended) return;
    if (paused || held) s.video.pause();
    else playVideo(s.video);
  }

  function setPaused(p) {
    paused = p;
    root.classList.toggle("is-paused", p);
    labels();
    apply();
  }

  /* The visitor's own choice is remembered; a browser refusing sound is not. */
  function setMuted(m, remember) {
    muted = m;
    if (remember) {
      try {
        localStorage.setItem(SOUND_KEY, m ? "off" : "on");
      } catch (e) {
        /* private mode: the choice lasts for this visit only */
      }
    }
    slides.forEach(function (s) {
      if (s && s.video) s.video.muted = m;
    });
    labels();
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    var dt = lastFrame ? Math.min(now - lastFrame, 100) : 0;
    lastFrame = now;
    if (ended) {
      if (upNext < 0) return;
      upNext -= dt;
      if (upNext <= 0) return goNext();
      renderUpNext();
      return;
    }
    var s = slides[index];
    if (!s) return;
    if (s.video) {
      var d = s.video.duration;
      fill(index, d && isFinite(d) ? s.video.currentTime / d : 0);
      return;
    }
    if (s.loaded && !paused && !held) elapsed += dt;
    fill(index, elapsed / PHOTO_MS);
    if (elapsed >= PHOTO_MS) show(index + 1);
  }

  /* ---------- input ---------- */

  function onKey(e) {
    if (!isOpen()) return;
    if (e.key === "Escape") close();
    else if (e.key === "ArrowRight") {
      if (!ended) show(index + 1);
    } else if (e.key === "ArrowLeft") show(ended ? items.length - 1 : index - 1);
    else if ((e.key === " " || e.key === "k") && !e.target.closest(".ss-end, button")) {
      e.preventDefault();
      if (!ended) setPaused(!paused);
    } else if (e.key === "m" || e.key === "M") setMuted(!muted, true);
    else if (e.key === "Tab") {
      var f = Array.prototype.filter.call(root.querySelectorAll("button"), function (el) {
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

  function bindPointer() {
    var active = false;
    var x0 = 0;
    var y0 = 0;
    var dx = 0;
    var dy = 0;
    var timer = 0;

    stage.addEventListener("pointerdown", function (e) {
      if (ended || (e.pointerType === "mouse" && e.button !== 0)) return;
      active = true;
      x0 = e.clientX;
      y0 = e.clientY;
      dx = dy = 0;
      timer = setTimeout(function () {
        held = true;
        root.classList.add("is-held");
        apply();
      }, HOLD_MS);
    });

    window.addEventListener("pointermove", function (e) {
      if (!active) return;
      dx = e.clientX - x0;
      dy = e.clientY - y0;
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) clearTimeout(timer);
      if (dy > 0 && dy > Math.abs(dx)) {
        stage.style.transform = "translate3d(0," + dy + "px,0)";
        root.style.backgroundColor = "rgba(13,27,41," + Math.max(0.4, 1 - dy / 600) + ")";
      }
    });

    function end() {
      if (!active) return;
      active = false;
      clearTimeout(timer);
      stage.style.transform = "";
      root.style.backgroundColor = "";
      if (held) {
        held = false;
        root.classList.remove("is-held");
        apply();
        return;
      }
      if (dy > 100 && dy > Math.abs(dx)) return close();
      if (dx < -50 && Math.abs(dx) > Math.abs(dy)) return show(index + 1);
      if (dx > 50 && Math.abs(dx) > Math.abs(dy)) return show(index - 1);
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
        var r = stage.getBoundingClientRect();
        if (x0 - r.left < r.width * 0.3) show(index - 1);
        else show(index + 1);
      }
    }

    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  }

  /* ---------- open / close ---------- */

  /* options: { from: element to refocus on close, next: { place, go } } */
  function open(p, options) {
    if (!p || !p.media.length) return;
    if (!root) build();
    options = options || {};
    slides.forEach(function (s, k) {
      discard(k);
    });
    place = p;
    next = options.next || null;
    items = p.media.slice();
    slides = [];
    index = 0;
    opener = options.from || document.activeElement;
    paused = false;
    held = false;
    root.classList.remove("is-paused", "is-held");
    renderBars();
    root.setAttribute("aria-hidden", "false");
    document.body.classList.add("lb-locked");
    root.classList.add("is-open");
    pauseBtn.focus({ preventScroll: true }); // Space then pauses, like a video player
    show(0);
    cancelAnimationFrame(raf);
    lastFrame = 0;
    raf = requestAnimationFrame(frame);
  }

  function close() {
    if (!isOpen()) return;
    cancelAnimationFrame(raf);
    upNext = -1;
    slides.forEach(function (s, k) {
      discard(k);
    });
    slides = [];
    root.classList.remove("is-open", "is-ended");
    root.setAttribute("aria-hidden", "true");
    endPanel.hidden = true;
    document.body.classList.remove("lb-locked");
    if (opener && opener.focus) opener.focus({ preventScroll: true });
  }

  TM.slideshow = { open: open, close: close };
})();
