import { db, auth } from "./firebase-init.js";
import {
  ref, set, update, onValue, onDisconnect, remove
} from "https://www.gstatic.com/firebasejs/12.14.0/firebase-database.js";
import {
  signInAnonymously, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js";
import { getDriverColor, haversineDistance, formatDistance } from "./helpers.js";
import { icons } from "./icons.js";
import destinations from "./destinations.js";

let currentUid = null;
let passengerWatchId = null;
let destMarker = null;
let mapClickMode = false;
let wakeLock = null;
let currentDestSet = false;
let searchTimeout = null;
const STALE_MS = 30000;

const $ = (id) => document.getElementById(id);

const countText = $("count-text");
const exitBtn = $("btn-exit");
const destSearch = $("dest-search");
const destList = $("dest-list");
const destConfirm = $("dest-confirm");
const destConfirmText = $("dest-confirm-text");
const destClear = $("dest-clear");
const drawerContent = $("drawer-content");
const btnDestMap = $("btn-dest-map");

const map = L.map("map").setView([14.5833, 120.9833], 12);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: '&copy; OpenStreetMap contributors', maxZoom: 19
}).addTo(map);

const driverMarkers = new Map();
let userMarker = null;
let needsBoundsFit = true;
const passengerMarkers = new Map();

function onOwnLocation(lat, lng) {
  if (!userMarker) {
    userMarker = L.circleMarker([lat, lng], {
      radius: 8, fillColor: "#4285F4", color: "#fff", weight: 2, fillOpacity: 0.9
    }).addTo(map);
    userMarker.bindPopup('<div style="font-family:sans-serif;"><strong>You are here</strong></div>');
    if (driverMarkers.size === 0 && passengerMarkers.size === 0) map.setView([lat, lng], 15);
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
      set(ref(db, `jeepTrack/passengers/${currentUid}/location`), { lat: latitude, lng: longitude, timestamp: Date.now() });
      set(ref(db, `jeepTrack/passengers/${currentUid}/status/lastSeen`), Date.now());
      onOwnLocation(latitude, longitude);
    },
    () => { if (currentUid) { clearTimeout(gpsRetryTimeout); gpsRetryTimeout = setTimeout(() => startGpsWatch(), 3000); } },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
  );
  requestWakeLock();
  startGpsWatchdog();
}

function stopGpsWatch() {
  stopGpsWatchdog(); clearTimeout(gpsRetryTimeout);
  if (passengerWatchId !== null) { navigator.geolocation.clearWatch(passengerWatchId); passengerWatchId = null; }
  releaseWakeLock();
}

function startGpsWatchdog() {
  stopGpsWatchdog();
  gpsWatchdogId = setInterval(() => {
    if (!currentUid) return;
    if (Date.now() - (lastGpsTimestamp || trackingStartTime) > 35000) startGpsWatch();
  }, 5000);
}
function stopGpsWatchdog() { clearInterval(gpsWatchdogId); gpsWatchdogId = null; }

async function requestWakeLock() {
  if (!("wakeLock" in navigator)) return;
  try { wakeLock = await navigator.wakeLock.request("screen"); wakeLock.addEventListener("release", () => { wakeLock = null; }); } catch {}
}
async function releaseWakeLock() {
  if (!wakeLock) return;
  try { await wakeLock.release(); wakeLock = null; } catch {}
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && currentUid && !wakeLock) requestWakeLock();
});

signInAnonymously(auth);
onAuthStateChanged(auth, (user) => {
  if (user) {
    currentUid = user.uid;
    const locRef = ref(db, `jeepTrack/passengers/${currentUid}/location`);
    onDisconnect(locRef).remove();
    const statusRef = ref(db, `jeepTrack/passengers/${currentUid}/status`);
    onDisconnect(statusRef).update({ isActive: false });
    update(ref(db, `jeepTrack/passengers/${currentUid}/status`), { isActive: true, lastSeen: Date.now() });
    window.hideSplash();
    startGpsWatch();
  } else {
    currentUid = null; stopGpsWatch();
  }
});

