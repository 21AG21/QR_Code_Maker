/*
 * Tests for qrcode.js. Run with: node test.js
 *
 * The golden hashes below were produced by cross-checking this encoder against the
 * Python `qrcode` reference library: with the mask forced, every matrix matched
 * bit-for-bit across all four EC levels and versions 1-40.
 */
"use strict";

var crypto = require("crypto");
var QRCode = require("./qrcode.js");

var failures = 0;
var checks = 0;

function check(name, condition, detail) {
  checks++;
  if (condition) {
    console.log("  ok   " + name);
  } else {
    failures++;
    console.log("  FAIL " + name + (detail ? " — " + detail : ""));
  }
}

/** Hashes the module matrix so fixtures stay short. */
function fingerprint(qr) {
  var bits = qr.modules
    .map(function (row) {
      return row
        .map(function (m) {
          return m ? "1" : "0";
        })
        .join("");
    })
    .join("");
  return crypto.createHash("sha256").update(bits).digest("hex").slice(0, 16);
}

console.log("golden matrices");
[
  { text: "https://example.com", ecc: "M", version: 2, mask: 1, size: 25, sha: "09bdb9b82a64568e" },
  { text: "http://a.co", ecc: "L", version: 1, mask: 2, size: 21, sha: "dddb4c49b0aa9e98" },
  { text: "A", ecc: "H", version: 1, mask: 7, size: 21, sha: "d38f398db3302bbc" },
  {
    text: "https://ünïcodé.example.com/página",
    ecc: "Q",
    version: 4,
    mask: 7,
    size: 33,
    sha: "dd95f33d419a15e1"
  },
  {
    text: "https://ex.com/" + "a".repeat(200),
    ecc: "H",
    version: 15,
    mask: 0,
    size: 77,
    sha: "07f4926d1d93eb38"
  }
].forEach(function (want) {
  var qr = QRCode.encode(want.text, want.ecc);
  var label = want.ecc + ' "' + want.text.slice(0, 24) + '"';
  check(
    label,
    qr.version === want.version &&
      qr.mask === want.mask &&
      qr.size === want.size &&
      fingerprint(qr) === want.sha,
    "got v" + qr.version + " mask=" + qr.mask + " sha=" + fingerprint(qr)
  );
});

console.log("structure");
(function () {
  var qr = QRCode.encode("https://example.com", "M");

  check("size follows version", qr.size === qr.version * 4 + 17);

  // The three finder patterns are a 7x7 dark ring with a 3x3 dark core.
  [[0, 0], [qr.size - 7, 0], [0, qr.size - 7]].forEach(function (origin) {
    var ox = origin[0];
    var oy = origin[1];
    var good = true;
    for (var dy = 0; dy < 7; dy++) {
      for (var dx = 0; dx < 7; dx++) {
        var dist = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
        if (qr.modules[oy + dy][ox + dx] !== (dist !== 2)) good = false;
      }
    }
    check("finder pattern at " + ox + "," + oy, good);
  });

  var timingOk = true;
  for (var i = 8; i < qr.size - 8; i++) {
    if (qr.modules[6][i] !== (i % 2 === 0)) timingOk = false;
    if (qr.modules[i][6] !== (i % 2 === 0)) timingOk = false;
  }
  check("timing patterns alternate", timingOk);

  check("dark module is set", qr.modules[qr.size - 8][8] === true);
})();

console.log("version selection");
(function () {
  // Level L version 1 holds 17 byte-mode characters; 18 needs version 2.
  check("17 bytes fits version 1 at L", QRCode.encode("x".repeat(17), "L").version === 1);
  check("18 bytes needs version 2 at L", QRCode.encode("x".repeat(18), "L").version === 2);

  // Higher error correction costs capacity, so the same text needs a bigger symbol.
  var text = "https://example.com/some/path?with=query";
  var versions = ["L", "M", "Q", "H"].map(function (level) {
    return QRCode.encode(text, level).version;
  });
  check(
    "stronger correction never shrinks the symbol",
    versions[0] <= versions[1] && versions[1] <= versions[2] && versions[2] <= versions[3],
    versions.join(" <= ")
  );

  // Multi-byte characters consume more capacity than ASCII.
  check("UTF-8 is encoded as bytes", QRCode.encode("é".repeat(9), "L").version === 2);
})();

console.log("limits and errors");
(function () {
  check("version 40 at L is reachable", QRCode.encode("x".repeat(2953), "L").version === 40);

  var threw = false;
  try {
    QRCode.encode("x".repeat(2954), "L");
  } catch (e) {
    threw = /too long/.test(e.message);
  }
  check("payload past capacity is rejected", threw);

  threw = false;
  try {
    QRCode.encode("hello", "Z");
  } catch (e) {
    threw = /error correction/i.test(e.message);
  }
  check("unknown correction level is rejected", threw);

  // Every mask must produce the same size symbol and differ from its neighbours.
  var seen = {};
  var distinct = true;
  for (var m = 0; m < 8; m++) {
    var f = fingerprint(QRCode.encode("https://example.com", "M", { mask: m }));
    if (seen[f]) distinct = false;
    seen[f] = true;
  }
  check("all 8 masks produce distinct symbols", distinct);
})();

console.log("\n" + (checks - failures) + "/" + checks + " checks passed");
process.exit(failures ? 1 : 0);
