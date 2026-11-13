/*
 * Admin › Profile: the author's name, shown on the home page as
 * "A personal travel journal by <name>".
 */
(function () {
  "use strict";

  var TM = window.TM;
  var A = TM.admin;

  var $ = function (id) {
    return document.getElementById(id);
  };

  var saved = "";

  function clean(value) {
    return value.replace(/\s+/g, " ").trim();
  }

  function refresh() {
    var name = clean($("display-name").value);
    $("name-preview").textContent = name ? "A personal travel journal by " + name : "A personal travel journal";
    $("profile-save").disabled = !name || name === saved;
    $("f-name").classList.remove("has-error");
  }

  function showError(message) {
    $("name-error").textContent = message;
    $("f-name").classList.add("has-error");
  }

  document.addEventListener("DOMContentLoaded", function () {
    var input = $("display-name");
    input.addEventListener("input", refresh);

    $("profile-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var name = clean(input.value);
      if (!name) return showError("Enter your name.");
      $("profile-save").disabled = true;
      A.request("PUT", "/profile", { displayName: name })
        .then(function (p) {
          saved = p.displayName;
          input.value = saved;
          refresh();
          TM.ui.toast("Name saved");
        })
        .catch(function (err) {
          refresh();
          if (err.status === 422) showError(err.message);
          else A.failed(err);
        });
    });

    A.start()
      .then(function () {
        return A.request("GET", "/profile");
      })
      .then(function (p) {
        saved = (p && p.displayName) || "";
        input.value = saved;
        input.disabled = false;
        refresh();
      })
      .catch(A.failed);
  });
})();
