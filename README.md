# QR Code Maker

Type a website, get a QR code. No build step, no dependencies, no network calls —
open `index.html` in a browser and it works, including offline.

```
open index.html          # macOS
xdg-open index.html      # Linux
```

Or serve the folder if you prefer a real origin:

```
python3 -m http.server 8000    # then visit http://localhost:8000
```

## What it does

- Opens with a code for **fremontgame.vercel.app** already generated. The box is
  selected on load, so typing replaces it with any other site.
- Encodes whatever you type as you type it.
- Adds `https://` to bare hostnames, so `example.com` becomes `https://example.com`.
  Anything with its own scheme (`http:`, `mailto:`, …) is left alone.
- Downloads as **PNG** (for screens) or **SVG** (for print, scales to any size).
- Error correction level and image size live under **Options**. Higher correction
  survives smudges and logos at the cost of a denser code.
- Prefills from a query string: `index.html?url=example.com`.

## Files

| File | Purpose |
| --- | --- |
| `qrcode.js` | The encoder. Standalone, no dependencies, works in browsers and Node. |
| `app.js` | Wires the input box to the encoder, draws the canvas, handles downloads. |
| `index.html`, `style.css` | The page. |
| `test.js` | Test suite: `node test.js` |

## Using the encoder on its own

`qrcode.js` is self-contained, so you can drop it into any project:

```js
const QRCode = require("./qrcode.js");     // or <script src="qrcode.js"></script>

const qr = QRCode.encode("https://example.com", "M");
qr.size            // 25 — modules per side
qr.version         // 2
qr.modules[y][x]   // true = dark module
```

`encode(text, level, options)` takes an error correction level of `"L"`, `"M"`,
`"Q"` or `"H"` (default `"M"`), and an optional `{minVersion, maxVersion, mask}`.
It throws if the text exceeds the capacity of a version 40 symbol at that level
(2,953 bytes at level L). Remember to leave a 4-module light quiet zone around the
symbol when you render it — scanners need it.

Text is encoded in byte mode as UTF-8, which handles any input. A numeric or
uppercase-only URL would pack slightly tighter in numeric or alphanumeric mode;
those modes aren't implemented, so such codes come out marginally larger than the
theoretical minimum.

## Correctness

The encoder implements ISO/IEC 18004: byte mode encoding, Reed-Solomon error
correction over GF(256), block interleaving, all 40 versions, all 4 correction
levels, and penalty-based mask selection.

It was checked against the Python `qrcode` reference library — with the mask
forced, all 1,592 tested matrices (every EC level × every mask × versions 1–40)
matched bit-for-bit. Automatic mask choice can differ from that library on some
inputs, because it only scans for finder-like penalty patterns fully inside the
symbol while this one counts the quiet zone as light, per the spec; every mask
yields a valid, scannable code either way.

Generated codes were also decoded back with OpenCV's detector, from both the
canvas and the downloaded SVG, and round-tripped to the exact original text.

Run the suite with `node test.js`.
