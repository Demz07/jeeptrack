import { db, auth } from "./firebase-init.js";
import {
  ref,
  set,
  update,
  onValue,
  onDisconnect,
  remove
} from "https://www.gstatic.com/firebasejs/12.14.0/firebase-database.js";
import {
  signInAnonymously,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js";
import {
  getDriverColor,
  haversineDistance,
  formatDistance,
  formatSpeed
} from "./helpers.js";

let currentUid = null;
let passengerWatchId = null;
let destMarker = null;
let mapClickMode = false;
let wakeLock = null;
const STALE_MS = 30000;

async function requestWakeLock() {
  if (!("wakeLock" in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLock.addEventListener("release", () => { wakeLock = null; });
  } catch {}
}

async function releaseWakeLock() {
  if (!wakeLock) return;
  try { await wakeLock.release(); wakeLock = null; } catch {}
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && currentUid && !wakeLock) {
    requestWakeLock();
  }
});

const $ = (id) => document.getElementById(id);

const activeCountEl = $("active-count");
const exitBtn = $("btn-exit");
const destInput = $("dest-input");
const destSetBtn = $("btn-dest-set");
const destClearBtn = $("btn-dest-clear");
const drawerHandle = $("drawer-handle");
const drawerBar = $("drawer-bar");
const drawerLabel = $("drawer-label");
const drawerContent = $("drawer-content");

const map = L.map("map").setView([14.5833, 120.9833], 12);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: '&copy; OpenStreetMap contributors',
  maxZoom: 19
}).addTo(map);

const driverMarkers = new Map();
let userMarker = null;
let needsBoundsFit = true;

const passengerMarkers = new Map();

function onOwnLocation(lat, lng) {
  if (!userMarker) {
    userMarker = L.circleMarker([lat, lng], {
      radius: 8,
      fillColor: "#4285F4",
      color: "#fff",
      weight: 2,
      fillOpacity: 0.9
    }).addTo(map);
    userMarker.bindPopup('<div style="font-family:sans-serif;"><strong>You are here</strong></div>');
    if (driverMarkers.size === 0 && passengerMarkers.size === 0) {
      map.setView([lat, lng], 15);
    }
  } else {
    userMarker.setLatLng([lat, lng]);
  }
}

let lastGpsTimestamp = 0;
let trackingStartTime = 0;
let gpsWatchdogId = null;
let gpsRetryTimeout = null;

function startGpsWatch() {
  if (!navigator.geolocation || !currentUid) return;
  stopGpsWatch();

  lastGpsTimestamp = 0;
  trackingStartTime = Date.now();

  passengerWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      if (!currentUid) return;
      lastGpsTimestamp = Date.now();
      const { latitude, longitude } = pos.coords;

      set(ref(db, `jeepTrack/passengers/${currentUid}/location`), {
        lat: latitude,
        lng: longitude,
        timestamp: Date.now()
      });
      set(ref(db, `jeepTrack/passengers/${currentUid}/status/lastSeen`), Date.now());

      onOwnLocation(latitude, longitude);
    },
    () => {
      if (currentUid) {
        clearTimeout(gpsRetryTimeout);
        gpsRetryTimeout = setTimeout(() => startGpsWatch(), 3000);
      }
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
  );

  requestWakeLock();
  startGpsWatchdog();
}

function stopGpsWatch() {
  stopGpsWatchdog();
  clearTimeout(gpsRetryTimeout);
  if (passengerWatchId !== null) {
    navigator.geolocation.clearWatch(passengerWatchId);
    passengerWatchId = null;
  }
  releaseWakeLock();
}

function startGpsWatchdog() {
  stopGpsWatchdog();
  gpsWatchdogId = setInterval(() => {
    if (!currentUid) return;
    const elapsed = Date.now() - (lastGpsTimestamp || trackingStartTime);
    if (elapsed > 35000) {
      startGpsWatch();
    }
  }, 5000);
}

function stopGpsWatchdog() {
  clearInterval(gpsWatchdogId);
  gpsWatchdogId = null;
}

signInAnonymously(auth);

onAuthStateChanged(auth, (user) => {
  if (user) {
    currentUid = user.uid;

    const locRef = ref(db, `jeepTrack/passengers/${currentUid}/location`);
    onDisconnect(locRef).remove();

    const statusRef = ref(db, `jeepTrack/passengers/${currentUid}/status`);
    onDisconnect(statusRef).update({ isActive: false });

    update(ref(db, `jeepTrack/passengers/${currentUid}/status`), {
      isActive: true,
      lastSeen: Date.now()
    });

    startGpsWatch();
  } else {
    currentUid = null;
    stopGpsWatch();
  }
});

