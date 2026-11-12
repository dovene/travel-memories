/*
 * Admin › Backups.
 *
 * Download: builds one .tar in the browser with the same layout as `npm run export`
 * (content/…, media/…, manifest.json with SHA-256 checksums, README.md), from the content
 * documents (GET /api/admin/backup/content) and every file's public URL. Chrome and Edge
 * write straight to disk; other browsers assemble the file, then download it.
 *
 * Restore: reads such a .tar or an export folder, checks every file against manifest.json
 * (size and SHA-256), skips media already stored, uploads the rest one file at a time,
 * then the content documents last — so the site only switches once everything is there.
 */
(function () {
  "use strict";

  var TM = window.TM;
  var A = TM.admin;
  var esc = TM.ui.esc;
  var session = null;
  var plan = null; // files of the journal, for the download
  var pending = null; // checked backup waiting for confirmation

  var $ = function (id) {
    return document.getElementById(id);
  };

  function hex(buffer) {
    return Array.from(new Uint8Array(buffer), function (b) {
      return b.toString(16).padStart(2, "0");
    }).join("");
  }

  function sha256(blob) {
    return blob.arrayBuffer().then(function (buf) {
      return crypto.subtle.digest("SHA-256", buf);
    }).then(hex);
  }

  function progress(id, done, total, text) {
    var box = $(id);
    box.hidden = false;
    box.querySelector("i").style.transform = "scaleX(" + (total ? Math.min(1, done / total) : 0) + ")";
    box.querySelector(".progress-text").textContent = text;
  }

  function stamp(d) {
    return d.toISOString().slice(0, 16).replace(":", "-");
  }

  /* ---------- download ---------- */

  function mediaFiles(places) {
    var files = [];
    places.forEach(function (p) {
      p.media.forEach(function (m) {
        var folder = "media/users/" + session.ownerId + "/" + p.id + "/";
        files.push({ path: folder + m.filename, url: m.url, size: m.size, contentType: m.contentType });
        Object.keys(m.variants || {}).forEach(function (name) {
          var v = m.variants[name];
          files.push({ path: folder + v.filename, url: v.url, size: v.size || 0, contentType: v.contentType });
        });
      });
    });
    return files;
  }

  function measure() {
    return A.request("GET", "/places").then(function (data) {
      var files = mediaFiles(data.places);
      var bytes = files.reduce(function (n, f) {
        return n + f.size;
      }, 0);
      plan = { places: data.places, files: files, bytes: bytes };
      $("export-summary").textContent =
        data.places.length + " destinations · " + files.length + " photo, video and preview files · about " + A.fmtSize(bytes);
      $("export-start").disabled = false;
    });
  }

  /* Where the archive goes: straight to disk when the browser allows it, else into a Blob. */
  function openSink(name) {
    if (window.showSaveFilePicker) {
      return window
        .showSaveFilePicker({ suggestedName: name, types: [{ description: "Backup archive", accept: { "application/x-tar": [".tar"] } }] })
        .then(function (handle) {
          return handle.createWritable();
        })
        .then(function (w) {
          return {
            write: function (part) {
              return w.write(part);
            },
            close: function () {
              return w.close();
            },
            abort: function () {
              return w.abort();
            }
          };
        });
    }
    var parts = [];
    return Promise.resolve({
      write: function (part) {
        parts.push(part);
        return Promise.resolve();
      },
      close: function () {
        var url = URL.createObjectURL(new Blob(parts, { type: "application/x-tar" }));
        var a = document.createElement("a");
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () {
          URL.revokeObjectURL(url);
        }, 60000);
        parts = [];
        return Promise.resolve();
      },
      abort: function () {
        parts = [];
        return Promise.resolve();
      }
    });
  }

  function readme(m) {
    return [
      "# Travel Memories backup",
      "",
      "Downloaded " + m.exportedAt + " from the admin panel (" + m.environment + ").",
      m.owners.map(function (o) {
        return "- @" + o.username + " (owner `" + o.ownerId + "`): " + o.places + " destinations, " + o.media + " media files";
      }).join("\n"),
      "",
      "## What is inside",
      "",
      "- `content/usernames/<username>.json`: public handle → owner",
      "- `content/users/<ownerId>/profile.json`: the profile",
      "- `content/users/<ownerId>/places.json`: every destination (names, descriptions, city, country, visit date, cover, ordered media list)",
      "- `media/users/<ownerId>/<placeId>/<file>`: original photos and videos, untouched, plus smaller previews",
      "- `manifest.json`: every file with its size, type and SHA-256 checksum",
      "",
      "## Restoring",
      "",
      "Admin panel › Backups › Restore a backup, and choose this .tar file (or the folder after opening it).",
      "With the repository: open the .tar, then `npm run restore -- --from <folder> --target <env>`.",
      ""
    ].join("\n");
  }

  function download() {
    var started = new Date();
    var top = "travel-memories-" + (session.environment || "backup") + "-" + stamp(started);
    var btn = $("export-start");
    var sink = null;
    var manifestFiles = [];
    var done = 0;
    var total = 0;

    function writeFile(path, blob) {
      return sha256(blob).then(function (sum) {
        manifestFiles.push({ path: path, size: blob.size, contentType: blob.type || "application/octet-stream", sha256: sum });
        return sink
          .write(TM.tar.header(top + "/" + path, blob.size, started.getTime()))
          .then(function () {
            return sink.write(blob);
          })
          .then(function () {
            return sink.write(TM.tar.padding(blob.size));
          });
      });
    }

    function fetchFile(f) {
      return fetch(f.url, { credentials: "same-origin" }).then(function (res) {
        if (!res.ok) throw new Error("Could not download " + f.path + " (" + res.status + ")");
        return res.blob();
      }).then(function (blob) {
        return new Blob([blob], { type: f.contentType });
      });
    }

    btn.disabled = true;
    return openSink(top + ".tar")
      .then(function (s) {
        sink = s;
        progress("export-progress", 0, 1, "Preparing…");
        return Promise.all([A.request("GET", "/backup/content"), measure()]);
      })
      .then(function (r) {
        var content = r[0];
        var files = plan.files;
        total = plan.bytes;
        var chain = Promise.resolve();
        content.files.forEach(function (f) {
          chain = chain.then(function () {
            return writeFile(f.path, new Blob([f.text], { type: "application/json" }));
          });
        });
        // Download two files ahead while writing the current one, in order.
        var ahead = [];
        var next = 0;
        function prefetch() {
          while (ahead.length < 3 && next < files.length) ahead.push({ file: files[next], data: fetchFile(files[next++]) });
        }
        function step() {
          prefetch();
          var item = ahead.shift();
          if (!item) return Promise.resolve();
          return item.data.then(function (blob) {
            return writeFile(item.file.path, blob).then(function () {
              done += item.file.size;
              progress("export-progress", done, total, "Downloading " + manifestFiles.length + " / " + (files.length + content.files.length) + " files · " + A.fmtSize(done) + " of " + A.fmtSize(total));
              return step();
            });
          });
        }
        return chain.then(step).then(function () {
          var places = JSON.parse(content.files.filter(function (f) { return /places\.json$/.test(f.path); })[0].text);
          manifestFiles.sort(function (a, b) {
            return a.path.localeCompare(b.path);
          });
          var manifest = {
            format: "travel-memories-export",
            formatVersion: 1,
            exportedAt: started.toISOString(),
            environment: content.environment,
            source: "admin",
            owners: [{ ownerId: content.ownerId, username: content.username, places: places.places.length, media: plan.files.length }],
            totalBytes: manifestFiles.reduce(function (n, f) { return n + f.size; }, 0),
            files: manifestFiles
          };
          var extra = [
            ["manifest.json", JSON.stringify(manifest, null, 2) + "\n"],
            ["README.md", readme(manifest)]
          ];
          var tail = Promise.resolve();
          extra.forEach(function (e) {
            tail = tail.then(function () {
              var blob = new Blob([e[1]]);
              return sink.write(TM.tar.header(top + "/" + e[0], blob.size, started.getTime())).then(function () {
                return sink.write(blob);
              }).then(function () {
                return sink.write(TM.tar.padding(blob.size));
              });
            });
          });
          return tail.then(function () {
            return sink.write(TM.tar.end());
          }).then(function () {
            return sink.close();
          }).then(function () {
            progress("export-progress", 1, 1, "Done: " + manifest.files.length + " files, " + A.fmtSize(manifest.totalBytes) + ", saved as " + top + ".tar");
            TM.ui.toast("Backup saved");
          });
        });
      })
      .catch(function (err) {
        if (err && err.name === "AbortError") return; // the save dialog was cancelled
        if (sink) sink.abort().catch(function () {});
        progress("export-progress", 0, 1, "Stopped: " + ((err && err.message) || "network error") + ". Nothing was changed; try again.");
        A.failed(err);
      })
      .then(function () {
        btn.disabled = false;
      });
  }

  /* ---------- restore ---------- */

  /* Normalises a .tar or a folder into { manifest, files: { path → Blob } }. */
  function readBackup(entries) {
    var manifestEntry = entries.filter(function (e) {
      return e.path === "manifest.json" || /\/manifest\.json$/.test(e.path);
    }).sort(function (a, b) {
      return a.path.length - b.path.length;
    })[0];
    if (!manifestEntry) return Promise.reject(new Error("No manifest.json found: this is not a Travel Memories backup."));
    var root = manifestEntry.path.slice(0, -"manifest.json".length);
    var files = {};
    entries.forEach(function (e) {
      if (e.path.indexOf(root) === 0) files[e.path.slice(root.length)] = e.blob;
    });
    return manifestEntry.blob.text().then(function (text) {
      var manifest;
      try {
        manifest = JSON.parse(text);
      } catch (e) {
        throw new Error("manifest.json is damaged.");
      }
      if (manifest.format !== "travel-memories-export" || manifest.formatVersion !== 1) throw new Error("This is not a Travel Memories backup (format version 1).");
      return { manifest: manifest, files: files };
    });
  }

  function check(backup) {
    var m = backup.manifest;
    var owners = (m.owners || []).map(function (o) {
      return o.ownerId;
    });
    if (owners.length !== 1 || owners[0] !== session.ownerId)
      throw new Error("This backup belongs to another journal (" + owners.join(", ") + ").");
    var problems = [];
    var list = m.files.filter(function (f) {
      return !/^content\/usernames\//.test(f.path) || f.path === "content/usernames/" + session.username + ".json";
    });
    var i = 0;
    function next() {
      if (i >= list.length) return Promise.resolve();
      var f = list[i++];
      var blob = backup.files[f.path];
      if (i % 10 === 0 || i === list.length) progress("restore-progress", i, list.length, "Checking files " + i + " / " + list.length + "…");
      if (!blob) problems.push("missing " + f.path);
      else if (blob.size !== f.size) problems.push("wrong size " + f.path);
      else if (f.sha256)
        return sha256(blob).then(function (sum) {
          if (sum !== f.sha256) problems.push("damaged " + f.path);
          return next();
        });
      return next();
    }
    return next().then(function () {
      if (problems.length) throw new Error("The backup failed its checks, nothing was uploaded: " + problems.slice(0, 5).join("; ") + (problems.length > 5 ? "…" : ""));
      var placesFile = list.filter(function (f) {
        return /^content\/users\/[^/]+\/places\.json$/.test(f.path);
      })[0];
      if (!placesFile) throw new Error("The backup has no places.json.");
      return backup.files[placesFile.path].text().then(function (text) {
        var places = JSON.parse(text);
        var media = list.filter(function (f) {
          return f.path.indexOf("media/") === 0;
        });
        return A.request("POST", "/backup/existing", { paths: media.map(function (f) { return f.path; }) }).then(function (r) {
          var missing = media.filter(function (f) {
            return r.existing[f.path] !== f.size;
          });
          return {
            backup: backup,
            places: places.places.length,
            documents: list.filter(function (f) { return f.path.indexOf("content/") === 0; }),
            media: media,
            missing: missing
          };
        });
      });
    });
  }

  function showCheck(c) {
    var m = c.backup.manifest;
    var when = new Date(m.exportedAt).toLocaleString("en", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
    var upload = c.missing.reduce(function (n, f) { return n + f.size; }, 0);
    $("restore-check").hidden = false;
    $("restore-check").innerHTML =
      '<p><strong>Backup of ' + esc(when) + "</strong> (" + esc(m.environment || "") + "): " + c.places + " destinations, " + c.media.length + " media files, all checks passed.</p>" +
      "<p>" + (c.media.length - c.missing.length) + " files are already stored; " + c.missing.length + " to upload (" + A.fmtSize(upload) + ").</p>" +
      '<div class="backup-actions"><button type="button" class="btn btn-danger-solid" id="restore-start">Restore this backup</button></div>';
    $("restore-start").addEventListener("click", function () {
      $("confirm-restore-text").textContent =
        "Your destinations will be replaced by the " + c.places + " destinations of this backup (" + when + "). Destinations added or changes made since then will disappear from the site; their photos stay in storage.";
      $("confirm-restore").showModal();
    });
    pending = c;
  }

  function restore(c) {
    var files = c.missing.concat(
      c.documents.slice().sort(function (a, b) {
        return /places\.json$/.test(a.path) - /places\.json$/.test(b.path); // places.json last: the switch-over
      })
    );
    var total = files.reduce(function (n, f) { return n + f.size; }, 0) || 1;
    var done = 0;
    var i = 0;
    $("restore-check").querySelectorAll("button").forEach(function (b) {
      b.disabled = true;
    });
    function next() {
      if (i >= files.length) return Promise.resolve();
      var f = files[i++];
      var blob = c.backup.files[f.path];
      return A.request("PUT", "/backup/files?path=" + encodeURIComponent(f.path), undefined, { "Content-Type": f.contentType || "application/octet-stream" }, blob).then(function () {
        done += f.size;
        progress("restore-progress", done, total, "Uploading " + i + " / " + files.length + " · " + A.fmtSize(done) + " of " + A.fmtSize(total));
        return next();
      });
    }
    return next()
      .then(function () {
        progress("restore-progress", 1, 1, "Restored: " + c.places + " destinations are live again.");
        TM.ui.toast("Backup restored");
        pending = null;
      })
      .catch(function (err) {
        progress("restore-progress", done, total, "Stopped: " + ((err && err.message) || "network error") + ". The site still shows what it showed before; you can try again.");
        A.failed(err);
        $("restore-check").querySelectorAll("button").forEach(function (b) {
          b.disabled = false;
        });
      });
  }

  function choose(entriesPromise) {
    $("restore-check").hidden = true;
    pending = null;
    progress("restore-progress", 0, 1, "Reading the backup…");
    entriesPromise
      .then(readBackup)
      .then(check)
      .then(function (c) {
        $("restore-progress").hidden = true;
        showCheck(c);
      })
      .catch(function (err) {
        progress("restore-progress", 0, 1, (err && err.message) || "Could not read the backup.");
      });
  }

  document.addEventListener("DOMContentLoaded", function () {
    $("export-start").innerHTML = TM.icons.download + "<span>Download backup</span>";
    $("export-start").addEventListener("click", download);
    $("restore-file").addEventListener("change", function (e) {
      var file = e.target.files[0];
      e.target.value = "";
      if (file) choose(TM.tar.list(file));
    });
    $("restore-folder").addEventListener("change", function (e) {
      var list = Array.prototype.map.call(e.target.files, function (f) {
        return { path: f.webkitRelativePath || f.name, size: f.size, blob: f };
      });
      e.target.value = "";
      if (list.length) choose(Promise.resolve(list));
    });
    $("restore-cancel").addEventListener("click", function () {
      $("confirm-restore").close();
    });
    $("restore-ok").addEventListener("click", function () {
      $("confirm-restore").close();
      if (pending) restore(pending);
    });
    A.start()
      .then(function (s) {
        session = s;
        return A.request("GET", "/backup/content").then(function (c) {
          session.environment = c.environment;
        });
      })
      .then(measure)
      .catch(function (err) {
        $("export-summary").textContent = "Could not measure your journal.";
        A.failed(err);
      });
  });
})();
