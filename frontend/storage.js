/**
 * VoxPDF Studio — Capa de Persistencia Local (IndexedDB + Progreso de Lectura)
 * Módulo puro de infraestructura sin acoplamiento al DOM.
 */

window.VoxStorage = (function () {
  const LOCAL_DB_NAME = "voxpdf_local_db";
  const LOCAL_DB_VERSION = 1;
  const LOCAL_STORE_NAME = "documents";
  const ACTIVE_DOC_KEY = "last_opened_pdf";
  const PROGRESS_PREFIX = "voxpdf_progress_";

  function openLocalPdfDb() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error("IndexedDB no disponible"));
        return;
      }
      const req = window.indexedDB.open(LOCAL_DB_NAME, LOCAL_DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(LOCAL_STORE_NAME)) {
          db.createObjectStore(LOCAL_STORE_NAME);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function savePdf(file, arrayBuffer, parsed, cleaningOptions) {
    try {
      const db = await openLocalPdfDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(LOCAL_STORE_NAME, "readwrite");
        const store = tx.objectStore(LOCAL_STORE_NAME);
        store.put(
          {
            filename: file.name,
            fileSize: file.size,
            pdfBytes: arrayBuffer,
            parsed,
            cleaningOptions,
            savedAt: new Date().toISOString(),
          },
          ACTIVE_DOC_KEY
        );
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    } catch (err) {
      console.warn("No se pudo guardar el PDF en IndexedDB:", err);
    }
  }

  async function loadPdf() {
    try {
      const db = await openLocalPdfDb();
      const record = await new Promise((resolve, reject) => {
        const tx = db.transaction(LOCAL_STORE_NAME, "readonly");
        const store = tx.objectStore(LOCAL_STORE_NAME);
        const getReq = store.get(ACTIVE_DOC_KEY);
        getReq.onsuccess = () => resolve(getReq.result || null);
        getReq.onerror = () => reject(getReq.error);
      });
      db.close();
      return record;
    } catch (_) {
      return null;
    }
  }

  async function clearPdf() {
    try {
      const db = await openLocalPdfDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(LOCAL_STORE_NAME, "readwrite");
        const store = tx.objectStore(LOCAL_STORE_NAME);
        store.delete(ACTIVE_DOC_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    } catch (_) {}
  }

  function getProgress(docId) {
    if (!docId) return null;
    try {
      const raw = localStorage.getItem(`${PROGRESS_PREFIX}${docId}`);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function saveProgress(payload) {
    if (!payload || !payload.doc_id) return;
    try {
      localStorage.setItem(`${PROGRESS_PREFIX}${payload.doc_id}`, JSON.stringify(payload));
    } catch (_) {}
  }

  return {
    savePdf,
    loadPdf,
    clearPdf,
    getProgress,
    saveProgress,
  };
})();
