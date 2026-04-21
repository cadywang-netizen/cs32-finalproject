// State
let routes = [];
let liked = JSON.parse(localStorage.getItem("liked_routes") || "[]");
let skippedIds = new Set(JSON.parse(localStorage.getItem("skipped_ids") || "[]"));
let searchRadius = 1;
let maps = {};
let dailyPrefs = { distance: "any", terrain: "any" };

// Boot
async function boot() {
  const res = await fetch("/api/me");
  if (res.status === 401) {
    show("login-screen");
    return;
  }
  const athlete = await res.json();
  show("app-screen");
  const avatar = document.getElementById("avatar");
  if (athlete.profile_medium) avatar.src = athlete.profile_medium;
  else avatar.style.display = "none";
  renderSaved();
  document.getElementById("prefs-panel").classList.remove("hidden");
}

function show(id) {
  document.getElementById("login-screen").classList.add("hidden");
  document.getElementById("app-screen").classList.add("hidden");
  document.getElementById(id).classList.remove("hidden");
}

// Daily prefs
function selectPref(group, value) {
  dailyPrefs[group] = value;
  document.querySelectorAll(`#chips-${group} .pref-chip`).forEach(btn => {
    btn.classList.toggle("selected", btn.getAttribute("onclick").includes(`'${value}'`));
  });
}

function startWithPrefs() {
  document.getElementById("prefs-panel").classList.add("hidden");
  document.getElementById("tab-nav").classList.remove("hidden");
  loadRoutes();
}

// Routing
function switchTab(tab, event) {
  document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
  event.target.classList.add("active");
  document.getElementById("swipe-tab").classList.toggle("hidden", tab !== "swipe");
  document.getElementById("saved-tab").classList.toggle("hidden", tab !== "saved");
}

// Load routes from Flask
async function loadRoutes() {
  setState("loading");
  try {
    const pos = await getLocation();
    const { latitude: lat, longitude: lng } = pos.coords;

    const segRes = await fetch(`/api/segments?lat=${lat}&lng=${lng}&radius=${searchRadius}`);
    if (!segRes.ok) throw new Error("Segment fetch failed");
    const segments = await segRes.json();

    const seenIds = new Set([...liked.map(r => r.id), ...skippedIds]);
    const unseen = segments.filter(s => !seenIds.has(s.id));

    const details = await Promise.all(
      unseen.map(s =>
        fetch(`/api/segments/${s.id}`).then(r => r.ok ? r.json() : null)
      )
    );

    const valid = details.filter(d => d && !seenIds.has(d.id));
    routes = rankRoutes(valid);

    if (routes.length === 0) {
      // Expand search radius and try again (up to 3x)
      if (searchRadius < 3) {
        searchRadius++;
        loadRoutes();
      } else {
        setState("empty");
      }
      return;
    }
    setState("cards");
    renderCards();
  } catch (err) {
    console.error(err);
    setState("error", "Couldn't load routes. Make sure location access is enabled.");
  }
}

function getLocation() {
  return new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej));
}

// Ranking / preference engine
function buildProfile() {
  if (!liked.length) return null;

  const avg = key => liked.reduce((s, r) => s + (r[key] || 0), 0) / liked.length;
  const avgDist = avg("distance");
  const avgElev = avg("total_elevation_gain");

  const stdDev = key => {
    const mean = avg(key);
    const variance = liked.reduce((s, r) => s + Math.pow((r[key] || 0) - mean, 2), 0) / liked.length;
    return Math.sqrt(variance);
  };
  // floor stddev so a single-route profile still gives a reasonable acceptance band
  const distStdDev = stdDev("distance") || avgDist * 0.3;
  const elevStdDev = stdDev("total_elevation_gain") || Math.max(avgElev * 0.3, 20);

  // geographic centroid of liked routes (where the user likes to run)
  const locRoutes = liked.filter(r => r.start_latlng?.length === 2);
  const avgLat = locRoutes.length
    ? locRoutes.reduce((s, r) => s + r.start_latlng[0], 0) / locRoutes.length
    : null;
  const avgLng = locRoutes.length
    ? locRoutes.reduce((s, r) => s + r.start_latlng[1], 0) / locRoutes.length
    : null;

  return { avgDist, avgElev, distStdDev, elevStdDev, avgLat, avgLng, count: liked.length };
}

function dailyPrefScore(r) {
  let score = 0, total = 0;

  if (dailyPrefs.distance !== "any") {
    total++;
    const km = r.distance / 1000;
    if (dailyPrefs.distance === "short"  && km < 3)          score++;
    if (dailyPrefs.distance === "medium" && km >= 3 && km <= 7) score++;
    if (dailyPrefs.distance === "long"   && km > 7)           score++;
  }

  if (dailyPrefs.terrain !== "any") {
    total++;
    const elev = r.total_elevation_gain || 0;
    const routeTerrain = elev < 30 ? "flat" : elev < 100 ? "rolling" : "hilly";
    if (routeTerrain === dailyPrefs.terrain) score++;
  }

  return total === 0 ? 1 : score / total;
}

