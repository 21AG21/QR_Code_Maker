/**
 * A dependency-free QR Code encoder (ISO/IEC 18004).
 *
 * Encodes text in byte mode (UTF-8) and returns the finished module matrix.
 * Supports all 40 versions and all four error correction levels.
 *
 *   const qr = QRCode.encode("https://example.com", "M");
 *   qr.size            // number of modules per side
 *   qr.modules[y][x]   // true = dark
 *
 * Exposed as a global `QRCode` in the browser, and via module.exports in Node.
 */
(function (root) {
  "use strict";

  // Error correction levels: [format bits] for each level.
  var ECC = {
    L: { name: "L", ordinal: 0, formatBits: 1 },
    M: { name: "M", ordinal: 1, formatBits: 0 },
    Q: { name: "Q", ordinal: 2, formatBits: 3 },
    H: { name: "H", ordinal: 3, formatBits: 2 }
  };

  // Number of error correction codewords per block, indexed by [ecc ordinal][version].
  var ECC_CODEWORDS_PER_BLOCK = [
    // 1   2   3   4   5   6   7   8   9  10  11  12  13  14  15  16  17  18  19  20  21  22  23  24  25  26  27  28  29  30  31  32  33  34  35  36  37  38  39  40
    [-1,  7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30], // L
    [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28], // M
    [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30], // Q
    [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]  // H
  ];

  // Number of error correction blocks, indexed by [ecc ordinal][version].
  var NUM_ERROR_CORRECTION_BLOCKS = [
    // 1   2   3   4   5   6   7   8   9  10  11  12  13  14  15  16  17  18  19  20  21  22  23  24  25  26  27  28  29  30  31  32  33  34  35  36  37  38  39  40
    [-1,  1,  1,  1,  1,  1,  2,  2,  2,  2,  4,  4,  4,  4,  4,  6,  6,  6,  6,  7,  8,  8,  9,  9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25], // L
    [-1,  1,  1,  1,  2,  2,  4,  4,  4,  5,  5,  5,  8,  9,  9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49], // M
    [-1,  1,  1,  2,  2,  4,  4,  6,  6,  8,  8,  8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68], // Q
    [-1,  1,  1,  2,  4,  4,  4,  5,  6,  8,  8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81]  // H
  ];

  var MIN_VERSION = 1;
  var MAX_VERSION = 40;

  // ---------------------------------------------------------------- utilities

  function getBit(x, i) {
    return ((x >>> i) & 1) !== 0;
  }

  /** UTF-8 encodes a string into an array of byte values. */
  function toUtf8(str) {
    var bytes = [];
    for (var i = 0; i < str.length; i++) {
      var code = str.charCodeAt(i);
      // Combine surrogate pairs into a single code point.
      if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) {
        var next = str.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
          i++;
        }
      }
      if (code < 0x80) {
        bytes.push(code);
      } else if (code < 0x800) {
        bytes.push(0xc0 | (code >>> 6), 0x80 | (code & 0x3f));
      } else if (code < 0x10000) {
        bytes.push(0xe0 | (code >>> 12), 0x80 | ((code >>> 6) & 0x3f), 0x80 | (code & 0x3f));
      } else {
        bytes.push(
          0xf0 | (code >>> 18),
          0x80 | ((code >>> 12) & 0x3f),
          0x80 | ((code >>> 6) & 0x3f),
          0x80 | (code & 0x3f)
        );
      }
    }
    return bytes;
  }

  /** Total number of data + error correction modules for a version, ignoring format/version info. */
  function getNumRawDataModules(ver) {
    var result = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      var numAlign = Math.floor(ver / 7) + 2;
      result -= (25 * numAlign - 10) * numAlign - 55;
      if (ver >= 7) result -= 36;
    }
    return result;
  }

  /** Number of usable data codewords (excluding error correction) for a version and level. */
  function getNumDataCodewords(ver, ecc) {
    return (
      Math.floor(getNumRawDataModules(ver) / 8) -
      ECC_CODEWORDS_PER_BLOCK[ecc.ordinal][ver] * NUM_ERROR_CORRECTION_BLOCKS[ecc.ordinal][ver]
    );
  }

  /** Byte mode character count indicator width, which widens at versions 10 and 27. */
  function charCountBits(ver) {
    return ver <= 9 ? 8 : 16;
  }

  // ------------------------------------------------------- Reed-Solomon (GF 256)

  /** Multiplies two field elements modulo the QR generator polynomial x^8 + x^4 + x^3 + x^2 + 1. */
  function gfMultiply(x, y) {
    var z = 0;
    for (var i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11d);
      z ^= ((y >>> i) & 1) * x;
    }
    return z & 0xff;
  }

  /** Returns the coefficients of the divisor polynomial for the given number of ECC codewords. */
  function rsComputeDivisor(degree) {
    var result = [];
    for (var i = 0; i < degree - 1; i++) result.push(0);
    result.push(1); // Starts as the monomial x^0.

    var root = 1;
    for (var i = 0; i < degree; i++) {
      // Multiply the current product by (x - r^i).
      for (var j = 0; j < result.length; j++) {
        result[j] = gfMultiply(result[j], root);
        if (j + 1 < result.length) result[j] ^= result[j + 1];
      }
      root = gfMultiply(root, 0x02);
    }
    return result;
  }

  /** Returns the remainder of the data polynomial divided by the divisor: the ECC codewords. */
  function rsComputeRemainder(data, divisor) {
    var result = divisor.map(function () {
      return 0;
    });
    for (var i = 0; i < data.length; i++) {
      var factor = data[i] ^ result.shift();
      result.push(0);
      for (var j = 0; j < divisor.length; j++) {
        result[j] ^= gfMultiply(divisor[j], factor);
      }
    }
    return result;
  }

  /** Splits data into blocks, appends ECC to each, and interleaves them into the final codeword stream. */
  function addEccAndInterleave(data, ver, ecc) {
    var numBlocks = NUM_ERROR_CORRECTION_BLOCKS[ecc.ordinal][ver];
    var blockEccLen = ECC_CODEWORDS_PER_BLOCK[ecc.ordinal][ver];
    var rawCodewords = Math.floor(getNumRawDataModules(ver) / 8);
    var numShortBlocks = numBlocks - (rawCodewords % numBlocks);
    var shortBlockDataLen = Math.floor(rawCodewords / numBlocks) - blockEccLen;

    var divisor = rsComputeDivisor(blockEccLen);
    var dataBlocks = [];
    var eccBlocks = [];
    for (var i = 0, k = 0; i < numBlocks; i++) {
      var len = shortBlockDataLen + (i < numShortBlocks ? 0 : 1);
      var block = data.slice(k, k + len);
      k += len;
      dataBlocks.push(block);
      eccBlocks.push(rsComputeRemainder(block, divisor));
    }

    var result = [];
    for (var i = 0; i < shortBlockDataLen + 1; i++) {
      for (var j = 0; j < numBlocks; j++) {
        if (i < dataBlocks[j].length) result.push(dataBlocks[j][i]);
      }
    }
    for (var i = 0; i < blockEccLen; i++) {
      for (var j = 0; j < numBlocks; j++) {
        result.push(eccBlocks[j][i]);
      }
    }
    return result;
  }

  // ------------------------------------------------------------- matrix drawing

  /** Centre coordinates of the alignment patterns for a version, or [] for version 1. */
  function alignmentPatternPositions(ver) {
    if (ver === 1) return [];
    var numAlign = Math.floor(ver / 7) + 2;
    var step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2;
    var result = [6];
    for (var pos = ver * 4 + 10; result.length < numAlign; pos -= step) {
      result.splice(1, 0, pos);
    }
    return result;
  }

  function Matrix(ver, ecc) {
    this.version = ver;
    this.ecc = ecc;
    this.size = ver * 4 + 17;
    this.modules = [];
    this.isFunction = [];
    for (var y = 0; y < this.size; y++) {
      var row = [];
      var funcRow = [];
      for (var x = 0; x < this.size; x++) {
        row.push(false);
        funcRow.push(false);
      }
      this.modules.push(row);
      this.isFunction.push(funcRow);
    }
  }

  Matrix.prototype.setFunctionModule = function (x, y, isDark) {
    this.modules[y][x] = isDark;
    this.isFunction[y][x] = true;
  };

  Matrix.prototype.drawFinderPattern = function (x, y) {
    for (var dy = -4; dy <= 4; dy++) {
      for (var dx = -4; dx <= 4; dx++) {
        var dist = Math.max(Math.abs(dx), Math.abs(dy)); // Chebyshev distance from centre.
        var xx = x + dx;
        var yy = y + dy;
        if (xx >= 0 && xx < this.size && yy >= 0 && yy < this.size) {
          this.setFunctionModule(xx, yy, dist !== 2 && dist !== 4);
        }
      }
    }
  };

  Matrix.prototype.drawAlignmentPattern = function (x, y) {
    for (var dy = -2; dy <= 2; dy++) {
      for (var dx = -2; dx <= 2; dx++) {
        this.setFunctionModule(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  };

  /** Draws the 15-bit format information (error correction level + mask), twice. */
  Matrix.prototype.drawFormatBits = function (mask) {
    var data = (this.ecc.formatBits << 3) | mask;
    var rem = data;
    for (var i = 0; i < 10; i++) {
      rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    }
    var bits = ((data << 10) | rem) ^ 0x5412;

    // First copy, around the top-left finder pattern.
    for (var i = 0; i <= 5; i++) this.setFunctionModule(8, i, getBit(bits, i));
    this.setFunctionModule(8, 7, getBit(bits, 6));
    this.setFunctionModule(8, 8, getBit(bits, 7));
    this.setFunctionModule(7, 8, getBit(bits, 8));
    for (var i = 9; i < 15; i++) this.setFunctionModule(14 - i, 8, getBit(bits, i));

    // Second copy, split between the other two finder patterns.
    for (var i = 0; i < 8; i++) this.setFunctionModule(this.size - 1 - i, 8, getBit(bits, i));
    for (var i = 8; i < 15; i++) this.setFunctionModule(8, this.size - 15 + i, getBit(bits, i));
    this.setFunctionModule(8, this.size - 8, true); // Always-dark module.
  };

  /** Draws the 18-bit version information, twice. Only present on version 7 and above. */
  Matrix.prototype.drawVersionBits = function () {
    if (this.version < 7) return;
    var rem = this.version;
    for (var i = 0; i < 12; i++) {
      rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    }
    var bits = (this.version << 12) | rem;
    for (var i = 0; i < 18; i++) {
      var bit = getBit(bits, i);
      var a = this.size - 11 + (i % 3);
      var b = Math.floor(i / 3);
      this.setFunctionModule(a, b, bit);
      this.setFunctionModule(b, a, bit);
    }
  };

  Matrix.prototype.drawFunctionPatterns = function () {
    // Timing patterns.
    for (var i = 0; i < this.size; i++) {
      this.setFunctionModule(6, i, i % 2 === 0);
      this.setFunctionModule(i, 6, i % 2 === 0);
    }

    // Finder patterns, plus their separators (covered by the 9x9 draw area).
    this.drawFinderPattern(3, 3);
    this.drawFinderPattern(this.size - 4, 3);
    this.drawFinderPattern(3, this.size - 4);

    // Alignment patterns, skipping the three that would collide with finder patterns.
    var pos = alignmentPatternPositions(this.version);
    var n = pos.length;
    for (var i = 0; i < n; i++) {
      for (var j = 0; j < n; j++) {
        var isCorner =
          (i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0);
        if (!isCorner) this.drawAlignmentPattern(pos[i], pos[j]);
      }
    }

    this.drawFormatBits(0); // Placeholder; rewritten once the mask is chosen.
    this.drawVersionBits();
  };

  /** Places the codeword bits in the zigzag pattern that snakes up and down the symbol. */
  Matrix.prototype.drawCodewords = function (data) {
    var i = 0; // Bit index into data.
    for (var right = this.size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5; // Skip the vertical timing pattern column.
      for (var vert = 0; vert < this.size; vert++) {
        for (var j = 0; j < 2; j++) {
          var x = right - j;
          var upward = ((right + 1) & 2) === 0;
          var y = upward ? this.size - 1 - vert : vert;
          if (!this.isFunction[y][x] && i < data.length * 8) {
            this.modules[y][x] = getBit(data[i >>> 3], 7 - (i & 7));
            i++;
          }
          // Any remaining modules stay light, as the spec requires.
        }
      }
    }
  };

  /** XORs the data modules with the given mask pattern. Applying it twice undoes it. */
  Matrix.prototype.applyMask = function (mask) {
    for (var y = 0; y < this.size; y++) {
      for (var x = 0; x < this.size; x++) {
        if (this.isFunction[y][x]) continue;
        var invert;
        switch (mask) {
          case 0: invert = (x + y) % 2 === 0; break;
          case 1: invert = y % 2 === 0; break;
          case 2: invert = x % 3 === 0; break;
          case 3: invert = (x + y) % 3 === 0; break;
          case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break;
          case 6: invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
          case 7: invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0; break;
          default: throw new Error("Mask out of range");
        }
        if (invert) this.modules[y][x] = !this.modules[y][x];
      }
    }
  };

  /** Scores how hard the symbol would be to scan; lower is better. */
  Matrix.prototype.penaltyScore = function () {
    var N1 = 3, N2 = 3, N3 = 40, N4 = 10;
    var size = this.size;
    var result = 0;

    // Rule 1: runs of five or more same-colour modules in a row or column.
    for (var y = 0; y < size; y++) {
      var runColor = false;
      var runLen = 0;
      for (var x = 0; x < size; x++) {
        if (this.modules[y][x] === runColor) {
          runLen++;
          if (runLen === 5) result += N1;
          else if (runLen > 5) result++;
        } else {
          runColor = this.modules[y][x];
          runLen = 1;
        }
      }
    }
    for (var x = 0; x < size; x++) {
      var runColor = false;
      var runLen = 0;
      for (var y = 0; y < size; y++) {
        if (this.modules[y][x] === runColor) {
          runLen++;
          if (runLen === 5) result += N1;
          else if (runLen > 5) result++;
        } else {
          runColor = this.modules[y][x];
          runLen = 1;
        }
      }
    }

    // Rule 2: 2x2 blocks of the same colour.
    for (var y = 0; y < size - 1; y++) {
      for (var x = 0; x < size - 1; x++) {
        var color = this.modules[y][x];
        if (
          color === this.modules[y][x + 1] &&
          color === this.modules[y + 1][x] &&
          color === this.modules[y + 1][x + 1]
        ) {
          result += N2;
        }
      }
    }

    // Rule 3: finder-like 1:1:3:1:1 patterns with four light modules on one side.
    for (var y = 0; y < size; y++) {
      for (var x = 0; x < size; x++) {
        if (this.hasFinderLike(x, y, 1, 0)) result += N3;
        if (this.hasFinderLike(x, y, 0, 1)) result += N3;
      }
    }

    // Rule 4: deviation of the overall dark module proportion from 50%.
    var dark = 0;
    for (var y = 0; y < size; y++) {
      for (var x = 0; x < size; x++) {
        if (this.modules[y][x]) dark++;
      }
    }
    var total = size * size;
    var k = Math.floor((Math.abs(dark * 20 - total * 10) + total - 1) / total) - 1;
    result += k * N4;

    return result;
  };

  /** Tests for the dark:light:dark:light:dark 1:1:3:1:1 sequence plus 4 light modules. */
  Matrix.prototype.hasFinderLike = function (x, y, dx, dy) {
    var pattern = [true, false, true, true, true, false, true];
    var self = this;

    function moduleAt(i) {
      var xx = x + dx * i;
      var yy = y + dy * i;
      // Modules beyond the symbol count as light (the quiet zone).
      if (xx < 0 || xx >= self.size || yy < 0 || yy >= self.size) return false;
      return self.modules[yy][xx];
    }

    for (var i = 0; i < 7; i++) {
      if (moduleAt(i) !== pattern[i]) return false;
    }
    // Four light modules must precede or follow the pattern.
    var before = true;
    var after = true;
    for (var i = 1; i <= 4; i++) {
      if (moduleAt(-i)) before = false;
      if (moduleAt(6 + i)) after = false;
    }
    return before || after;
  };

  // ---------------------------------------------------------------- public API

  /**
   * Encodes text as a QR Code symbol.
   *
   * @param {string} text            the content, encoded in byte mode as UTF-8
   * @param {string} [eccName="M"]   error correction level: "L", "M", "Q" or "H"
   * @param {object} [opts]          {minVersion, maxVersion, mask} overrides
   * @returns {{size:number, modules:boolean[][], version:number, ecc:string, mask:number}}
   */
  function encode(text, eccName, opts) {
    opts = opts || {};
    var ecc = ECC[(eccName || "M").toUpperCase()];
    if (!ecc) throw new Error("Unknown error correction level: " + eccName);

    var minVersion = opts.minVersion || MIN_VERSION;
    var maxVersion = opts.maxVersion || MAX_VERSION;
    var bytes = toUtf8(String(text));

    // Pick the smallest version that fits the payload.
    var version = null;
    for (var ver = minVersion; ver <= maxVersion; ver++) {
      var capacityBits = getNumDataCodewords(ver, ecc) * 8;
      var neededBits = 4 + charCountBits(ver) + bytes.length * 8;
      if (neededBits <= capacityBits) {
        version = ver;
        break;
      }
    }
    if (version === null) {
      throw new Error(
        "Text is too long: " + bytes.length + " bytes exceeds the capacity at level " + ecc.name
      );
    }

    // Build the bit stream: mode indicator, length, payload.
    var bits = [];
    function appendBits(value, len) {
      for (var i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1);
    }
    appendBits(0x4, 4); // Byte mode.
    appendBits(bytes.length, charCountBits(version));
    for (var i = 0; i < bytes.length; i++) appendBits(bytes[i], 8);

    var dataCapacityBits = getNumDataCodewords(version, ecc) * 8;
    appendBits(0, Math.min(4, dataCapacityBits - bits.length)); // Terminator.
    appendBits(0, (8 - (bits.length % 8)) % 8); // Pad to a byte boundary.

    // Alternating pad codewords fill the remaining capacity.
    for (var pad = 0xec; bits.length < dataCapacityBits; pad ^= 0xec ^ 0x11) {
      appendBits(pad, 8);
    }

    var dataCodewords = [];
    for (var i = 0; i < bits.length; i += 8) {
      var b = 0;
      for (var j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
      dataCodewords.push(b);
    }

    var allCodewords = addEccAndInterleave(dataCodewords, version, ecc);

    var matrix = new Matrix(version, ecc);
    matrix.drawFunctionPatterns();
    matrix.drawCodewords(allCodewords);

    // Choose the mask with the lowest penalty, unless one was requested.
    var mask = opts.mask;
    if (mask === undefined || mask === null) {
      var bestPenalty = Infinity;
      mask = 0;
      for (var m = 0; m < 8; m++) {
        matrix.applyMask(m);
        matrix.drawFormatBits(m);
        var penalty = matrix.penaltyScore();
        if (penalty < bestPenalty) {
          bestPenalty = penalty;
          mask = m;
        }
        matrix.applyMask(m); // Undo.
      }
    }
    matrix.applyMask(mask);
    matrix.drawFormatBits(mask);

    return {
      size: matrix.size,
      modules: matrix.modules,
      version: version,
      ecc: ecc.name,
      mask: mask
    };
  }

  var QRCode = { encode: encode, MAX_VERSION: MAX_VERSION };

  if (typeof module === "object" && module.exports) module.exports = QRCode;
  else root.QRCode = QRCode;
})(typeof self !== "undefined" ? self : this);
