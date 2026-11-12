/*
 * Minimal tar (ustar) writer and reader for backups, in the browser.
 * A tar file is a list of 512-byte headers each followed by the file's bytes, padded to
 * 512 bytes, and two empty blocks at the end. macOS and Windows open it natively.
 */
(function () {
  "use strict";

  var TM = (window.TM = window.TM || {});
  var enc = new TextEncoder();
  var dec = new TextDecoder();

  function put(buf, offset, length, text) {
    buf.set(enc.encode(text).subarray(0, length), offset);
  }

  function octal(n, length) {
    return n.toString(8).padStart(length - 1, "0") + "\0";
  }

  /* Long paths are split into the 155-byte prefix and 100-byte name fields. */
  function split(path) {
    if (enc.encode(path).length <= 100) return { name: path, prefix: "" };
    for (var i = path.length - 1; i > 0; i--) {
      if (path[i] !== "/") continue;
      var prefix = path.slice(0, i);
      var name = path.slice(i + 1);
      if (name && enc.encode(name).length <= 100 && enc.encode(prefix).length <= 155) return { name: name, prefix: prefix };
    }
    throw new Error("Path too long for a tar file: " + path);
  }

  function header(path, size, mtimeMs) {
    var h = new Uint8Array(512);
    var p = split(path);
    put(h, 0, 100, p.name);
    put(h, 100, 8, "0000644\0");
    put(h, 108, 8, "0000000\0");
    put(h, 116, 8, "0000000\0");
    put(h, 124, 12, octal(size, 12));
    put(h, 136, 12, octal(Math.floor((mtimeMs || Date.now()) / 1000), 12));
    put(h, 148, 8, "        ");
    h[156] = 48; // "0": regular file
    put(h, 257, 6, "ustar\0");
    put(h, 263, 2, "00");
    put(h, 345, 155, p.prefix);
    var sum = 0;
    for (var i = 0; i < 512; i++) sum += h[i];
    put(h, 148, 8, sum.toString(8).padStart(6, "0") + "\0 ");
    return h;
  }

  function padding(size) {
    return new Uint8Array((512 - (size % 512)) % 512);
  }

  function end() {
    return new Uint8Array(1024);
  }

  function text(h, offset, length) {
    var s = dec.decode(h.subarray(offset, offset + length));
    var nul = s.indexOf("\0");
    return nul === -1 ? s : s.slice(0, nul);
  }

  /* Path from a pax extended header ("<len> path=<value>\n" records), if any. */
  function paxPath(bytes) {
    var s = dec.decode(bytes);
    var m = s.match(/(?:^|\n)\d+ path=([^\n]*)\n/);
    return m ? m[1] : null;
  }

  /*
   * Lists the regular files of a tar Blob without reading their contents:
   * [{ path, size, blob }]. macOS metadata entries ("._*", "__MACOSX") are skipped.
   */
  function list(file) {
    var entries = [];
    var offset = 0;
    var nextPath = null;

    function step() {
      if (offset + 512 > file.size) return Promise.resolve(entries);
      return file
        .slice(offset, offset + 512)
        .arrayBuffer()
        .then(function (buf) {
          var h = new Uint8Array(buf);
          if (h.every(function (b) { return b === 0; })) return entries;
          if (text(h, 257, 5) !== "ustar") throw new Error("This is not a tar file.");
          var size = parseInt(text(h, 124, 12).trim() || "0", 8);
          var type = String.fromCharCode(h[156] || 48);
          var name = text(h, 0, 100);
          var prefix = text(h, 345, 155);
          var path = nextPath || (prefix ? prefix + "/" + name : name);
          var dataStart = offset + 512;
          offset = dataStart + size + padding(size).length;
          if (type === "x") {
            return file
              .slice(dataStart, dataStart + size)
              .arrayBuffer()
              .then(function (pax) {
                nextPath = paxPath(new Uint8Array(pax));
                return step();
              });
          }
          nextPath = null;
          var base = path.split("/").pop();
          if ((type === "0" || type === "\0") && base && base.indexOf("._") !== 0 && path.indexOf("__MACOSX") === -1)
            entries.push({ path: path, size: size, blob: file.slice(dataStart, dataStart + size) });
          return step();
        });
    }
    return step();
  }

  TM.tar = { header: header, padding: padding, end: end, list: list };
})();