function popularityScore(r) {
  // log-scale blend: unique athletes is the strongest signal;
  // total efforts and Strava stars add secondary weight
  const raw = Math.log1p(
    (r.athlete_count || 0) +
    (r.effort_count  || 0) / 10 +
    (r.star_count    || 0) * 5
  );
  return Math.min(raw / Math.log1p(5000), 1);
}

function scoreRoute(r, profile) {
  const pop = popularityScore(r);
  const daily = dailyPrefScore(r);
  const hasDailyPref = dailyPrefs.distance !== "any" || dailyPrefs.terrain !== "any";

  if (!profile) {
    return hasDailyPref ? daily * 0.65 + pop * 0.35 : pop;
  }

  // Gaussian soft match: full score on-target, smooth decay as deviation grows
  const gaussMatch = (val, mean, sd) =>
    Math.exp(-0.5 * Math.pow((val - mean) / Math.max(sd, 1), 2));

  const distScore = gaussMatch(r.distance, profile.avgDist, profile.distStdDev);
  const elevScore = gaussMatch(r.total_elevation_gain || 0, profile.avgElev, profile.elevStdDev);

  // proximity to the user's usual running area (~8 km decay radius)
  let locationScore = 0.5; // neutral when no location data
  if (profile.avgLat != null && r.start_latlng?.length === 2) {
    const dlat = r.start_latlng[0] - profile.avgLat;
    const dlng = r.start_latlng[1] - profile.avgLng;
    const distKm = Math.sqrt(dlat * dlat + dlng * dlng) * 111;
    locationScore = Math.exp(-distKm / 8);
  }

  const preferenceScore = distScore * 0.45 + elevScore * 0.35 + locationScore * 0.20;

  // cold-start blend: popularity dominates until 5+ likes build a real profile
  const confidence = Math.min(profile.count / 5, 1);
  const profileBlend = confidence * preferenceScore + (1 - confidence) * pop;

  // daily prefs override at 60% when the user made a specific choice
  return hasDailyPref ? daily * 0.6 + profileBlend * 0.4 : profileBlend;
}

function rankRoutes(list) {
  const profile = buildProfile();
  return [...list].sort((a, b) => scoreRoute(b, profile) - scoreRoute(a, profile));
}

// State display
function setState(state, msg) {
  document.getElementById("state-loading").classList.add("hidden");
  document.getElementById("state-error").classList.add("hidden");
  document.getElementById("state-empty").classList.add("hidden");
  document.getElementById("card-stack").classList.add("hidden");
  document.getElementById("routes-remaining").classList.add("hidden");

  if (state === "loading") document.getElementById("state-loading").classList.remove("hidden");
  if (state === "error") {
    document.getElementById("error-text").textContent = msg || "Something went wrong.";
    document.getElementById("state-error").classList.remove("hidden");
  }
  if (state === "empty") document.getElementById("state-empty").classList.remove("hidden");
  if (state === "cards") {
    document.getElementById("card-stack").classList.remove("hidden");
    document.getElementById("routes-remaining").classList.remove("hidden");
  }
}

// Card rendering
function renderCards() {
  const stack = document.getElementById("card-stack");
  stack.innerHTML = "";
  maps = {};

  const visible = routes.slice(0, 3);
  visible.forEach((route, i) => {
    const card = buildCard(route, i);
    stack.appendChild(card);
  });

  // Init maps after DOM insertion
  requestAnimationFrame(() => {
    visible.forEach((route, i) => initMap(route, i));
  });

  document.getElementById("routes-remaining").textContent =
    `${routes.length} route${routes.length !== 1 ? "s" : ""} left`;
}

function buildCard(route, index) {
  const diff = difficulty(route.total_elevation_gain || 0);
  const card = document.createElement("div");
  card.className = "swipe-card";
  card.innerHTML = `
    <div class="card-map" id="map-${index}"></div>
    <div class="card-badge" style="background:${diff.color}">${diff.label}</div>
    <div class="card-info">
      <h2 class="card-name">${route.name}</h2>
      <div class="card-stats">
        <div class="stat">
          <span class="stat-label">Distance</span>
          <span class="stat-value">${formatDist(route.distance)}</span>
        </div>
        <div class="stat">
          <span class="stat-label">Elevation</span>
          <span class="stat-value">${Math.round(route.total_elevation_gain || 0)} m</span>
        </div>
        <div class="stat">
          <span class="stat-label">Runners</span>
          <span class="stat-value">${(route.athlete_count || 0).toLocaleString()}</span>
        </div>
      </div>
    </div>
    ${index === 0 ? `
    <div class="card-actions">
      <button class="btn-skip" onclick="handleSkip()">✕</button>
      <button class="btn-like" onclick="handleLike()">♥</button>
    </div>` : ""}
  `;
  return card;
}

function initMap(route, index) {
  const el = document.getElementById(`map-${index}`);
  if (!el || maps[index]) return;

  const coords = route.map?.polyline ? decodePolyline(route.map.polyline) : [];
  const center = coords.length
    ? coords[Math.floor(coords.length / 2)]
    : [37.77, -122.41];

  const map = L.map(el, {
    center, zoom: 14,
    zoomControl: false, attributionControl: false,
    dragging: false, scrollWheelZoom: false,
  });

  L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
    subdomains: "abcd",
    maxZoom: 19,
  }).addTo(map);

  if (coords.length > 0) {
    const line = L.polyline(coords, { color: "#FF5A3C", weight: 4 }).addTo(map);
    map.fitBounds(line.getBounds(), { padding: [20, 20] });
  }

  maps[index] = map;
}

