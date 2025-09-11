/* js/reportes.js
   =====================================================================
   CONTROLADOR DE REPORTES (modal + tabla + exportación)
   ---------------------------------------------------------------------
   Objetivo de diseño (escalable y desacoplado):
   - Este módulo NO construye datasets de Serenos ni de Alertas.
     Sólo los CONSUME a través de adaptadores públicos que exponen
     otros módulos:
        • personal.js  → getSerenosRows(), onSerenosUpdate()
        • alertas.js   → getAlertasRows(),  onAlertasUpdate()
   - Para CALIFICACIONES (ENCUESTAS) usamos un proyecto Firebase
     SEPARADO (dbC) y aquí definimos un adaptador independiente.
   - Cualquier “nuevo reporte” futuro sólo debe:
        1) exponer un adaptador que devuelva filas normalizadas
           (con campo `_when: Date` para filtrar por turno).
        2) añadir su definición en HEADERS y en `rowsAll(type)`.
   ===================================================================== */

/* ────────────────────────────────────────────────────────────────────
   1) IMPORTS
   ──────────────────────────────────────────────────────────────────── */
import {
  // NUEVO: calificaciones/encuestas viven en un proyecto distinto
  dbC, collection, onSnapshot,
} from "./Firebase.js";

import {
  // Helpers de tiempo (única fuente de verdad)
  parseFecha, intervaloTurno, todayTurnDefaults,
  // Para mejorar UX bloqueando el mapa cuando el modal está abierto
  map,
} from "./mapa.js";

import { getSerenosRows, onSerenosUpdate } from "./personal.js";
import { getAlertasRows, onAlertasUpdate } from "./alertas.js";

/* ────────────────────────────────────────────────────────────────────
   2) ESTADO LOCAL DEL MÓDULO
   ──────────────────────────────────────────────────────────────────── */

let currentReport = "serenos"; // 'serenos' | 'alertas' | 'calificaciones'
let currentRows   = [];        // filas actualmente mostradas en la tabla

// Dataset normalizado de CALIFICACIONES (encuestas del proyecto dbC)
let allCalifRaw   = [];

/* ────────────────────────────────────────────────────────────────────
   3) DEFINICIÓN DE CABECERAS POR TIPO (COLUMNA → ORDEN CANÓNICO)
   ────────────────────────────────────────────────────────────────────
   Si incorporas un nuevo reporte, agrega su cabecera aquí.
   Mantén el orden deseado tanto para la tabla como para el CSV.
--------------------------------------------------------------------- */
const HEADERS = {
  serenos: ["Nombre","DNI","Cargo","Supervisor","Comentario","Fecha","Hora","Lat","Lng"],
  alertas: ["Tipo","Código","Nombre","Fecha","Hora","Lat","Lng"],

  // CALIFICACIONES (encuestas) — mapea campos del proyecto “tu-opinion-importa-msi”
  calificaciones: [
    "Fecha","Hora","Nombre Usuario","Identificador","Placa/DNI","Sector/Cargo",
    "Limpieza","Presentación","Rapidez","Solución"
  ],
};

/* ────────────────────────────────────────────────────────────────────
   4) ADAPTADORES DE FUENTE DE DATOS (rowsAll / rowsByDay)
   ──────────────────────────────────────────────────────────────────── */

// Devuelve TODAS las filas para el tipo actual (sin filtrar por día/turno)
function rowsAll(type) {
  if (type === "serenos") return getSerenosRows();     // proviene de personal.js
  if (type === "alertas") return getAlertasRows();     // proviene de alertas.js
  return [...allCalifRaw];                             // encuestas locales a este módulo
}

// Aplica filtro por “fecha + turno” usando `_when: Date` en cada fila
function rowsByDay(type, dateStr, turno) {
  const base = parseFecha(dateStr);
  const { start, end } = intervaloTurno(base, turno);
  return rowsAll(type).filter(r => r._when >= start && r._when < end);
}

/* ────────────────────────────────────────────────────────────────────
   5) SUSCRIPCIÓN A CALIFICACIONES (ENCUESTAS) EN dbC
   ────────────────────────────────────────────────────────────────────
   - Colección: "encuestas"
   - Estructura esperada (según screenshot):
       {
         calificaciones: { limpieza, presentacion, rapidez, solucion },
         fecha: "dd/mm/yyyy",
         hora:  "hh:mm:ss a. m./p. m.",
         identificador: "Automovil 10 49",
         nombre_usuario: "Jhulmar",
         placa_dni: "EUG 268",
         sector_cargo: "SECTOR 5",
         timestamp: (Firestore Timestamp opcional)
       }
--------------------------------------------------------------------- */

