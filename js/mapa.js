/* js/mapa.js
   ------------------------------------------------------------
   RESPONSABILIDAD: núcleo del MAPA (Leaflet) y utilidades comunes.
   - Crea el mapa y las capas: capaSerenos, capaAlertas, capaGeofences.
   - Dibuja geocercas (polígonos) desde Firestore (dbL).
   - Muestra leyendas: 
       * "Serenos por Sector" (chips) -> se actualiza vía updateSectorCountsFrom(...)
       * Lista de geocercas (toggle con botón GEOCERCAS)
   - Provee iconos/“dibujitos” para marcadores.
   - Expone helpers de fechas/coords/parseos para otros módulos.
   - NO conoce datasets de personal/alertas (módulo neutral).
   ------------------------------------------------------------ */

import { dbL, collection, onSnapshot } from "./Firebase.js";

/* ==========================
   MAPA base + capas
   ========================== */

// Crea el mapa centrado en Lima (puedes ajustar si lo necesitas)
export const map = L.map("map", {
  zoomControl: true,
  preferCanvas: true,
}).setView([-12.0464, -77.0428], 12);

// Capa base OSM
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap',
}).addTo(map);

// Capas lógicas (personas / alertas / geocercas)
export const capaSerenos   = L.layerGroup().addTo(map);
export const capaAlertas   = L.layerGroup().addTo(map);
export const capaGeofences = L.layerGroup().addTo(map);

/* ==========================
   Leyenda "Serenos por Sector"
   (chips sobre el contenedor del mapa)
   ========================== */

const legendWrap = document.createElement("div");
legendWrap.className = "sector-legend";
legendWrap.innerHTML = `
  <div class="card">
    <div class="title">SERENOS POR SECTOR</div>
    <div id="chipsSectors" class="chips"></div>
  </div>`;
map.getContainer().appendChild(legendWrap);
// Evita que el drag/zoom del mapa capture interacciones de la leyenda
L.DomEvent.disableClickPropagation(legendWrap);

const chipsBox = legendWrap.querySelector("#chipsSectors");

/* ==========================
   Helpers generales (exportados)
   ========================== */

// Coerce a número (acepta "10,5" → 10.5)
const toNum = v => (typeof v === "number" ? v : parseFloat(String(v).replace(",", ".")));

// Normaliza string (tildes → sin tildes, trim, lowercase) – si lo necesitas en otros módulos
export const norm = (s) => (s ?? "").toString()
  .normalize("NFD").replace(/\p{Diacritic}/gu,"")
  .trim().toLowerCase();

// "2025-09-11" → Date (00:00:00)
export const parseFecha = (v) => {
  const [y,m,d] = v.split("-").map(n => +n);
  return new Date(y, m-1, d, 0, 0, 0, 0);
};

// Intervalos de turno (T1/T2/T3/Todos) sobre una fecha base
export const intervaloTurno = (base, turno) => {
  const start = new Date(base), end = new Date(base);
  if (turno === "t1")      { start.setHours(7,0,0,0);  end.setHours(15,0,0,0); }
  else if (turno === "t2") { start.setHours(15,0,0,0); end.setHours(23,0,0,0); }
  else if (turno === "t3") { start.setHours(23,0,0,0); end.setDate(end.getDate()+1); end.setHours(7,0,0,0); }
  else                     { start.setHours(0,0,0,0);  end.setDate(end.getDate()+1); end.setHours(0,0,0,0); }
  return { start, end };
};

// Defaults para “hoy” y turno actual
export const todayTurnDefaults = () => {
  const now  = new Date();
  const base = new Date(now);
  let turno = "t1";
  if (now.getHours() < 6)       { base.setDate(base.getDate()-1); turno = "t3"; }
  else if (now.getHours() < 14) { turno = "t1"; }
  else if (now.getHours() < 22) { turno = "t2"; }
  else                          { turno = "t3"; }
  const y = base.getFullYear();
  const m = String(base.getMonth()+1).padStart(2,"0");
  const d = String(base.getDate()).padStart(2,"0");
  return { fecha: `${y}-${m}-${d}`, turno };
};

// Extrae coords robustamente (de varias variantes de campo)
export const getCoords = (o) => {
  const lat = toNum(o.lat ?? o.latitude ?? o.latitud);
  const lng = toNum(o.lng ?? o.long ?? o.lon ?? o.longitude ?? o.longitud);
  if (Number.isNaN(lat) || Number.isNaN(lng) || lat<-90 || lat>90 || lng<-180 || lng>180) return null;
  return [lat, lng];
};

// Timestamps de "asistencias" (SERENOS)
export const getWhenS = (d) => {
  const t = d.timestamp;
  if (t?.toDate)                return t.toDate();
  if (typeof t?.seconds==="number") return new Date(t.seconds*1000);
  if (typeof t === "string") {
    const dt = new Date(t); if (!isNaN(dt)) return dt;
  }
  if (d.fecha) { // dd/mm/yyyy o dd-mm-yyyy
    const [dd,mm,yy] = (d.fecha+"").split(/[\/\-]/).map(n=>+n);
    return new Date(yy, mm-1, dd);
  }
  return new Date(0);
};

