/* js/personal.js
   ------------------------------------------------------------
   RESPONSABILIDAD: manejar el panel de PERSONAL (asistencias) y
   los marcadores de serenos en el mapa.
   - Suscribe a Firestore (colección "asistencias" de dbS).
   - Filtra por fecha/turno/texto/solo comentario.
   - Coloca/actualiza marcadores en capaSerenos y muestra popups.
   - Actualiza el chip #countSerenos.
   - Recalcula los “Serenos por Sector” con updateSectorCountsFrom(...).
   - Expone:
       • getSerenosRows()          → filas normalizadas para reportes.
       • onSerenosUpdate(callback) → evento al reconstruir (para otros módulos).
       • getLatestSerenosMap()     → último mapa “latest” por sereno.
   ------------------------------------------------------------ */

import {
  dbS,
  collection, onSnapshot, query, orderBy,
} from "./Firebase.js";

import {
  capaSerenos,
  iconSereno,
  updateSectorCountsFrom,
  intervaloTurno,
  parseFecha,
  todayTurnDefaults,
  getCoords,
  getWhenS,
  norm,
} from "./mapa.js";

/* ==========================
   Estado interno del módulo
   ========================== */

// Cache de documentos de asistencias
const docsS = new Map(); // idDoc -> { data, when }
// Markers por “sereno” (clave = DNI o nombre)
const markersS = new Map(); // key -> { marker }

// Función de clave: prioriza DNI, luego nombre
const keyFor = (d) =>
  (d?.dni && String(d.dni).trim()) ||
  (d?.nombre && String(d.nombre).trim()) ||
  "sin-id";

// Último conjunto “latest” (por sereno) usado para el conteo por sector
let lastLatestSerenos = new Map();

// Dataset normalizado para reportes (ordenado desc por _when)
let allSerenosRaw = [];

// Observadores (p. ej., reportes.js) que quieren saber cuando cambia la vista
const listeners = new Set();
export const onSerenosUpdate = (cb) => { if (typeof cb === "function") listeners.add(cb); };
const emit = () => listeners.forEach(cb => { try { cb(); } catch {} });

/* ==========================
   Popups y helpers UI locales
   ========================== */

// Escapado seguro para HTML
const esc = (v) => (v ?? "").toString().replace(/[<>&]/g, s => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[s]));

// Contenido del popup del sereno
const popupS = (d, when) => {
  const c = (d.comentario ?? "").toString().trim();
  const fecha = (when instanceof Date && !isNaN(when)) ? when.toLocaleDateString() : "-";
  const hora  = (when instanceof Date && !isNaN(when)) ? when.toLocaleTimeString() : "-";
  return `
    <div class="popup">
      <div class="row"><strong>Nombre:</strong> ${esc(d.nombre || "-")}</div>
      <div class="row"><strong>DNI:</strong> ${esc(d.dni || "-")}</div>
      ${d.cargo ? `<div class="row"><strong>Cargo:</strong> ${esc(d.cargo)}</div>` : ""}
      <div class="row"><strong>Supervisor:</strong> ${esc(d.supervisor || "-")}</div>
      <div class="row"><strong>Fecha:</strong> ${fecha}</div>
      <div class="row"><strong>Hora:</strong> ${hora}</div>
      ${c ? `<div class="row"><strong>Comentario:</strong> ${esc(c)}</div>` : ""}
    </div>`;
};

// Aplica/actualiza popup en un marker existente
function setSerenoPopup(marker, data, when) {
  const pop = marker.getPopup();
  if (pop) pop.setContent(popupS(data, when));
  else marker.bindPopup(popupS(data, when));
}

// Pequeño debounce para inputs
const debounce = (fn, ms = 160) => {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};

/* ==========================
   Render principal (filtrado y marcadores)
   ========================== */