// dd/mm/yyyy + 12h AM/PM → Date (si no hay timestamp nativo)
function parseFechaHora(fechaStr, horaStr) {
  let dd, mm, yy;
  if (typeof fechaStr === "string" && fechaStr.includes("/")) {
    const [d,m,y] = fechaStr.split("/").map(x => parseInt(x,10));
    dd = d; mm = m; yy = y;
  }
  const base = (dd && mm && yy) ? new Date(yy,mm-1,dd,0,0,0,0) : new Date(0);
  if (typeof horaStr === "string") {
    const m = horaStr.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AP]\.?M\.?)$/i);
    if (m) {
      let h   = parseInt(m[1],10) % 12;
      const i = parseInt(m[2],10);
      const ampm = m[3].toUpperCase().replace(".","");
      if (ampm === "PM") h += 12;
      base.setHours(h, i, 0, 0);
    }
  }
  return base;
}

function whenFromEncuesta(d) {
  const t = d?.timestamp;
  if (t?.toDate)               return t.toDate();
  if (typeof t?.seconds==="number") return new Date(t.seconds * 1000);
  return parseFechaHora(d.fecha, d.hora);
}

// Suscripción en caliente a las encuestas
onSnapshot(collection(dbC, "encuestas"), (snap) => {
  allCalifRaw = snap.docs.map(doc => {
    const data = doc.data() || {};
    const when = whenFromEncuesta(data);

    // Sub-bloque de calificaciones (si falta algún campo, usamos 0)
    const cal = data.calificaciones || {};
    const limpieza     = Number(cal.limpieza ?? 0);
    const presentacion = Number(cal.presentacion ?? 0);
    const rapidez      = Number(cal.rapidez ?? 0);
    const solucion     = Number(cal.solucion ?? 0);
    

    return {
      "Fecha": (when instanceof Date && !isNaN(when)) ? when.toLocaleDateString() : (data.fecha || ""),
      "Hora" : (when instanceof Date && !isNaN(when)) ? when.toLocaleTimeString() : (data.hora  || ""),
      "Nombre Usuario": data.nombre_usuario || "",
      "Identificador":  data.identificador  || "",
      "Placa/DNI":      data.placa_dni      || "",
      "Sector/Cargo":   data.sector_cargo   || "",
      "Limpieza":       limpieza,
      "Presentación":   presentacion,
      "Rapidez":        rapidez,
      "Solución":       solucion,
      
      _when: when, // ← clave para filtros por día/turno
    };
  }).sort((a,b) => b._when - a._when);

  // Si ya estamos viendo “calificaciones”, refrescamos al vuelo
  if (!modal.classList.contains("hidden") && currentReport === "calificaciones") {
    refreshTable();
  }
});

/* ────────────────────────────────────────────────────────────────────
   6) UTILIDADES DE TABLA Y CSV (GENÉRICAS)
   ──────────────────────────────────────────────────────────────────── */

const esc = (v) => (v ?? "").toString().replace(/[<>&]/g, s => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[s]));

function renderTable(head, rows) {
  const thead = reportTable.querySelector("thead");
  const tbody = reportTable.querySelector("tbody");
  if (!thead || !tbody) return;
  thead.innerHTML = `<tr>${head.map(h => `<th>${h}</th>`).join("")}</tr>`;
  tbody.innerHTML = "";
  for (const r of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = head.map(h => `<td>${esc(r[h] ?? "")}</td>`).join("");
    tbody.appendChild(tr);
  }
}

