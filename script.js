/**
 * Portable Attention Box — dual-shell navigation + local prototype state
 * Desktop ≥769px · Mobile ≤768px
 */
(function () {
  "use strict";

  var STORAGE_KEY = "pab_records_v1";

  /** Canonical spatial scan output (matches live step-05 canvas). */
  var SPATIAL_SCAN_OUT_W = 720;
  var SPATIAL_SCAN_OUT_H = 500;
  /** Point budget scale for light “chart” spatial scan (circles + grid; capped in paint). */
  var SPATIAL_PAINT_FILL_FACTOR = 0.011;
  var SPATIAL_EXPORT_FILL_FACTOR = 0.016;

  var DESKTOP_RECORDS = [
    { id: "041", date: "Apr 12, 2025", time: "9:41am", focus: 72, mood: "Calm", light: "Soft", objects: 5 },
    { id: "040", date: "Apr 11, 2025", time: "8:15am", focus: 88, mood: "Focused", light: "Bright", objects: 5 },
    { id: "039", date: "Apr 9, 2025", time: "2:02pm", focus: 45, mood: "Restless", light: "Artificial", objects: 4 },
    { id: "038", date: "Apr 7, 2025", time: "10:30am", focus: 61, mood: "Alert", light: "Soft", objects: 6 },
    { id: "037", date: "Apr 5, 2025", time: "7:55am", focus: 79, mood: "Calm", light: "Bright", objects: 5 },
    { id: "036", date: "Apr 3, 2025", time: "11:20am", focus: 55, mood: "Tired", light: "Dim", objects: 3 },
  ];

  var EARLIER_MOCKS = [
    {
      id: "earlier-a",
      recordCode: "035",
      displayId: "PAB-2025-0328-035",
      date: "Mar 28, 2025",
      time: "4:12pm",
      focus: 52,
      mood: "Calm",
      light: "Dim",
      objects: 4,
      notes: "Earlier imported record (mock).",
      photoDataUrl: null,
      duration: "1h 05m",
      createdAt: 0,
    },
    {
      id: "earlier-b",
      recordCode: "034",
      displayId: "PAB-2025-0315-034",
      date: "Mar 15, 2025",
      time: "11:30am",
      focus: 67,
      mood: "Focused",
      light: "Soft",
      objects: 5,
      notes: "Earlier imported record (mock).",
      photoDataUrl: null,
      duration: "3h 10m",
      createdAt: 0,
    },
  ];

  var deskCameraStream = null;

  var state = {
    mobileStack: [],
    uploadedImage: null,
    focusLevel: 72,
    selectedMood: "Calm",
    selectedLighting: "Soft",
    recallMood: "Any",
    draftRecordKey: null,
    showEarlierMobile: false,
    selectedRecord: null,
    deskEntryStep: 1,
    deskDraftStarted: false,
    /** Shared archive list filter (desktop table + mobile cards). */
    archiveFilter: "all",
    archiveSortNewestFirst: true,
    /** Estimated object / region count from mobile processing analysis (optional). */
    mobileInferredObjectCount: null,
  };

  function seedInitialRecords() {
    var now = Date.now();
    return DESKTOP_RECORDS.map(function (r, idx) {
      return {
        id: "seed-" + r.id,
        recordCode: r.id,
        displayId: "PAB-2025-0" + r.id,
        date: r.date,
        time: r.time,
        focus: r.focus,
        mood: r.mood,
        light: r.light,
        objects: r.objects != null ? r.objects : 5,
        notes:
          "Morning session. " + r.mood + " mood, " + r.light + " light — logged as record " + r.id + ".",
        photoDataUrl: null,
        duration: "2h 14m",
        createdAt: now - idx * 86400000,
      };
    });
  }

  function loadRecordsFromStorage() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        var initial = seedInitialRecords();
        localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
        return initial;
      }
      var arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : seedInitialRecords();
    } catch (e) {
      return seedInitialRecords();
    }
  }

  function saveRecordsToStorage(arr) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
  }

  function isStorageQuotaError(e) {
    if (!e) return false;
    if (e.name === "QuotaExceededError") return true;
    if (e.name === "NS_ERROR_DOM_QUOTA_REACHED") return true;
    if (e.code === 22) return true;
    if (e.code === 1014) return true;
    return false;
  }

  /** Resize JPEG data URL so localStorage JSON stays under typical ~5MB limits. */
  function compressImageDataUrl(dataUrl, maxEdge, quality, callback) {
    if (!dataUrl || typeof dataUrl !== "string" || dataUrl.indexOf("data:image") !== 0) {
      callback(dataUrl);
      return;
    }
    var img = new Image();
    img.onload = function () {
      try {
        var w = img.naturalWidth || img.width;
        var h = img.naturalHeight || img.height;
        if (!w || !h) {
          callback(dataUrl);
          return;
        }
        var sc = Math.min(1, maxEdge / Math.max(w, h));
        var tw = Math.max(1, Math.round(w * sc));
        var th = Math.max(1, Math.round(h * sc));
        var c = document.createElement("canvas");
        c.width = tw;
        c.height = th;
        var ctx = c.getContext("2d");
        if (!ctx) {
          callback(dataUrl);
          return;
        }
        ctx.drawImage(img, 0, 0, tw, th);
        var out = c.toDataURL("image/jpeg", quality);
        callback(out || dataUrl);
      } catch (err) {
        callback(dataUrl);
      }
    };
    img.onerror = function () {
      callback(dataUrl);
    };
    img.src = dataUrl;
  }

  function persistRecordListWithQuotaFallback(all, rec) {
    try {
      saveRecordsToStorage(all);
      return true;
    } catch (e) {
      if (!isStorageQuotaError(e)) {
        return false;
      }
      all.shift();
      rec.photoDataUrl = null;
      rec.scanImageDataUrl = null;
      all.unshift(rec);
      try {
        saveRecordsToStorage(all);
        return true;
      } catch (e2) {
        return false;
      }
    }
  }

  function getAllRecords() {
    return loadRecordsFromStorage();
  }

  function getRecordsForDisplayMobile() {
    var base = getAllRecords().slice();
    base.sort(function (a, b) {
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
    return state.showEarlierMobile ? base.concat(EARLIER_MOCKS) : base;
  }

  function findRecordById(id) {
    var pool = getRecordsForDisplayMobile();
    var i;
    for (i = 0; i < pool.length; i += 1) {
      if (pool[i].id === id) return pool[i];
    }
    var desk = getAllRecords();
    for (i = 0; i < desk.length; i += 1) {
      if (desk[i].id === id) return desk[i];
    }
    return null;
  }

  function findRecordByIdDesk(id) {
    var all = getAllRecords();
    var i;
    for (i = 0; i < all.length; i += 1) {
      if (all[i].id === id) return all[i];
    }
    return null;
  }

  function hashString(str) {
    var h = 2166136261 >>> 0;
    var i;
    for (i = 0; i < str.length; i += 1) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mulberry32(seed) {
    return function () {
      var t = (seed += 0x6d2b79f5) >>> 0;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function drawPointCloudMetatool(canvas, seed, density) {
    var w = canvas.width;
    var h = canvas.height;
    var ctx = canvas.getContext("2d");
    if (!ctx) return;
    var rand = mulberry32(hashString(String(seed)) || 1);
    ctx.clearRect(0, 0, w, h);

    ctx.strokeStyle = "rgba(12,12,12,0.05)";
    ctx.lineWidth = 0.5;
    var y;
    for (y = 0; y <= h; y += 20) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    var x;
    for (x = 0; x <= w; x += 20) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }

    var pts = [];
    var cx = w * 0.5;
    var cy = h * 0.5;
    var i;
    for (i = 0; i < density; i += 1) {
      var a = rand() * Math.PI * 2;
      var rad = Math.pow(rand(), 0.6) * Math.min(w, h) * 0.42;
      pts.push({
        x: cx + Math.cos(a) * rad * (0.6 + rand() * 0.8),
        y: cy + Math.sin(a) * rad * 0.7,
        s: 0.8 + rand() * 2.5,
        o: 0.15 + rand() * 0.7,
      });
    }
    [[0.25, 0.38], [0.55, 0.3], [0.74, 0.52], [0.38, 0.65], [0.62, 0.68]].forEach(function (pair) {
      var j;
      for (j = 0; j < 14; j += 1) {
        pts.push({
          x: pair[0] * w + (rand() - 0.5) * 36,
          y: pair[1] * h + (rand() - 0.5) * 28,
          s: 1 + rand() * 3,
          o: 0.3 + rand() * 0.65,
        });
      }
    });

    for (i = 0; i < Math.min(50, pts.length); i += 1) {
      var j;
      for (j = i + 1; j < Math.min(i + 3, pts.length); j += 1) {
        var p = pts[i];
        var q = pts[j];
        var d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d < 60) {
          ctx.strokeStyle = "rgba(12,12,12,0.09)";
          ctx.lineWidth = 0.5;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(q.x, q.y);
          ctx.stroke();
        }
      }
    }

    pts.forEach(function (p) {
      ctx.fillStyle = "rgba(12,12,12," + p.o + ")";
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.s, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function drawPointCloudPortable(canvas, seed, density) {
    var w = canvas.width;
    var h = canvas.height;
    var ctx = canvas.getContext("2d");
    if (!ctx) return;
    var rand = mulberry32(hashString(String(seed)) || 1);
    ctx.clearRect(0, 0, w, h);

    var yi;
    for (yi = 0; yi <= Math.floor(h / 20); yi += 1) {
      ctx.strokeStyle = "rgba(12,12,12,0.06)";
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(0, yi * 20);
      ctx.lineTo(w, yi * 20);
      ctx.stroke();
    }
    var xi;
    for (xi = 0; xi <= Math.floor(w / 20); xi += 1) {
      ctx.beginPath();
      ctx.moveTo(xi * 20, 0);
      ctx.lineTo(xi * 20, h);
      ctx.stroke();
    }

    var pts = [];
    var cx = w * 0.5;
    var cy = h * 0.45;
    var i;
    for (i = 0; i < density; i += 1) {
      var angle = rand() * Math.PI * 2;
      var spread = rand();
      var radius = Math.pow(spread, 0.5) * Math.min(w, h) * 0.44;
      pts.push({
        x: cx + Math.cos(angle) * radius * (0.5 + rand() * 0.5),
        y: cy + Math.sin(angle) * radius * 0.65,
        s: 0.8 + rand() * 2.2,
        o: 0.15 + rand() * 0.75,
      });
    }
    [[0.28, 0.38], [0.55, 0.32], [0.72, 0.5], [0.38, 0.62], [0.6, 0.65]].forEach(function (pair) {
      var j;
      for (j = 0; j < 12; j += 1) {
        pts.push({
          x: pair[0] * w + (rand() - 0.5) * 28,
          y: pair[1] * h + (rand() - 0.5) * 20,
          s: 1 + rand() * 2.5,
          o: 0.4 + rand() * 0.55,
        });
      }
    });

    for (i = 0; i < Math.min(40, pts.length); i += 1) {
      var k;
      for (k = i + 1; k < Math.min(i + 3, pts.length); k += 1) {
        var p = pts[i];
        var q = pts[k];
        var dist = Math.hypot(q.x - p.x, q.y - p.y);
        if (dist < 55) {
          ctx.strokeStyle = "rgba(12,12,12,0.1)";
          ctx.lineWidth = 0.5;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(q.x, q.y);
          ctx.stroke();
        }
      }
    }

    pts.forEach(function (p) {
      ctx.fillStyle = "rgba(12,12,12," + p.o + ")";
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.s, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  /**
   * Build a per-cell weight map from an image: stronger weight where there are
   * edges (object boundaries) and local luminance variance (texture / clutter).
   */
  function sampleImageToDensityGrid(img, cols, rows) {
    var c = document.createElement("canvas");
    c.width = cols;
    c.height = rows;
    var ctx = c.getContext("2d");
    if (!ctx) {
      return { weights: new Float32Array(cols * rows).fill(1), cols: cols, rows: rows, totalWeight: cols * rows };
    }
    var iw = img.naturalWidth || img.width;
    var ih = img.naturalHeight || img.height;
    if (!iw || !ih) {
      return { weights: new Float32Array(cols * rows).fill(1), cols: cols, rows: rows, totalWeight: cols * rows };
    }
    /* Use contain-fit normalization (not cover-crop) so object scale stays
       consistent across different photo aspect ratios. */
    var scale = Math.min(cols / iw, rows / ih);
    var dw = Math.max(1, Math.round(iw * scale));
    var dh = Math.max(1, Math.round(ih * scale));
    var dx = Math.round((cols - dw) / 2);
    var dy = Math.round((rows - dh) / 2);
    ctx.fillStyle = "rgb(238,238,236)";
    ctx.fillRect(0, 0, cols, rows);
    ctx.drawImage(img, 0, 0, iw, ih, dx, dy, dw, dh);
    var id = ctx.getImageData(0, 0, cols, rows);
    var data = id.data;
    var gray = new Float32Array(cols * rows);
    var gx;
    var gy;
    var i;
    for (gy = 0; gy < rows; gy += 1) {
      for (gx = 0; gx < cols; gx += 1) {
        i = (gy * cols + gx) * 4;
        gray[gy * cols + gx] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      }
    }
    function getG(x, y) {
      var cx = x;
      var cy = y;
      if (cx < 0) cx = 0;
      if (cx >= cols) cx = cols - 1;
      if (cy < 0) cy = 0;
      if (cy >= rows) cy = rows - 1;
      return gray[cy * cols + cx];
    }
    var mag = new Float32Array(cols * rows);
    var Gx;
    var Gy;
    for (gy = 0; gy < rows; gy += 1) {
      for (gx = 0; gx < cols; gx += 1) {
        Gx =
          -getG(gx - 1, gy - 1) +
          getG(gx + 1, gy - 1) +
          2 * (-getG(gx - 1, gy) + getG(gx + 1, gy)) -
          getG(gx - 1, gy + 1) +
          getG(gx + 1, gy + 1);
        Gy =
          -getG(gx - 1, gy - 1) -
          2 * getG(gx, gy - 1) -
          getG(gx + 1, gy - 1) +
          getG(gx - 1, gy + 1) +
          2 * getG(gx, gy + 1) +
          getG(gx + 1, gy + 1);
        mag[gy * cols + gx] = Math.sqrt(Gx * Gx + Gy * Gy);
      }
    }
    var weights = new Float32Array(cols * rows);
    var maxW = 0;
    for (gy = 0; gy < rows; gy += 1) {
      for (gx = 0; gx < cols; gx += 1) {
        var sum = 0;
        var sumSq = 0;
        var cnt = 0;
        var dy;
        var dx;
        for (dy = -1; dy <= 1; dy += 1) {
          for (dx = -1; dx <= 1; dx += 1) {
            var vly = gy + dy;
            var vlx = gx + dx;
            if (vly < 0 || vly >= rows || vlx < 0 || vlx >= cols) continue;
            var gv = gray[vly * cols + vlx];
            sum += gv;
            sumSq += gv * gv;
            cnt += 1;
          }
        }
        var mean = sum / cnt;
        var variance = Math.max(0, sumSq / cnt - mean * mean);
        var e = mag[gy * cols + gx];
        var wgt = e * 0.62 + Math.sqrt(variance) * 0.38;
        /* Suppress artificial contain-fit box edges: downweight near letterbox borders. */
        var inImg = gx >= dx && gx < dx + dw && gy >= dy && gy < dy + dh;
        if (!inImg) {
          weights[gy * cols + gx] = 0.035;
          continue;
        }
        var borderDist = Math.min(gx - dx, dx + dw - 1 - gx, gy - dy, dy + dh - 1 - gy);
        var borderFade = Math.max(0, Math.min(1, borderDist / 2));
        wgt *= 0.35 + 0.65 * borderFade;
        weights[gy * cols + gx] = wgt;
        if (wgt > maxW) maxW = wgt;
      }
    }
    var total = 0;
    for (i = 0; i < weights.length; i += 1) {
      weights[i] = (weights[i] / (maxW + 1e-6)) * 0.9 + 0.1;
      total += weights[i];
    }
    return { weights: weights, cols: cols, rows: rows, totalWeight: total };
  }

  function escapeHtmlMini(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function varianceOfWeights(weights) {
    var n = weights.length;
    if (!n) return 0;
    var s = 0;
    var s2 = 0;
    var i;
    for (i = 0; i < n; i += 1) {
      var v = weights[i];
      s += v;
      s2 += v * v;
    }
    var m = s / n;
    return Math.max(0, s2 / n - m * m);
  }

  function countDensityBlobs(weights, cols, rows) {
    var sum = 0;
    var i;
    for (i = 0; i < weights.length; i += 1) {
      sum += weights[i];
    }
    var avg = sum / weights.length;
    var thr = Math.min(0.74, Math.max(0.24, avg * 1.05 + 0.06));
    var mask = new Uint8Array(cols * rows);
    for (i = 0; i < weights.length; i += 1) {
      mask[i] = weights[i] >= thr ? 1 : 0;
    }
    var seen = new Uint8Array(cols * rows);
    var blobs = 0;
    var y;
    var x;
    for (y = 0; y < rows; y += 1) {
      for (x = 0; x < cols; x += 1) {
        var idx = y * cols + x;
        if (!mask[idx] || seen[idx]) continue;
        blobs += 1;
        var q = [idx];
        seen[idx] = 1;
        while (q.length) {
          var cur = q.pop();
          var cx = cur % cols;
          var cy = (cur / cols) | 0;
          var dirs = [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ];
          var d;
          for (d = 0; d < 4; d += 1) {
            var nx = cx + dirs[d][0];
            var ny = cy + dirs[d][1];
            if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
            var ni = ny * cols + nx;
            if (!mask[ni] || seen[ni]) continue;
            seen[ni] = 1;
            q.push(ni);
          }
        }
      }
    }
    return { blobs: blobs, thr: thr, avg: avg };
  }

  function columnDensityHistogram(weights, cols, rows, numBars) {
    var bars = [];
    var colW = cols / numBars;
    var b;
    for (b = 0; b < numBars; b += 1) {
      var x0 = Math.floor(b * colW);
      var x1 = b === numBars - 1 ? cols : Math.floor((b + 1) * colW);
      var sum = 0;
      var gx;
      var gy;
      for (gy = 0; gy < rows; gy += 1) {
        for (gx = x0; gx < x1; gx += 1) {
          sum += weights[gy * cols + gx];
        }
      }
      var cells = Math.max(1, (x1 - x0) * rows);
      bars[b] = sum / cells;
    }
    var maxB = 0;
    for (b = 0; b < numBars; b += 1) {
      if (bars[b] > maxB) maxB = bars[b];
    }
    if (maxB <= 0) {
      for (b = 0; b < numBars; b += 1) {
        bars[b] = 0.15;
      }
      return bars;
    }
    for (b = 0; b < numBars; b += 1) {
      bars[b] = bars[b] / maxB;
    }
    return bars;
  }

  function buildMobileProcStructureLabels(weights, cols, rows, blobInfo) {
    var chips = [];
    var b = blobInfo.blobs;
    if (b <= 0) {
      chips.push("No strong density peaks");
    } else {
      chips.push("Salient regions ×" + Math.min(b, 14));
    }

    var mid = cols / 2;
    var left = 0;
    var right = 0;
    var lc = 0;
    var rc = 0;
    var gx;
    var gy;
    for (gy = 0; gy < rows; gy += 1) {
      for (gx = 0; gx < cols; gx += 1) {
        var w0 = weights[gy * cols + gx];
        if (gx < mid) {
          left += w0;
          lc += 1;
        } else {
          right += w0;
          rc += 1;
        }
      }
    }
    var lMean = lc ? left / lc : 0;
    var rMean = rc ? right / rc : 0;
    if (lMean > rMean * 1.16) {
      chips.push("Left-weighted density");
    } else if (rMean > lMean * 1.16) {
      chips.push("Right-weighted density");
    }

    var tThird = Math.max(1, Math.floor(rows / 3));
    var top = 0;
    var bot = 0;
    var tc = 0;
    var bc = 0;
    for (gy = 0; gy < rows; gy += 1) {
      for (gx = 0; gx < cols; gx += 1) {
        var w1 = weights[gy * cols + gx];
        if (gy < tThird) {
          top += w1;
          tc += 1;
        } else if (gy >= rows - tThird) {
          bot += w1;
          bc += 1;
        }
      }
    }
    var tMean = tc ? top / tc : 0;
    var bMean = bc ? bot / bc : 0;
    if (tMean > bMean * 1.14) {
      chips.push("Upper-field detail");
    } else if (bMean > tMean * 1.14) {
      chips.push("Lower-plane emphasis");
    }

    var v = varianceOfWeights(weights);
    if (v > 0.035) {
      chips.push("High local contrast");
    } else if (v < 0.012) {
      chips.push("Smooth / uniform tone");
    }

    var hiFrac = 0;
    var tot = weights.length;
    var ii;
    for (ii = 0; ii < tot; ii += 1) {
      if (weights[ii] >= blobInfo.thr) hiFrac += 1;
    }
    hiFrac /= Math.max(1, tot);
    if (hiFrac > 0.38) {
      chips.push("Busy / cluttered field");
    } else if (hiFrac < 0.14) {
      chips.push("Sparse composition");
    }

    return chips.slice(0, 7);
  }

  function setMobileProcessingLogComplete(done) {
    var rows = document.querySelectorAll("#mobile-processing .processing-item");
    if (rows.length < 3) return;
    var last = rows[2];
    var dot = last.querySelector(".processing-dot");
    var label = last.querySelectorAll("span")[1];
    if (done) {
      if (dot) {
        dot.classList.remove("active");
        dot.classList.add("done");
      }
      if (label) {
        label.style.color = "var(--gray3)";
      }
      var mark = last.querySelectorAll("span")[2];
      if (mark) mark.textContent = "✓";
    } else {
      if (dot) {
        dot.classList.add("active");
        dot.classList.remove("done");
      }
      if (label) {
        label.style.color = "var(--ink)";
      }
      var mark2 = last.querySelectorAll("span")[2];
      if (mark2) mark2.textContent = "";
    }
  }

  function renderMobileProcAnalysis(dataUrl) {
    var chipsHost = document.getElementById("mobile-proc-objects");
    var barsHost = document.getElementById("mobile-proc-density-bars");
    if (!chipsHost || !barsHost) return;

    function showEmpty() {
      chipsHost.innerHTML =
        '<span class="mobile-proc-chip mobile-proc-chip--muted">Upload a desk photo to analyze structure</span>';
      var i;
      var h = "";
      for (i = 0; i < 12; i += 1) {
        h +=
          '<span class="mobile-proc-bar" style="height:18%;opacity:0.22"></span>';
      }
      barsHost.innerHTML = h;
      state.mobileInferredObjectCount = null;
      setMobileProcessingLogComplete(false);
    }

    if (!dataUrl) {
      showEmpty();
      return;
    }

    setMobileProcessingLogComplete(false);
    chipsHost.innerHTML =
      '<span class="mobile-proc-chip mobile-proc-chip--muted">Analyzing…</span>';
    barsHost.innerHTML = "";

    var img = new Image();
    img.onload = function () {
      try {
        var grid = sampleImageToDensityGrid(img, 42, 30);
        var w = grid.weights;
        var cols = grid.cols;
        var rows = grid.rows;
        var blobInfo = countDensityBlobs(w, cols, rows);
        var labels = buildMobileProcStructureLabels(w, cols, rows, blobInfo);
        chipsHost.innerHTML = labels
          .map(function (t) {
            return (
              '<span class="mobile-proc-chip">' + escapeHtmlMini(t) + "</span>"
            );
          })
          .join("");

        var bars = columnDensityHistogram(w, cols, rows, 12);
        var bh = "";
        var bi;
        for (bi = 0; bi < bars.length; bi += 1) {
          var hPct = Math.max(14, Math.round(bars[bi] * 100));
          var op = 0.32 + bars[bi] * 0.58;
          bh +=
            '<span class="mobile-proc-bar" style="height:' +
            hPct +
            "%;opacity:" +
            op +
            '"></span>';
        }
        barsHost.innerHTML = bh;

        var est = Math.max(
          2,
          Math.min(12, blobInfo.blobs + Math.round(blobInfo.avg * 4))
        );
        state.mobileInferredObjectCount = est;
        setMobileProcessingLogComplete(true);
      } catch (err) {
        chipsHost.innerHTML =
          '<span class="mobile-proc-chip mobile-proc-chip--muted">Could not read image analysis</span>';
        var j;
        var eh = "";
        for (j = 0; j < 12; j += 1) {
          eh +=
            '<span class="mobile-proc-bar" style="height:18%;opacity:0.22"></span>';
        }
        barsHost.innerHTML = eh;
        state.mobileInferredObjectCount = null;
        setMobileProcessingLogComplete(false);
      }
    };
    img.onerror = function () {
      showEmpty();
    };
    img.src = dataUrl;
  }

  function drawPointCloudFromDensityGrid(canvas, grid, pointCount, variant) {
    var w = canvas.width;
    var h = canvas.height;
    var ctx = canvas.getContext("2d");
    if (!ctx || !grid || !grid.weights) return;
    var weights = grid.weights;
    var cols = grid.cols;
    var rows = grid.rows;
    var totalWeight = grid.totalWeight || 0;
    if (totalWeight <= 0) {
      totalWeight = weights.length;
    }
    var rand = mulberry32(hashString(String(totalWeight) + "-" + cols + "-" + rows) || 1);
    ctx.clearRect(0, 0, w, h);

    ctx.strokeStyle = "rgba(12,12,12,0.05)";
    ctx.lineWidth = 0.5;
    var yy;
    var xx;
    for (yy = 0; yy <= h; yy += 20) {
      ctx.beginPath();
      ctx.moveTo(0, yy);
      ctx.lineTo(w, yy);
      ctx.stroke();
    }
    for (xx = 0; xx <= w; xx += 20) {
      ctx.beginPath();
      ctx.moveTo(xx, 0);
      ctx.lineTo(xx, h);
      ctx.stroke();
    }

    var maxW = 0;
    var wi;
    for (wi = 0; wi < weights.length; wi += 1) {
      if (weights[wi] > maxW) maxW = weights[wi];
    }

    function pickCell() {
      var t = rand() * totalWeight;
      var acc = 0;
      var k;
      for (k = 0; k < weights.length; k += 1) {
        acc += weights[k];
        if (t <= acc) return k;
      }
      return weights.length - 1;
    }

    var pts = [];
    var i;
    for (i = 0; i < pointCount; i += 1) {
      var idx = pickCell();
      var cellX = idx % cols;
      var cellY = Math.floor(idx / cols);
      var dNorm = weights[idx] / (maxW + 1e-6);
      var jitterX = (rand() * 0.82 + 0.09) / cols;
      var jitterY = (rand() * 0.82 + 0.09) / rows;
      var px = ((cellX + jitterX) / cols) * w;
      var py = ((cellY + jitterY) / rows) * h;
      if (variant === "portable") {
        py = py * 0.93 + h * 0.035;
      }
      pts.push({
        x: px,
        y: py,
        s: 0.65 + dNorm * 2.85 + rand() * 0.5,
        o: Math.min(0.92, 0.13 + dNorm * 0.64 + rand() * 0.14),
        d: dNorm,
      });
    }

    var edgeDist = variant === "portable" ? 55 : 60;
    var edgeCap = variant === "portable" ? 40 : 50;
    for (i = 0; i < Math.min(edgeCap, pts.length); i += 1) {
      var j;
      for (j = i + 1; j < Math.min(i + 3, pts.length); j += 1) {
        var p = pts[i];
        var q = pts[j];
        var dist = Math.hypot(q.x - p.x, q.y - p.y);
        if (dist < edgeDist) {
          var da = p.d != null ? p.d : 0.5;
          var db = q.d != null ? q.d : 0.5;
          var edgeAlpha = 0.055 + 0.08 * Math.min(da, db);
          ctx.strokeStyle = "rgba(12,12,12," + edgeAlpha + ")";
          ctx.lineWidth = 0.5;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(q.x, q.y);
          ctx.stroke();
        }
      }
    }

    pts.forEach(function (p) {
      ctx.fillStyle = "rgba(12,12,12," + p.o + ")";
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.s, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function drawPointCloudMetatoolFromImage(canvas, dataUrl, pointCount) {
    if (!canvas || !dataUrl) return;
    drawSpatialScanFromImage(canvas, dataUrl, {
      focus: state.focusLevel,
      mood: getDeskLogMood(),
      light: getDeskLogLight(),
      pointCount: pointCount != null ? pointCount : null,
    });
  }

  function drawPointCloudPortableFromImage(canvas, dataUrl, pointCount) {
    if (!canvas || !dataUrl) return;
    drawSpatialScanFromImage(canvas, dataUrl, {
      focus: state.focusLevel,
      mood: state.selectedMood,
      light: state.selectedLighting,
      pointCount: pointCount != null ? pointCount : null,
    });
  }

  /**
   * Core paint: light grid + grayscale variable circles + faint links + center reticle.
   * Still driven from sampleImageToDensityGrid (desk photo), not a raw threshold bitmap.
   */
  function paintSpatialScanFromLoadedImage(ctx, cssW, cssH, dpr, img, params) {
    params = params || {};
    var focus = Number(params.focus);
    if (isNaN(focus)) focus = 72;
    var mood = params.mood || "Calm";
    var light = params.light || "Soft";
    var pointOverride = params.pointCount != null ? params.pointCount : null;

    var cols = Math.round(70 + (focus / 100) * 30);
    var rows = Math.max(40, Math.round(cols * (cssH / cssW)));
    var grid = sampleImageToDensityGrid(img, cols, rows);
    var weights = grid.weights;
    var totalWeight = grid.totalWeight || 1;
    if (totalWeight <= 0) totalWeight = weights.length;
    var maxW = 0;
    var wi;
    for (wi = 0; wi < weights.length; wi += 1) {
      if (weights[wi] > maxW) maxW = weights[wi];
    }

    var rand = mulberry32(hashString(String(totalWeight) + mood + light + cols + "-" + cssW + "x" + cssH) || 1);
    var focusNorm = focus / 100;
    var jitterBoost = 0.88 + (1 - focusNorm) * 0.22;
    var lowMood = String(mood).toLowerCase();
    var moodJ = 1;
    if (lowMood.indexOf("anxious") >= 0 || lowMood.indexOf("restless") >= 0) moodJ = 1.08;
    else if (lowMood.indexOf("tired") >= 0) moodJ = 1.04;

    var lightLower = String(light).toLowerCase();
    var opBoost = 1;
    if (lightLower.indexOf("bright") >= 0 || lightLower.indexOf("sun") >= 0) opBoost = 1.08;
    else if (lightLower.indexOf("dim") >= 0) opBoost = 0.88;
    else if (lightLower.indexOf("soft") >= 0) opBoost = 1;
    else if (lightLower.indexOf("artificial") >= 0) opBoost = 0.94;

    var nBase = Math.round(cssW * cssH * SPATIAL_PAINT_FILL_FACTOR);
    var nPts = pointOverride != null
      ? Math.min(9200, Math.max(3200, Math.round(pointOverride * 0.98)))
      : Math.min(8200, Math.max(3000, nBase));

    function pickCell() {
      var t = rand() * totalWeight;
      var acc = 0;
      var k;
      for (k = 0; k < weights.length; k += 1) {
        acc += weights[k];
        if (t <= acc) return k;
      }
      return weights.length - 1;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#f2f1ee";
    ctx.fillRect(0, 0, cssW, cssH);

    var gridStep = Math.max(16, Math.round(Math.min(cssW, cssH) / 26));
    ctx.strokeStyle = "rgba(12,12,12,0.06)";
    ctx.lineWidth = 0.5;
    var gx;
    var gy;
    for (gy = 0; gy <= cssH; gy += gridStep) {
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.lineTo(cssW, gy);
      ctx.stroke();
    }
    for (gx = 0; gx <= cssW; gx += gridStep) {
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, cssH);
      ctx.stroke();
    }

    var pts = [];
    var i;
    for (i = 0; i < nPts; i += 1) {
      var idx = pickCell();
      var cellX = idx % cols;
      var cellY = Math.floor(idx / cols);
      var dNorm = weights[idx] / (maxW + 1e-6);
      /* Jitter in cell units (0..1), not in normalized grid units, to avoid row/column striping. */
      var jx = Math.min(0.98, (rand() * 0.82 + 0.09) * jitterBoost * moodJ);
      var jy = Math.min(0.98, (rand() * 0.82 + 0.09) * jitterBoost * moodJ);
      var px = ((cellX + jx) / cols) * cssW;
      var py = ((cellY + jy) / rows) * cssH;
      if (px < 0) px = 0;
      if (py < 0) py = 0;
      if (px >= cssW) px = cssW - 1e-6;
      if (py >= cssH) py = cssH - 1e-6;
      var radius = 0.55 + dNorm * 2.65 + rand() * 0.55;
      var opac = Math.min(0.9, (0.12 + dNorm * 0.62 + rand() * 0.12) * opBoost);
      pts.push({ x: px, y: py, s: radius, o: opac, d: dNorm });
    }

    var edgeDist = Math.min(72, 0.14 * Math.min(cssW, cssH));
    var edgeCap = Math.min(56, Math.round(36 + nPts * 0.004));
    for (i = 0; i < Math.min(edgeCap, pts.length); i += 1) {
      var j;
      for (j = i + 1; j < Math.min(i + 4, pts.length); j += 1) {
        var p = pts[i];
        var q = pts[j];
        var dist = Math.hypot(q.x - p.x, q.y - p.y);
        if (dist < edgeDist) {
          var da = p.d != null ? p.d : 0.5;
          var db = q.d != null ? q.d : 0.5;
          var edgeAlpha = 0.05 + 0.09 * Math.min(da, db);
          ctx.strokeStyle = "rgba(12,12,12," + edgeAlpha + ")";
          ctx.lineWidth = 0.5;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(q.x, q.y);
          ctx.stroke();
        }
      }
    }

    pts.forEach(function (p) {
      ctx.fillStyle = "rgba(12,12,12," + p.o + ")";
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.s, 0, Math.PI * 2);
      ctx.fill();
    });

    var cx = cssW * 0.5;
    var cy = cssH * 0.5;
    var ringR = Math.max(5, Math.min(cssW, cssH) * 0.014);
    ctx.strokeStyle = "rgba(12,12,12,0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "rgba(12,12,12,0.85)";
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(1.2, ringR * 0.28), 0, Math.PI * 2);
    ctx.fill();
  }

  /**
   * Final spatial scan PNG (720×500 logical @ DPR) — same paint as live preview; use for archive only.
   */
  function exportSpatialScanToDataUrl(dataUrl, params, callback) {
    if (!dataUrl || typeof dataUrl !== "string" || dataUrl.indexOf("data:image") !== 0) {
      if (callback) callback(null);
      return;
    }
    var cssW = SPATIAL_SCAN_OUT_W;
    var cssH = SPATIAL_SCAN_OUT_H;
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(cssW * dpr));
    c.height = Math.max(1, Math.round(cssH * dpr));
    var ctx = c.getContext("2d");
    if (!ctx) {
      if (callback) callback(null);
      return;
    }
    var img = new Image();
    img.onload = function () {
      try {
        var pc = Math.min(9200, Math.max(3600, Math.round(cssW * cssH * SPATIAL_EXPORT_FILL_FACTOR)));
        var merged = {
          focus: params && params.focus != null ? params.focus : 72,
          mood: (params && params.mood) || "Calm",
          light: (params && params.light) || "Soft",
          pointCount: params && params.pointCount != null ? params.pointCount : pc,
        };
        paintSpatialScanFromLoadedImage(ctx, cssW, cssH, dpr, img, merged);
        var url = c.toDataURL("image/png");
        if (callback) callback(url || null);
      } catch (err) {
        if (callback) callback(null);
      }
    };
    img.onerror = function () {
      if (callback) callback(null);
    };
    img.src = dataUrl;
  }

  /**
   * Density-driven spatial scan on canvas: light grid + grayscale point cloud (image-sampled).
   * Logical size = canvas width/height attributes (stable aspect).
   */
  function drawSpatialScanFromImage(canvas, dataUrl, params) {
    if (!canvas || !dataUrl) return;
    params = params || {};
    var cssW = parseInt(canvas.getAttribute("width"), 10) || 400;
    var cssH = parseInt(canvas.getAttribute("height"), 10) || 280;
    var dpr = Math.min(2.5, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(cssW * dpr));
    canvas.height = Math.max(1, Math.round(cssH * dpr));
    canvas.style.width = cssW + "px";
    canvas.style.height = cssH + "px";

    var boot = canvas.getContext("2d");
    if (!boot) return;
    boot.setTransform(dpr, 0, 0, dpr, 0, 0);
    boot.fillStyle = "#f2f1ee";
    boot.fillRect(0, 0, cssW, cssH);

    var img = new Image();
    img.onload = function () {
      var ctx = canvas.getContext("2d");
      if (!ctx) return;
      paintSpatialScanFromLoadedImage(ctx, cssW, cssH, dpr, img, params);
    };
    img.onerror = function () {
      var ctx2 = canvas.getContext("2d");
      if (!ctx2) return;
      ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx2.fillStyle = "#eae8e4";
      ctx2.fillRect(0, 0, cssW, cssH);
    };
    img.src = dataUrl;
  }

  /** Scale saved scan image into a small canvas (legacy paths only). */
  function drawSavedScanIntoCanvas(canvas, scanDataUrl) {
    if (!canvas || !scanDataUrl) return;
    var cw = parseInt(canvas.getAttribute("width"), 10) || 60;
    var ch = parseInt(canvas.getAttribute("height"), 10) || 52;
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var im = new Image();
    im.onload = function () {
      var ctx = canvas.getContext("2d");
      if (!ctx) return;
      canvas.width = Math.max(1, Math.round(cw * dpr));
      canvas.height = Math.max(1, Math.round(ch * dpr));
      canvas.style.width = cw + "px";
      canvas.style.height = ch + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#f2f1ee";
      ctx.fillRect(0, 0, cw, ch);
      var ir = im.width / im.height;
      var cr = cw / ch;
      var dw;
      var dh;
      var dx;
      var dy;
      if (ir > cr) {
        dw = cw;
        dh = cw / ir;
        dx = 0;
        dy = (ch - dh) / 2;
      } else {
        dh = ch;
        dw = ch * ir;
        dx = (cw - dw) / 2;
        dy = 0;
      }
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(im, dx, dy, dw, dh);
    };
    im.src = scanDataUrl;
  }

  /** Archive / detail: prefer frozen scan PNG; else re-render from photo; else seed cloud. */
  function drawDeskCloudFromRecordOrSeed(canvas, rec, seedStr, seedDensity) {
    if (!canvas) return;
    if (rec && rec.scanImageDataUrl) {
      drawSavedScanIntoCanvas(canvas, rec.scanImageDataUrl);
    } else if (rec && rec.photoDataUrl) {
      var cw = parseInt(canvas.getAttribute("width"), 10) || 60;
      var ch = parseInt(canvas.getAttribute("height"), 10) || 52;
      var n = Math.max(1400, Math.min(22000, Math.round(cw * ch * 7)));
      drawSpatialScanFromImage(canvas, rec.photoDataUrl, {
        focus: rec.focus != null ? rec.focus : 72,
        mood: rec.mood || "Calm",
        light: rec.light || "Soft",
        pointCount: n,
      });
    } else {
      drawPointCloudMetatool(canvas, seedStr, seedDensity);
    }
  }

  function drawPortableCloudFromRecordOrSeed(canvas, rec, seedStr, seedDensity) {
    if (!canvas) return;
    if (rec && rec.scanImageDataUrl) {
      drawSavedScanIntoCanvas(canvas, rec.scanImageDataUrl);
    } else if (rec && rec.photoDataUrl) {
      var cw = parseInt(canvas.getAttribute("width"), 10) || 56;
      var ch = parseInt(canvas.getAttribute("height"), 10) || 56;
      var n = Math.max(1200, Math.min(20000, Math.round(cw * ch * 6.5)));
      drawSpatialScanFromImage(canvas, rec.photoDataUrl, {
        focus: rec.focus != null ? rec.focus : 72,
        mood: rec.mood || "Calm",
        light: rec.light || "Soft",
        pointCount: n,
      });
    } else {
      drawPointCloudPortable(canvas, seedStr, seedDensity);
    }
  }

  function renderHalftone(container, width, height) {
    if (!container) return;
    var ns = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(ns, "svg");
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
    svg.setAttribute("class", "halftone-bg");
    var rows = Math.floor(height / 10);
    var cols = Math.floor(width / 10);
    var cx2 = width / 2;
    var cy2 = height / 2;
    var maxD = Math.hypot(cx2, cy2);
    var r;
    var c;
    for (r = 0; r < rows; r += 1) {
      for (c = 0; c < cols; c += 1) {
        var x = c * 10 + 5;
        var y = r * 10 + 5;
        var d = Math.hypot(x - cx2, y - cy2);
        var sz = 0.4 + (d / maxD) * 1.0;
        var circle = document.createElementNS(ns, "circle");
        circle.setAttribute("cx", String(x));
        circle.setAttribute("cy", String(y));
        circle.setAttribute("r", String(sz));
        circle.setAttribute("fill", "rgba(12,12,12,0.25)");
        svg.appendChild(circle);
      }
    }
    container.innerHTML = "";
    container.appendChild(svg);
  }

  function syncRangeVisual(range, fillEl, thumbEl, pct) {
    var v = pct != null ? Number(pct) : Number(range.value);
    var p = Math.max(0, Math.min(100, v));
    if (fillEl) fillEl.style.width = p + "%";
    if (thumbEl) thumbEl.style.left = p + "%";
  }

  function getDeskRecallMoodFilter() {
    var g = document.querySelector('[data-desk-chip-group="recall-mood"]');
    var on = g && g.querySelector("button.is-on");
    return on ? on.textContent.trim() : "Any";
  }

  function getDeskRecallLightFilter() {
    var g = document.querySelector('[data-desk-chip-group="recall-light"]');
    var on = g && g.querySelector("button.is-on");
    return on ? on.textContent.trim() : "Bright";
  }

  function getDeskRecallDateCutoffMs() {
    var g = document.querySelector('[data-desk-chip-group="recall-date"]');
    var on = g && g.querySelector("button.is-on");
    var label = on ? on.textContent.trim() : "All Time";
    var now = Date.now();
    if (label.indexOf("Week") >= 0) return now - 7 * 86400000;
    if (label.indexOf("Month") >= 0) return now - 30 * 86400000;
    return 0;
  }

  function applyArchiveFilter(list, filterKey) {
    var key = filterKey || "all";
    var now = Date.now();
    var weekAgo = now - 7 * 86400000;
    if (key === "high") {
      return list.filter(function (r) {
        return Number(r.focus) >= 80;
      });
    }
    if (key === "low") {
      return list.filter(function (r) {
        return Number(r.focus) < 60;
      });
    }
    if (key === "week") {
      return list.filter(function (r) {
        return (r.createdAt || 0) >= weekAgo;
      });
    }
    if (key === "calm") {
      return list.filter(function (r) {
        return String(r.mood || "")
          .toLowerCase()
          .indexOf("calm") >= 0;
      });
    }
    if (key === "focused") {
      return list.filter(function (r) {
        return String(r.mood || "")
          .toLowerCase()
          .indexOf("focused") >= 0;
      });
    }
    return list.slice();
  }

  function syncArchiveFilterUi() {
    var key = state.archiveFilter || "all";
    document.querySelectorAll("[data-desk-archive-filter]").forEach(function (b) {
      var k = b.getAttribute("data-desk-archive-filter") || "all";
      b.classList.toggle("is-active", k === key);
    });
    document.querySelectorAll("[data-mobile-archive-filter]").forEach(function (b) {
      var k = b.getAttribute("data-mobile-archive-filter") || "all";
      b.classList.toggle("active", k === key);
    });
  }

  function computeDeskMatches() {
    var range = document.getElementById("desk-recall-focus-range");
    var target = range ? Number(range.value) : 85;
    var moodF = getDeskRecallMoodFilter();
    var lightF = getDeskRecallLightFilter();
    var cutoff = getDeskRecallDateCutoffMs();
    var all = getAllRecords().filter(function (r) {
      return (r.createdAt || 0) >= cutoff;
    });
    var scored = all.map(function (r) {
      var pen = Math.abs(r.focus - target) * 1.15;
      if (moodF !== "Any" && r.mood !== moodF) pen += 22;
      if (r.light !== lightF) pen += 14;
      var match = Math.max(0, Math.min(100, Math.round(100 - pen)));
      return { record: r, match: match, dist: Math.abs(r.focus - target) };
    });
    scored.sort(function (a, b) {
      return b.match - a.match || a.dist - b.dist;
    });
    var top = scored.slice(0, 8);
    var j;
    for (j = 0; j < top.length; j += 1) {
      top[j].best = j === 0;
    }
    return top;
  }

  function computeMobileMatches() {
    var range = document.getElementById("mobile-recall-focus-range");
    var target = range ? Number(range.value) : 85;
    var moodF = state.recallMood || "Any";
    var all = getAllRecords();
    var scored = all.map(function (r) {
      var pen = Math.abs(r.focus - target) * 1.05;
      if (moodF !== "Any" && r.mood !== moodF) pen += 18;
      var match = Math.max(0, Math.min(100, Math.round(100 - pen)));
      return { record: r, match: match, dist: Math.abs(r.focus - target) };
    });
    scored.sort(function (a, b) {
      return b.match - a.match || a.dist - b.dist;
    });
    var top = scored.slice(0, 8);
    var j;
    for (j = 0; j < top.length; j += 1) {
      top[j].best = j === 0;
    }
    return top;
  }

  function updateDeskArchiveMeta() {
    var rows = getAllRecords();
    var n = rows.length;
    var avg = n ? Math.round(rows.reduce(function (s, r) {
      return s + r.focus;
    }, 0) / n) : 0;
    var c = document.getElementById("desk-archive-count");
    var a = document.getElementById("desk-archive-avg-focus");
    if (c) c.textContent = String(n);
    if (a) a.textContent = String(avg);
  }

  function getSelectedDeskArchiveRecordIds() {
    var host = document.getElementById("desk-archive-rows");
    if (!host) return [];
    var ids = [];
    host.querySelectorAll("input[data-archive-select]:checked").forEach(function (cb) {
      var row = cb.closest(".desk-table-row");
      if (row) ids.push(row.getAttribute("data-record-id"));
    });
    return ids;
  }

  function updateDeskArchiveBulkUi() {
    var ids = getSelectedDeskArchiveRecordIds();
    var delBtn = document.getElementById("desk-archive-delete-selected");
    var hint = document.getElementById("desk-archive-selection-hint");
    var allCb = document.getElementById("desk-archive-select-all");
    var host = document.getElementById("desk-archive-rows");
    var total = host ? host.querySelectorAll(".desk-table-row").length : 0;
    var n = ids.length;
    if (delBtn) delBtn.disabled = n === 0;
    if (hint) hint.textContent = n ? n + " selected" : "";
    if (allCb && host) {
      allCb.checked = total > 0 && n === total;
      allCb.indeterminate = n > 0 && n < total;
    }
  }

  function removeDeskArchiveRecordsByIds(ids) {
    if (!ids || !ids.length) return;
    var skip = {};
    ids.forEach(function (id) {
      skip[id] = true;
    });
    var all = getAllRecords().filter(function (r) {
      return !skip[r.id];
    });
    saveRecordsToStorage(all);
    var cur = state.selectedRecord;
    if (cur && skip[cur.id]) {
      closeDeskDetail();
      state.selectedRecord = null;
      var isMobile =
        typeof window.matchMedia === "function" &&
        !window.matchMedia("(min-width: 769px)").matches;
      if (isMobile && getActiveMobileScreen() === "detail") {
        showMobileScreen("archive");
      }
    }
    var allCb = document.getElementById("desk-archive-select-all");
    if (allCb) {
      allCb.checked = false;
      allCb.indeterminate = false;
    }
    buildDeskArchiveRows();
    findDeskMatchesAndRender();
    buildMobileArchiveList();
  }

  function deleteSelectedDeskArchiveRecords() {
    var ids = getSelectedDeskArchiveRecordIds();
    if (!ids.length) return;
    if (
      !window.confirm(
        "Delete " + ids.length + " record(s) from this device? This cannot be undone."
      )
    ) {
      return;
    }
    removeDeskArchiveRecordsByIds(ids);
  }

  function buildDeskArchiveRows() {
    var host = document.getElementById("desk-archive-rows");
    if (!host) return;
    host.innerHTML = "";
    var list = getAllRecords().slice();
    list.sort(function (a, b) {
      var ta = a.createdAt || 0;
      var tb = b.createdAt || 0;
      return state.archiveSortNewestFirst ? tb - ta : ta - tb;
    });
    list = applyArchiveFilter(list, state.archiveFilter);
    list.forEach(function (r, idx) {
      var row = document.createElement("div");
      row.className = "desk-table-row";
      row.setAttribute("data-record-id", r.id);
      var photoCell = r.photoDataUrl
        ? '<div class="desk-thumb-cell"><img src="' +
          r.photoDataUrl +
          '" alt="" /></div>'
        : '<div class="desk-thumb-cell"><svg viewBox="0 0 60 52" width="60" height="52"><use href="#desk-thumb" /></svg></div>';
      var cloudCell =
        r.scanImageDataUrl != null
          ? '<div class="desk-thumb-cell desk-thumb-cell--scan"><img src="' +
            r.scanImageDataUrl +
            '" alt="" class="desk-archive-scan-img"/></div>'
          : '<div class="desk-thumb-cell"><canvas width="60" height="52" data-record-id="' +
            String(r.id).replace(/"/g, "") +
            '" data-pc-m="desk-arch-' +
            idx +
            "-" +
            r.id +
            '" data-den="28"></canvas></div>';
      row.innerHTML =
        '<div class="desk-archive-check" data-archive-no-open="1"><input type="checkbox" data-archive-select="" aria-label="Select this record" /></div>' +
        photoCell +
        cloudCell +
        '<div><div class="desk-table-mini">' +
        r.displayId +
        '</div><div class="desk-table-mini"><small>' +
        r.objects +
        " objects detected</small></div></div>" +
        '<div style="font-family:var(--mono);font-size:10px;color:var(--ink);line-height:1.5">' +
        r.date +
        '<br/><span style="color:var(--gray3)">' +
        r.time +
        "</span></div>" +
        '<div><div style="font-family:var(--mono);font-size:14px;font-weight:500;margin-bottom:3px">' +
        r.focus +
        '%</div><div class="desk-focus-bar"><i style="width:' +
        r.focus +
        '%"></i></div></div>' +
        '<div style="font-family:var(--mono);font-size:10px;color:var(--gray3)">' +
        r.mood +
        "</div>" +
        '<div style="font-family:var(--mono);font-size:10px;color:var(--gray3)">' +
        r.light +
        '</div><div><button type="button" class="desk-cell-btn">View →</button></div>';
      host.appendChild(row);
    });
    host.querySelectorAll("canvas[data-pc-m]").forEach(function (cv) {
      var rid = cv.getAttribute("data-record-id");
      var rec = rid ? findRecordByIdDesk(rid) : null;
      var den = parseInt(cv.getAttribute("data-den"), 10) || 28;
      drawDeskCloudFromRecordOrSeed(cv, rec, cv.getAttribute("data-pc-m"), den);
    });

    updateDeskArchiveMeta();
    updateDeskArchiveBulkUi();
  }

  function buildDeskRecallResults(matches) {
    var host = document.getElementById("desk-recall-results");
    if (!host) return;
    host.innerHTML = "";
    var countEl = document.getElementById("desk-recall-result-count");
    if (countEl) countEl.textContent = matches.length ? String(matches.length) + " " : "0 ";
    matches.forEach(function (row, i) {
      var r = row.record;
      var card = document.createElement("div");
      card.className = "desk-result-card" + (row.best ? " is-best" : "");
      card.setAttribute("data-record-id", r.id);
      var recallCloud =
        r.scanImageDataUrl != null
          ? '<div class="desk-thumb-cell desk-thumb-cell--scan" style="width:72px;height:60px"><img src="' +
            r.scanImageDataUrl +
            '" alt="" class="desk-archive-scan-img"/></div>'
          : '<div class="desk-thumb-cell" style="width:72px;height:60px;background:var(--paper2)"><canvas width="72" height="60" data-record-id="' +
            String(r.id).replace(/"/g, "") +
            '" data-pc-m="desk-rec-' +
            i +
            "-" +
            r.id +
            '" data-den="32"></canvas></div>';
      card.innerHTML =
        '<div class="desk-thumb-cell" style="width:72px;height:60px"><svg viewBox="0 0 60 52" width="72" height="60"><use href="#desk-thumb" /></svg></div>' +
        recallCloud +
        "<div>" +
        '<div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">' +
        '<span style="font-family:var(--mono);font-size:12px;font-weight:500">' +
        r.date +
        " — " +
        r.focus +
        "% focus</span>" +
        (row.best ? '<span class="desk-badge">Best match</span>' : "") +
        "</div>" +
        '<div style="font-family:var(--mono);font-size:9px;color:var(--gray3);letter-spacing:0.06em;margin-bottom:8px">' +
        r.mood +
        " · " +
        r.light +
        "</div>" +
        '<div style="display:flex;align-items:center;gap:8px">' +
        '<div style="flex:1;height:2px;background:var(--gray1);position:relative">' +
        '<div style="position:absolute;left:0;top:0;height:100%;width:' +
        row.match +
        '%;background:var(--ink)"></div></div>' +
        '<span style="font-family:var(--mono);font-size:9px;letter-spacing:0.08em;color:var(--ink);white-space:nowrap">' +
        row.match +
        "% match</span></div></div>" +
        '<div class="desk-result-actions"><button type="button">Recreate →</button></div>';
      host.appendChild(card);
    });
    host.querySelectorAll("canvas[data-pc-m]").forEach(function (cv) {
      var rid = cv.getAttribute("data-record-id");
      var rec = rid ? findRecordByIdDesk(rid) : null;
      var den = parseInt(cv.getAttribute("data-den"), 10) || 32;
      drawDeskCloudFromRecordOrSeed(cv, rec, cv.getAttribute("data-pc-m"), den);
    });

    host.onclick = function (e) {
      var card = e.target.closest(".desk-result-card");
      if (!card || !host.contains(card)) return;
      if (e.target.closest(".desk-result-actions")) {
        e.stopPropagation();
        window.location.hash = "new-entry";
        return;
      }
      var id = card.getAttribute("data-record-id");
      var rec = findRecordByIdDesk(id);
      if (rec) openDeskDetail(rec);
    };
  }

  function findDeskMatchesAndRender() {
    buildDeskRecallResults(computeDeskMatches());
  }

  function buildMobileArchiveList() {
    var host = document.getElementById("mobile-archive-list");
    if (!host) return;
    host.innerHTML = "";
    var records = applyArchiveFilter(
      getRecordsForDisplayMobile(),
      state.archiveFilter
    );
    var countEl = document.getElementById("mobile-archive-count");
    if (countEl) countEl.textContent = String(records.length);
    records.forEach(function (r, i) {
      var card = document.createElement("article");
      card.className = "archive-card";
      card.setAttribute("data-record-id", r.id);
      var thumbL =
        r.photoDataUrl != null
          ? '<div class="thumb-box"><img src="' +
            r.photoDataUrl +
            '" alt="" style="width:100%;height:100%;object-fit:cover;display:block" /></div>'
          : '<div class="thumb-box"><svg viewBox="0 0 174 200" width="56" height="56"><use href="#desk-photo-svg" /></svg></div>';
      var mobCloud =
        r.scanImageDataUrl != null
          ? '<div class="thumb-box thumb-box--scan"><img src="' +
            r.scanImageDataUrl +
            '" alt="" class="mobile-archive-scan-img"/></div>'
          : '<div class="thumb-box"><canvas width="56" height="56" data-record-id="' +
            String(r.id).replace(/"/g, "") +
            '" data-pc-p="m-arch-' +
            i +
            "-" +
            r.id +
            '" data-den="40"></canvas></div>';
      card.innerHTML =
        thumbL +
        mobCloud +
        '<div class="archive-meta">' +
        '<div class="date">' +
        r.date +
        "</div><div>" +
        r.time +
        '</div><div style="margin:3px 0"><span class="focus-pill">' +
        r.focus +
        '% focus</span></div><div>' +
        r.mood +
        " · " +
        r.light +
        '</div><button type="button" class="mobile-archive-delete" data-mobile-archive-delete="">Delete</button></div>';
      host.appendChild(card);
      card.addEventListener("click", function (e) {
        if (e.target.closest("[data-mobile-archive-delete]")) {
          e.preventDefault();
          e.stopPropagation();
          if (
            !window.confirm(
              "Delete this record from this device? This cannot be undone."
            )
          ) {
            return;
          }
          removeDeskArchiveRecordsByIds([r.id]);
          return;
        }
        state.selectedRecord = r;
        navigateMobileForward("detail");
      });
    });
    host.querySelectorAll("canvas[data-pc-p]").forEach(function (cv) {
      var rid = cv.getAttribute("data-record-id");
      var rec = rid ? findRecordById(rid) : null;
      var den = parseInt(cv.getAttribute("data-den"), 10) || 40;
      drawPortableCloudFromRecordOrSeed(cv, rec, cv.getAttribute("data-pc-p"), den);
    });
  }

  function buildMobileRecallList(matches) {
    var host = document.getElementById("mobile-recall-list");
    if (!host) return;
    host.innerHTML = "";
    var countEl = document.getElementById("mobile-recall-count");
    if (!matches || !matches.length) {
      if (countEl) countEl.textContent = "0";
      return;
    }
    if (countEl) countEl.textContent = String(matches.length);
    matches.forEach(function (row, i) {
      var r = row.record;
      var el = document.createElement("div");
      el.className = "recall-card";
      el.setAttribute("data-record-id", r.id);
      var mobRecCloud =
        r.scanImageDataUrl != null
          ? '<div class="thumb-box thumb-box--scan" style="width:48px;height:48px"><img src="' +
            r.scanImageDataUrl +
            '" alt="" class="mobile-archive-scan-img"/></div>'
          : '<div class="thumb-box" style="width:48px;height:48px"><canvas width="48" height="48" data-record-id="' +
            String(r.id).replace(/"/g, "") +
            '" data-pc-p="m-rec-' +
            i +
            "-" +
            r.id +
            '" data-den="30"></canvas></div>';
      el.innerHTML =
        '<div style="display:grid;grid-template-columns:48px 48px 1fr;gap:10px;align-items:start">' +
        '<div class="thumb-box" style="width:48px;height:48px"><svg viewBox="0 0 174 200" width="48" height="48"><use href="#desk-photo-svg" /></svg></div>' +
        mobRecCloud +
        "<div>" +
        '<div style="font-size:10px;font-weight:500;color:var(--ink);margin-bottom:2px">' +
        r.date +
        " — " +
        r.focus +
        "% focus</div>" +
        '<div style="font-size:8px;color:var(--gray3);letter-spacing:0.06em;margin-bottom:5px">' +
        r.mood +
        " · " +
        r.light +
        "</div>" +
        '<div style="display:flex;align-items:center;gap:6px">' +
        '<div class="recall-match-bar" style="flex:1">' +
        '<div class="recall-match-fill" style="width:' +
        row.match +
        '%"></div></div>' +
        '<span style="font-size:8px;font-weight:500;letter-spacing:0.08em;white-space:nowrap">' +
        row.match +
        "% match</span></div></div></div>";
      host.appendChild(el);
      el.addEventListener("click", function () {
        state.selectedRecord = r;
        navigateMobileForward("detail");
      });
    });
    host.querySelectorAll("canvas[data-pc-p]").forEach(function (cv) {
      var rid = cv.getAttribute("data-record-id");
      var rec = rid ? findRecordById(rid) : null;
      var den = parseInt(cv.getAttribute("data-den"), 10) || 30;
      drawPortableCloudFromRecordOrSeed(cv, rec, cv.getAttribute("data-pc-p"), den);
    });
  }

  function openDeskDetail(rec) {
    if (!rec) return;
    state.selectedRecord = rec;
    var ov = document.getElementById("desk-detail-overlay");
    if (!ov) return;
    var code = document.getElementById("desk-detail-code");
    var head = document.getElementById("desk-detail-heading");
    var notes = document.getElementById("desk-detail-notes");
    var img = document.getElementById("desk-detail-photo");
    var fb = document.getElementById("desk-detail-photo-fallback");
    if (code) code.textContent = rec.displayId || rec.recordCode;
    if (head) head.textContent = rec.date + " — " + rec.time;
    if (notes) notes.textContent = rec.notes || "";
    if (rec.photoDataUrl && img && fb) {
      img.src = rec.photoDataUrl;
      img.classList.remove("hidden");
      fb.classList.add("hidden");
    } else if (img && fb) {
      img.classList.add("hidden");
      fb.classList.remove("hidden");
    }
    var sf = document.getElementById("desk-detail-stat-focus");
    var sm = document.getElementById("desk-detail-stat-mood");
    var sl = document.getElementById("desk-detail-stat-light");
    var so = document.getElementById("desk-detail-stat-objects");
    if (sf) sf.textContent = rec.focus + "%";
    if (sm) sm.textContent = rec.mood;
    if (sl) sl.textContent = rec.light;
    if (so) so.textContent = String(rec.objects != null ? rec.objects : "—");
    ov.classList.add("is-open");
    ov.setAttribute("aria-hidden", "false");
    var ridForDraw = rec.id;
    var scanImgEl = document.getElementById("desk-detail-scan-img");
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        var r2 = findRecordByIdDesk(ridForDraw);
        var cv = document.getElementById("canvas-desk-detail-pc");
        if (!r2) return;
        if (r2.scanImageDataUrl && scanImgEl) {
          scanImgEl.src = r2.scanImageDataUrl;
          scanImgEl.classList.remove("hidden");
          if (cv) cv.classList.add("hidden");
        } else {
          if (scanImgEl) {
            scanImgEl.removeAttribute("src");
            scanImgEl.classList.add("hidden");
          }
          if (cv) {
            cv.classList.remove("hidden");
            drawDeskCloudFromRecordOrSeed(cv, r2, "desk-detail-" + r2.id, 72);
          }
        }
      });
    });
  }

  function closeDeskDetail() {
    var ov = document.getElementById("desk-detail-overlay");
    if (!ov) return;
    ov.classList.remove("is-open");
    ov.setAttribute("aria-hidden", "true");
  }

  function populateMobileDetail(rec) {
    if (!rec) return;
    var code = document.getElementById("mobile-detail-record-code");
    var dt = document.getElementById("mobile-detail-datetime");
    var badge = document.getElementById("mobile-detail-focus-badge");
    var img = document.getElementById("mobile-detail-photo");
    var fb = document.getElementById("mobile-detail-photo-fallback");
    if (code) code.textContent = rec.displayId || "PAB-2025-0" + rec.recordCode;
    if (dt) dt.textContent = rec.date + " — " + rec.time;
    if (badge) badge.textContent = rec.focus + "% focus";
    if (rec.photoDataUrl && img && fb) {
      setImgDataUrl(img, rec.photoDataUrl);
      img.classList.remove("hidden");
      fb.classList.add("hidden");
    } else if (img && fb) {
      img.classList.add("hidden");
      fb.classList.remove("hidden");
    }
    var sf = document.getElementById("mobile-detail-stat-focus");
    var sm = document.getElementById("mobile-detail-stat-mood");
    var sl = document.getElementById("mobile-detail-stat-light");
    var sd = document.getElementById("mobile-detail-stat-duration");
    var notes = document.getElementById("mobile-detail-notes");
    var fl = document.getElementById("mobile-detail-focus-pct-label");
    var bar = document.getElementById("mobile-detail-focus-bar");
    if (sf) sf.textContent = rec.focus + "%";
    if (sm) sm.textContent = rec.mood;
    if (sl) sl.textContent = rec.light;
    if (sd) sd.textContent = rec.duration || "—";
    if (notes) notes.textContent = rec.notes || "";
    if (fl) fl.textContent = rec.focus + "%";
    if (bar) bar.style.width = rec.focus + "%";
    var scanMob = document.getElementById("mobile-detail-scan-img");
    var dc = document.getElementById("canvas-mobile-detail-pc");
    if (rec.scanImageDataUrl && scanMob) {
      setImgDataUrl(scanMob, rec.scanImageDataUrl);
      scanMob.classList.remove("hidden");
      if (dc) dc.classList.add("hidden");
    } else {
      if (scanMob) {
        scanMob.removeAttribute("src");
        scanMob.classList.add("hidden");
      }
      if (dc) {
        dc.classList.remove("hidden");
        drawPortableCloudFromRecordOrSeed(dc, rec, "mobile-detail-" + rec.id, 85);
      }
    }
  }

  /** Clear src first so replacing with the same file still reloads (mobile Safari). */
  function setImgDataUrl(img, dataUrl) {
    if (!img) return;
    img.removeAttribute("src");
    if (dataUrl) {
      img.src = dataUrl;
    }
  }

  function syncMobileCaptureContinueEnabled() {
    var takeBtn = document.getElementById("mobile-btn-take-photo");
    if (!takeBtn) return;
    takeBtn.disabled = !state.uploadedImage;
  }

  function syncCaptureThumb() {
    var img = document.getElementById("mobile-capture-ref-img");
    var fb = document.getElementById("mobile-capture-ref-fallback");
    if (!img || !fb) return;
    if (state.uploadedImage) {
      setImgDataUrl(img, state.uploadedImage);
      img.classList.remove("hidden");
      fb.classList.add("hidden");
    } else {
      img.classList.add("hidden");
      fb.classList.remove("hidden");
    }
    syncMobileCaptureContinueEnabled();
  }

  function refreshMobileProcessingSpatial() {
    var pc = document.getElementById("canvas-mobile-proc-pc");
    if (!pc) return;
    if (state.uploadedImage) {
      drawPointCloudPortableFromImage(pc, state.uploadedImage, 128);
    } else {
      drawPointCloudPortable(pc, "mobile-proc", 90);
    }
    renderMobileProcAnalysis(state.uploadedImage);
  }

  function syncLogFocusUi() {
    var range = document.getElementById("mobile-log-focus-range");
    var fill = document.getElementById("mobile-log-focus-fill");
    var thumb = document.getElementById("mobile-log-focus-thumb");
    var num = document.getElementById("mobile-log-focus-num");
    if (!range) return;
    var v = Number(range.value);
    state.focusLevel = v;
    syncRangeVisual(range, fill, thumb, v);
    if (num) num.textContent = String(v);
  }

  function syncRecallFocusUi() {
    var range = document.getElementById("mobile-recall-focus-range");
    var fill = document.getElementById("mobile-recall-focus-fill");
    var thumb = document.getElementById("mobile-recall-focus-thumb");
    var num = document.getElementById("mobile-recall-focus-num");
    if (!range) return;
    var v = Number(range.value);
    syncRangeVisual(range, fill, thumb, v);
    if (num) num.textContent = String(v);
  }

  function syncDeskRecallFocusUi() {
    var range = document.getElementById("desk-recall-focus-range");
    var fill = document.getElementById("desk-recall-focus-fill");
    var thumb = document.getElementById("desk-recall-focus-thumb");
    var big = document.getElementById("desk-recall-focus-display");
    if (!range) return;
    var v = Number(range.value);
    syncRangeVisual(range, fill, thumb, v);
    if (big) big.innerHTML = v + "<small>%</small>";
  }

  function prepareDraftLogUi() {
    var now = new Date();
    var idEl = document.getElementById("mobile-log-record-id");
    var tEl = document.getElementById("mobile-log-time");
    var shortId =
      "PAB-" +
      now.getFullYear() +
      "-" +
      pad2(now.getMonth() + 1) +
      pad2(now.getDate()) +
      "-" +
      String(Math.floor(Math.random() * 900) + 100);
    if (idEl) idEl.textContent = "RECORD ID — " + shortId;
    if (tEl) {
      tEl.textContent = formatLogTime(now);
    }
    var range = document.getElementById("mobile-log-focus-range");
    if (range) {
      range.value = String(state.focusLevel);
      syncLogFocusUi();
    }
  }

  function pad2(n) {
    return n < 10 ? "0" + n : String(n);
  }

  function formatLogDate(now) {
    var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return months[now.getMonth()] + " " + now.getDate() + ", " + now.getFullYear();
  }

  function formatLogTime(now) {
    var h = now.getHours();
    var m = now.getMinutes();
    var am = h < 12;
    var h12 = h % 12 || 12;
    return h12 + ":" + pad2(m) + (am ? "am" : "pm");
  }

  function stopDeskCameraTracks() {
    if (deskCameraStream) {
      deskCameraStream.getTracks().forEach(function (t) {
        t.stop();
      });
      deskCameraStream = null;
    }
    var v = document.getElementById("desk-camera-video");
    if (v) {
      v.srcObject = null;
      v.classList.add("hidden");
    }
  }

  function refreshDeskCameraStatus() {
    var v = document.getElementById("desk-camera-video");
    var still = document.getElementById("desk-viewfinder-still");
    var el = document.getElementById("desk-camera-status");
    if (!el) return;
    var live = v && !v.classList.contains("hidden") && v.srcObject;
    var hasStill = still && !still.classList.contains("hidden") && still.getAttribute("src");
    if (live) {
      el.textContent = "LIVE PREVIEW";
    } else if (hasStill) {
      el.textContent = "PHOTO READY";
    } else {
      el.textContent = "CAMERA INACTIVE";
    }
  }

  function syncDeskViewfinderLayers() {
    var v = document.getElementById("desk-camera-video");
    var still = document.getElementById("desk-viewfinder-still");
    var ph = document.getElementById("desk-camera-placeholder");
    var live = v && !v.classList.contains("hidden") && v.srcObject;
    var hasStill = still && !still.classList.contains("hidden") && still.getAttribute("src");
    if (ph) {
      if (live || hasStill) {
        ph.classList.add("hidden");
      } else {
        ph.classList.remove("hidden");
      }
    }
    refreshDeskCameraStatus();
  }

  function stopDeskCamera() {
    stopDeskCameraTracks();
    syncDeskViewfinderLayers();
  }

  function startDeskCamera() {
    if (!window.matchMedia("(min-width: 769px)").matches) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      syncDeskViewfinderLayers();
      return;
    }
    var stillEl = document.getElementById("desk-viewfinder-still");
    if (stillEl) {
      stillEl.classList.add("hidden");
      stillEl.removeAttribute("src");
    }
    stopDeskCameraTracks();
    navigator.mediaDevices
      .getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      })
      .then(function (stream) {
        deskCameraStream = stream;
        var vid = document.getElementById("desk-camera-video");
        if (!vid) return;
        vid.srcObject = stream;
        vid.classList.remove("hidden");
        syncDeskViewfinderLayers();
      })
      .catch(function () {
        syncDeskViewfinderLayers();
      });
  }

  function showDeskViewfinderStill(dataUrl) {
    stopDeskCameraTracks();
    var still = document.getElementById("desk-viewfinder-still");
    if (still) {
      still.src = dataUrl;
      still.classList.remove("hidden");
    }
    syncDeskViewfinderLayers();
    syncDeskContinueStep1Button();
  }

  function captureDeskPhotoFromVideo() {
    var v = document.getElementById("desk-camera-video");
    if (!v || !v.srcObject) return false;
    if (v.readyState < 2) return false;
    var w = v.videoWidth;
    var h = v.videoHeight;
    if (!w || !h) return false;
    var canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    var ctx = canvas.getContext("2d");
    if (!ctx) return false;
    ctx.drawImage(v, 0, 0, w, h);
    var url = canvas.toDataURL("image/jpeg", 0.92);
    state.uploadedImage = url;
    showDeskViewfinderStill(url);
    syncDeskRefCardFromState();
    syncDeskContinueStep1Button();
    return true;
  }

  function syncDeskRefCardFromState() {
    var thumbImg = document.getElementById("desk-ref-thumb-img");
    var thumbFb = document.getElementById("desk-ref-thumb-fallback");
    var dt = document.getElementById("desk-ref-datetime");
    if (state.uploadedImage && thumbImg && thumbFb) {
      thumbImg.src = state.uploadedImage;
      thumbImg.classList.remove("hidden");
      thumbFb.classList.add("hidden");
    } else if (thumbImg && thumbFb) {
      thumbImg.classList.add("hidden");
      thumbFb.classList.remove("hidden");
    }
    if (dt) {
      var now = new Date();
      dt.textContent = formatLogDate(now) + " — " + formatLogTime(now);
    }
  }

  function onDeskTakePhotoClick() {
    if (!window.matchMedia("(min-width: 769px)").matches) return;
    var v = document.getElementById("desk-camera-video");
    if (v && v.srcObject && v.readyState >= 2 && v.videoWidth > 0) {
      if (captureDeskPhotoFromVideo()) return;
    }
    startDeskCamera();
  }

  function saveMobileRecord() {
    var btn = document.getElementById("mobile-btn-save-record");
    if (btn && btn.getAttribute("data-saving") === "1") return;
    if (btn) {
      btn.setAttribute("data-saving", "1");
      btn.disabled = true;
    }
    var notesEl = document.getElementById("mobile-log-notes");
    var idLine = document.getElementById("mobile-log-record-id");
    var now = new Date();
    var displayId = idLine ? idLine.textContent.replace(/^RECORD ID —\s*/i, "").trim() : "PAB-NEW";
    var rec = {
      id: "rec-" + now.getTime(),
      recordCode: String(Math.floor(Math.random() * 900) + 100),
      displayId: displayId,
      date: formatLogDate(now),
      time: formatLogTime(now),
      focus: state.focusLevel,
      mood: state.selectedMood,
      light: state.selectedLighting,
      objects:
        state.mobileInferredObjectCount != null && state.mobileInferredObjectCount > 0
          ? state.mobileInferredObjectCount
          : 4 + Math.floor(Math.random() * 3),
      notes: notesEl ? notesEl.value : "",
      photoDataUrl: null,
      scanImageDataUrl: null,
      duration: "1h 20m",
      createdAt: now.getTime(),
    };
    function resetSaveButton() {
      if (btn) {
        btn.removeAttribute("data-saving");
        btn.disabled = false;
      }
    }
    function commitRecordMobile(photoUrl, scanUrl) {
      try {
        rec.photoDataUrl = photoUrl;
        rec.scanImageDataUrl = scanUrl || null;
        var all = getAllRecords();
        all.unshift(rec);
        var ok = persistRecordListWithQuotaFallback(all, rec);
        if (!ok) {
          window.alert(
            "Could not save this record. Allow site storage or free space in your browser, then try again."
          );
          return;
        }
        state.uploadedImage = null;
        state.mobileInferredObjectCount = null;
        state.mobileStack = [];
        buildDeskArchiveRows();
        updateDeskArchiveMeta();
        buildMobileArchiveList();
        showMobileScreen("archive");
      } catch (err) {
        window.alert("Save failed: " + (err && err.message ? err.message : String(err)));
      } finally {
        resetSaveButton();
      }
    }
    var raw = state.uploadedImage;
    var scanParamsMob = {
      focus: state.focusLevel,
      mood: state.selectedMood,
      light: state.selectedLighting,
    };
    if (!raw) {
      commitRecordMobile(null, null);
      return;
    }
    var pend = 2;
    var photoDone = null;
    var scanDone = null;
    function tryMobBoth() {
      pend -= 1;
      if (pend !== 0) return;
      commitRecordMobile(photoDone, scanDone);
    }
    exportSpatialScanToDataUrl(raw, scanParamsMob, function (u) {
      scanDone = u;
      tryMobBoth();
    });
    if (raw.length > 450000) {
      compressImageDataUrl(raw, 1280, 0.78, function (c) {
        photoDone = c;
        tryMobBoth();
      });
    } else {
      photoDone = raw;
      tryMobBoth();
    }
  }

  function getActiveMobileScreen() {
    var el = document.querySelector(".mobile-screen.is-active");
    return el ? el.getAttribute("data-mobile-screen") : "landing";
  }

  function navigateMobileForward(next) {
    var cur = getActiveMobileScreen();
    if (cur && cur !== next) state.mobileStack.push(cur);
    showMobileScreen(next);
  }

  function navigateMobileBack() {
    var prev = state.mobileStack.pop();
    if (prev) showMobileScreen(prev);
    else showMobileScreen("landing");
  }

  function getDeskSectionFromHash() {
    var h = (window.location.hash || "#home").slice(1).toLowerCase();
    if (["home", "new-entry", "archive", "recall"].indexOf(h) >= 0) return h;
    return "home";
  }

  function syncDeskContinueStep1Button() {
    var btn = document.getElementById("desk-btn-continue-step1");
    if (!btn) return;
    var has = !!state.uploadedImage;
    btn.disabled = !has;
  }

  function updateDeskEntryStepper(n) {
    var root = document.getElementById("desk-page-new-entry");
    if (!root) return;
    var items = root.querySelectorAll(".desk-step-item");
    var lines = root.querySelectorAll(".desk-step-line");
    items.forEach(function (item, idx) {
      var step = idx + 1;
      var num = item.querySelector(".desk-step-num");
      var lbl = item.querySelector(".desk-step-label");
      if (num) {
        num.classList.toggle("is-current", step === n);
        num.classList.toggle("is-complete", step < n);
      }
      if (lbl) {
        lbl.classList.toggle("is-current", step === n);
      }
    });
    lines.forEach(function (line, idx) {
      line.classList.toggle("is-done", n > idx + 1);
    });
  }

  function refreshDeskSpatialScanPanel() {
    var canvas = document.getElementById("canvas-desk-entry-process");
    if (canvas && state.uploadedImage) {
      drawSpatialScanFromImage(canvas, state.uploadedImage, {
        focus: state.focusLevel,
        mood: getDeskLogMood(),
        light: getDeskLogLight(),
      });
    }
  }

  function syncDeskLogFocusUi() {
    var range = document.getElementById("desk-log-focus-range");
    var fill = document.getElementById("desk-log-focus-fill");
    var thumb = document.getElementById("desk-log-focus-thumb");
    var big = document.getElementById("desk-log-focus-display");
    if (!range) return;
    var v = Number(range.value);
    state.focusLevel = v;
    syncRangeVisual(range, fill, thumb, v);
    if (big) big.innerHTML = v + "<small>%</small>";
  }

  function getDeskLogMood() {
    var inp = document.getElementById("desk-log-mood-input");
    if (inp && inp.value.trim()) {
      return inp.value.trim();
    }
    var on = document.querySelector('[data-desk-chip-group="log-mood"] button.is-on');
    return on ? on.textContent.trim() : state.selectedMood;
  }

  function getDeskLogLight() {
    var on = document.querySelector('[data-desk-chip-group="log-light"] button.is-on');
    return on ? on.textContent.trim() : state.selectedLighting;
  }

  function prepareDeskLogUi() {
    var now = new Date();
    var idEl = document.getElementById("desk-log-record-id-display");
    var tEl = document.getElementById("desk-log-time-display");
    if (!state.deskDraftStarted) {
      state.deskDraftStarted = true;
      var shortId =
        "PAB-" +
        now.getFullYear() +
        "-" +
        pad2(now.getMonth() + 1) +
        pad2(now.getDate()) +
        "-" +
        String(Math.floor(Math.random() * 900) + 100);
      if (idEl) idEl.textContent = "RECORD ID — " + shortId;
      if (tEl) tEl.textContent = formatLogTime(now);
      var notes = document.getElementById("desk-log-notes");
      if (notes) notes.value = "";
    } else {
      if (tEl) tEl.textContent = formatLogTime(now);
    }
    var range = document.getElementById("desk-log-focus-range");
    if (range) {
      range.value = String(state.focusLevel);
      syncDeskLogFocusUi();
    }
    var moodInp = document.getElementById("desk-log-mood-input");
    if (moodInp) moodInp.value = state.selectedMood;
    document.querySelectorAll("[data-desk-log-mood]").forEach(function (b) {
      b.classList.toggle("is-on", b.textContent.trim() === state.selectedMood);
    });
    document.querySelectorAll("[data-desk-log-light]").forEach(function (b) {
      b.classList.toggle("is-on", b.textContent.trim() === state.selectedLighting);
    });
  }

  function syncDeskSaveSummary() {
    var mood = getDeskLogMood();
    var light = getDeskLogLight();
    var idLine = document.getElementById("desk-log-record-id-display");
    var saveId = document.getElementById("desk-save-record-id");
    var sum = document.getElementById("desk-save-summary");
    if (saveId && idLine) {
      saveId.textContent = idLine.textContent.replace(/^RECORD ID —\s*/i, "").trim();
    }
    if (sum) {
      sum.textContent = state.focusLevel + "% focus · " + mood + " · " + light;
    }
    var thumb = document.getElementById("desk-save-thumb");
    var tfb = document.getElementById("desk-save-thumb-fallback");
    if (state.uploadedImage && thumb && tfb) {
      thumb.src = state.uploadedImage;
      thumb.classList.remove("hidden");
      tfb.classList.add("hidden");
    } else if (thumb && tfb) {
      thumb.classList.add("hidden");
      tfb.classList.remove("hidden");
    }
  }

  function setDeskEntryStep(n) {
    if (n >= 2) {
      stopDeskCameraTracks();
    }
    state.deskEntryStep = n;
    document.querySelectorAll(".desk-entry-panel").forEach(function (el) {
      var s = parseInt(el.getAttribute("data-desk-entry-step"), 10);
      el.classList.toggle("is-active", s === n);
    });
    document.querySelectorAll(".desk-entry-sidebar-panel").forEach(function (el) {
      var s = parseInt(el.getAttribute("data-desk-entry-step"), 10);
      el.classList.toggle("is-active", s === n);
    });
    var deskNewPage = document.getElementById("desk-page-new-entry");
    if (deskNewPage) {
      deskNewPage.classList.toggle("desk-page-new-entry--spatial-wide", n === 5);
    }
    updateDeskEntryStepper(n);
    if (n === 1) {
      state.deskDraftStarted = false;
      if (state.uploadedImage) {
        showDeskViewfinderStill(state.uploadedImage);
        syncDeskRefCardFromState();
      } else {
        var still = document.getElementById("desk-viewfinder-still");
        if (still) {
          still.classList.add("hidden");
          still.removeAttribute("src");
        }
        syncDeskViewfinderLayers();
        if (window.matchMedia("(min-width: 769px)").matches) {
          startDeskCamera();
        }
      }
      syncDeskContinueStep1Button();
    }
    if (n === 2) {
      syncDeskLogFocusUi();
    }
    if (n === 3) {
      var moodInp3 = document.getElementById("desk-log-mood-input");
      if (moodInp3) moodInp3.value = state.selectedMood;
      document.querySelectorAll("[data-desk-log-mood]").forEach(function (b) {
        b.classList.toggle("is-on", b.textContent.trim() === state.selectedMood);
      });
    }
    if (n === 4) {
      document.querySelectorAll("[data-desk-log-light]").forEach(function (b) {
        b.classList.toggle("is-on", b.textContent.trim() === state.selectedLighting);
      });
    }
    if (n === 5) {
      refreshDeskSpatialScanPanel();
    }
    if (n === 6) {
      prepareDeskLogUi();
      syncDeskSaveSummary();
    }
  }

  function saveDeskRecord() {
    var btn = document.getElementById("desk-btn-save-entry");
    if (btn && btn.getAttribute("data-saving") === "1") return;
    if (btn) {
      btn.setAttribute("data-saving", "1");
      btn.disabled = true;
    }
    var notesEl = document.getElementById("desk-log-notes");
    var idEl = document.getElementById("desk-log-record-id-display");
    var displayId = idEl ? idEl.textContent.replace(/^RECORD ID —\s*/i, "").trim() : "PAB-NEW";
    var now = new Date();
    var rec = {
      id: "rec-" + now.getTime(),
      recordCode: String(Math.floor(Math.random() * 900) + 100),
      displayId: displayId,
      date: formatLogDate(now),
      time: formatLogTime(now),
      focus: state.focusLevel,
      mood: getDeskLogMood(),
      light: getDeskLogLight(),
      objects: 4 + Math.floor(Math.random() * 3),
      notes: notesEl ? notesEl.value : "",
      photoDataUrl: null,
      scanImageDataUrl: null,
      duration: "1h 20m",
      createdAt: now.getTime(),
    };
    function resetSaveButton() {
      if (btn) {
        btn.removeAttribute("data-saving");
        btn.disabled = false;
      }
    }
    function commitRecord(photoUrl, scanUrl) {
      try {
        rec.photoDataUrl = photoUrl;
        rec.scanImageDataUrl = scanUrl || null;
        var all = getAllRecords();
        all.unshift(rec);
        var ok = persistRecordListWithQuotaFallback(all, rec);
        if (!ok) {
          window.alert(
            "Could not save this record. Allow site storage or free space in your browser, then try again."
          );
          return;
        }
        state.uploadedImage = null;
        state.deskEntryStep = 1;
        buildDeskArchiveRows();
        updateDeskArchiveMeta();
        buildMobileArchiveList();
        window.location.hash = "archive";
      } catch (err) {
        window.alert("Save failed: " + (err && err.message ? err.message : String(err)));
      } finally {
        resetSaveButton();
      }
    }
    var raw = state.uploadedImage;
    var scanParams = {
      focus: state.focusLevel,
      mood: getDeskLogMood(),
      light: getDeskLogLight(),
    };
    if (!raw) {
      commitRecord(null, null);
      return;
    }
    var pending = 2;
    var photoOut = null;
    var scanOut = null;
    function tryCommitBoth() {
      pending -= 1;
      if (pending !== 0) return;
      commitRecord(photoOut, scanOut);
    }
    exportSpatialScanToDataUrl(raw, scanParams, function (url) {
      scanOut = url;
      tryCommitBoth();
    });
    if (raw.length > 450000) {
      compressImageDataUrl(raw, 1280, 0.78, function (comp) {
        photoOut = comp;
        tryCommitBoth();
      });
    } else {
      photoOut = raw;
      tryCommitBoth();
    }
  }

  function bindDeskLogFormChips() {
    var logPanel = document.getElementById("desk-page-new-entry");
    if (!logPanel) return;
    logPanel.addEventListener("click", function (e) {
      var m = e.target.closest("[data-desk-log-mood]");
      if (m) {
        var row = m.closest("[data-desk-chip-group]");
        if (row) {
          row.querySelectorAll("[data-desk-log-mood]").forEach(function (b) {
            b.classList.remove("is-on");
          });
        }
        m.classList.add("is-on");
        state.selectedMood = m.textContent.trim();
        var inp = document.getElementById("desk-log-mood-input");
        if (inp) inp.value = state.selectedMood;
        return;
      }
      var l = e.target.closest("[data-desk-log-light]");
      if (l) {
        var row2 = l.closest("[data-desk-chip-group]");
        if (row2) {
          row2.querySelectorAll("[data-desk-log-light]").forEach(function (b) {
            b.classList.remove("is-on");
          });
        }
        l.classList.add("is-on");
        state.selectedLighting = l.textContent.trim();
      }
    });
    var moodInp = document.getElementById("desk-log-mood-input");
    if (moodInp) {
      moodInp.addEventListener("input", function () {
        var v = moodInp.value.trim();
        if (v) state.selectedMood = v;
      });
    }
  }

  function showDeskPage(id) {
    document.querySelectorAll(".desk-page").forEach(function (el) {
      el.classList.toggle("is-active", el.getAttribute("data-desk-page") === id);
    });
    document.querySelectorAll(".desk-nav-links a").forEach(function (a) {
      a.classList.toggle("is-active", a.getAttribute("data-desk-nav") === id);
    });
    if (id === "home") {
      var c = document.getElementById("canvas-desk-home-cloud");
      if (c) drawPointCloudMetatool(c, "desk-home-hero", 200);
    }
    if (id === "new-entry") {
      setDeskEntryStep(state.deskEntryStep || 1);
    } else {
      stopDeskCamera();
    }
    if (id === "recall") {
      findDeskMatchesAndRender();
    }
  }

  function syncMobileTabBar(name) {
    var home = name === "landing";
    var neu = name === "capture" || name === "processing" || name === "log";
    var arch = name === "archive" || name === "detail";
    var rec = name === "recall";
    document.querySelectorAll("[data-mobile-tab]").forEach(function (btn) {
      var t = btn.getAttribute("data-mobile-tab");
      var on =
        (t === "home" && home) ||
        (t === "new-entry" && neu) ||
        (t === "archive" && arch) ||
        (t === "recall" && rec);
      btn.classList.toggle("is-active", !!on);
    });
  }

  function showMobileScreen(name) {
    document.querySelectorAll(".mobile-screen").forEach(function (el) {
      el.classList.toggle("is-active", el.getAttribute("data-mobile-screen") === name);
    });
    var phone = document.getElementById("phone-root");
    if (phone) phone.classList.toggle("phone--landing", name === "landing");
    syncMobileTabBar(name);

    if (name === "landing") {
      var lc = document.getElementById("canvas-mobile-landing-pc");
      if (lc) drawPointCloudPortable(lc, "mobile-landing", 180);
    }
    if (name === "processing") {
      refreshMobileProcessingSpatial();
    }
    if (name === "log") {
      prepareDraftLogUi();
    }
    if (name === "archive") {
      buildMobileArchiveList();
    }
    if (name === "detail" && state.selectedRecord) {
      populateMobileDetail(state.selectedRecord);
    }
    if (name === "capture") {
      syncCaptureThumb();
    }
  }

  function onHashChange() {
    if (window.matchMedia("(min-width: 769px)").matches) {
      showDeskPage(getDeskSectionFromHash());
    }
  }

  function bindDeskRecallChips() {
    document.querySelectorAll("[data-desk-recall-mood]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var row = btn.closest("[data-desk-chip-group]");
        if (!row) return;
        row.querySelectorAll("[data-desk-recall-mood]").forEach(function (b) {
          b.classList.remove("is-on");
        });
        btn.classList.add("is-on");
      });
    });
    document.querySelectorAll("[data-desk-recall-light]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var row = btn.closest("[data-desk-chip-group]");
        if (!row) return;
        row.querySelectorAll("[data-desk-recall-light]").forEach(function (b) {
          b.classList.remove("is-on");
        });
        btn.classList.add("is-on");
      });
    });
    document.querySelectorAll("[data-desk-recall-date]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var row = btn.closest("[data-desk-chip-group]");
        if (!row) return;
        row.querySelectorAll("[data-desk-recall-date]").forEach(function (b) {
          b.classList.remove("is-on");
        });
        btn.classList.add("is-on");
      });
    });
  }

  function init() {
    renderHalftone(document.getElementById("mobile-halftone"), 390, 844);
    loadRecordsFromStorage();

    buildDeskArchiveRows();
    findDeskMatchesAndRender();
    buildMobileArchiveList();
    buildMobileRecallList(computeMobileMatches());

    bindDeskRecallChips();

    document.querySelectorAll("[data-desk-archive-filter]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.archiveFilter = btn.getAttribute("data-desk-archive-filter") || "all";
        buildDeskArchiveRows();
        buildMobileArchiveList();
        syncArchiveFilterUi();
      });
    });
    var deskArchSort = document.getElementById("desk-archive-sort");
    if (deskArchSort) {
      deskArchSort.addEventListener("click", function () {
        state.archiveSortNewestFirst = !state.archiveSortNewestFirst;
        deskArchSort.textContent = state.archiveSortNewestFirst ? "↕ NEWEST" : "↕ OLDEST";
        buildDeskArchiveRows();
      });
    }

    document.querySelectorAll("[data-mobile-archive-filter]").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        state.archiveFilter = btn.getAttribute("data-mobile-archive-filter") || "all";
        buildDeskArchiveRows();
        buildMobileArchiveList();
        syncArchiveFilterUi();
      });
    });

    document.querySelectorAll("[data-mobile-tab]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var t = btn.getAttribute("data-mobile-tab");
        if (t === "home") {
          state.mobileStack = [];
          showMobileScreen("landing");
        } else if (t === "new-entry") {
          state.mobileStack = ["landing"];
          showMobileScreen("capture");
        } else if (t === "archive") {
          state.mobileStack = ["landing"];
          showMobileScreen("archive");
        } else if (t === "recall") {
          state.mobileStack = ["landing", "archive"];
          showMobileScreen("recall");
        }
      });
    });

    var mobArchHome = document.getElementById("mobile-archive-back-home");
    if (mobArchHome) {
      mobArchHome.addEventListener("click", function () {
        state.mobileStack = [];
        showMobileScreen("landing");
      });
    }

    var deskRange = document.getElementById("desk-recall-focus-range");
    if (deskRange) {
      deskRange.addEventListener("input", syncDeskRecallFocusUi);
      syncDeskRecallFocusUi();
    }
    var deskFind = document.getElementById("desk-btn-find-recall");
    if (deskFind) {
      deskFind.addEventListener("click", findDeskMatchesAndRender);
    }

    var deskPhotoInput = document.getElementById("desk-photo-input");
    if (deskPhotoInput) {
      deskPhotoInput.addEventListener("change", function (e) {
        var f = e.target.files && e.target.files[0];
        if (!f || !/^image\//.test(f.type)) return;
        var reader = new FileReader();
        reader.onload = function () {
          state.uploadedImage = reader.result;
          showDeskViewfinderStill(reader.result);
          syncDeskRefCardFromState();
          syncDeskContinueStep1Button();
        };
        reader.readAsDataURL(f);
        e.target.value = "";
      });
    }
    var deskTake = document.getElementById("desk-btn-take-photo");
    if (deskTake) {
      deskTake.addEventListener("click", onDeskTakePhotoClick);
    }
    var deskCont1 = document.getElementById("desk-btn-continue-step1");
    if (deskCont1) {
      deskCont1.addEventListener("click", function () {
        if (!state.uploadedImage) return;
        setDeskEntryStep(2);
      });
    }
    var deskCont2 = document.getElementById("desk-btn-continue-step2");
    if (deskCont2) {
      deskCont2.addEventListener("click", function () {
        setDeskEntryStep(3);
      });
    }
    var deskBack2 = document.getElementById("desk-btn-back-step2");
    if (deskBack2) {
      deskBack2.addEventListener("click", function () {
        setDeskEntryStep(1);
      });
    }
    var deskCont3 = document.getElementById("desk-btn-continue-step3");
    if (deskCont3) {
      deskCont3.addEventListener("click", function () {
        setDeskEntryStep(4);
      });
    }
    var deskBack3 = document.getElementById("desk-btn-back-step3");
    if (deskBack3) {
      deskBack3.addEventListener("click", function () {
        setDeskEntryStep(2);
      });
    }
    var deskCont4 = document.getElementById("desk-btn-continue-step4");
    if (deskCont4) {
      deskCont4.addEventListener("click", function () {
        setDeskEntryStep(5);
      });
    }
    var deskBack4 = document.getElementById("desk-btn-back-step4");
    if (deskBack4) {
      deskBack4.addEventListener("click", function () {
        setDeskEntryStep(3);
      });
    }
    var deskCont5 = document.getElementById("desk-btn-continue-step5");
    if (deskCont5) {
      deskCont5.addEventListener("click", function () {
        setDeskEntryStep(6);
      });
    }
    var deskBack5 = document.getElementById("desk-btn-back-step5");
    if (deskBack5) {
      deskBack5.addEventListener("click", function () {
        setDeskEntryStep(4);
      });
    }
    var deskBack6 = document.getElementById("desk-btn-back-step6");
    if (deskBack6) {
      deskBack6.addEventListener("click", function () {
        setDeskEntryStep(5);
      });
    }
    var deskSaveEntry = document.getElementById("desk-btn-save-entry");
    if (deskSaveEntry) {
      deskSaveEntry.addEventListener("click", saveDeskRecord);
    }

    var archHost = document.getElementById("desk-archive-rows");
    if (archHost) {
      archHost.addEventListener("click", function (e) {
        if (e.target.closest("[data-archive-no-open]")) return;
        var row = e.target.closest(".desk-table-row");
        if (!row || !archHost.contains(row)) return;
        var id = row.getAttribute("data-record-id");
        var rec = findRecordByIdDesk(id);
        if (rec) openDeskDetail(rec);
      });
      archHost.addEventListener("change", function (e) {
        if (e.target.matches("input[data-archive-select]")) {
          updateDeskArchiveBulkUi();
        }
      });
    }
    var archSelectAll = document.getElementById("desk-archive-select-all");
    if (archSelectAll) {
      archSelectAll.addEventListener("change", function () {
        var on = archSelectAll.checked;
        var rowsHost = document.getElementById("desk-archive-rows");
        if (!rowsHost) return;
        rowsHost.querySelectorAll("input[data-archive-select]").forEach(function (cb) {
          cb.checked = on;
        });
        updateDeskArchiveBulkUi();
      });
    }
    var archDel = document.getElementById("desk-archive-delete-selected");
    if (archDel) {
      archDel.addEventListener("click", deleteSelectedDeskArchiveRecords);
    }

    var deskLogRange = document.getElementById("desk-log-focus-range");
    if (deskLogRange) {
      deskLogRange.addEventListener("input", syncDeskLogFocusUi);
    }
    bindDeskLogFormChips();
    var deskClose = document.getElementById("desk-detail-close");
    if (deskClose) deskClose.addEventListener("click", closeDeskDetail);
    var deskRec = document.getElementById("desk-detail-recreate");
    if (deskRec) {
      deskRec.addEventListener("click", function () {
        closeDeskDetail();
        state.deskEntryStep = 1;
        window.location.hash = "new-entry";
      });
    }
    var deskOv = document.getElementById("desk-detail-overlay");
    if (deskOv) {
      deskOv.addEventListener("click", function (e) {
        if (e.target === deskOv) closeDeskDetail();
      });
    }

    var logRange = document.getElementById("mobile-log-focus-range");
    if (logRange) {
      logRange.addEventListener("input", syncLogFocusUi);
      syncLogFocusUi();
    }
    var mRecRange = document.getElementById("mobile-recall-focus-range");
    if (mRecRange) {
      mRecRange.addEventListener("input", syncRecallFocusUi);
      syncRecallFocusUi();
    }

    var photoInput = document.getElementById("mobile-photo-input");
    if (photoInput) {
      photoInput.addEventListener("change", function (e) {
        var f = e.target.files && e.target.files[0];
        if (!f || !/^image\//.test(f.type)) return;
        var takeBtn0 = document.getElementById("mobile-btn-take-photo");
        if (takeBtn0) takeBtn0.disabled = true;
        var r = new FileReader();
        r.onload = function () {
          state.uploadedImage = r.result;
          syncCaptureThumb();
          syncMobileCaptureContinueEnabled();
          if (getActiveMobileScreen() === "processing") {
            refreshMobileProcessingSpatial();
          }
        };
        r.onerror = function () {
          syncMobileCaptureContinueEnabled();
        };
        r.readAsDataURL(f);
        e.target.value = "";
      });
    }
    var procReplaceInput = document.getElementById("mobile-proc-replace-input");
    if (procReplaceInput) {
      procReplaceInput.addEventListener("change", function (e) {
        var f = e.target.files && e.target.files[0];
        if (!f || !/^image\//.test(f.type)) return;
        var r = new FileReader();
        r.onload = function () {
          state.uploadedImage = r.result;
          syncCaptureThumb();
          refreshMobileProcessingSpatial();
        };
        r.readAsDataURL(f);
        e.target.value = "";
      });
    }
    var takeBtn = document.getElementById("mobile-btn-take-photo");
    if (takeBtn) {
      takeBtn.addEventListener("click", function () {
        if (!state.uploadedImage) {
          window.alert("Upload a desk photo first (library or camera roll).");
          return;
        }
        navigateMobileForward("processing");
      });
    }
    var contLog = document.getElementById("mobile-btn-continue-log");
    if (contLog) {
      contLog.addEventListener("click", function () {
        navigateMobileForward("log");
      });
    }
    var saveBtn = document.getElementById("mobile-btn-save-record");
    if (saveBtn) saveBtn.addEventListener("click", saveMobileRecord);

    var loadEarlier = document.getElementById("mobile-btn-load-earlier");
    if (loadEarlier) {
      loadEarlier.addEventListener("click", function () {
        state.showEarlierMobile = true;
        buildMobileArchiveList();
      });
    }

    var findMob = document.getElementById("mobile-btn-find-match");
    if (findMob) {
      findMob.addEventListener("click", function () {
        buildMobileRecallList(computeMobileMatches());
      });
    }

    var mobRecreate = document.getElementById("mobile-btn-recreate");
    if (mobRecreate) {
      mobRecreate.addEventListener("click", function () {
        var rec = state.selectedRecord;
        state.mobileStack = [];
        if (rec && rec.photoDataUrl) state.uploadedImage = rec.photoDataUrl;
        else state.uploadedImage = null;
        if (rec) {
          state.focusLevel = rec.focus;
          state.selectedMood = rec.mood;
          state.selectedLighting = rec.light;
        }
        var lr = document.getElementById("mobile-log-focus-range");
        if (lr) lr.value = String(state.focusLevel);
        syncLogFocusUi();
        syncCaptureThumb();
        syncMobileCaptureContinueEnabled();
        showMobileScreen("capture");
      });
    }

    var mobDelRec = document.getElementById("mobile-btn-delete-record");
    if (mobDelRec) {
      mobDelRec.addEventListener("click", function () {
        var rec = state.selectedRecord;
        if (!rec) return;
        if (
          !window.confirm(
            "Delete this record from this device? This cannot be undone."
          )
        ) {
          return;
        }
        removeDeskArchiveRecordsByIds([rec.id]);
      });
    }

    document.querySelectorAll(".js-mobile-back").forEach(function (btn) {
      btn.addEventListener("click", function () {
        navigateMobileBack();
      });
    });

    var logSection = document.getElementById("mobile-log");
    if (logSection) {
      logSection.addEventListener("click", function (e) {
        var m = e.target.closest("[data-mood-chip]");
        if (m) {
          m.parentElement.querySelectorAll("[data-mood-chip]").forEach(function (b) {
            b.classList.remove("active");
          });
          m.classList.add("active");
          state.selectedMood = m.textContent.trim();
          var inp = document.getElementById("mobile-log-mood-input");
          if (inp) inp.value = state.selectedMood;
          return;
        }
        var l = e.target.closest("[data-light-chip]");
        if (l) {
          var crow = l.closest(".chip-row");
          if (crow) {
            crow.querySelectorAll("[data-light-chip]").forEach(function (b) {
              b.classList.remove("active");
            });
          }
          l.classList.add("active");
          state.selectedLighting = l.textContent.trim();
        }
      });
    }
    var moodInp = document.getElementById("mobile-log-mood-input");
    if (moodInp) {
      moodInp.addEventListener("input", function () {
        state.selectedMood = moodInp.value.trim() || state.selectedMood;
      });
    }

    var recallSection = document.querySelector("#mobile-recall [data-chip-group=\"recall-mood\"]");
    if (recallSection) {
      recallSection.addEventListener("click", function (e) {
        var c = e.target.closest("[data-recall-mood-chip]");
        if (!c) return;
        recallSection.querySelectorAll("[data-recall-mood-chip]").forEach(function (b) {
          b.classList.remove("active");
        });
        c.classList.add("active");
        state.recallMood = c.textContent.trim();
      });
    }

    document.querySelectorAll("[data-desk-nav]").forEach(function (el) {
      el.addEventListener("click", function (e) {
        var navId = el.getAttribute("data-desk-nav");
        if (!navId || !el.getAttribute("href") || el.getAttribute("href").indexOf("#") !== 0) return;
        e.preventDefault();
        window.location.hash = navId;
      });
    });

    document.querySelectorAll("[data-mobile-go]").forEach(function (el) {
      el.addEventListener("click", function () {
        navigateMobileForward(el.getAttribute("data-mobile-go"));
      });
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeDeskDetail();
    });

    window.addEventListener("hashchange", onHashChange);
    window.addEventListener("resize", function () {
      if (window.matchMedia("(min-width: 769px)").matches) {
        showDeskPage(getDeskSectionFromHash());
      }
    });

    if (window.matchMedia("(min-width: 769px)").matches) {
      showDeskPage(getDeskSectionFromHash());
    } else {
      showMobileScreen("landing");
      syncMobileCaptureContinueEnabled();
    }

    syncArchiveFilterUi();

    var c0 = document.getElementById("canvas-desk-home-cloud");
    if (c0 && window.matchMedia("(min-width: 769px)").matches) {
      drawPointCloudMetatool(c0, "desk-home-hero", 200);
    }

    if ("serviceWorker" in navigator) {
      window.addEventListener("load", function () {
        navigator.serviceWorker.register("./service-worker.js").catch(function () {});
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