// ── Driver markers ──
onValue(ref(db, "jeepTrack/drivers"), (snapshot) => {
  const data = snapshot.val();
  const now = Date.now();
  const seen = new Set();
  const listItems = [];
  if (data) {
    Object.entries(data).forEach(([id, d]) => {
      const loc = d.location;
      if (!loc || !loc.timestamp) return;
      if (now - loc.timestamp > STALE_MS) { removeDriverMarker(id); return; }
      seen.add(id);
      const existing = driverMarkers.get(id);
      const info = d.info || {};
      const plate = info.plateNumber || "Unknown";
      const route = [info.routeOrigin, info.routeDestination].filter(Boolean).join(" → ");
      const speed = loc.speed ? `${(loc.speed * 3.6).toFixed(1)} km/h` : "0 km/h";
      const ago = Math.round((now - loc.timestamp) / 1000) + "s ago";
      const popup = `<div style="font-family:sans-serif;min-width:140px;"><strong>${icons.vehicle} ${plate}</strong><br>${route ? `<span>${route}</span><br>` : ""}<span style="color:#666;">Speed: ${speed}</span><br><span style="color:#666;">Updated: ${ago}</span></div>`;
      if (existing) {
        existing.setLatLng([loc.lat, loc.lng]); existing.setPopupContent(popup);
      } else {
        const m = L.marker([loc.lat, loc.lng], {
          icon: L.divIcon({ className: "", html: `<div style="width:24px;height:24px;background:${getDriverColor(id)};border:3px solid white;border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,0.3);"></div>`, iconSize: [24, 24], iconAnchor: [12, 12], popupAnchor: [0, -16] })
        });
        m.bindPopup(popup); m.addTo(map); driverMarkers.set(id, m); needsBoundsFit = true;
      }
      let dist = null;
      if (userMarker) dist = haversineDistance(userMarker.getLatLng().lat, userMarker.getLatLng().lng, loc.lat, loc.lng);
      listItems.push({ id, plate, origin: info.routeOrigin || "", destination: info.routeDestination || "", color: getDriverColor(id), lat: loc.lat, lng: loc.lng, distance: dist });
    });
  }
  driverMarkers.forEach((_, id) => { if (!seen.has(id)) removeDriverMarker(id); });
  countText.textContent = `${driverMarkers.size} active`;
  if (needsBoundsFit && driverMarkers.size > 0) {
    const group = L.featureGroup(Array.from(driverMarkers.values()));
    map.fitBounds(group.getBounds().pad(0.1)); needsBoundsFit = false;
  }
  if (userMarker) listItems.sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
  populateDrawer(listItems);
});

// ── Other passenger markers ──
onValue(ref(db, "jeepTrack/passengers"), (snapshot) => {
  const data = snapshot.val();
  if (!data) { passengerMarkers.forEach((_, id) => removePassengerMarker(id)); return; }
  const now = Date.now(); const seen = new Set();
  Object.entries(data).forEach(([id, d]) => {
    if (id === currentUid) return;
    const loc = d.location; if (!loc || !loc.timestamp) return;
    if (now - loc.timestamp > STALE_MS) return; seen.add(id);
    const existing = passengerMarkers.get(id);
    const dest = d.destination; const destName = dest?.name || "";
    const label = destName.length > 22 ? destName.slice(0, 20) + "..." : (destName || "Waiting");
    const popup = dest
      ? `<div style="font-family:sans-serif;"><strong>${icons.people} Passenger</strong><br><span style="color:#666;">Going to: ${destName}</span></div>`
      : `<div style="font-family:sans-serif;"><strong>${icons.people} Passenger</strong><br><span style="color:#666;">Waiting</span></div>`;
    const html = `<div style="display:flex;flex-direction:column;align-items:center;"><div style="width:10px;height:10px;border-radius:50%;background:#f59e0b;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.3);"></div><div style="font-size:10px;font-weight:600;color:#333;background:rgba(255,255,255,0.95);padding:1px 5px;border-radius:3px;white-space:nowrap;margin-top:1px;box-shadow:0 1px 2px rgba(0,0,0,0.15);">${label}</div></div>`;
    if (existing) {
      existing.setLatLng([loc.lat, loc.lng]); existing.setPopupContent(popup);
      existing.setIcon(L.divIcon({ className: "", html, iconSize: [20, 36], iconAnchor: [10, 36] }));
    } else {
      const m = L.marker([loc.lat, loc.lng], { icon: L.divIcon({ className: "", html, iconSize: [20, 36], iconAnchor: [10, 36] }) });
      m.bindPopup(popup); m.addTo(map); passengerMarkers.set(id, m);
    }
  });
  passengerMarkers.forEach((_, id) => { if (!seen.has(id)) removePassengerMarker(id); });
});

