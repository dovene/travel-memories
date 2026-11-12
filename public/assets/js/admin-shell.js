/*
 * Shared pieces of the admin pages that are not the destination editor
 * (Visitors, Backups): API requests, the signed-in user, sign out, small formatters.
 */
(function () {
  "use strict";

  var TM = window.TM;
  var API = "/api/admin";

  function ApiError(status, body) {
    this.status = status;
    this.code = body && body.error && body.error.code;
    this.message = (body && body.error && body.error.message) || "Something went wrong.";
    this.details = body && body.error && body.error.details;
  }

  function request(method, path, body, headers, rawBody) {
    var init = { method: method, credentials: "same-origin", headers: headers || {} };
    if (rawBody !== undefined) init.body = rawBody;
    else if (body !== undefined) {
      init.body = JSON.stringify(body);
      init.headers["Content-Type"] = "application/json";
    }
    return fetch(API + path, init).then(function (res) {
      if (res.status === 401) {
        location.href = "/admin/login";
        throw new ApiError(401, null);
      }
      if (res.status === 204) return null;
      return res
        .json()
        .catch(function () {
          return null;
        })
        .then(function (data) {
          if (!res.ok) throw new ApiError(res.status, data);
          return data;
        });
    });
  }

  function failed(err) {
    if (err && err.status === 401) return;
    TM.ui.toast((err && err.message) || "Network error — check your connection.");
  }

  function fmtSize(b) {
    if (b >= 1024 * 1024 * 1024) return (b / 1024 / 1024 / 1024).toFixed(2) + " GB";
    if (b >= 1024 * 1024) return (b / 1024 / 1024).toFixed(1) + " MB";
    return Math.max(1, Math.round(b / 1024)) + " KB";
  }

  /* Signs in check, avatar and sign out; resolves with the session. */
  function start() {
    document.getElementById("logout").addEventListener("click", function (e) {
      e.preventDefault();
      fetch(API + "/logout", { method: "POST", credentials: "same-origin" }).then(function () {
        location.href = "/admin/login";
      });
    });
    return request("GET", "/session").then(function (s) {
      if (!s.authenticated) {
        location.href = "/admin/login";
        throw new ApiError(401, null);
      }
      document.getElementById("avatar").textContent = (s.username || "?").charAt(0).toUpperCase();
      return s;
    });
  }

  /* Draws the section icons in the admin navigation. */
  function navIcons() {
    document.querySelectorAll(".admin-nav [data-icon]").forEach(function (el) {
      el.insertAdjacentHTML("afterbegin", TM.icons[el.getAttribute("data-icon")] || "");
    });
  }
  document.addEventListener("DOMContentLoaded", navIcons);

  TM.admin = { request: request, failed: failed, fmtSize: fmtSize, start: start, ApiError: ApiError };
})();
