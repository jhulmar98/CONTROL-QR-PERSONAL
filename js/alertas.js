/* js/alertas.js
   ------------------------------------------------------------
   RESPONSABILIDAD: manejar el panel de ALERTAS y los pines en el mapa.
   - Suscribe a Firestore (colección "alertas" de dbA).
   - Renderiza/actualiza marcadores en la capa de alertas.
   - Controla el contador #countAlertas y los filtros (activas / por fecha).
   - Notifica a otros módulos (p. ej., reportes.js) mediante onAlertasUpdate().
   - Expone getAlertasRows() para que reportes.js consuma las filas normalizadas.
   ------------------------------------------------------------ */

import {
  dbA,                  // Firestore de alertas/calificaciones
  collection,
  onSnapshot,
} from "./Firebase.js";

import {
  map,                  // Leaflet map (para flyTo)
  capaAlertas,          // LayerGroup para alertas
  iconAlerta,           // Icono/pin de alerta (pulse opcional)
  // Helpers comunes centralizados en mapa.js (misma lógica que tenías):
  intervaloTurno,
  parseFecha,
  todayTurnDefaults,
  getCoords,
  getWhenA,
} from "./mapa.js";

/* ==========================
   Estado interno del módulo
   ========================== */

// Cache de documentos y marcadores en el mapa
const docsA     = new Map(); // id -> { id, data, when }
const markersA  = new Map(); // id -> Leaflet Marker
let initialized = false;     // marca si ya pasamos el primer snapshot

// Dataset normalizado para reportes (se actualiza con cada snapshot)
let allAlertasRaw = [];

// Observadores (reportes.js puede suscribirse a cambios)
const listeners = new Set();
export const onAlertasUpdate = (cb) => { if (typeof cb === "function") listeners.add(cb); };
const emit = () => listeners.forEach(cb => { try { cb(); } catch {} });

/* ==========================
   Utilidades locales (UI)
   ========================== */

// Escape seguro para HTML en popups
const esc = (v) => (v ?? "").toString().replace(/[<>&]/g, s => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[s]));

// Contenido del popup de una alerta
const popupA = (d, when) => `
  <div class="popup">
    <div class="row"><strong>Tipo:</strong> ${esc(d.incidente || "Alerta")}</div>
    <div class="row"><strong>Código:</strong> ${esc(d.usuarioCodigo || "-")}</div>
    <div class="row"><strong>Nombre:</strong> ${esc(d.usuarioNombre || "-")}</div>
    <div class="row"><strong>Fecha:</strong> ${when.toLocaleDateString()}</div>
    <div class="row"><strong>Hora:</strong> ${when.toLocaleTimeString()}</div>
  </div>`;

/* ==========================
   Render principal
   ========================== */

function rebuildAlertas() {
  // Modo: "activas" (últimos 30min) o "range" (por fecha + turno)
  const mode  = document.querySelector('input[name="alertMode"]:checked')?.value || "active";
  const pulse = (mode === "active");

  capaAlertas.clearLayers();

  const now = Date.now();
  const THIRTY_MIN = 30 * 60 * 1000;
  let visibles = 0;

  // Rango cuando el modo es "Por fecha"
  let start = null, end = null;
  if (mode === "range") {
    const fecha = document.getElementById("fechaAlertas").value;
    const turno = document.querySelector('input[name="turnoAlertas"]:checked')?.value || "todos";
    const r = intervaloTurno(parseFecha(fecha), turno);
    start = r.start; end = r.end;
  }

  for (const [, rec] of docsA) {
    // Coordenadas válidas
    const coords = getCoords({
      lat: rec.data.lat, latitud: rec.data.latitud, latitude: rec.data.latitude,
      lng: rec.data.lng, longitud: rec.data.longitud, longitude: rec.data.longitude
    });
    if (!coords) continue;

    // Inclusión según modo
    const when = rec.when;
    const include = (mode === "active")
      ? ((now - when.getTime()) <= THIRTY_MIN)
      : (when >= start && when < end);

    if (!include) continue;

    // Crear/actualizar marcador
    let m = markersA.get(rec.id);
    if (!m) {
      m = L.marker(coords, { icon: iconAlerta(pulse) });
      m.bindPopup(popupA(rec.data, when));
      markersA.set(rec.id, m);
    } else {
      m.setLatLng(coords).setIcon(iconAlerta(pulse));
      const p = m.getPopup(); if (p) p.setContent(popupA(rec.data, when));
    }

    capaAlertas.addLayer(m);
    visibles++;
  }

  // Actualiza chip contador
  const chip = document.getElementById("countAlertas");
  if (chip) chip.textContent = String(visibles);

  // Notifica a suscriptores (reportes, etc.)
  emit();
}

/* ==========================
   Suscripción a Firestore
   ========================== */