function rebuildSerenos() {
  // Lee filtros de la UI
  const fecha = document.getElementById("fechaSerenos")?.value;
  const turno = document.querySelector('input[name="turnoSerenos"]:checked')?.value || "t1";
  const texto = norm(document.getElementById("buscador")?.value || "");
  const onlyC = !!document.getElementById("soloComentario")?.checked;

  // Intervalo del turno para esa fecha
  const base = parseFecha(fecha);
  const { start, end } = intervaloTurno(base, turno);

  // latest: para cada sereno (key), su registro más reciente dentro del turno
  const latest = new Map();

  for (const [, rec] of docsS) {
    const { data, when } = rec;

    // Coordenadas válidas
    const coords = getCoords({
      lat: data.lat, latitud: data.latitud, latitude: data.latitude,
      lng: data.lng, longitud: data.longitud, longitude: data.longitude, long: data.long,
    });
    if (!coords) continue;

    // Dentro del rango del turno
    if (!(when >= start && when < end)) continue;

    // Cumple filtro de texto (en nombre o DNI)
    const okText =
      !texto ||
      norm(data.nombre).includes(texto) ||
      norm(String(data.dni || "")).includes(texto);
    if (!okText) continue;

    // Solo con comentario (si está marcado)
    const hasC = !!(data.comentario && String(data.comentario).trim());
    if (onlyC && !hasC) continue;

    // Mantén solo el más reciente por key
    const k = keyFor(data);
    const prev = latest.get(k);
    if (!prev || when > prev.when) latest.set(k, { data, when, coords, hasC });
  }

  // Limpia la capa y reconstruye marcadores visibles
  capaSerenos.clearLayers();
  const keysVisible = new Set();

  for (const [k, info] of latest) {
    let rec = markersS.get(k);
    if (!rec) {
      const m = L.marker(info.coords, { icon: iconSereno() });
      setSerenoPopup(m, info.data, info.when);
      rec = { marker: m };
      markersS.set(k, rec);
    } else {
      rec.marker.setLatLng(info.coords).setIcon(iconSereno());
      setSerenoPopup(rec.marker, info.data, info.when);
    }
    capaSerenos.addLayer(rec.marker);
    keysVisible.add(k);
  }

  // Quita marcadores que ya no entran en el filtro
  for (const [k, rec] of markersS) {
    if (!keysVisible.has(k)) capaSerenos.removeLayer(rec.marker);
  }

  // Actualiza chip de conteo
  const chip = document.getElementById("countSerenos");
  if (chip) chip.textContent = String(keysVisible.size);

  // Guarda último “latest” para conteo por sector y actualiza leyenda
  lastLatestSerenos = latest;
  updateSectorCountsFrom(latest);

  // Notifica a suscriptores
  emit();
}

/* ==========================
   Suscripción a Firestore (asistencias)
   ========================== */

onSnapshot(query(collection(dbS, "asistencias"), orderBy("timestamp", "desc")), (snap) => {
  // Refresca cache de docs (asistencias)
  docsS.clear();
  snap.docs.forEach(d => {
    const data = d.data() || {};
    docsS.set(d.id, { data, when: getWhenS(data) });
  });

  // Dataset normalizado para reportes (orden desc)
  allSerenosRaw = snap.docs.map(d => {
    const data = d.data() || {};
    const when = getWhenS(data);
    const coords = getCoords({
      lat: data.lat, latitud: data.latitud, latitude: data.latitude,
      lng: data.lng, longitud: data.longitud, longitude: data.longitude, long: data.long,
    });

    // Normaliza supervisor desde posibles campos alternativos
    let sup = data.supervisor ?? data.supervisorNombre ?? data.encargado ?? data.jefe ?? data.usuarioNombre ?? data.usuario ?? "";
    if (sup && typeof sup === "object") {
      sup = sup.nombre ?? sup.name ?? JSON.stringify(sup);
    }

    return {
      Nombre: data.nombre || "",
      DNI: data.dni || "",
      Cargo: data.cargo || "",
      Supervisor: sup,
      Comentario: (data.comentario || "").toString().trim(),
      Fecha: (when instanceof Date && !isNaN(when)) ? when.toLocaleDateString() : "",
      Hora:  (when instanceof Date && !isNaN(when)) ? when.toLocaleTimeString() : "",
      Lat:   coords ? coords[0] : "",
      Lng:   coords ? coords[1] : "",
      _when: when,
    };
  }).sort((a, b) => b._when - a._when);

  // Reconstruye vista con filtros actuales
  rebuildSerenos();
});

/* ==========================
   Inicialización del panel PERSONAL
   ========================== */

(function initPersonalPanelDefaults() {
  const { fecha, turno } = todayTurnDefaults();

  // Fecha de serenos (hoy)
  const dateInput = document.getElementById("fechaSerenos");
  if (dateInput) dateInput.value = fecha;

  // Turno sugerido (según hora actual)
  const rd = document.getElementById(`ts-${turno}`);
  if (rd) rd.checked = true;
})();

// Listeners de filtros
document.getElementById("fechaSerenos")?.addEventListener("change", rebuildSerenos);
document.querySelectorAll('input[name="turnoSerenos"]').forEach(radio => {
  radio.addEventListener("change", rebuildSerenos);
});
document.getElementById("buscador")?.addEventListener("input", debounce(rebuildSerenos, 140));
document.getElementById("soloComentario")?.addEventListener("change", rebuildSerenos);

// Botón “Hoy”: repone fecha/turno por defecto y reconstruye
document.getElementById("btnHoyS")?.addEventListener("click", () => {
  const { fecha, turno } = todayTurnDefaults();
  const dateInput = document.getElementById("fechaSerenos");
  if (dateInput) dateInput.value = fecha;
  const rd = document.getElementById(`ts-${turno}`);
  if (rd) rd.checked = true;
  rebuildSerenos();
});

/* ==========================
   API pública del módulo
   ========================== */

// Devuelve copia del dataset normalizado de serenos (para reportes.js)
export function getSerenosRows() {
  return [...allSerenosRaw];
}

// Devuelve el último “latest map” (por sereno) usado para conteos de sector
export function getLatestSerenosMap() {
  return new Map(lastLatestSerenos);
}