function downloadCSV(filename, head, rows) {
  const escCSV = s => `"${String(s ?? "").replace(/"/g,'""')}"`;
  const csvHead = head.map(escCSV).join(";");
  const csvBody = rows.map(r => head.map(h => escCSV(r[h] ?? "")).join(";")).join("\n");
  const blob = new Blob([csvHead + "\n" + csvBody], { type:"text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ────────────────────────────────────────────────────────────────────
   7) CONTROL DE MODAL (abrir/cerrar + UX con mapa)
   ──────────────────────────────────────────────────────────────────── */

const modal         = document.getElementById("modal");
const modalTitle    = document.getElementById("modalTitle");
const reportTable   = document.getElementById("reportTable");
const repFiltersBox = document.getElementById("repFilters");

function disableMapInteractions() {
  map.dragging.disable();
  map.scrollWheelZoom.disable();
  map.doubleClickZoom.disable();
  map.boxZoom.disable();
  map.keyboard.disable();
  if (map.touchZoom) map.touchZoom.disable();
}
function enableMapInteractions() {
  map.dragging.enable();
  map.scrollWheelZoom.enable();
  map.doubleClickZoom.enable();
  map.boxZoom.enable();
  map.keyboard.enable();
  if (map.touchZoom) map.touchZoom.enable();
}

function openModal() {
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden","false");
  document.body.classList.add("modal-open");
  disableMapInteractions();
}
function closeModal() {
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden","true");
  document.body.classList.remove("modal-open");
  enableMapInteractions();
}

document.getElementById("modalClose")?.addEventListener("click", closeModal);
modal?.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });

/* ────────────────────────────────────────────────────────────────────
   8) DEFAULTS Y REFRESCO DE VISTA
   ──────────────────────────────────────────────────────────────────── */

function setRepDefaults() {
  const { fecha } = todayTurnDefaults();
  document.getElementById("rep-all")?.click(); // activa “Todo”
  const dateInput = document.getElementById("repDate");
  if (dateInput) dateInput.value = fecha;
  const rdTodos = document.getElementById("rep-todos");
  if (rdTodos) rdTodos.checked = true;
  if (repFiltersBox) repFiltersBox.style.display = "none";
}

function refreshTable() {
  const head = HEADERS[currentReport];
  const mode = document.querySelector('input[name="repMode"]:checked')?.value || "all";
  currentRows = (mode === "all")
    ? rowsAll(currentReport)
    : rowsByDay(currentReport, document.getElementById("repDate")?.value, document.querySelector('input[name="repTurno"]:checked')?.value || "todos");
  renderTable(head, currentRows);
}

/* ────────────────────────────────────────────────────────────────────
   9) LISTENERS DE UI (modo, aplicar, exportar)
   ──────────────────────────────────────────────────────────────────── */

document.getElementById("rep-all")?.addEventListener("change", () => {
  if (repFiltersBox) repFiltersBox.style.display = "none";
  refreshTable();
});
document.getElementById("rep-day")?.addEventListener("change", () => {
  if (repFiltersBox) repFiltersBox.style.display = "grid";
  refreshTable();
});
document.getElementById("btnRepAplicar")?.addEventListener("click", refreshTable);

document.getElementById("btnExport")?.addEventListener("click", () => {
  const head = HEADERS[currentReport];
  const mode = document.querySelector('input[name="repMode"]:checked')?.value || "all";
  const nameSuffix = (mode === "all")
    ? "ALL"
    : `DAY_${document.getElementById("repDate")?.value}_${document.querySelector('input[name="repTurno"]:checked')?.value || "todos"}`;
  downloadCSV(`reporte_${currentReport}_${nameSuffix}_${Date.now()}.csv`, head, currentRows);
});

/* ────────────────────────────────────────────────────────────────────
   10) BOTONES DE APERTURA (tres reportes)
   ──────────────────────────────────────────────────────────────────── */

document.getElementById("btnReporteSerenos")?.addEventListener("click", () => {
  currentReport = "serenos";
  setRepDefaults();
  if (modalTitle) modalTitle.textContent = "Reporte • Serenos";
  refreshTable();
  openModal();
});

document.getElementById("btnReporteIncidentes")?.addEventListener("click", () => {
  currentReport = "alertas";
  setRepDefaults();
  if (modalTitle) modalTitle.textContent = "Reporte • Incidentes";
  refreshTable();
  openModal();
});

document.getElementById("btnReporteCalificaciones")?.addEventListener("click", () => {
  currentReport = "calificaciones";
  setRepDefaults();
  if (modalTitle) modalTitle.textContent = "Reporte • Calificaciones";
  refreshTable();
  openModal();
});

/* ────────────────────────────────────────────────────────────────────
   11) SINCRONIZACIÓN REACTIVA (cuando cambian otras fuentes)
   ──────────────────────────────────────────────────────────────────── */

onSerenosUpdate(() => {
  if (!modal.classList.contains("hidden") && currentReport === "serenos") {
    refreshTable();
  }
});
onAlertasUpdate(() => {
  if (!modal.classList.contains("hidden") && currentReport === "alertas") {
    refreshTable();
  }
});
