/**
 * Portable Attention Box — mobile-first PWA prototype
 * Features:
 * - Camera capture via getUserMedia + file upload fallback
 * - Photo preview + simulated point-cloud generation
 * - Local archive in localStorage
 * - Recall mode by nearest focus level
 * - PWA install + service worker registration
 */

(function () {
  "use strict";

  const STORAGE_KEY = "portableAttentionBox_records_v1";
  /** v2: default is CSS-driven (auto). v1 could leave users stuck in "mobile" on desktop. */
  const VIEW_MODE_KEY = "portableAttentionBox_viewMode_v2";
  const DESKTOP_MIN_WIDTH = 900;
  let currentPhotoDataUrl = "";
  let currentCloudSeed = "";
  let cameraStream = null;
  let deferredInstallPrompt = null;

  function loadRecords() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      console.warn("Could not read local records:", error);
      return [];
    }
  }

  function saveRecords(records) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  }

  function hashString(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i += 1) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mulberry32(seed) {
    return function () {
      let t = (seed += 0x6d2b79f5) >>> 0;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function drawPointCloud(canvas, seed) {
    const w = canvas.width;
    const h = canvas.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rand = mulberry32(hashString(String(seed)) || 1);
    ctx.fillStyle = "#050508";
    ctx.fillRect(0, 0, w, h);

    const clusterCount = 4 + Math.floor(rand() * 5);
    const clusters = [];
    for (let i = 0; i < clusterCount; i += 1) {
      clusters.push({
        x: rand() * w,
        y: rand() * h,
        r: Math.min(w, h) * (0.08 + rand() * 0.18),
      });
    }

    const pointCount = Math.floor(w * h * 0.035 + rand() * (w * h * 0.02));
    for (let i = 0; i < pointCount; i += 1) {
      let x;
      let y;
      if (rand() < 0.82) {
        const c = clusters[Math.floor(rand() * clusterCount)];
        const ang = rand() * Math.PI * 2;
        const dist = Math.sqrt(rand()) * c.r * (0.6 + rand() * 0.8);
        x = c.x + Math.cos(ang) * dist;
        y = c.y + Math.sin(ang) * dist;
      } else {
        x = rand() * w;
        y = rand() * h;
      }

      x = Math.max(0, Math.min(w - 1, x));
      y = Math.max(0, Math.min(h - 1, y));
      const coolTone = rand() > 0.62;
      ctx.fillStyle = coolTone ? "rgba(195, 225, 255, 0.9)" : "rgba(250, 250, 252, 0.82)";
      const size = rand() < 0.88 ? 1 : 2;
      ctx.fillRect(Math.floor(x), Math.floor(y), size, size);
    }

    ctx.strokeStyle = "rgba(255,255,255,0.04)";
    ctx.lineWidth = 1;
    const step = 32;
    for (let gx = 0; gx <= w; gx += step) {
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, h);
      ctx.stroke();
    }
    for (let gy = 0; gy <= h; gy += step) {
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.lineTo(w, gy);
      ctx.stroke();
    }
  }

  function getPageFromHash() {
    const page = (window.location.hash || "#home").slice(1).toLowerCase();
    if (["home", "new", "archive", "recall"].includes(page)) return page;
    return "home";
  }

  function showPage(id) {
    document.querySelectorAll(".page").forEach(function (el) {
      el.classList.toggle("page--active", el.id === "page-" + id);
    });
    document.querySelectorAll(".site-nav a[data-nav]").forEach(function (a) {
      a.classList.toggle("is-active", a.getAttribute("data-nav") === id);
    });

    if (id === "archive") renderArchive();
  }

  function navigateTo(id) {
    window.location.hash = id;
  }

  function defaultDateString() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  function setSaveEnabled(enabled) {
    const button = document.getElementById("btn-save");
    if (button) button.disabled = !enabled;
  }

  function setCameraStatus(text) {
    const status = document.getElementById("camera-status");
    if (status) status.textContent = text;
  }

  function showGeneratedPreview() {
    const image = document.getElementById("preview-photo");
    image.src = currentPhotoDataUrl;

    currentCloudSeed = "cloud-" + Date.now() + "-" + Math.random().toString(36).slice(2);
    drawPointCloud(document.getElementById("cloud-canvas-main"), currentCloudSeed);

    document.getElementById("record-preview").classList.remove("hidden");
    setSaveEnabled(true);
  }

  async function startCamera() {
    const supportsCamera = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    if (!supportsCamera) {
      setCameraStatus("Camera API is not supported on this device/browser.");
      alert("Camera is not supported in this browser. Please upload a file instead.");
      return;
    }

    const video = document.getElementById("camera-video");
    const captureButton = document.getElementById("btn-capture-photo");
    const stopButton = document.getElementById("btn-stop-camera");

    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      video.srcObject = cameraStream;
      video.classList.remove("hidden");
      captureButton.disabled = false;
      stopButton.disabled = false;
      setCameraStatus("Camera is on. Frame your desk, then tap Capture.");
    } catch (error) {
      console.error(error);
      setCameraStatus("Could not access camera. Please allow permissions or use upload.");
      alert("Camera access failed. Please allow permission or upload a file instead.");
    }
  }

  function stopCamera() {
    const video = document.getElementById("camera-video");
    const captureButton = document.getElementById("btn-capture-photo");
    const stopButton = document.getElementById("btn-stop-camera");

    if (cameraStream) {
      cameraStream.getTracks().forEach(function (track) {
        track.stop();
      });
      cameraStream = null;
    }

    if (video) {
      video.srcObject = null;
      video.classList.add("hidden");
    }

    if (captureButton) captureButton.disabled = true;
    if (stopButton) stopButton.disabled = true;
    setCameraStatus("Camera is off. You can also upload a photo file below.");
  }

  function captureFromCamera() {
    const video = document.getElementById("camera-video");
    if (!cameraStream || !video || video.videoWidth === 0) {
      alert("Start the camera and wait for it to load before capturing.");
      return;
    }

    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = video.videoWidth;
    tempCanvas.height = video.videoHeight;
    const ctx = tempCanvas.getContext("2d");
    ctx.drawImage(video, 0, 0, tempCanvas.width, tempCanvas.height);

    currentPhotoDataUrl = tempCanvas.toDataURL("image/jpeg", 0.92);
    showGeneratedPreview();
  }

  function handlePhotoUpload(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (loadEvent) {
      currentPhotoDataUrl = loadEvent.target.result;
      showGeneratedPreview();
    };
    reader.readAsDataURL(file);
  }

  function onGenerateClick() {
    if (!currentPhotoDataUrl) {
      alert("Capture a photo or upload a file first.");
      return;
    }
    showGeneratedPreview();
  }

  function onSave() {
    const date = document.getElementById("entry-date").value;
    const focus = parseInt(document.getElementById("entry-focus").value, 10);
    const mood = document.getElementById("entry-mood").value.trim();
    const lighting = document.getElementById("entry-lighting").value.trim();
    const notes = document.getElementById("entry-notes").value.trim();

    if (!date || Number.isNaN(focus)) {
      alert("Date and focus level are required.");
      return;
    }
    if (!currentPhotoDataUrl || !currentCloudSeed) {
      alert("Generate a spatial record before saving.");
      return;
    }

    const record = {
      id: "rec-" + Date.now(),
      date: date,
      focus: Math.max(0, Math.min(100, focus)),
      mood: mood,
      lighting: lighting,
      notes: notes,
      photoDataUrl: currentPhotoDataUrl,
      cloudSeed: currentCloudSeed,
    };

    const all = loadRecords();
    all.unshift(record);
    saveRecords(all);

    alert("Record saved to archive.");
    document.getElementById("entry-form").reset();
    document.getElementById("entry-date").value = defaultDateString();
    document.getElementById("record-preview").classList.add("hidden");
    currentPhotoDataUrl = "";
    currentCloudSeed = "";
    setSaveEnabled(false);
    stopCamera();
    navigateTo("archive");
  }

  function renderArchive() {
    const records = loadRecords();
    const grid = document.getElementById("archive-grid");
    const empty = document.getElementById("archive-empty");
    grid.innerHTML = "";

    if (records.length === 0) {
      empty.classList.remove("hidden");
      return;
    }
    empty.classList.add("hidden");

    records.forEach(function (rec) {
      const card = document.createElement("article");
      card.className = "record-card";
      card.innerHTML =
        '<div class="record-card__meta"><dl>' +
        "<dt>Date</dt><dd>" +
        escapeHtml(rec.date) +
        "</dd>" +
        "<dt>Focus</dt><dd>" +
        escapeHtml(String(rec.focus)) +
        "%</dd>" +
        "<dt>Mood</dt><dd>" +
        escapeHtml(rec.mood || "—") +
        "</dd>" +
        "<dt>Lighting</dt><dd>" +
        escapeHtml(rec.lighting || "—") +
        "</dd></dl></div>" +
        '<div class="record-card__split">' +
        '<div class="record-card__thumb"><img alt="" /></div>' +
        '<div class="record-card__thumb"><canvas width="160" height="160" aria-hidden="true"></canvas></div>' +
        "</div>" +
        '<p class="record-card__notes"></p>';

      const img = card.querySelector("img");
      img.src = rec.photoDataUrl;
      img.alt = "Desk photo from " + rec.date;
      card.querySelector(".record-card__notes").textContent = rec.notes || "—";
      drawPointCloud(card.querySelector("canvas"), rec.cloudSeed);
      grid.appendChild(card);
    });
  }

  function runRecall() {
    const target = parseInt(document.getElementById("recall-target").value, 10);
    const empty = document.getElementById("recall-empty");
    const grid = document.getElementById("recall-grid");

    if (Number.isNaN(target) || target < 0 || target > 100) {
      alert("Enter a desired attention level between 0 and 100.");
      return;
    }

    const records = loadRecords();
    if (records.length === 0) {
      empty.textContent = "No records in the archive yet.";
      empty.classList.remove("hidden");
      grid.classList.add("hidden");
      grid.innerHTML = "";
      return;
    }

    const sorted = records
      .map(function (rec) {
        return { rec: rec, distance: Math.abs(rec.focus - target) };
      })
      .sort(function (a, b) {
        return a.distance - b.distance || b.rec.date.localeCompare(a.rec.date);
      });

    empty.classList.add("hidden");
    grid.classList.remove("hidden");
    grid.innerHTML = "";

    sorted.forEach(function (item) {
      const rec = item.rec;
      const card = document.createElement("article");
      card.className = "record-card";
      card.innerHTML =
        '<div class="record-card__meta"><dl>' +
        "<dt>Date</dt><dd>" +
        escapeHtml(rec.date) +
        "</dd>" +
        "<dt>Focus</dt><dd>" +
        escapeHtml(String(rec.focus)) +
        "%</dd>" +
        "<dt>Mood</dt><dd>" +
        escapeHtml(rec.mood || "—") +
        "</dd>" +
        "<dt>Lighting</dt><dd>" +
        escapeHtml(rec.lighting || "—") +
        '</dd></dl><span class="badge-distance">Δ from target: ' +
        item.distance +
        "%</span></div>" +
        '<div class="record-card__split">' +
        '<div class="record-card__thumb"><img alt="" /></div>' +
        '<div class="record-card__thumb"><canvas width="160" height="160" aria-hidden="true"></canvas></div>' +
        "</div>" +
        '<p class="record-card__notes"></p>';

      const img = card.querySelector("img");
      img.src = rec.photoDataUrl;
      img.alt = "Desk photo from " + rec.date;
      card.querySelector(".record-card__notes").textContent = rec.notes || "—";
      drawPointCloud(card.querySelector("canvas"), rec.cloudSeed);
      grid.appendChild(card);
    });
  }

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  function setupPwaInstall() {
    const installButton = document.getElementById("btn-install");
    if (!installButton) return;

    window.addEventListener("beforeinstallprompt", function (event) {
      event.preventDefault();
      deferredInstallPrompt = event;
      installButton.classList.remove("hidden");
    });

    installButton.addEventListener("click", async function () {
      if (!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      installButton.classList.add("hidden");
    });
  }

  function setupViewToggle() {
    const toggleButton = document.getElementById("btn-view-toggle");
    if (!toggleButton) return;

    function isWideViewport() {
      return window.matchMedia("(min-width: " + DESKTOP_MIN_WIDTH + "px)").matches;
    }

    function readStoredMode() {
      const raw = localStorage.getItem(VIEW_MODE_KEY);
      if (raw === "mobile" || raw === "desktop") return raw;
      return "auto";
    }

    function applyStoredMode() {
      const mode = readStoredMode();
      document.body.classList.remove("force-mobile", "force-desktop");
      if (mode === "mobile") {
        document.body.classList.add("force-mobile");
      } else if (mode === "desktop") {
        document.body.classList.add("force-desktop");
      }
      syncToggleLabel();
    }

    function syncToggleLabel() {
      const mode = readStoredMode();
      const wide = isWideViewport();
      if (mode === "auto") {
        toggleButton.textContent = wide ? "Mobile View" : "Desktop View";
      } else if (mode === "mobile") {
        toggleButton.textContent = "Desktop View";
      } else {
        toggleButton.textContent = "Mobile View";
      }
    }

    applyStoredMode();

    toggleButton.addEventListener("click", function () {
      const mode = readStoredMode();
      const wide = isWideViewport();

      if (wide) {
        if (mode === "mobile") {
          localStorage.setItem(VIEW_MODE_KEY, "auto");
        } else {
          localStorage.setItem(VIEW_MODE_KEY, "mobile");
        }
      } else {
        if (mode === "desktop") {
          localStorage.setItem(VIEW_MODE_KEY, "auto");
        } else {
          localStorage.setItem(VIEW_MODE_KEY, "desktop");
        }
      }
      applyStoredMode();
    });

    window.addEventListener("resize", function () {
      syncToggleLabel();
    });
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("./service-worker.js").catch(function (error) {
        console.warn("Service worker registration failed:", error);
      });
    });
  }

  function init() {
    const dateInput = document.getElementById("entry-date");
    if (!dateInput.value) dateInput.value = defaultDateString();

    document.getElementById("btn-start-camera").addEventListener("click", startCamera);
    document.getElementById("btn-capture-photo").addEventListener("click", captureFromCamera);
    document.getElementById("btn-stop-camera").addEventListener("click", stopCamera);
    document.getElementById("photo-input").addEventListener("change", handlePhotoUpload);
    document.getElementById("btn-generate").addEventListener("click", onGenerateClick);
    document.getElementById("btn-save").addEventListener("click", onSave);
    document.getElementById("btn-recall").addEventListener("click", runRecall);

    document.querySelectorAll("a[data-nav]").forEach(function (a) {
      a.addEventListener("click", function (event) {
        event.preventDefault();
        navigateTo(a.getAttribute("data-nav"));
      });
    });

    window.addEventListener("hashchange", function () {
      showPage(getPageFromHash());
    });

    window.addEventListener("beforeunload", stopCamera);

    setupPwaInstall();
    setupViewToggle();
    registerServiceWorker();
    showPage(getPageFromHash());
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