const driversRef = ref(db, "jeepTrack/drivers");
onValue(driversRef, (snapshot) => {
  const data = snapshot.val();
  const now = Date.now();
  const seen = new Set();
  const listItems = [];

  if (data) {
    Object.entries(data).forEach(([id, d]) => {
      const loc = d.location;
      if (!loc || !loc.timestamp) return;
      if (now - loc.timestamp > STALE_MS) {
        removeDriverMarker(id);
        return;
      }
      seen.add(id);

      const existing = driverMarkers.get(id);
      const info = d.info || {};
      const plate = info.plateNumber || "Unknown";
      const route = [info.routeOrigin, info.routeDestination].filter(Boolean).join(" \u2192 ");
      const speed = loc.speed ? `${(loc.speed * 3.6).toFixed(1)} km/h` : "0 km/h";
      const ago = Math.round((now - loc.timestamp) / 1000) + "s ago";
      const popup = `<div style="font-family:sans-serif;min-width:140px;">
        <strong style="font-size:1.1rem;">\uD83D\uDE8C ${plate}</strong><br>
        ${route ? `<span>${route}</span><br>` : ""}
        <span style="color:#666;">Speed: ${speed}</span><br>
        <span style="color:#666;">Updated: ${ago}</span>
      </div>`;

      if (existing) {
        existing.setLatLng([loc.lat, loc.lng]);
        existing.setPopupContent(popup);
      } else {
        const m = L.marker([loc.lat, loc.lng], {
          icon: L.divIcon({
            className: "",
            html: `<div style="width:24px;height:24px;background:${getDriverColor(id)};border:3px solid white;border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,0.3);"></div>`,
            iconSize: [24, 24],
            iconAnchor: [12, 12],
            popupAnchor: [0, -16]
          })
        });
        m.bindPopup(popup);
        m.addTo(map);
        driverMarkers.set(id, m);
        needsBoundsFit = true;
      }

      let dist = null;
      if (userMarker) {
        dist = haversineDistance(
          userMarker.getLatLng().lat, userMarker.getLatLng().lng,
          loc.lat, loc.lng
        );
      }
      listItems.push({
        id,
        plate,
        origin: info.routeOrigin || "",
        destination: info.routeDestination || "",
        color: getDriverColor(id),
        lat: loc.lat,
        lng: loc.lng,
        distance: dist
      });
    });
  }

  driverMarkers.forEach((_, id) => {
    if (!seen.has(id)) removeDriverMarker(id);
  });

  activeCountEl.textContent = `${driverMarkers.size} active`;

  if (needsBoundsFit && driverMarkers.size > 0) {
    const group = L.featureGroup(Array.from(driverMarkers.values()));
    map.fitBounds(group.getBounds().pad(0.1));
    needsBoundsFit = false;
  }

  if (userMarker) {
    listItems.sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
  }
  populateDrawer(listItems);
});

onValue(ref(db, "jeepTrack/passengers"), (snapshot) => {
  const data = snapshot.val();
  if (!data) {
    passengerMarkers.forEach((_, id) => removePassengerMarker(id));
    return;
  }
  const now = Date.now();
  const seen = new Set();

  Object.entries(data).forEach(([id, d]) => {
    if (id === currentUid) return;
    const loc = d.location;
    if (!loc || !loc.timestamp) return;
    if (now - loc.timestamp > STALE_MS) return;
    seen.add(id);

    const existing = passengerMarkers.get(id);
    const dest = d.destination;
    const destName = dest?.name || "";
    const label = destName.length > 22 ? destName.slice(0, 20) + "..." : (destName || "Waiting");
    const popup = dest
      ? `<div style="font-family:sans-serif;"><strong>\uD83E\uDDD1 Passenger</strong><br><span style="color:#666;">Going to: ${destName}</span></div>`
      : `<div style="font-family:sans-serif;"><strong>\uD83E\uDDD1 Passenger</strong><br><span style="color:#666;">Waiting</span></div>`;

    const html = `<div style="display:flex;flex-direction:column;align-items:center;">
      <div style="width:10px;height:10px;border-radius:50%;background:#f59e0b;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.3);"></div>
      <div style="font-size:10px;font-weight:600;color:#333;background:rgba(255,255,255,0.95);padding:1px 5px;border-radius:3px;white-space:nowrap;margin-top:1px;box-shadow:0 1px 2px rgba(0,0,0,0.15);">${label}</div>
    </div>`;

    if (existing) {
      existing.setLatLng([loc.lat, loc.lng]);
      existing.setPopupContent(popup);
      existing.setIcon(L.divIcon({
        className: "", html, iconSize: [20, 36], iconAnchor: [10, 36]
      }));
    } else {
      const m = L.marker([loc.lat, loc.lng], {
        icon: L.divIcon({
          className: "", html, iconSize: [20, 36], iconAnchor: [10, 36]
        })
      });
      m.bindPopup(popup);
      m.addTo(map);
      passengerMarkers.set(id, m);
    }
  });

  passengerMarkers.forEach((_, id) => {
    if (!seen.has(id)) removePassengerMarker(id);
  });
});