// Timestamps de "alertas" (createdAt en distintos formatos)
export const getWhenA = (d) => {
  const ct = d?.createdAt;
  if (ct?.toDate)                return ct.toDate();
  if (typeof ct?.seconds==="number") return new Date(ct.seconds*1000);
  if (typeof ct === "number")    return new Date(ct);
  if (typeof ct === "string") {
    const x = new Date(ct); if (!isNaN(x)) return x;
  }
  return new Date(0);
};

/* ==========================
   Iconos / “Dibujitos”
   ========================== */

// 👤 Sereno (divIcon simple, puedes cambiar estilos en CSS)
export const iconSereno = () => L.divIcon({
  html: `<div style="font-size:22px; line-height:22px;">👤</div>`,
  className: "",
  iconSize: [22,22],
  iconAnchor: [11,20],
  popupAnchor: [0,-18],
});

// Pin de alerta (con pulso opcional para “activas”)
export const iconAlerta = (pulse = false) => L.divIcon({
  html: `<div class="pin red ${pulse ? "pulse" : ""}">
          <div class="pin-dot">!</div>
          <div class="pin-stick"></div>
        </div>`,
  className: "pin-wrap",
  iconSize: [22,32],
  iconAnchor: [11,30],
  popupAnchor: [0,-26],
});

/* ==========================
   Geocercas (polígonos) + leyenda
   ========================== */

// Estructuras internas para geofences
const geofenceById   = new Map(); // id -> { id, nombre, color, path, _color }
const geofenceLayers = new Map(); // id -> Leaflet polygon

// Control: botón "GEOCERCAS" en la esquina superior derecha
const GeoButton = L.Control.extend({
  options: { position: "topright" },
  onAdd: function() {
    const wrap = L.DomUtil.create("div", "geo-ctrl-wrap");
    wrap.innerHTML = `<button id="btnGeo" class="btn small outline">GEOCERCAS</button>`;
    L.DomEvent.disableClickPropagation(wrap);
    return wrap;
  }
});
map.addControl(new GeoButton());

// Panel/leyenda de geocercas (toggle)
let legendDiv = null;
let legendVisible = false;

const legendCtrl = L.control({ position: "topright" });
legendCtrl.onAdd = () => {
  const d = L.DomUtil.create("div", "geo-ctrl-wrap geo-legend");
  d.id = "geoLegend";
  d.innerHTML = `<h4></h4><div id="geoItems"></div>`;
  L.DomEvent.disableClickPropagation(d);
  legendDiv = d;
  d.style.display = "none"; // inicialmente oculto
  return d;
};
legendCtrl.addTo(map);

// Toggle del panel de geocercas
function toggleLegend(show) {
  legendVisible = (show !== undefined) ? show : !legendVisible;
  if (legendDiv) legendDiv.style.display = legendVisible ? "block" : "none";
}

// Listener global al botón (evita acoplar al DOM fuera del control)
document.addEventListener("click", (e) => {
  if (e.target && e.target.id === "btnGeo") toggleLegend();
});

// Helpers para dibujar polígonos
const parsePath = (arr) => (Array.isArray(arr) ? arr : [])
  .map(p => [toNum(p.lat), toNum(p.lng)])
  .filter(([a,b]) => !Number.isNaN(a) && !Number.isNaN(b));

const defaultColors = ["#ef4444","#f59e0b","#10b981","#3b82f6","#8b5cf6","#ec4899","#22c55e"];

function drawOneGeofence(g, idx) {
  const id   = g.id;
  const path = parsePath(g.path || []);
  if (!path.length) return;

  const color = g.color || defaultColors[idx % defaultColors.length];
  g._color = color;

  // Cierra el polígono si hace falta (primero == último)
  const closed = (path.length > 2 && (path[0][0] !== path[path.length-1][0] || path[0][1] !== path[path.length-1][1]))
    ? [...path, path[0]]
    : path;

  let poly = geofenceLayers.get(id);
  if (!poly) {
    poly = L.polygon(closed, { color, weight: 2, fillColor: color, fillOpacity: .18 });
    capaGeofences.addLayer(poly);
    geofenceLayers.set(id, poly);
  } else {
    poly.setLatLngs(closed).setStyle({ color, fillColor: color, fillOpacity: .18, weight: 2 });
  }
}

// Orden natural por número de “Sector 04”, “Sector 12”, etc.
const sectorNumber = (name) => {
  const m = String(name || "").match(/(\d+)/);
  return m ? parseInt(m[1], 10) : Number.POSITIVE_INFINITY;
};

// Reconstruye la lista (panel derecho) con los nombres/colores de geocercas
function rebuildLegend() {
  if (!legendDiv) return;
  const items = legendDiv.querySelector("#geoItems");
  if (!items) return;

  items.innerHTML = "";

  const list = Array.from(geofenceById.values()).sort((a,b) => {
    const na = sectorNumber(a.nombre || a.name);
    const nb = sectorNumber(b.nombre || b.name);
    if (na !== nb) return na - nb;
    return String(a.nombre || a.name || "").localeCompare(String(b.nombre || b.name || ""));
  });

  for (const g of list) {
    const el = document.createElement("div");
    el.className = "item";
    el.textContent = g.nombre || g.name || "Sector";
    el.style.setProperty("--swatch", g._color || g.color || "#9ca3af");
    items.appendChild(el);
  }
}

