/* Admin login page (kept out of the HTML so the Content-Security-Policy can forbid inline scripts). */
(function () {
  var form = document.getElementById("login-form");
  var btn = document.getElementById("login-btn");
  var errorBox = document.getElementById("login-error");

  function showError(text) {
    errorBox.textContent = text;
    errorBox.hidden = !text;
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    showError("");
    var username = document.getElementById("username").value.trim();
    var password = document.getElementById("password").value;
    var ok = true;
    [["f-user", username], ["f-pass", password]].forEach(function (pair) {
      document.getElementById(pair[0]).classList.toggle("has-error", !pair[1]);
      if (!pair[1]) ok = false;
    });
    if (!ok) return;

    btn.classList.add("is-loading");
    btn.innerHTML = '<span class="spinner"></span> Signing in…';
    fetch("/api/admin/login", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: username, password: password })
    })
      .then(function (res) {
        if (res.ok) {
          location.replace("/admin/");
          return;
        }
        return res.json().catch(function () { return null; }).then(function (data) {
          var message = data && data.error && data.error.message;
          showError(message || "Sign-in failed. Please try again.");
          document.getElementById("password").select();
        });
      })
      .catch(function () {
        showError("Network error — check your connection.");
      })
      .then(function () {
        btn.classList.remove("is-loading");
        btn.textContent = "Sign in";
      });
  });
})();

/* Background: one of the journal's own cover photos when there is one, otherwise the brand gradient. */
(function () {
  var img = document.getElementById("login-visual");
  fetch("/api/public/dovene/places")
    .then(function (res) {
      return res.ok ? res.json() : { places: [] };
    })
    .then(function (data) {
      var covers = [];
      data.places.forEach(function (p) {
        p.media.forEach(function (m) {
          var v = m.variants || {};
          var pic = m.type === "video" ? v.poster : v.display || v.thumb;
          if (pic) covers.push(pic.url);
        });
      });
      if (!covers.length) return;
      img.src = covers[Math.floor(Math.random() * covers.length)];
      img.hidden = false;
    })
    .catch(function () {});
})();
    
