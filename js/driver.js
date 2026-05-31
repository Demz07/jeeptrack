import { db, auth } from "./firebase-init.js";
import {
  ref,
  set,
  update,
  onValue,
  onDisconnect
} from "https://www.gstatic.com/firebasejs/12.14.0/firebase-database.js";
import {
  signInAnonymously,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js";
import { formatSpeed, formatAccuracy } from "./helpers.js";

let watchId = null;
let isTracking = false;
let currentUid = null;

const $ = (id) => document.getElementById(id);

const statusDot = $("status-dot");
const statusText = $("status-text");
const statusSub = $("status-sub");
const plateDisplay = $("plate-number");
const latDisplay = $("gps-lat");
const lngDisplay = $("gps-lng");
const speedDisplay = $("gps-speed");
const accuracyDisplay = $("gps-accuracy");
const toggleBtn = $("btn-toggle");
const exitBtn = $("btn-exit");
const plateEditBtn = $("btn-plate-edit");
const plateModal = $("modal-plate");
const inputPlate = $("input-plate");
const plateSaveBtn = $("btn-plate-save");
const inputOrigin = $("input-origin");
const inputDest = $("input-dest");
const saveRouteBtn = $("btn-save-route");
const routeStatus = $("route-status");
const passengerBadge = $("passenger-badge");
const overlay = $("passenger-overlay");
const overlayClose = $("btn-overlay-close");
const overlayCount = $("overlay-count");

let plateNumber = localStorage.getItem("jeeptrack_plate") || "";
let routeOrigin = localStorage.getItem("jeeptrack_origin") || "";
let routeDestination = localStorage.getItem("jeeptrack_dest") || "";

let overlayMap = null;
let overlayMarkers = new Map();
let overlayOpen = false;
let lastPassengerSnapshot = {};

let wakeLock = null;

async function requestWakeLock() {
  if (!("wakeLock" in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLock.addEventListener("release", () => {
      wakeLock = null;
    });
  } catch {}
}

async function releaseWakeLock() {
  if (!wakeLock) return;
  try {
    await wakeLock.release();
    wakeLock = null;
  } catch {}
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && isTracking && !wakeLock) {
    requestWakeLock();
  }
});

let lastGpsTimestamp = 0;
let trackingStartTime = 0;
let gpsWatchdogId = null;
let gpsRetryTimeout = null;

let driverLiveMap = null;
let driverMapMarker = null;
let driverLiveMapInitialized = false;
let lastKnownLat = 14.5833;
let lastKnownLng = 120.9833;

function setStatus(style, text, sub) {
  statusDot.className = "status-dot" + (style ? ` ${style}` : "");
  statusText.textContent = text;
  if (sub !== undefined) {
    statusSub.textContent = sub;
  }
}

function updateToggleButton() {
  const active = isTracking && currentUid;
  toggleBtn.textContent = active ? "\u26D4 Stop Tracking" : "\u25B6 Start Tracking";
  toggleBtn.className = "btn-primary " + (active ? "stop" : "start");
  toggleBtn.disabled = !currentUid;
}

function showPlateModal() {
  plateModal.style.display = "flex";
  inputPlate.value = plateNumber;
  inputPlate.focus();
}

function hidePlateModal() {
  plateModal.style.display = "none";
}

function onGpsSuccess(pos) {
  if (!isTracking || !currentUid) return;

  lastGpsTimestamp = Date.now();
  if (statusText.textContent !== "Tracking active") {
    setStatus("active", "Tracking active", "Sending location every 3\u20135 seconds");
  }

  const { latitude, longitude, speed, accuracy, heading } = pos.coords;
  lastKnownLat = latitude;
  lastKnownLng = longitude;

  latDisplay.textContent = latitude.toFixed(6);
  lngDisplay.textContent = longitude.toFixed(6);
  speedDisplay.innerHTML = formatSpeed(speed);
  accuracyDisplay.textContent = formatAccuracy(accuracy);

  set(ref(db, `jeepTrack/drivers/${currentUid}/location`), {
    lat: latitude,
    lng: longitude,
    speed: speed || 0,
    heading: heading || 0,
    accuracy: accuracy || 0,
    timestamp: Date.now()
  });

  set(ref(db, `jeepTrack/drivers/${currentUid}/status/lastSeen`), Date.now());

  if (!driverLiveMapInitialized) {
    const mapCard = document.getElementById("live-map-card");
    if (mapCard) {
      driverLiveMap = L.map("driver-live-map", { zoomControl: false }).setView([latitude, longitude], 16);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19
      }).addTo(driverLiveMap);
      driverMapMarker = L.circleMarker([latitude, longitude], {
        radius: 10,
        fillColor: "#0d9488",
        color: "#fff",
        weight: 3,
        fillOpacity: 0.9
      }).addTo(driverLiveMap);
      setTimeout(() => driverLiveMap.invalidateSize(), 200);
      driverLiveMapInitialized = true;
    }
  } else if (driverMapMarker) {
    driverMapMarker.setLatLng([latitude, longitude]);
  }
}