onSnapshot(collection(dbA, "alertas"), (snap) => {
  const newIds = [];

  snap.docChanges().forEach((ch) => {
    const id = ch.doc.id;

    if (ch.type === "removed") {
      // Quita del cache y del mapa
      docsA.delete(id);
      const m = markersA.get(id);
      if (m) {
        capaAlertas.removeLayer(m);
        markersA.delete(id);
      }
      return;
    }

    // Added/Modified
    const data = ch.doc.data() || {};
    const when = getWhenA(data);
    docsA.set(id, { id, data, when });

    if (initialized && ch.type === "added") newIds.push(id);
  });

  // Dataset normalizado para reportes (ordenado por fecha desc)
  allAlertasRaw = Array.from(docsA.values())
    .map(({ data, when }) => {
      const coords = getCoords({
        lat: data.lat, latitud: data.latitud, latitude: data.latitude,
        lng: data.lng, longitud: data.longitud, longitude: data.longitude
      });
      return {
        Tipo:  data.incidente || "",
        Código: data.usuarioCodigo || "",
        Nombre: data.usuarioNombre || "",
        Fecha: (when instanceof Date && !isNaN(when)) ? when.toLocaleDateString() : "",
        Hora:  (when instanceof Date && !isNaN(when)) ? when.toLocaleTimeString() : "",
        Lat:   coords ? coords[0] : "",
        Lng:   coords ? coords[1] : "",
        _when: when,
      };
    })
    .sort((a, b) => b._when - a._when);

  // Redibuja todo (modo actual)
  rebuildAlertas();

  // En el primer snapshot no hacemos animación; a partir del segundo sí.
  if (initialized && newIds.length) {
    // Si hay nuevas alertas "visibles" según el modo, volamos a la primera.
    const mode = document.querySelector('input[name="alertMode"]:checked')?.value || "active";
    const now = Date.now();
    const THIRTY_MIN = 30 * 60 * 1000;

    for (const id of newIds) {
      const rec = docsA.get(id);
      if (!rec) continue;

      const coords = getCoords({
        lat: rec.data.lat, latitud: rec.data.latitud, latitude: rec.data.latitude,
        lng: rec.data.lng, longitud: rec.data.longitud, longitude: rec.data.longitude
      });
      if (!coords) continue;

      // ¿Debe ser visible con el modo actual?
      let visible = false;
      if (mode === "active") {
        visible = (now - rec.when.getTime()) <= THIRTY_MIN;
      } else {
        const fecha = document.getElementById("fechaAlertas").value;
        const turno = document.querySelector('input[name="turnoAlertas"]:checked')?.value || "todos";
        const { start, end } = intervaloTurno(parseFecha(fecha), turno);
        visible = (rec.when >= start && rec.when < end);
      }
      if (!visible) continue;

      // Anima la vista y abre el popup
      map.flyTo(coords, 17, { animate: true, duration: 0.8 });
      const m = markersA.get(id);
      if (m) setTimeout(() => m.openPopup(), 300);
      break; // solo el primero
    }
  }

  if (!initialized) initialized = true;
});

/* ==========================
   Event listeners de la UI
   ========================== */

// Activa/desactiva filtros por fecha según el modo
function setAlertFiltersEnabled(enabled) {
  const box = document.getElementById("alertFilters");
  if (!box) return;
  box.style.opacity = enabled ? "1" : ".45";
  box.style.pointerEvents = enabled ? "auto" : "none";
}

// Inicializa valores por defecto SOLO para el panel de alertas
(function initAlertPanelDefaults() {
  const { fecha } = todayTurnDefaults();

  // Modo por defecto: Activas
  const rdActive = document.getElementById("am-active");
  if (rdActive) rdActive.checked = true;

  // Fecha por defecto (hoy)
  const dateInput = document.getElementById("fechaAlertas");
  if (dateInput) dateInput.value = fecha;

  // Turno por defecto: Todos
  const rdTodos = document.getElementById("ta-todos");
  if (rdTodos) rdTodos.checked = true;

  // Filtros deshabilitados cuando el modo es "Activas"
  setAlertFiltersEnabled(false);
})();

// Cambios de modo
document.getElementById("am-active")?.addEventListener("change", () => {
  setAlertFiltersEnabled(false);
  rebuildAlertas();
});
document.getElementById("am-range")?.addEventListener("change", () => {
  setAlertFiltersEnabled(true);
  rebuildAlertas();
});

// Cambios de filtros (fecha/turno)
document.getElementById("fechaAlertas")?.addEventListener("change", rebuildAlertas);
document.querySelectorAll('input[name="turnoAlertas"]').forEach(radio => {
  radio.addEventListener("change", rebuildAlertas);
});

// Botón “Hoy” (restaura fecha y turno)
document.getElementById("btnHoyA")?.addEventListener("click", () => {
  const { fecha } = todayTurnDefaults();
  const dateInput = document.getElementById("fechaAlertas");
  if (dateInput) dateInput.value = fecha;
  const rdTodos = document.getElementById("ta-todos");
  if (rdTodos) rdTodos.checked = true;
  rebuildAlertas();
});

// Refresco periódico solo para modo "Activas"
setInterval(() => {
  if (document.getElementById("am-active")?.checked) rebuildAlertas();
}, 15000);

/* ==========================
   API pública del módulo
   ========================== */

// Devuelve una copia del dataset normalizado (para reportes.js)
export function getAlertasRows() {
  return [...allAlertasRaw];
}