function removeDriverMarker(id) {
  const m = driverMarkers.get(id);
  if (m) { map.removeLayer(m); driverMarkers.delete(id); needsBoundsFit = true; }
}

function removePassengerMarker(id) {
  const m = passengerMarkers.get(id);
  if (m) { map.removeLayer(m); passengerMarkers.delete(id); }
}

let drawerOpen = false;

function populateDrawer(items) {
  if (items.length === 0) {
    drawerContent.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-secondary);font-size:0.875rem;">No active jeepneys nearby</div>';
    drawerLabel.textContent = "0 jeepneys";
    return;
  }

  drawerLabel.textContent = `${items.length} jeepne${items.length === 1 ? "y" : "ys"}`;

  drawerContent.innerHTML = items.map((item) => {
    const route = [item.origin, item.destination].filter(Boolean).join(" \u2192 ");
    const dist = item.distance !== null ? formatDistance(item.distance) : "";
    return `<div class="drawer-item" data-lat="${item.lat}" data-lng="${item.lng}">
      <div class="dot" style="background:${item.color}"></div>
      <div class="info">
        <div class="plate">${item.plate}</div>
        ${route ? `<div class="route">${route}</div>` : ""}
      </div>
      ${dist ? `<div class="distance">${dist}</div>` : ""}
    </div>`;
  }).join("");

  drawerContent.querySelectorAll(".drawer-item").forEach((el) => {
    el.addEventListener("click", () => {
      const lat = parseFloat(el.dataset.lat);
      const lng = parseFloat(el.dataset.lng);
      map.setView([lat, lng], 16);
      closeDrawer();
    });
  });
}

function toggleDrawer() {
  const isOpen = !drawerContent.classList.contains("hidden");
  if (isOpen) {
    closeDrawer();
  } else {
    openDrawer();
  }
}

function openDrawer() {
  drawerContent.classList.remove("hidden");
  drawerBar.classList.add("open");
}

function closeDrawer() {
  drawerContent.classList.add("hidden");
  drawerBar.classList.remove("open");
}

drawerHandle.addEventListener("click", toggleDrawer);

function setDestinationFromMap(lat, lng) {
  if (destMarker) {
    destMarker.setLatLng([lat, lng]);
  } else {
    destMarker = L.marker([lat, lng], {
      icon: L.divIcon({
        className: "",
        html: `<div style="font-size:32px;text-align:center;line-height:1;">\uD83D\uDCCD</div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 32]
      })
    }).addTo(map);
    destMarker.bindPopup('<div style="font-family:sans-serif;"><strong>Your destination</strong></div>');
  }

  fetch(
    `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`
  )
    .then((r) => r.json())
    .then((data) => {
      const name =
        data.display_name?.split(",")[0] || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
      destInput.value = name;
      saveDestination(lat, lng, name);
    })
    .catch(() => {
      destInput.value = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
      saveDestination(lat, lng, destInput.value);
    });
}

function saveDestination(lat, lng, name) {
  if (!currentUid) return;
  set(ref(db, `jeepTrack/passengers/${currentUid}/destination`), {
    lat,
    lng,
    name,
    timestamp: Date.now()
  });
  destClearBtn.style.display = "inline";
}

function clearDestination() {
  if (destMarker) {
    map.removeLayer(destMarker);
    destMarker = null;
  }
  destInput.value = "";
  destClearBtn.style.display = "none";
  if (currentUid) {
    remove(ref(db, `jeepTrack/passengers/${currentUid}/destination`));
  }
}

map.on("click", (e) => {
  if (mapClickMode) {
    setDestinationFromMap(e.latlng.lat, e.latlng.lng);
    mapClickMode = false;
    destSetBtn.classList.remove("active");
    destSetBtn.textContent = "\uD83D\uDCCD Set on Map";
    map.getContainer().style.cursor = "";
  }
});

destSetBtn.addEventListener("click", () => {
  mapClickMode = !mapClickMode;
  destSetBtn.classList.toggle("active");
  destSetBtn.textContent = mapClickMode ? "\uD83D\uDCCD Tap map" : "\uD83D\uDCCD Set on Map";
  map.getContainer().style.cursor = mapClickMode ? "crosshair" : "";
});

destClearBtn.addEventListener("click", clearDestination);

destInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && destInput.value.trim()) {
    if (!currentUid) return;
    const name = destInput.value.trim();
    set(ref(db, `jeepTrack/passengers/${currentUid}/destination`), {
      name,
      timestamp: Date.now()
    });
    destClearBtn.style.display = "inline";
  }
});

exitBtn.addEventListener("click", () => {
  if (currentUid) {
    update(ref(db, `jeepTrack/passengers/${currentUid}/status`), { isActive: false });
  }
  stopGpsWatch();
  localStorage.removeItem("jeeptrack_role");
  window.location.href = "index.html";
});