function removeDriverMarker(id) { const m = driverMarkers.get(id); if (m) { map.removeLayer(m); driverMarkers.delete(id); needsBoundsFit = true; } }
function removePassengerMarker(id) { const m = passengerMarkers.get(id); if (m) { map.removeLayer(m); passengerMarkers.delete(id); } }

// ── Nominatim API search with local fallback ──
function searchDestinations(query) {
  clearTimeout(searchTimeout);
  const q = query.trim();
  if (!q) { renderDestinations(destinations); return; }

  searchTimeout = setTimeout(() => {
    const apiUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=15&countrycodes=ph`;

    fetch(apiUrl)
      .then(r => r.json())
      .then(data => {
        if (data && data.length > 0) {
          const apiResults = data.map(item => ({
            id: `api_${item.osm_id || Math.random().toString(36).slice(2)}`,
            name: item.display_name.split(",")[0].trim(),
            area: item.display_name.split(",").slice(1, 3).join(",").trim() || item.type || "Philippines",
            lat: parseFloat(item.lat),
            lng: parseFloat(item.lon),
            keywords: []
          }));
          renderDestinations(apiResults);
        } else {
          fallbackSearch(q);
        }
      })
      .catch(() => fallbackSearch(q));
  }, 300);
}

function fallbackSearch(query) {
  const q = query.toLowerCase();
  const filtered = destinations.filter(d =>
    d.name.toLowerCase().includes(q) || d.area.toLowerCase().includes(q) ||
    (d.keywords || []).some(k => k.includes(q))
  );
  renderDestinations(filtered);
}

// ── Destinations list rendering ──
function groupDestinations(list) {
  const groups = {};
  list.forEach(d => {
    const area = d.area || "Other";
    if (!groups[area]) groups[area] = [];
    groups[area].push(d);
  });
  return Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0]));
}

function renderDestinations(list) {
  if (list.length === 0) {
    destList.innerHTML = `<div class="empty-state"><div class="empty-state-title">No destinations found</div><div class="empty-state-desc">Try a different search term or use the map to set your destination</div></div>`;
    return;
  }
  const grouped = groupDestinations(list);
  destList.innerHTML = grouped.map(([area, items]) =>
    `<div class="dest-section">
      <div class="dest-section-title">${area}</div>
      ${items.map(d => {
        const name = d.name.replace(/"/g, "&quot;");
        return `<div class="dest-item" data-lat="${d.lat}" data-lng="${d.lng}" data-name="${name}">
          <div class="dest-item-icon">${icons.pin}</div>
          <div class="dest-item-info">
            <div class="dest-item-name">${d.name}</div>
            <div class="dest-item-area">${d.area}</div>
          </div>
        </div>`;
      }).join("")}
    </div>`
  ).join("");
  destList.querySelectorAll(".dest-item").forEach(el => {
    el.addEventListener("click", () => {
      setDestination(parseFloat(el.dataset.lat), parseFloat(el.dataset.lng), el.dataset.name);
    });
  });
}

// ── Destination management ──
function setDestination(lat, lng, name) {
  if (!currentUid) return;
  set(ref(db, `jeepTrack/passengers/${currentUid}/destination`), { lat, lng, name, timestamp: Date.now() });
  currentDestSet = true;
  passengerBottom.classList.remove("collapsed");
  
  if (destMarker) { destMarker.setLatLng([lat, lng]); }
  else {
    const pinHtml = `<div style="position:relative;"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3" fill="#dc2626"/></svg></div>`;
    destMarker = L.marker([lat, lng], { icon: L.divIcon({ className: "", html: pinHtml, iconSize: [28, 36], iconAnchor: [14, 36] }) }).addTo(map);
    destMarker.bindPopup('<div style="font-family:sans-serif;"><strong>Your destination</strong></div>');
  }
  map.setView([lat, lng], 16);
  showDestConfirm(name);
  destSearch.value = "";
  renderDestinations(destinations);
}

function showDestConfirm(name) {
  destConfirm.style.display = "flex";
  destConfirmText.textContent = `Going to: ${name}`;
}

function clearDestination() {
  if (destMarker) { map.removeLayer(destMarker); destMarker = null; }
  if (currentUid) remove(ref(db, `jeepTrack/passengers/${currentUid}/destination`));
  destConfirm.style.display = "none";
  currentDestSet = false;
  if (mapClickMode) toggleMapClick();
}

// ── Map click mode ──
function toggleMapClick() {
  mapClickMode = !mapClickMode;
  btnDestMap.classList.toggle("active");
  btnDestMap.innerHTML = mapClickMode
    ? `${icons.pin} Tap map`
    : `${icons.pin} Map`;
  map.getContainer().style.cursor = mapClickMode ? "crosshair" : "";
}

map.on("click", (e) => {
  if (mapClickMode) {
    const { lat, lng } = e.latlng;
    fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`)
      .then(r => r.json())
      .then(data => { setDestination(lat, lng, data.display_name?.split(",")[0] || `${lat.toFixed(4)}, ${lng.toFixed(4)}`); })
      .catch(() => { setDestination(lat, lng, `${lat.toFixed(4)}, ${lng.toFixed(4)}`); });
    toggleMapClick();
  }
});

// ── Tab switching ──
document.querySelectorAll(".sheet-tab").forEach(tab => {
  tab.addEventListener("click", (e) => {
    e.stopPropagation();
    document.querySelectorAll(".sheet-tab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".sheet-pane").forEach(p => p.classList.remove("active"));
    tab.classList.add("active");
    const pane = $("pane-" + tab.dataset.tab);
    if (pane) pane.classList.add("active");
    if (tab.dataset.tab === "nearby") setTimeout(() => map.invalidateSize(), 100);
  });
});

// ── Collapsible bottom sheet ──
const passengerBottom = $("passenger-bottom");
const sheetDrag = $("sheet-drag");

function toggleSheet(e) {
  e.stopPropagation();
  passengerBottom.classList.toggle("collapsed");
  setTimeout(() => map.invalidateSize(), 350);
}

sheetDrag.addEventListener("click", toggleSheet);

document.querySelector(".sheet-tabs")?.addEventListener("click", (e) => {
  if (e.target.closest(".sheet-tab")) return;
  passengerBottom.classList.remove("collapsed");
  setTimeout(() => map.invalidateSize(), 350);
});

// ── Nearby drawer ──
function populateDrawer(items) {
  if (items.length === 0) {
    drawerContent.innerHTML = '<div class="drawer-empty">No active jeepneys nearby</div>';
    return;
  }
  drawerContent.innerHTML = items.map(item => {
    const route = [item.origin, item.destination].filter(Boolean).join(" → ");
    const dist = item.distance !== null ? formatDistance(item.distance) : "";
    return `<div class="drawer-item" data-lat="${item.lat}" data-lng="${item.lng}">
      <div class="dot" style="background:${item.color}"></div>
      <div class="info">
        <div class="plate">${icons.vehicle} ${item.plate}</div>
        ${route ? `<div class="route">${route}</div>` : ""}
      </div>
      ${dist ? `<div class="distance">${dist}</div>` : ""}
    </div>`;
  }).join("");
  drawerContent.querySelectorAll(".drawer-item").forEach(el => {
    el.addEventListener("click", () => {
      map.setView([parseFloat(el.dataset.lat), parseFloat(el.dataset.lng)], 16);
    });
  });
}

// ── Event listeners ──
btnDestMap.addEventListener("click", toggleMapClick);

destSearch.addEventListener("input", () => {
  passengerBottom.classList.remove("collapsed");
  searchDestinations(destSearch.value);
});
destSearch.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && destSearch.value.trim()) {
    searchDestinations(destSearch.value);
    const first = destList.querySelector(".dest-item");
    if (first) first.click();
  }
});

destClear.addEventListener("click", clearDestination);

exitBtn.addEventListener("click", () => {
  if (currentUid) update(ref(db, `jeepTrack/passengers/${currentUid}/status`), { isActive: false });
  stopGpsWatch();
  localStorage.removeItem("jeeptrack_role");
  window.location.href = "index.html";
});

// ── Init ──
renderDestinations(destinations);
