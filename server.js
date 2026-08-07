/*
 * A tiny static file server for local development, using only Node built-ins.
 *
 *   node server.js            # http://localhost:8000
 *   node server.js 3000       # a different port
 *   PORT=3000 node server.js  # same, via the environment
 */
"use strict";

var http = require("http");
var fs = require("fs");
var path = require("path");
var url = require("url");

var ROOT = __dirname;
var DEFAULT_PORT = 8000;

var MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".md": "text/markdown; charset=utf-8"
};

function send(res, status, body, headers) {
  res.writeHead(status, headers || { "Content-Type": "text/plain; charset=utf-8" });
  res.end(body);
}

var server = http.createServer(function (req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    send(res, 405, "Method not allowed", {
      "Content-Type": "text/plain; charset=utf-8",
      Allow: "GET, HEAD"
    });
    return;
  }

  var pathname = decodeURIComponent(url.parse(req.url).pathname);
  if (pathname === "/") pathname = "/index.html";

  // Resolve inside ROOT so "../" in a request cannot escape the project directory.
  var filePath = path.join(ROOT, path.normalize(pathname));
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    send(res, 403, "Forbidden");
    return;
  }

  fs.stat(filePath, function (err, stats) {
    if (err || !stats.isFile()) {
      send(res, 404, "Not found: " + pathname);
      return;
    }

    var type = MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    var headers = {
      "Content-Type": type,
      "Content-Length": stats.size,
      // Development server: always serve what is on disk, so edits show up on reload.
      "Cache-Control": "no-store"
    };

    if (req.method === "HEAD") {
      res.writeHead(200, headers);
      res.end();
      return;
    }

    res.writeHead(200, headers);
    var stream = fs.createReadStream(filePath);
    stream.pipe(res);
    stream.on("error", function () {
      res.destroy();
    });
  });
});

var port = Number(process.argv[2] || process.env.PORT || DEFAULT_PORT);

server.on("error", function (err) {
  if (err.code === "EADDRINUSE") {
    console.error(
      "Port " + port + " is already in use. Try: node server.js " + (port + 1)
    );
  } else {
    console.error(err.message);
  }
  process.exit(1);
});

server.listen(port, function () {
  console.log("QR Code Maker running at http://localhost:" + port);
  console.log("Press Ctrl+C to stop.");
});