/* ==========================
   Conteo por sector (chips)
   ========================== */

// Calcula si un punto está sobre un segmento del polígono (para contar borde como “dentro”)
function onSegment(px, py, x1, y1, x2, y2, eps = 1e-10) {
  const cross = (px - x1) * (y2 - y1) - (py - y1) * (x2 - x1);
  if (Math.abs(cross) > eps) return false;
  const dot = (px - x1) * (px - x2) + (py - y1) * (py - y2);
  return dot <= eps;
}

// Ray casting (con borde como “dentro”)
function pointInRing(lat, lng, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].lng, yi = ring[i].lat;
    const xj = ring[j].lng, yj = ring[j].lat;
    if (onSegment(lng, lat, xi, yi, xj, yj)) return true;
    const intersect = ((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// Busca el sector (geocerca) que contiene un punto
export function sectorOfPoint(lat, lng) {
  for (const [id, poly] of geofenceLayers) {
    if (!poly.getBounds().contains([lat, lng])) continue;
    const g = geofenceById.get(id);
    if (!g) continue;
    const lls = poly.getLatLngs();
    const rings = Array.isArray(lls[0]) ? lls : [lls]; // Polygon o MultiPolygon
    for (const ring of rings) {
      if (ring && ring.length >= 3 && pointInRing(lat, lng, ring)) return { id, g };
    }
  }
  return null;
}

// Etiqueta de sector (“S4” si el nombre contiene 4)
const sectorLabel = (g) => {
  const n = sectorNumber(g?.nombre || g?.name);
  return Number.isFinite(n) ? `S${n}` : (g?.nombre || g?.name || "Sector");
};

// Mapa base de conteo (0) por sector
function baseSectorCountMap() {
  const map = new Map();
  const ordered = Array.from(geofenceById.values()).sort((a,b) => sectorNumber(a.nombre) - sectorNumber(b.nombre));
  for (const g of ordered) {
    const lab = sectorLabel(g);
    map.set(lab, { 
      label: lab,
      num: sectorNumber(g.nombre),
      color: g._color || g.color || "#9ca3af",
      name: g.nombre || g.name || lab,
      count: 0
    });
  }
  return map;
}

// Pinta chips en la leyenda de “Serenos por Sector”
function renderSectorLegend(countMap) {
  const arr = Array.from(countMap.values()).sort((a,b) => a.num - b.num);
  chipsBox.innerHTML = "";
  for (const it of arr) {
    const d = document.createElement("div");
    d.className = "chip";
    d.innerHTML = `
      <span class="dot" style="background:${it.color}"></span>
      <span class="lbl">${it.label}</span>
      <span class="val">${it.count}</span>`;
    chipsBox.appendChild(d);
  }
}

/* 
  API para PERSONAL:
  ------------------
  updateSectorCountsFrom(latestMap)
  - latestMap es: Map<key, { coords: [lat, lng], ... }>
  - Recalcula conteos por sector y actualiza chips.
*/
export function updateSectorCountsFrom(latestMap) {
  // Si aún no hay geocercas, mostramos 0s
  if (!geofenceLayers.size) { renderSectorLegend(baseSectorCountMap()); return; }

  const counts = baseSectorCountMap();
  for (const [, info] of latestMap) {
    const [lat, lng] = info.coords;
    const s = sectorOfPoint(lat, lng);
    if (!s) continue;
    const lab = sectorLabel(s.g);
    if (counts.has(lab)) counts.get(lab).count++;
    else counts.set(lab, {
      label: lab,
      num: sectorNumber(s.g.nombre),
      color: s.g._color || "#9ca3af",
      name: s.g.nombre || lab,
      count: 1
    });
  }
  renderSectorLegend(counts);
}

/* ==========================
   Suscripción a geocercas (dbL)
   ========================== */

onSnapshot(collection(dbL, "geofences"), (snap) => {
  geofenceById.clear();
  capaGeofences.clearLayers();
  geofenceLayers.clear();

  // Construye un arreglo de geocercas activas
  const docs = [];
  snap.forEach(doc => {
    const d = doc.data() || {};
    if (d.activo === false) return;
    const path = d.geometry?.path || d.path || [];
    docs.push({
      id:     doc.id,
      nombre: d.nombre || d.name,
      color:  d.color  || d.colour,
      path,
    });
  });

  // Dibuja cada geocerca y registra su color real
  docs.forEach((g, i) => {
    geofenceById.set(g.id, g);
    drawOneGeofence(g, i);
  });

  // Actualiza leyenda de geocercas
  rebuildLegend();

  // IMPORTANTE:
  // En este punto, la leyenda de “Serenos por Sector” se muestra con 0
  // hasta que personal.js llame a updateSectorCountsFrom(...) con su
  // último "latestMap". Esto evita acoplar módulos.
  renderSectorLegend(baseSectorCountMap());
});

