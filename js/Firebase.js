/* js/Firebase.js
   ------------------------------------------------------------
   Módulo único para inicializar Firebase y exponer Firestore.
   - No toca el DOM ni el mapa.
   - Otros módulos importan los `db` y los helpers de Firestore
     DESDE AQUÍ para garantizar que todos usan la MISMA versión.
   ------------------------------------------------------------ */

// SDK base de Firebase y Firestore (v10 modular)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getFirestore,
  // Reexportamos estos helpers para usarlos desde este módulo
  collection,
  onSnapshot,
  query,
  orderBy,
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

/* ==========================
   Configs e inicializaciones
   ========================== */

/** App Serenos (asistencias) */
const cfgS = {
  apiKey: "AIzaSyA-bTOSM1OCc1HNaUrFTqMAQKl6rLXOu3w",
  authDomain: "asistencia-serenazgo.firebaseapp.com",
  projectId: "asistencia-serenazgo",
  storageBucket: "asistencia-serenazgo.firebasestorage.app",
  messagingSenderId: "437643878125",
  appId: "1:437643878125:web:b4ebfe2657c2d52e65b6e4",
};
// Nota: esta app usa el nombre por defecto
export const appS = initializeApp(cfgS);
export const dbS  = getFirestore(appS); // <- Firestore para asistencias

/** App Alertas (alerta vecinal) — SE MANTIENE IGUAL */
const cfgA = {
  apiKey: "AIzaSyDOTV9g3daZttWK16p9Bmcl7N3LoXqJaAU",
  authDomain: "vecinos-37d87.firebaseapp.com",
  projectId: "vecinos-37d87",
  storageBucket: "vecinos-37d87.firebasestorage.app",
  messagingSenderId: "730270250892",
  appId: "1:730270250892:web:211880d8827f499d2808a9",
  measurementId: "G-EVVVLMYE4V",
};
// Importante: nombramos explícitamente esta app para no colisionar
export const appA = initializeApp(cfgA, "vecinos");
export const dbA  = getFirestore(appA); // <- Firestore para alertas

/** App Calificaciones / Encuestas (nuevo proyecto separado) */
const cfgC = {
  apiKey: "AIzaSyAzqBW_0QduNdRk2lHFzgh8cOqHOzCRq8A",
  authDomain: "tu-opinion-importa-msi.firebaseapp.com",
  projectId: "tu-opinion-importa-msi",
  storageBucket: "tu-opinion-importa-msi.firebasestorage.app",
  messagingSenderId: "933860804282",
  appId: "1:933860804282:web:8afef3b37b9d01fdca6483",
  measurementId: "G-ZM3EM2Z4W7",
};
// Nombre único ("opiniones") para coexistir con las otras apps
export const appC = initializeApp(cfgC, "opiniones");
export const dbC  = getFirestore(appC); // <- Firestore para encuestas/calificaciones

/** App Lugares (Geocercas) */
const cfgL = {
  apiKey: "AIzaSyDYvq2uVd5MuTLOGZu4QoOn-LFr0gMlye4",
  authDomain: "lugares-aa4be.firebaseapp.com",
  projectId: "lugares-aa4be",
  storageBucket: "lugares-aa4be.firebasestorage.app",
  messagingSenderId: "351424017310",
  appId: "1:351424017310:web:99816d2535018e1c711c8f",
  measurementId: "G-51KS7PLTEP",
};
export const appL = initializeApp(cfgL, "lugares");
export const dbL  = getFirestore(appL); // <- Firestore para geofences

/* ==========================
   Reexports convenientes
   ==========================
   Para evitar que cada módulo tenga que importar Firestore
   desde la CDN, reexportamos lo que ya usas en tu app:
   - collection, onSnapshot, query, orderBy
   (Si luego necesitas addDoc, where, etc., también puedes
    reexportarlos aquí.)
*/
export { collection, onSnapshot, query, orderBy };

/* ==========================
   Notas de uso en otros módulos
   ==========================
   import { dbS, dbA, dbC, dbL, collection, onSnapshot, query, orderBy } from "./Firebase.js";

   // Ejemplos:
   // onSnapshot(query(collection(dbS, "asistencias"), orderBy("timestamp","desc")), ...)
   // onSnapshot(collection(dbA, "alertas"), ...)
   // onSnapshot(collection(dbC, "encuestas"), ...)   // <-- NUEVO (Ver calificaciones)
   // onSnapshot(collection(dbL, "geofences"), ...)

   Seguridad: asegúrate de tener reglas de Firestore adecuadas
   para producción; las keys públicas del front no son secretas,
   la seguridad real está en las reglas.
*/