function onGpsError(err) {
  console.error("GPS error:", err);
  setStatus("", "GPS error", "Auto-retrying in 3s...");
  clearTimeout(gpsRetryTimeout);
  gpsRetryTimeout = setTimeout(() => {
    if (isTracking) restartGpsWatch();
  }, 3000);
}

function startTracking() {
  if (!navigator.geolocation) {
    alert("GPS is not available on this device.");
    return;
  }

  if (!plateNumber) {
    showPlateModal();
    return;
  }

  isTracking = true;
  lastGpsTimestamp = 0;
  trackingStartTime = Date.now();
  document.getElementById("live-map-card").style.display = "";
  setStatus("active", "Waiting for GPS...", "Ensure location is enabled");
  updateToggleButton();

  if (currentUid) {
    set(ref(db, `jeepTrack/drivers/${currentUid}/status/isActive`), true);
  }

  watchId = navigator.geolocation.watchPosition(
    onGpsSuccess,
    onGpsError,
    { enableHighAccuracy: true, maximumAge: 3000, timeout: 5000 }
  );

  requestWakeLock();
  startGpsWatchdog();
}

function stopTracking() {
  isTracking = false;
  stopGpsWatchdog();
  clearTimeout(gpsRetryTimeout);
  document.getElementById("live-map-card").style.display = "none";

  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }

  if (currentUid) {
    update(ref(db, `jeepTrack/drivers/${currentUid}/status`), {
      isActive: false,
      lastSeen: Date.now()
    });
  }

  releaseWakeLock();
  setStatus("", "Inactive", "Tap Start to begin tracking");
  updateToggleButton();
}

function toggleTracking() {
  if (isTracking) {
    stopTracking();
  } else {
    startTracking();
  }
}

function saveRoute() {
  const origin = inputOrigin.value.trim();
  const dest = inputDest.value.trim();
  routeOrigin = origin;
  routeDestination = dest;
  localStorage.setItem("jeeptrack_origin", origin);
  localStorage.setItem("jeeptrack_dest", dest);

  if (currentUid) {
    set(ref(db, `jeepTrack/drivers/${currentUid}/info/routeOrigin`), origin);
    set(ref(db, `jeepTrack/drivers/${currentUid}/info/routeDestination`), dest);
  }

  routeStatus.textContent = origin || dest ? `Route saved: ${origin} \u2192 ${dest}` : "Route cleared";
  setTimeout(() => { routeStatus.textContent = ""; }, 3000);
}

function openOverlay() {
  overlayOpen = true;
  overlay.classList.add("open");

  setTimeout(() => {
    if (!overlayMap) {
      overlayMap = L.map("passenger-map", { zoomControl: false }).setView([lastKnownLat, lastKnownLng], 14);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19
      }).addTo(overlayMap);
    } else {
      overlayMap.setView([lastKnownLat, lastKnownLng], 15);
    }
    overlayMap.invalidateSize();
    updateOverlayMarkers(lastPassengerSnapshot);
  }, 100);
}

function closeOverlay() {
  overlayOpen = false;
  overlay.classList.remove("open");
}

function updateOverlayMarkers(passengers) {
  if (!overlayMap) return;

  const seen = new Set();
  const now = Date.now();

  Object.entries(passengers).forEach(([id, d]) => {
    const loc = d.location;
    if (!loc || !loc.timestamp) return;
    if (now - loc.timestamp > 30000) return;
    seen.add(id);

    const existing = overlayMarkers.get(id);
    const dest = d.destination;
    const destName = dest?.name || "";
    const label = destName.length > 22 ? destName.slice(0, 20) + "..." : (destName || "Waiting");
    const popup = dest
      ? `<div style="font-family:sans-serif;"><strong>\uD83E\uDDD1 Passenger</strong><br><span style="color:#666;">Going to: ${destName}</span></div>`
      : `<div style="font-family:sans-serif;"><strong>\uD83E\uDDD1 Passenger</strong><br><span style="color:#666;">Waiting</span></div>`;

    const html = `<div style="display:flex;flex-direction:column;align-items:center;">
      <div style="width:12px;height:12px;border-radius:50%;background:#f59e0b;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.3);"></div>
      <div style="font-size:11px;font-weight:600;color:#333;background:rgba(255,255,255,0.95);padding:2px 6px;border-radius:4px;white-space:nowrap;margin-top:2px;box-shadow:0 1px 2px rgba(0,0,0,0.15);">${label}</div>
    </div>`;

    if (existing) {
      existing.setLatLng([loc.lat, loc.lng]);
      existing.setPopupContent(popup);
      existing.setIcon(L.divIcon({
        className: "", html, iconSize: [24, 40], iconAnchor: [12, 40]
      }));
    } else {
      const m = L.marker([loc.lat, loc.lng], {
        icon: L.divIcon({
          className: "", html, iconSize: [24, 40], iconAnchor: [12, 40]
        })
      });
      m.bindPopup(popup);
      m.addTo(overlayMap);
      overlayMarkers.set(id, m);
    }
  });

  overlayMarkers.forEach((m, id) => {
    if (!seen.has(id)) {
      overlayMap.removeLayer(m);
      overlayMarkers.delete(id);
    }
  });

  overlayCount.textContent = `(${overlayMarkers.size})`;
}

