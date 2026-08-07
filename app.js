/* Wires the input box to the QR encoder and renders the result. */
(function () {
  "use strict";

  var QUIET_ZONE = 4; // Modules of light margin the spec asks for on every side.

  var input = document.getElementById("url");
  var resolvedEl = document.getElementById("resolved");
  var statusEl = document.getElementById("status");
  var canvas = document.getElementById("canvas");
  var placeholder = document.getElementById("placeholder");
  var pngButton = document.getElementById("download-png");
  var svgButton = document.getElementById("download-svg");
  var eccSelect = document.getElementById("ecc");
  var scaleInput = document.getElementById("scale");
  var scaleLabel = document.getElementById("scale-label");

  var current = null; // { url, qr } for the code on screen, or null.

  /**
   * Turns what the user typed into something worth encoding.
   * Bare hostnames like "example.com" get https:// so phones open them as links.
   */
  function normalize(raw) {
    var text = raw.trim();
    if (text === "") return "";
    // Leave anything that already carries a scheme (https:, mailto:, ...) alone.
    if (/^[a-z][a-z0-9+.-]*:/i.test(text)) return text;
    if (text.indexOf("//") === 0) return "https:" + text;
    return "https://" + text;
  }

  /** Draws the module matrix onto the canvas at the requested module size. */
  function draw(qr, moduleSize) {
    var side = (qr.size + QUIET_ZONE * 2) * moduleSize;
    canvas.width = side;
    canvas.height = side;
    canvas.style.width = Math.min(side, 320) + "px";

    var ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, side, side);
    ctx.fillStyle = "#000000";
    for (var y = 0; y < qr.size; y++) {
      for (var x = 0; x < qr.size; x++) {
        if (qr.modules[y][x]) {
          ctx.fillRect(
            (x + QUIET_ZONE) * moduleSize,
            (y + QUIET_ZONE) * moduleSize,
            moduleSize,
            moduleSize
          );
        }
      }
    }
    canvas.classList.add("visible");
    placeholder.style.display = "none";
  }

  function clear(message, isError) {
    current = null;
    canvas.classList.remove("visible");
    placeholder.style.display = "";
    pngButton.disabled = true;
    svgButton.disabled = true;
    statusEl.textContent = message || "";
    statusEl.classList.toggle("error", Boolean(isError));
  }

  function render() {
    var moduleSize = Number(scaleInput.value);
    var url = normalize(input.value);

    resolvedEl.textContent = url && url !== input.value.trim() ? "Encodes as " + url : "";

    if (url === "") {
      clear("");
      return;
    }

    var qr;
    try {
      qr = QRCode.encode(url, eccSelect.value);
    } catch (err) {
      clear(err.message, true);
      return;
    }

    current = { url: url, qr: qr };
    draw(qr, moduleSize);
    pngButton.disabled = false;
    svgButton.disabled = false;
    statusEl.classList.remove("error");
    statusEl.textContent =
      "Version " +
      qr.version +
      " · " +
      qr.size +
      "×" +
      qr.size +
      " modules · level " +
      qr.ecc;
    scaleLabel.textContent = canvas.width + "px";
  }

  /** Builds a standalone SVG of the current code, so it scales to any print size. */
  function toSvg(qr) {
    var side = qr.size + QUIET_ZONE * 2;
    var path = [];
    for (var y = 0; y < qr.size; y++) {
      for (var x = 0; x < qr.size; x++) {
        if (qr.modules[y][x]) {
          path.push("M" + (x + QUIET_ZONE) + " " + (y + QUIET_ZONE) + "h1v1h-1z");
        }
      }
    }
    return (
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' +
      side +
      " " +
      side +
      '" shape-rendering="crispEdges">\n' +
      '<rect width="100%" height="100%" fill="#ffffff"/>\n' +
      '<path fill="#000000" d="' +
      path.join("") +
      '"/>\n</svg>\n'
    );
  }

  /** Derives a tidy filename from the encoded URL, e.g. "qr-example-com.png". */
  function filename(url, extension) {
    var slug = url
      .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase()
      .slice(0, 40);
    return "qr-" + (slug || "code") + "." + extension;
  }

  function saveBlob(blob, name) {
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    // Revoke on the next tick so the download has already started.
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 0);
  }

  pngButton.addEventListener("click", function () {
    if (!current) return;
    canvas.toBlob(function (blob) {
      saveBlob(blob, filename(current.url, "png"));
    }, "image/png");
  });

  svgButton.addEventListener("click", function () {
    if (!current) return;
    var blob = new Blob([toSvg(current.qr)], { type: "image/svg+xml" });
    saveBlob(blob, filename(current.url, "svg"));
  });

  input.addEventListener("input", render);
  eccSelect.addEventListener("change", render);
  scaleInput.addEventListener("input", render);

  // Prefill from ?url=... so a link can carry the website with it.
  var params = new URLSearchParams(location.search);
  if (params.get("url")) input.value = params.get("url");
  render();
  input.focus();
})();