// "Swipe" actions
function handleLike() {
  if (!routes.length) return;
  showFeedback("❤️");
  const route = routes[0];
  liked = [route, ...liked];
  localStorage.setItem("liked_routes", JSON.stringify(liked));
  document.getElementById("saved-count").textContent = liked.length;
  // re-rank remaining routes now that the profile has a new data point
  routes = rankRoutes(routes.slice(1));
  afterSwipe();
}

function handleSkip() {
  if (!routes.length) return;
  showFeedback("✕");
  skippedIds.add(routes[0].id);
  localStorage.setItem("skipped_ids", JSON.stringify([...skippedIds]));
  routes = routes.slice(1);
  afterSwipe();
}

function afterSwipe() {
  if (routes.length === 0) { setState("empty"); return; }
  renderCards();
  renderSaved();
}

function showFeedback(emoji) {
  const el = document.getElementById("feedback-overlay");
  el.textContent = emoji;
  el.classList.remove("hidden");
  el.style.animation = "none";
  requestAnimationFrame(() => {
    el.style.animation = "";
    el.classList.remove("hidden");
  });
  setTimeout(() => el.classList.add("hidden"), 650);
}

// Saved tab
function renderSaved() {
  document.getElementById("saved-count").textContent = liked.length;
  const list = document.getElementById("saved-list");
  const empty = document.getElementById("saved-empty");

  if (liked.length === 0) {
    empty.classList.remove("hidden");
    list.innerHTML = "";
    return;
  }

  empty.classList.add("hidden");
  list.innerHTML = liked.map(r => `
    <div class="saved-item" onclick="openRouteModal(${r.id})">
      <div class="saved-info">
        <span class="saved-name">${r.name}</span>
        <span class="saved-meta">${formatDist(r.distance)} · ${Math.round(r.total_elevation_gain || 0)} m elev</span>
      </div>
      <button class="unlike-btn" onclick="event.stopPropagation(); removeSaved(${r.id})">✕</button>
    </div>
  `).join("");
}

function removeSaved(id) {
  liked = liked.filter(r => r.id !== id);
  localStorage.setItem("liked_routes", JSON.stringify(liked));
  renderSaved();
}

// Route detail modal
let modalMap = null;

function openRouteModal(id) {
  const route = liked.find(r => r.id === id);
  if (!route) return;

  const diff = difficulty(route.total_elevation_gain || 0);
  document.getElementById("modal-name").textContent = route.name;
  document.getElementById("modal-dist").textContent = formatDist(route.distance);
  document.getElementById("modal-elev").textContent = `${Math.round(route.total_elevation_gain || 0)} m`;
  document.getElementById("modal-runners").textContent = (route.athlete_count || 0).toLocaleString();

  const badge = document.getElementById("modal-badge");
  badge.textContent = diff.label;
  badge.style.background = diff.color;

  document.getElementById("modal-remove").onclick = () => {
    removeSaved(id);
    closeRouteModal();
  };

  document.getElementById("route-modal").classList.remove("hidden");
  document.body.style.overflow = "hidden";

  requestAnimationFrame(() => initModalMap(route));
}

function initModalMap(route) {
  if (modalMap) { modalMap.remove(); modalMap = null; }

  const el = document.getElementById("modal-map");
  const coords = route.map?.polyline ? decodePolyline(route.map.polyline) : [];
  const center = coords.length ? coords[Math.floor(coords.length / 2)] : [37.77, -122.41];

  modalMap = L.map(el, {
    center, zoom: 14,
    zoomControl: true, attributionControl: false,
  });

  L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
    subdomains: "abcd", maxZoom: 19,
  }).addTo(modalMap);

  if (coords.length > 0) {
    const line = L.polyline(coords, { color: "#FF5A3C", weight: 5 }).addTo(modalMap);
    modalMap.fitBounds(line.getBounds(), { padding: [24, 24] });
  }
}

function closeRouteModal() {
  document.getElementById("route-modal").classList.add("hidden");
  document.body.style.overflow = "";
  if (modalMap) { modalMap.remove(); modalMap = null; }
}

function handleModalBackdrop(e) {
  if (e.target === document.getElementById("route-modal")) closeRouteModal();
}

// Helpers
function formatDist(m) {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

function difficulty(elev) {
  if (elev < 30) return { label: "Flat", color: "#2ecc71" };
  if (elev < 100) return { label: "Rolling", color: "#f39c12" };
  return { label: "Hilly", color: "#e74c3c" };
}

function decodePolyline(encoded) {
  let index = 0, lat = 0, lng = 0;
  const coords = [];
  while (index < encoded.length) {
    let b, shift = 0, result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0; result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    coords.push([lat / 1e5, lng / 1e5]);
  }
  return coords;
}

// hehe Go!
boot();