signInAnonymously(auth);

onAuthStateChanged(auth, (user) => {
  if (user) {
    currentUid = user.uid;

    const locationRef = ref(db, `jeepTrack/drivers/${currentUid}/location`);
    onDisconnect(locationRef).remove();

    const statusRef = ref(db, `jeepTrack/drivers/${currentUid}/status`);
    onDisconnect(statusRef).update({ isActive: false });

    set(ref(db, `jeepTrack/drivers/${currentUid}/info`), {
      plateNumber,
      routeOrigin,
      routeDestination,
      role: "driver",
      createdAt: Date.now()
    });

    statusSub.textContent = `ID: ${currentUid.slice(0, 8)}\u2026`;

    if (plateNumber) {
      setStatus("", "Ready", "Tap Start to begin tracking");
    } else {
      setStatus("", "Set your plate number", "Required before tracking");
    }

    updateToggleButton();
  } else {
    currentUid = null;
    stopTracking();
    setStatus("initializing", "Connecting\u2026", "");
    updateToggleButton();
  }
});

onValue(ref(db, "jeepTrack/passengers"), (snapshot) => {
  const data = snapshot.val() || {};
  const now = Date.now();

  lastPassengerSnapshot = {};

  Object.entries(data).forEach(([id, d]) => {
    const loc = d.location;
    if (!loc || !loc.timestamp) return;
    if (now - loc.timestamp > 30000) return;
    lastPassengerSnapshot[id] = d;
  });

  passengerBadge.textContent = `\uD83E\uDDD1 ${Object.keys(lastPassengerSnapshot).length} nearby`;

  updateOverlayMarkers(lastPassengerSnapshot);
});

plateSaveBtn.addEventListener("click", () => {
  const val = inputPlate.value.trim().toUpperCase();
  if (!val) {
    inputPlate.style.borderColor = "var(--error)";
    return;
  }
  inputPlate.style.borderColor = "";
  plateNumber = val;
  localStorage.setItem("jeeptrack_plate", plateNumber);
  plateDisplay.textContent = plateNumber;
  hidePlateModal();

  if (currentUid) {
    set(ref(db, `jeepTrack/drivers/${currentUid}/info/plateNumber`), plateNumber);
  }

  if (!isTracking && currentUid) {
    startTracking();
  }
});

inputPlate.addEventListener("keydown", (e) => {
  if (e.key === "Enter") plateSaveBtn.click();
});

plateEditBtn.addEventListener("click", showPlateModal);

toggleBtn.addEventListener("click", toggleTracking);

saveRouteBtn.addEventListener("click", saveRoute);

inputOrigin.addEventListener("keydown", (e) => {
  if (e.key === "Enter") inputDest.focus();
});
inputDest.addEventListener("keydown", (e) => {
  if (e.key === "Enter") saveRoute();
});

passengerBadge.addEventListener("click", () => {
  if (overlayOpen) closeOverlay();
  else openOverlay();
});

overlayClose.addEventListener("click", closeOverlay);

exitBtn.addEventListener("click", () => {
  stopTracking();
  localStorage.removeItem("jeeptrack_role");
  window.location.href = "index.html";
});

function startGpsWatchdog() {
  stopGpsWatchdog();
  gpsWatchdogId = setInterval(() => {
    if (!isTracking) return;
    const elapsed = Date.now() - (lastGpsTimestamp || trackingStartTime);
    if (elapsed > 35000) {
      if (lastGpsTimestamp === 0) {
        setStatus("active", "Waiting for GPS...", "Check location settings");
      } else {
        setStatus("active", "Reconnecting...", "GPS signal lost");
      }
      restartGpsWatch();
    }
  }, 5000);
}

function stopGpsWatchdog() {
  clearInterval(gpsWatchdogId);
  gpsWatchdogId = null;
}

function restartGpsWatch() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  watchId = navigator.geolocation.watchPosition(
    onGpsSuccess,
    onGpsError,
    { enableHighAccuracy: true, maximumAge: 3000, timeout: 5000 }
  );
}

setStatus("initializing", "Initializing\u2026", "Connecting to server");
updateToggleButton();

if (plateNumber) {
  plateDisplay.textContent = plateNumber;
}
if (routeOrigin) inputOrigin.value = routeOrigin;
if (routeDestination) inputDest.value = routeDestination;
