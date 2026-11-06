/**
 * VoxPDF — Controlador Frontend
 * Lector y conversor de PDF a voz con persistencia local en IndexedDB y sincronización de páginas.
 * Desarrollado por Edgar López.
 */

if (window.pdfjsLib) {
  window.pdfjsLib.GlobalWorkerOptions.workerSrc =
    "./vendor/pdfjs/pdf.worker.min.js";
}

const LOCAL_DB_NAME = "voxpdf_local_db";
const LOCAL_DB_VERSION = 1;
const LOCAL_STORE_NAME = "documents";
const ACTIVE_DOC_KEY = "last_opened_pdf";
const SILENT_AUDIO_URI = "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";

const state = {
  backendAvailable: true,
  docData: null,
  rawFile: null,
  pdfJsDoc: null,
  pdfRenderTask: null,
  currentPage: 1,
  currentSentenceIdx: 0,
  isPlaying: false,
  selectedVoice: "es-MX-DaliaNeural",
  playbackSpeed: 1.0,
  audioBlobCache: new Map(),
  playSessionId: 0,
  wakeLock: null,
  speechKeepAliveInterval: null,
  fontSizeLevel: localStorage.getItem("voxpdf_font_size") || "normal",
  scriptSearchQuery: "",
  sleepTimerMode: "0",
  sleepTimerEndTime: null,
  sleepTimerIntervalId: null,
};

const dom = {
  pdfFileInput: document.getElementById("pdfFileInput"),
  engineBadge: document.getElementById("engineBadge"),
  engineBadgeText: document.getElementById("engineBadgeText"),
  emptyStateDropzone: document.getElementById("emptyStateDropzone"),
  readerSplitContainer: document.getElementById("readerSplitContainer"),
  screenReaderAudio: document.getElementById("screenReaderAudio"),
  screenChaptersCleaning: document.getElementById("screenChaptersCleaning"),

  // Resumen y limpieza
  docTitleText: document.getElementById("docTitleText"),
  docMetaText: document.getElementById("docMetaText"),
  docDurationBadge: document.getElementById("docDurationBadge"),
  statPages: document.getElementById("statPages"),
  statSentences: document.getElementById("statSentences"),
  statWords: document.getElementById("statWords"),
  btnClearSavedPdf: document.getElementById("btnClearSavedPdf"),
  chkRemoveHeaders: document.getElementById("chkRemoveHeaders"),
  chkRemovePageNums: document.getElementById("chkRemovePageNums"),
  chkFixLineBreaks: document.getElementById("chkFixLineBreaks"),
  chkSplitByCommas: document.getElementById("chkSplitByCommas"),
  chkRemoveCitations: document.getElementById("chkRemoveCitations"),
  countHeadersRemoved: document.getElementById("countHeadersRemoved"),
  countPageNumsRemoved: document.getElementById("countPageNumsRemoved"),

  // Navegación Capítulos y Páginas
  chapterCountLabel: document.getElementById("chapterCountLabel"),
  chapterList: document.getElementById("chapterList"),
  pageGrid: document.getElementById("pageGrid"),
  btnPrevPageTop: document.getElementById("btnPrevPageTop"),
  btnNextPageTop: document.getElementById("btnNextPageTop"),
  currentPageLabel: document.getElementById("currentPageLabel"),
  totalPagesLabel: document.getElementById("totalPagesLabel"),
  bookProgressPct: document.getElementById("bookProgressPct"),
  bookProgressBarFill: document.getElementById("bookProgressBarFill"),

  // Visor PDF y Texto
  pdfHeaderDocName: document.getElementById("pdfHeaderDocName"),
  pdfCanvas: document.getElementById("pdfCanvas"),
  pdfHighlightBox: document.getElementById("pdfHighlightBox"),
  sentencesContainer: document.getElementById("sentencesContainer"),
  scriptSearchInput: document.getElementById("scriptSearchInput"),
  btnFontDec: document.getElementById("btnFontDec"),
  btnFontInc: document.getElementById("btnFontInc"),

  // Reproductor inferior
  btnPrevSentence: document.getElementById("btnPrevSentence"),
  btnPlayPause: document.getElementById("btnPlayPause"),
  btnNextSentence: document.getElementById("btnNextSentence"),
  iconPlay: document.getElementById("iconPlay"),
  iconPause: document.getElementById("iconPause"),
  audioVisualizer: document.getElementById("audioVisualizer"),
  playerChapterLabel: document.getElementById("playerChapterLabel"),
  nowPlayingSentence: document.getElementById("nowPlayingSentence"),
  sentenceCounterLabel: document.getElementById("sentenceCounterLabel"),
  pageProgressFill: document.getElementById("pageProgressFill"),
  voiceSelect: document.getElementById("voiceSelect"),
  speedSelect: document.getElementById("speedSelect"),
  sleepTimerSelect: document.getElementById("sleepTimerSelect"),
  sleepTimerBadge: document.getElementById("sleepTimerBadge"),
  neuralAudioPlayer: document.getElementById("neuralAudioPlayer"),
  bgKeepAliveAudio: document.getElementById("bgKeepAliveAudio"),

  // Banner progreso guardado
  resumeBanner: document.getElementById("resumeBanner"),
  resumeBannerText: document.getElementById("resumeBannerText"),
  btnResumeConfirm: document.getElementById("btnResumeConfirm"),
  btnResumeDismiss: document.getElementById("btnResumeDismiss"),
};

document.addEventListener("DOMContentLoaded", async () => {
  setupEventListeners();
  setupMediaSession();
  await detectEnvironmentAndVoices();
  if (window.VoxAdManager) {
    window.VoxAdManager.init();
  }
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
  await restorePersistedPdfFromLocalDb();
});

/* ==========================================================================
   PERSISTENCIA LOCAL DE ARCHIVOS PDF (IndexedDB)
   Permite recordar el PDF cargado y su texto procesado entre sesiones
   ========================================================================== */

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

async function savePdfToLocalDb(file, arrayBuffer, parsed) {
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
          cleaningOptions: {
            removeHeaders: dom.chkRemoveHeaders.checked,
            removePageNums: dom.chkRemovePageNums.checked,
            fixLineBreaks: dom.chkFixLineBreaks.checked,
            splitByCommas: dom.chkSplitByCommas ? dom.chkSplitByCommas.checked : true,
            removeCitations: dom.chkRemoveCitations ? dom.chkRemoveCitations.checked : true,
          },
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

async function loadPdfFromLocalDb() {
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

async function clearPdfFromLocalDb() {
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

async function restorePersistedPdfFromLocalDb() {
  const record = await loadPdfFromLocalDb();
  if (!record || !record.pdfBytes || !record.parsed) return;

  try {
    if (record.cleaningOptions) {
      dom.chkRemoveHeaders.checked = Boolean(record.cleaningOptions.removeHeaders);
      dom.chkRemovePageNums.checked = Boolean(record.cleaningOptions.removePageNums);
      dom.chkFixLineBreaks.checked = Boolean(record.cleaningOptions.fixLineBreaks);
      if (dom.chkSplitByCommas && record.cleaningOptions.splitByCommas !== undefined) {
        dom.chkSplitByCommas.checked = Boolean(record.cleaningOptions.splitByCommas);
      }
      if (dom.chkRemoveCitations && record.cleaningOptions.removeCitations !== undefined) {
        dom.chkRemoveCitations.checked = Boolean(record.cleaningOptions.removeCitations);
      }
    }

    const blob = new Blob([record.pdfBytes], { type: "application/pdf" });
    state.rawFile = new File([blob], record.filename || "documento.pdf", {
      type: "application/pdf",
    });

    await initializeDocument(record.parsed, record.pdfBytes, false, true);
  } catch (err) {
    console.warn("Error al restaurar PDF guardado localmente:", err);
  }
}

async function closeCurrentDocument() {
  stopPlayback();
  await clearPdfFromLocalDb();
  state.docData = null;
  state.rawFile = null;
  state.pdfJsDoc = null;
  state.currentPage = 1;
  state.currentSentenceIdx = 0;
  dom.pdfFileInput.value = "";

  dom.readerSplitContainer.classList.add("hidden");
  dom.emptyStateDropzone.classList.remove("hidden");
  dom.resumeBanner.classList.add("hidden");
  if (dom.btnClearSavedPdf) dom.btnClearSavedPdf.classList.add("hidden");

  dom.docTitleText.textContent = "Sin documento cargado";
  dom.docMetaText.textContent = "Selecciona un PDF";
  dom.statPages.textContent = "0";
  dom.statWords.textContent = "0";
  dom.docDurationBadge.textContent = "0 min";
  dom.currentPageLabel.textContent = "0";
  dom.totalPagesLabel.textContent = "0";
  dom.bookProgressPct.textContent = "0%";
  if (dom.bookProgressBarFill) dom.bookProgressBarFill.style.width = "0%";
  dom.playerChapterLabel.textContent = "Sin documento activo";
  dom.nowPlayingSentence.textContent = "Abre un archivo PDF para iniciar la lectura.";
  dom.btnPlayPause.disabled = true;
  dom.btnPrevSentence.disabled = true;
  dom.btnNextSentence.disabled = true;

  if ("mediaSession" in navigator) {
    try {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = "none";
    } catch (_) {}
  }
}

/* ==========================================================================
   DETECCIÓN DE VOCES Y EVENTOS DE INTERFAZ
   ========================================================================== */

async function detectEnvironmentAndVoices() {
  try {
    const healthRes = await fetch("./api/health", { cache: "no-store" });
    if (!healthRes.ok) throw new Error("Static host");
    const voicesRes = await fetch("./api/voices");
    const data = await voicesRes.json();

    state.backendAvailable = true;
    if (dom.engineBadgeText) dom.engineBadgeText.textContent = "Activo";
    dom.voiceSelect.innerHTML = "";
    (data.voices || []).forEach((v) => {
      const opt = document.createElement("option");
      opt.value = v.id;
      opt.className = "bg-surface text-slate-100";
      opt.textContent = v.name;
      dom.voiceSelect.appendChild(opt);
    });

    const browserOpt = document.createElement("option");
    browserOpt.value = "browser-local";
    browserOpt.className = "bg-surface text-slate-100";
    browserOpt.textContent = "Voz del sistema (sin conexión)";
    dom.voiceSelect.appendChild(browserOpt);
  } catch (_) {
    state.backendAvailable = false;
    state.selectedVoice = "browser-local";
    if (dom.engineBadgeText) dom.engineBadgeText.textContent = "Local";
    populateBrowserSpeechVoices();
    if (window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = populateBrowserSpeechVoices;
    }
  }
}

function populateBrowserSpeechVoices() {
  if (state.backendAvailable) return;
  dom.voiceSelect.innerHTML = "";
  const voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
  const preferred = voices.filter((v) => v.lang.startsWith("es") || v.lang.startsWith("en"));
  const list = preferred.length > 0 ? preferred : voices;

  if (list.length === 0) {
    const opt = document.createElement("option");
    opt.value = "browser-local";
    opt.className = "bg-surface text-slate-100";
    opt.textContent = "Voz del navegador (ES/EN)";
    dom.voiceSelect.appendChild(opt);
    return;
  }

  list.forEach((v) => {
    const opt = document.createElement("option");
    opt.value = `browser:${v.name}`;
    opt.className = "bg-surface text-slate-100";
    opt.textContent = `${v.name} (${v.lang})`;
    dom.voiceSelect.appendChild(opt);
  });
  state.selectedVoice = dom.voiceSelect.value;
}

function setupEventListeners() {
  dom.pdfFileInput.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (file) handleUploadFile(file);
  });

  if (dom.btnClearSavedPdf) {
    dom.btnClearSavedPdf.addEventListener("click", () => {
      closeCurrentDocument();
    });
  }

  window.addEventListener("dragover", (e) => {
    e.preventDefault();
    dom.emptyStateDropzone.classList.add("dragover");
  });
  window.addEventListener("dragleave", () => {
    dom.emptyStateDropzone.classList.remove("dragover");
  });
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    dom.emptyStateDropzone.classList.remove("dragover");
    const file = e.dataTransfer?.files?.[0];
    if (file && file.name.toLowerCase().endsWith(".pdf")) {
      handleUploadFile(file);
    }
  });

  [dom.chkRemoveHeaders, dom.chkRemovePageNums, dom.chkFixLineBreaks, dom.chkSplitByCommas, dom.chkRemoveCitations].forEach((chk) => {
    if (!chk) return;
    chk.addEventListener("change", () => {
      if (!state.docData || !state.rawFile) return;
      stopPlayback();
      handleUploadFile(state.rawFile, true);
    });
  });

  // Pestañas: Capítulos vs Páginas
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => {
        b.className =
          "tab-btn py-1.5 rounded-md text-slate-400 hover:text-slate-200 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors";
      });
      btn.className =
        "tab-btn active py-1.5 rounded-md bg-surface-elevated text-slate-100 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors";

      const showChapters = btn.dataset.tab === "chapters";
      document.getElementById("tabChapters").classList.toggle("hidden", !showChapters);
      document.getElementById("tabPages").classList.toggle("hidden", showChapters);
    });
  });

  // Selector de modo de vista (Dividida / Texto / PDF)
  document.querySelectorAll(".view-mode-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".view-mode-btn").forEach((b) => {
        b.className =
          "view-mode-btn py-1 px-2.5 rounded-md text-xs font-medium text-slate-400 hover:text-slate-200 transition-colors";
      });
      btn.className =
        "view-mode-btn active py-1 px-2.5 rounded-md text-xs font-medium bg-surface-elevated text-slate-100 transition-colors";

      dom.readerSplitContainer.classList.remove("view-split", "view-script", "view-pdf");
      dom.readerSplitContainer.classList.add(`view-${btn.dataset.view}`);
      renderPdfPageCanvas(state.currentPage);
    });
  });

  // Cambio de página unido al audio, sin forzar scroll
  dom.btnPrevPageTop.addEventListener("click", () => goToPage(state.currentPage - 1, 0, state.isPlaying));
  dom.btnNextPageTop.addEventListener("click", () => goToPage(state.currentPage + 1, 0, state.isPlaying));

  dom.btnPlayPause.addEventListener("click", () => togglePlayPause());
  dom.btnPrevSentence.addEventListener("click", () => stepSentence(-1));
  dom.btnNextSentence.addEventListener("click", () => stepSentence(1));

  dom.voiceSelect.addEventListener("change", () => {
    state.selectedVoice = dom.voiceSelect.value;
    state.audioBlobCache.clear();
    saveReadingProgress();
    if (state.isPlaying) playCurrentSentence();
  });

  dom.speedSelect.addEventListener("change", () => {
    state.playbackSpeed = parseFloat(dom.speedSelect.value) || 1.0;
    state.audioBlobCache.clear();
    highlightActiveSentence();
    saveReadingProgress();
    if (state.isPlaying) playCurrentSentence();
  });

  if (dom.sleepTimerSelect) {
    dom.sleepTimerSelect.addEventListener("change", handleSleepTimerChange);
  }

  if (dom.btnFontDec) {
    dom.btnFontDec.addEventListener("click", () => changeFontSize(-1));
  }
  if (dom.btnFontInc) {
    dom.btnFontInc.addEventListener("click", () => changeFontSize(1));
  }
  if (dom.scriptSearchInput) {
    dom.scriptSearchInput.addEventListener("input", handleSearchInput);
  }

  window.addEventListener("keydown", (e) => {
    if (!state.docData) return;
    const tag = document.activeElement?.tagName?.toLowerCase();
    if (tag === "input" || tag === "select" || tag === "textarea") return;

    if (e.code === "Space") {
      e.preventDefault();
      togglePlayPause();
    } else if (e.code === "ArrowRight") {
      e.preventDefault();
      stepSentence(1);
    } else if (e.code === "ArrowLeft") {
      e.preventDefault();
      stepSentence(-1);
    }
  });

  const btnWatchAdUnlock = document.getElementById("btnWatchAdUnlock");
  if (btnWatchAdUnlock && window.VoxAdManager) {
    btnWatchAdUnlock.addEventListener("click", () => {
      window.VoxAdManager.requestRewardedUnlock();
    });
  }

  // Navegación inferior móvil (< 1024px)
  document.querySelectorAll(".mobile-nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      switchMobileScreen(btn.dataset.mobilePanel);
    });
  });
}

function switchMobileScreen(panelName) {
  const showSidebar = panelName === "sidebar";
  document.querySelectorAll(".mobile-nav-btn").forEach((b) => {
    const isActive = b.dataset.mobilePanel === panelName;
    b.className = isActive
      ? "mobile-nav-btn flex flex-col items-center justify-center min-w-[44px] min-h-[44px] px-4 text-accent-light font-medium transition-colors"
      : "mobile-nav-btn flex flex-col items-center justify-center min-w-[44px] min-h-[44px] px-4 text-slate-400 transition-colors";
  });

  if (showSidebar) {
    dom.screenChaptersCleaning.classList.remove("hidden");
    dom.screenChaptersCleaning.classList.add("flex");
    dom.screenReaderAudio.classList.add("hidden");
    dom.screenReaderAudio.classList.remove("flex");
    dom.screenReaderAudio.classList.add("lg:flex");
  } else {
    dom.screenChaptersCleaning.classList.add("hidden");
    dom.screenChaptersCleaning.classList.remove("flex");
    dom.screenChaptersCleaning.classList.add("lg:flex");
    dom.screenReaderAudio.classList.remove("hidden");
    dom.screenReaderAudio.classList.add("flex");
  }
}

async function handleUploadFile(file, keepPosition = false) {
  stopPlayback();
  state.rawFile = file;
  state.audioBlobCache.clear();

  dom.nowPlayingSentence.textContent = "Procesando documento PDF...";

  try {
    const arrayBuffer = await file.arrayBuffer();
    let parsed;

    if (state.backendAvailable) {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("remove_headers_footers", dom.chkRemoveHeaders.checked);
      formData.append("remove_page_numbers", dom.chkRemovePageNums.checked);
      formData.append("fix_line_breaks", dom.chkFixLineBreaks.checked);
      formData.append("split_by_commas", dom.chkSplitByCommas ? dom.chkSplitByCommas.checked : true);
      formData.append("remove_academic_citations", dom.chkRemoveCitations ? dom.chkRemoveCitations.checked : true);

      const res = await fetch("./api/pdf/parse", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "No se pudo procesar el PDF");
      }
      parsed = await res.json();
    } else {
      parsed = await parsePdfClientSide(arrayBuffer, file.name, {
        removeHeaders: dom.chkRemoveHeaders.checked,
        removePageNums: dom.chkRemovePageNums.checked,
        fixLineBreaks: dom.chkFixLineBreaks.checked,
        splitByCommas: dom.chkSplitByCommas ? dom.chkSplitByCommas.checked : true,
        removeAcademicCitations: dom.chkRemoveCitations ? dom.chkRemoveCitations.checked : true,
      });
    }

    await savePdfToLocalDb(file, arrayBuffer, parsed);
    await initializeDocument(parsed, arrayBuffer, keepPosition, false);
  } catch (err) {
    alert(`Error: ${err.message}`);
    dom.nowPlayingSentence.textContent = "Error al cargar el documento.";
  }
}

async function parsePdfClientSide(arrayBuffer, filename, options) {
  const loadingTask = window.pdfjsLib.getDocument({ data: arrayBuffer.slice(0), isEvalSupported: false });
  const pdf = await loadingTask.promise;
  const totalPages = pdf.numPages;

  let removedPageNums = 0;
  let totalSentences = 0;
  let totalWords = 0;
  const pages = [];
  const pageNumRegex = /^\s*(?:p[áa]gina|p[áa]g\.?|page)?\s*\d+\s*(?:(?:de|of|\/|-)\s*\d+)?\s*$/i;

  for (let p = 1; p <= totalPages; p++) {
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale: 1.0 });
    const textContent = await page.getTextContent();

    const lines = [];
    for (const item of textContent.items) {
      const str = (item.str || "").trim();
      if (!str) continue;
      const y = viewport.height - item.transform[5];
      const inMargin = y < viewport.height * 0.09 || y > viewport.height * 0.91;

      if (options.removePageNums && inMargin && pageNumRegex.test(str)) {
        removedPageNums++;
        continue;
      }
      lines.push(str);
    }

    let fullText = lines.join(" ");
    if (options.fixLineBreaks) {
      fullText = fullText.replace(/([A-Za-zÁÉÍÓÚáéíóúÑñ]{2,})-\s+([a-záéíóúñ]{2,})/g, "$1$2");
      // Despaciado de títulos tipográficos (p. ej. "A R C O  I :  L A   F O R J A" -> "ARCO I : LA FORJA")
      fullText = fullText.replace(/(?<=\b[A-Za-zÁÉÍÓÚÑa-záéíóúñ]\b) (?=\b[A-Za-zÁÉÍÓÚÑa-záéíóúñ]\b)/g, "");
      fullText = fullText.replace(/\s{2,}/g, " ");
    }
    if (options.removeAcademicCitations) {
      // Eliminar citas numéricas tipo [1], [14, 21, 28]
      fullText = fullText.replace(/\s*\[\s*\d+(?:\s*[,–-]\s*\d+)*\s*\]/g, "");
    }

    const abbrRegex = /^(?:p[áa]g|p[áa]gs|cap|caps|art|arts|dr|dra|sr|sra|prof|ing|lic|ej|fig|figs|vs|no|n[úu]m)\.$/i;
    const splitPattern = options.splitByCommas !== false
      ? /(?<=[.!?…])\s+|(?<!\d)(?<=[,;:])\s+/
      : /(?<=[.!?…])\s+/;

    const rawParts = fullText.split(splitPattern).map((s) => s.trim()).filter(Boolean);
    const rawSentences = [];
    let clauseBuf = "";

    for (const piece of rawParts) {
      if (clauseBuf) {
        const words = clauseBuf.split(/\s+/);
        const lastWord = words[words.length - 1] || "";
        if (abbrRegex.test(lastWord)) {
          clauseBuf += " " + piece;
          continue;
        }
        rawSentences.push(clauseBuf);
        clauseBuf = piece;
      } else {
        clauseBuf = piece;
      }
    }
    if (clauseBuf) rawSentences.push(clauseBuf);

    const pageSentences = rawSentences.map((sText, idx) => ({
      id: `p${p}_s${idx}`,
      page_number: p,
      sentence_index: idx,
      paragraph_index: Math.floor(idx / 3),
      text: sText,
      bbox: [0.08, 0.12, 0.92, 0.85],
    }));

    const wordsInPage = fullText ? fullText.split(/\s+/).length : 0;
    totalSentences += pageSentences.length;
    totalWords += wordsInPage;

    pages.push({
      page_number: p,
      paragraphs: fullText ? [fullText] : [],
      sentences: pageSentences,
      word_count: wordsInPage,
    });
  }

  let chapters = [];
  try {
    const outline = await pdf.getOutline();
    if (outline && outline.length > 0) {
      for (let i = 0; i < outline.length; i++) {
        const item = outline[i];
        let pageNum = 1;
        if (item.dest) {
          const dest = typeof item.dest === "string" ? await pdf.getDestination(item.dest) : item.dest;
          if (dest && dest[0]) {
            const pageIndex = await pdf.getPageIndex(dest[0]);
            pageNum = pageIndex + 1;
          }
        }
        chapters.push({
          id: `ch_${i + 1}`,
          level: 1,
          title: item.title || `Capítulo ${i + 1}`,
          page_number: pageNum,
        });
      }
    }
  } catch (_) {}

  // Heurística de detección si no hay marcadores
  if (chapters.length === 0) {
    const chapterHeadingRegex = /^\s*(?:cap[íi]tulo|cap\.|acto|secci[óo]n|parte|arco|libro)\s+([0-9ivxlcdm]+|[a-záéíóúñ]+)/i;
    pages.forEach((pg) => {
      const firstSentence = pg.sentences?.[0]?.text || "";
      if (chapterHeadingRegex.test(firstSentence)) {
        chapters.push({
          id: `ch_${chapters.length + 1}`,
          level: 1,
          title: firstSentence.slice(0, 48),
          page_number: pg.page_number,
        });
      }
    });
  }

  if (chapters.length === 0) {
    chapters = [{ id: "ch_1", level: 1, title: "Inicio del documento", page_number: 1 }];
  }

  return {
    doc_id: `${filename}_${arrayBuffer.byteLength}`,
    filename,
    title: filename.replace(/\.pdf$/i, ""),
    author: "",
    total_pages: totalPages,
    total_sentences: totalSentences,
    total_words: totalWords,
    estimated_duration_minutes: Math.round((totalWords / 155) * 10) / 10,
    cleaning_stats: {
      removed_headers_footers: 0,
      removed_page_numbers: removedPageNums,
      fix_line_breaks: options.fixLineBreaks,
    },
    chapters,
    pages,
  };
}

async function initializeDocument(parsed, pdfArrayBuffer, keepPosition = false, autoRestore = false) {
  state.docData = parsed;

  if (window.pdfjsLib && pdfArrayBuffer) {
    try {
      const loadingTask = window.pdfjsLib.getDocument({ data: pdfArrayBuffer.slice(0), isEvalSupported: false });
      state.pdfJsDoc = await loadingTask.promise;
    } catch (e) {
      console.warn("Advertencia PDF.js:", e);
      state.pdfJsDoc = null;
    }
  }

  dom.emptyStateDropzone.classList.add("hidden");
  dom.readerSplitContainer.classList.remove("hidden");
  if (dom.btnClearSavedPdf) dom.btnClearSavedPdf.classList.remove("hidden");

  const sizeMb = state.rawFile ? `${(state.rawFile.size / (1024 * 1024)).toFixed(1)} MB` : "PDF";
  dom.docTitleText.textContent = parsed.title;
  dom.docTitleText.title = parsed.title;
  dom.docMetaText.textContent = sizeMb;
  dom.pdfHeaderDocName.textContent = parsed.filename;
  dom.docDurationBadge.textContent = `~${parsed.estimated_duration_minutes} min`;
  dom.statPages.textContent = parsed.total_pages;
  if (dom.statSentences) dom.statSentences.textContent = parsed.total_sentences.toLocaleString();
  dom.statWords.textContent = parsed.total_words.toLocaleString();
  dom.totalPagesLabel.textContent = parsed.total_pages;

  dom.countHeadersRemoved.textContent = parsed.cleaning_stats?.removed_headers_footers ?? 0;
  dom.countPageNumsRemoved.textContent = parsed.cleaning_stats?.removed_page_numbers ?? 0;

  dom.btnPlayPause.disabled = false;
  dom.btnPrevSentence.disabled = false;
  dom.btnNextSentence.disabled = false;

  renderChaptersAndPages();

  // Si se está restaurando automáticamente desde IndexedDB, recuperar página y oración directamente
  const savedProgress = getSavedProgressObject(parsed.doc_id);
  if (autoRestore && savedProgress) {
    if (savedProgress.speed) {
      state.playbackSpeed = parseFloat(savedProgress.speed) || 1.0;
      dom.speedSelect.value = String(state.playbackSpeed);
    }
    if (savedProgress.voice && Array.from(dom.voiceSelect.options).some((o) => o.value === savedProgress.voice)) {
      state.selectedVoice = savedProgress.voice;
      dom.voiceSelect.value = savedProgress.voice;
    }
    await goToPage(savedProgress.page || 1, savedProgress.sentence || 0, false);
    return;
  }

  const targetPage = keepPosition ? Math.min(state.currentPage, parsed.total_pages) : 1;
  const targetSentence = keepPosition ? state.currentSentenceIdx : 0;
  await goToPage(targetPage, targetSentence, false);

  if (!keepPosition) {
    checkSavedProgress(parsed.doc_id);
  }
}

function createChapterItemContent(chapter, index) {
  const left = document.createElement("div");
  left.className = "flex items-center gap-2.5 min-w-0";

  const indexLabel = document.createElement("span");
  indexLabel.className = "chapter-idx font-mono text-[11px] text-slate-500 flex-shrink-0";
  indexLabel.textContent = String(index + 1).padStart(2, "0");

  const title = document.createElement("span");
  title.className = "chapter-title-text text-xs text-slate-200 font-medium truncate";
  title.textContent = chapter.title; // texto plano: el título viene del PDF y nunca debe interpretarse como HTML

  left.append(indexLabel, title);

  const pageLabel = document.createElement("span");
  pageLabel.className = "font-mono text-[11px] text-slate-400 flex-shrink-0";
  pageLabel.textContent = `p. ${chapter.page_number}`;

  return [left, pageLabel];
}

function renderChaptersAndPages() {
  const { chapters, total_pages } = state.docData;

  if (dom.chapterCountLabel) {
    dom.chapterCountLabel.textContent = `${chapters.length} ${chapters.length === 1 ? "sección" : "secciones"}`;
  }

  dom.chapterList.innerHTML = "";
  chapters.forEach((ch, idx) => {
    const nextChPage = chapters[idx + 1] ? chapters[idx + 1].page_number - 1 : total_pages;
    const endPage = Math.max(ch.page_number, nextChPage);

    const li = document.createElement("li");
    li.className =
      "chapter-item px-3 py-2.5 rounded-lg bg-bg-base/60 hover:bg-surface-elevated border border-transparent flex items-center justify-between gap-2 cursor-pointer transition-colors";
    li.dataset.page = ch.page_number;
    li.dataset.endPage = endPage;
    li.dataset.title = ch.title;

    li.replaceChildren(...createChapterItemContent(ch, idx));

    li.addEventListener("click", () => {
      goToPage(ch.page_number, 0, true);
    });

    dom.chapterList.appendChild(li);
  });

  dom.pageGrid.innerHTML = "";
  for (let p = 1; p <= total_pages; p++) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className =
      "page-pill py-1.5 rounded-md bg-bg-base hover:bg-surface-elevated border border-white/[0.05] text-slate-300 font-mono text-xs transition-colors";
    btn.dataset.page = p;
    btn.textContent = p;
    btn.addEventListener("click", () => {
      goToPage(p, 0, state.isPlaying);
    });
    dom.pageGrid.appendChild(btn);
  }
}

function findChapterForPage(pageNum) {
  if (!state.docData?.chapters?.length) return null;
  let active = state.docData.chapters[0];
  for (const ch of state.docData.chapters) {
    if (ch.page_number <= pageNum) {
      active = ch;
    }
  }
  return active;
}

function getFontSizeClasses() {
  switch (state.fontSizeLevel) {
    case "compact":
      return { text: "text-xs", pad: "px-3 py-1.5", tag: "text-[10px]" };
    case "large":
      return { text: "text-base", pad: "px-4 py-3", tag: "text-xs" };
    case "normal":
    default:
      return { text: "text-sm", pad: "px-3.5 py-2", tag: "text-[11px]" };
  }
}

function escapeHtml(str) {
  return String(str || "").replace(/[&<>"']/g, (m) => {
    switch (m) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      case "'": return "&#39;";
      default: return m;
    }
  });
}

function escapeRegex(str) {
  return String(str || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatSentenceWithSearch(text) {
  const safeText = escapeHtml(text);
  if (!state.scriptSearchQuery) return safeText;
  try {
    const regex = new RegExp(`(${escapeRegex(state.scriptSearchQuery)})`, "gi");
    return safeText.replace(regex, `<mark class="bg-amber-400/30 text-amber-200 px-0.5 rounded font-semibold">$1</mark>`);
  } catch (_) {
    return safeText;
  }
}

function applySearchFilter() {
  const q = state.scriptSearchQuery;
  const cards = dom.sentencesContainer.querySelectorAll("[data-sentence-index]");
  const pageObj = state.docData?.pages?.[state.currentPage - 1];
  const sentences = pageObj?.sentences || [];

  cards.forEach((card) => {
    const idx = parseInt(card.dataset.sentenceIndex, 10);
    const s = sentences[idx];
    if (!s) return;
    if (!q) {
      card.classList.remove("hidden");
    } else {
      const match = s.text.toLowerCase().includes(q);
      card.classList.toggle("hidden", !match);
    }
  });
}

function handleSearchInput(e) {
  state.scriptSearchQuery = (e.target.value || "").trim().toLowerCase();
  highlightActiveSentence();
}

function changeFontSize(delta) {
  const levels = ["compact", "normal", "large"];
  let idx = levels.indexOf(state.fontSizeLevel);
  if (idx === -1) idx = 1;
  const nextIdx = Math.max(0, Math.min(levels.length - 1, idx + delta));
  state.fontSizeLevel = levels[nextIdx];
  try {
    localStorage.setItem("voxpdf_font_size", state.fontSizeLevel);
  } catch (_) {}
  highlightActiveSentence();
}

function handleSleepTimerChange() {
  const mode = dom.sleepTimerSelect.value;
  state.sleepTimerMode = mode;
  if (state.sleepTimerIntervalId) {
    clearInterval(state.sleepTimerIntervalId);
    state.sleepTimerIntervalId = null;
  }
  state.sleepTimerEndTime = null;

  if (mode === "0") {
    if (dom.sleepTimerBadge) {
      dom.sleepTimerBadge.classList.add("hidden");
      dom.sleepTimerBadge.textContent = "";
    }
    return;
  }

  if (mode === "chapter") {
    if (dom.sleepTimerBadge) {
      dom.sleepTimerBadge.classList.remove("hidden");
      dom.sleepTimerBadge.textContent = "Fin Cap.";
    }
    return;
  }

  const minutes = parseInt(mode, 10);
  if (!isNaN(minutes) && minutes > 0) {
    state.sleepTimerEndTime = Date.now() + minutes * 60 * 1000;
    if (dom.sleepTimerBadge) {
      dom.sleepTimerBadge.classList.remove("hidden");
    }
    updateSleepTimerDisplay();
    state.sleepTimerIntervalId = setInterval(updateSleepTimerDisplay, 1000);
  }
}

function updateSleepTimerDisplay() {
  if (!state.sleepTimerEndTime) return;
  const diffMs = state.sleepTimerEndTime - Date.now();
  if (diffMs <= 0) {
    if (state.sleepTimerIntervalId) {
      clearInterval(state.sleepTimerIntervalId);
      state.sleepTimerIntervalId = null;
    }
    state.sleepTimerMode = "0";
    state.sleepTimerEndTime = null;
    if (dom.sleepTimerSelect) dom.sleepTimerSelect.value = "0";
    if (dom.sleepTimerBadge) {
      dom.sleepTimerBadge.classList.add("hidden");
      dom.sleepTimerBadge.textContent = "";
    }
    stopPlayback();
    dom.nowPlayingSentence.textContent = "Temporizador de sueño: Reproducción pausada.";
    return;
  }

  const totalSeconds = Math.ceil(diffMs / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  if (dom.sleepTimerBadge) {
    dom.sleepTimerBadge.textContent = `${m}:${String(s).padStart(2, "0")}`;
  }
}

/**
 * Cambia de página y sincroniza capítulo y audio preservando la posición de scroll de la ventana.
 */
async function goToPage(pageNumber, sentenceIndex = 0, autoPlay = false) {
  if (!state.docData) return;
  const savedWindowScrollY = window.scrollY;
  const total = state.docData.total_pages;
  const clampedPage = Math.max(1, Math.min(total, pageNumber));

  const prevChapter = findChapterForPage(state.currentPage);
  const pageChanged = state.currentPage !== clampedPage || dom.sentencesContainer.children.length === 0;
  state.currentPage = clampedPage;

  const newChapter = findChapterForPage(clampedPage);
  if (
    pageChanged &&
    state.sleepTimerMode === "chapter" &&
    state.isPlaying &&
    prevChapter &&
    newChapter &&
    prevChapter.id !== newChapter.id
  ) {
    stopPlayback();
    state.sleepTimerMode = "0";
    if (dom.sleepTimerSelect) dom.sleepTimerSelect.value = "0";
    if (dom.sleepTimerBadge) {
      dom.sleepTimerBadge.classList.add("hidden");
      dom.sleepTimerBadge.textContent = "";
    }
    dom.nowPlayingSentence.textContent = "Temporizador de sueño: Fin de capítulo alcanzado.";
    autoPlay = false;
  }

  const pageObj = state.docData.pages[clampedPage - 1];
  const sentences = pageObj?.sentences || [];
  state.currentSentenceIdx = Math.max(0, Math.min(Math.max(0, sentences.length - 1), sentenceIndex));

  dom.currentPageLabel.textContent = clampedPage;
  dom.btnPrevPageTop.disabled = clampedPage <= 1;
  dom.btnNextPageTop.disabled = clampedPage >= total;

  document.querySelectorAll(".page-pill").forEach((el) => {
    const isCurrent = parseInt(el.dataset.page, 10) === clampedPage;
    el.className = isCurrent
      ? "page-pill py-1.5 rounded-md bg-accent text-white font-mono text-xs font-medium"
      : "page-pill py-1.5 rounded-md bg-bg-base hover:bg-surface-elevated border border-white/[0.05] text-slate-300 font-mono text-xs transition-colors";
  });

  if (pageChanged) {
    renderPageScript(pageObj);
    await renderPdfPageCanvas(clampedPage);
  }

  highlightActiveSentence();
  saveReadingProgress();

  if (Math.abs(window.scrollY - savedWindowScrollY) > 2) {
    window.scrollTo({ top: savedWindowScrollY, behavior: "instant" });
  }

  if (autoPlay) {
    playCurrentSentence();
  }
}

function renderPageScript(pageObj) {
  dom.sentencesContainer.innerHTML = "";
  const sentences = pageObj?.sentences || [];

  if (sentences.length === 0) {
    dom.sentencesContainer.innerHTML = `
      <div class="p-4 rounded-lg bg-bg-base/50 text-center text-xs text-slate-400">
        Esta página no contiene texto legible tras filtrar márgenes.
      </div>
    `;
    return;
  }

  sentences.forEach((s) => {
    const card = document.createElement("div");
    card.id = `sentence-node-${s.sentence_index}`;
    card.dataset.sentenceIndex = s.sentence_index;
    card.addEventListener("click", () => {
      state.currentSentenceIdx = s.sentence_index;
      highlightActiveSentence();
      saveReadingProgress();
      playCurrentSentence();
    });
    dom.sentencesContainer.appendChild(card);
  });
}

function highlightActiveSentence() {
  if (!state.docData) return;
  const pageObj = state.docData.pages?.[state.currentPage - 1];
  const sentences = pageObj?.sentences || [];
  const totalInPage = sentences.length;
  const idx = state.currentSentenceIdx;
  const fontStyle = getFontSizeClasses();

  sentences.forEach((s, sIdx) => {
    const node = document.getElementById(`sentence-node-${sIdx}`);
    if (!node) return;
    const numTag = String(sIdx + 1).padStart(2, "0");
    const formattedText = formatSentenceWithSearch(s.text);

    if (sIdx === idx) {
      node.className =
        `${fontStyle.pad} rounded-lg bg-accent/[0.1] border-l-2 border-accent-light flex items-start gap-3 cursor-pointer transition-colors`;
      node.innerHTML = `
        <span class="font-mono ${fontStyle.tag} text-accent-light mt-0.5 select-none">${numTag}</span>
        <p class="${fontStyle.text} text-slate-100 leading-relaxed font-medium">${formattedText}</p>
      `;
    } else if (sIdx < idx) {
      node.className =
        `${fontStyle.pad} rounded-lg hover:bg-surface-elevated/60 flex items-start gap-3 cursor-pointer opacity-55 hover:opacity-90 transition-all`;
      node.innerHTML = `
        <span class="font-mono ${fontStyle.tag} text-slate-500 mt-0.5 select-none">${numTag}</span>
        <p class="${fontStyle.text} text-slate-300 leading-relaxed">${formattedText}</p>
      `;
    } else {
      node.className =
        `${fontStyle.pad} rounded-lg hover:bg-surface-elevated/60 flex items-start gap-3 cursor-pointer transition-colors`;
      node.innerHTML = `
        <span class="font-mono ${fontStyle.tag} text-slate-500 mt-0.5 select-none">${numTag}</span>
        <p class="${fontStyle.text} text-slate-200 leading-relaxed">${formattedText}</p>
      `;
    }
  });

  applySearchFilter();

  const currentSentenceObj = sentences[idx];
  if (currentSentenceObj) {
    dom.nowPlayingSentence.textContent = currentSentenceObj.text;
    dom.sentenceCounterLabel.textContent = `Oración ${idx + 1} de ${totalInPage}`;
    const pagePct = totalInPage > 0 ? Math.round(((idx + 1) / totalInPage) * 100) : 0;
    dom.pageProgressFill.style.width = `${pagePct}%`;
  } else {
    dom.nowPlayingSentence.textContent = "Página sin texto.";
    dom.sentenceCounterLabel.textContent = "0 / 0";
    dom.pageProgressFill.style.width = "0%";
  }

  let readBeforePage = 0;
  for (let i = 0; i < state.currentPage - 1; i++) {
    readBeforePage += state.docData.pages[i]?.sentences?.length || 0;
  }
  const globalIdx = readBeforePage + idx + 1;
  const globalTotal = Math.max(1, state.docData.total_sentences);
  const bookPct = Math.min(100, Math.round((globalIdx / globalTotal) * 100));
  dom.bookProgressPct.textContent = `${bookPct}%`;
  if (dom.bookProgressBarFill) {
    dom.bookProgressBarFill.style.width = `${bookPct}%`;
  }

  let activeChapterPage = 1;
  let activeChapterTitle = state.docData.title;
  for (const ch of state.docData.chapters) {
    if (ch.page_number <= state.currentPage) {
      activeChapterPage = ch.page_number;
      activeChapterTitle = ch.title;
    }
  }
  if (dom.playerChapterLabel) {
    dom.playerChapterLabel.textContent = `${activeChapterTitle} · Pág. ${state.currentPage}`;
  }

  document.querySelectorAll(".chapter-item").forEach((el) => {
    const chStart = parseInt(el.dataset.page, 10);
    const isCurrent = chStart === activeChapterPage;
    el.className = isCurrent
      ? "chapter-item px-3 py-2.5 rounded-lg bg-accent/15 border border-accent/30 flex items-center justify-between gap-2 cursor-pointer transition-colors"
      : "chapter-item px-3 py-2.5 rounded-lg bg-bg-base/60 hover:bg-surface-elevated border border-transparent flex items-center justify-between gap-2 cursor-pointer transition-colors";
  });

  updatePdfHighlightBox();
  updateMediaSession();
}

async function renderPdfPageCanvas(pageNumber) {
  if (!state.pdfJsDoc) return;
  try {
    if (state.pdfRenderTask) {
      try {
        state.pdfRenderTask.cancel();
      } catch (_) {}
      state.pdfRenderTask = null;
    }

    const page = await state.pdfJsDoc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1.1 });
    const canvas = dom.pdfCanvas;
    const ctx = canvas.getContext("2d");
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    const renderTask = page.render({ canvasContext: ctx, viewport });
    state.pdfRenderTask = renderTask;
    await renderTask.promise;
    state.pdfRenderTask = null;
    updatePdfHighlightBox();
  } catch (err) {
    if (err?.name !== "RenderingCancelledException") {
      console.warn("No se pudo renderizar el canvas PDF:", err);
    }
  }
}

function updatePdfHighlightBox() {
  const pageObj = state.docData?.pages?.[state.currentPage - 1];
  const currentSentence = pageObj?.sentences?.[state.currentSentenceIdx];
  if (!currentSentence || !currentSentence.bbox) {
    dom.pdfHighlightBox.classList.add("hidden");
    return;
  }

  const [x0, y0, x1, y1] = currentSentence.bbox;
  dom.pdfHighlightBox.classList.remove("hidden");
  dom.pdfHighlightBox.style.left = `${(x0 * 100).toFixed(2)}%`;
  dom.pdfHighlightBox.style.top = `${(y0 * 100).toFixed(2)}%`;
  dom.pdfHighlightBox.style.width = `${((x1 - x0) * 100).toFixed(2)}%`;
  dom.pdfHighlightBox.style.height = `${((y1 - y0) * 100).toFixed(2)}%`;
}

function setupMediaSession() {
  if (!("mediaSession" in navigator)) return;

  const actions = [
    ["play", () => { if (!state.isPlaying) playCurrentSentence(); }],
    ["pause", () => { if (state.isPlaying) stopPlayback(); }],
    ["previoustrack", () => stepSentence(-1)],
    ["nexttrack", () => stepSentence(1)],
    ["seekbackward", () => stepSentence(-1)],
    ["seekforward", () => stepSentence(1)],
    ["stop", () => stopPlayback()],
  ];

  for (const [action, handler] of actions) {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch (_) {}
  }
}

function updateMediaSession() {
  if (!("mediaSession" in navigator) || !state.docData) return;

  const pageObj = state.docData.pages?.[state.currentPage - 1];
  const currentSentence = pageObj?.sentences?.[state.currentSentenceIdx];
  const sentenceText = currentSentence?.text || state.docData.title || "Lectura en curso";

  let activeChapterTitle = state.docData.title;
  for (const ch of state.docData.chapters) {
    if (ch.page_number <= state.currentPage) {
      activeChapterTitle = ch.title;
    }
  }

  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: sentenceText,
      artist: `${activeChapterTitle} · Pág. ${state.currentPage}/${state.docData.total_pages}`,
      album: state.docData.title,
      artwork: [
        { src: "./icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "./icon-512.png", sizes: "512x512", type: "image/png" },
        { src: "./icon.svg", sizes: "512x512", type: "image/svg+xml" },
      ],
    });
    navigator.mediaSession.playbackState = state.isPlaying ? "playing" : "paused";
  } catch (_) {}
}

function startBackgroundAudioAnchor() {
  if (!dom.bgKeepAliveAudio) return;
  try {
    if (!dom.bgKeepAliveAudio.src) {
      dom.bgKeepAliveAudio.src = SILENT_AUDIO_URI;
      dom.bgKeepAliveAudio.volume = 0.001;
    }
    const p = dom.bgKeepAliveAudio.play();
    if (p !== undefined) {
      p.catch(() => {});
    }
  } catch (_) {}
}

function stopBackgroundAudioAnchor() {
  if (!dom.bgKeepAliveAudio) return;
  try {
    dom.bgKeepAliveAudio.pause();
  } catch (_) {}
}

async function requestWakeLock() {
  if ("wakeLock" in navigator && !state.wakeLock) {
    try {
      state.wakeLock = await navigator.wakeLock.request("screen");
      state.wakeLock.addEventListener("release", () => {
        state.wakeLock = null;
      });
    } catch (_) {}
  }
}

function releaseWakeLock() {
  if (state.wakeLock) {
    state.wakeLock.release().catch(() => {});
    state.wakeLock = null;
  }
}

function togglePlayPause() {
  if (!state.docData) return;
  if (state.isPlaying) {
    stopPlayback();
  } else {
    playCurrentSentence();
  }
}

function stopPlayback() {
  state.isPlaying = false;
  state.playSessionId++;
  dom.neuralAudioPlayer.pause();
  stopBackgroundAudioAnchor();
  releaseWakeLock();

  if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
  if (state.speechKeepAliveInterval) {
    clearInterval(state.speechKeepAliveInterval);
    state.speechKeepAliveInterval = null;
  }

  updatePlayButtonUI(false);
  highlightActiveSentence();
  updateMediaSession();
}

function updatePlayButtonUI(playing) {
  dom.iconPlay.classList.toggle("hidden", playing);
  dom.iconPause.classList.toggle("hidden", !playing);
  dom.audioVisualizer.classList.toggle("playing", playing);

  if ("mediaSession" in navigator) {
    try {
      navigator.mediaSession.playbackState = playing ? "playing" : "paused";
    } catch (_) {}
  }
}

async function fetchSentenceAudioBlobUrl(text) {
  const cacheKey = `${state.selectedVoice}|${state.playbackSpeed}|${text}`;
  if (state.audioBlobCache.has(cacheKey)) {
    return state.audioBlobCache.get(cacheKey);
  }

  const res = await fetch("./api/tts/speak", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      voice: state.selectedVoice,
      speed: state.playbackSpeed,
    }),
  });

  if (!res.ok) {
    throw new Error("Fallo en síntesis de voz");
  }

  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  state.audioBlobCache.set(cacheKey, blobUrl);
  return blobUrl;
}

function isBrowserSpeechSelected() {
  return !state.backendAvailable || state.selectedVoice === "browser-local" || state.selectedVoice.startsWith("browser:");
}

function prefetchNextSentence() {
  if (!state.docData || isBrowserSpeechSelected()) return;
  const pageObj = state.docData.pages[state.currentPage - 1];
  const sentences = pageObj?.sentences || [];

  // Pre-cargar hasta 2 oraciones para garantizar reproducción ininterrumpida con pantalla bloqueada
  for (let offset = 1; offset <= 2; offset++) {
    const targetIdx = state.currentSentenceIdx + offset;
    if (targetIdx < sentences.length) {
      const nextText = sentences[targetIdx].text;
      fetchSentenceAudioBlobUrl(nextText).catch(() => {});
    } else {
      const nextPageIndex = state.currentPage; // índice base 0 de la página siguiente
      if (nextPageIndex < state.docData.total_pages) {
        const nextPageSentences = state.docData.pages[nextPageIndex]?.sentences || [];
        const nextSentInNextPage = nextPageSentences[targetIdx - sentences.length];
        if (nextSentInNextPage?.text) {
          fetchSentenceAudioBlobUrl(nextSentInNextPage.text).catch(() => {});
        }
      }
    }
  }
}

async function playCurrentSentence() {
  if (!state.docData) return;
  const pageObj = state.docData.pages[state.currentPage - 1];
  const sentences = pageObj?.sentences || [];

  if (sentences.length === 0) {
    if (state.currentPage < state.docData.total_pages) {
      await goToPage(state.currentPage + 1, 0, true);
    } else {
      stopPlayback();
    }
    return;
  }

  const currentSentence = sentences[state.currentSentenceIdx];
  if (!currentSentence) return;

  const sessionId = ++state.playSessionId;
  state.isPlaying = true;
  startBackgroundAudioAnchor();
  requestWakeLock();
  updatePlayButtonUI(true);
  highlightActiveSentence();
  updateMediaSession();
  saveReadingProgress();

  prefetchNextSentence();

  if (isBrowserSpeechSelected()) {
    playWithBrowserSpeech(currentSentence.text, sessionId);
    return;
  }

  try {
    const blobUrl = await fetchSentenceAudioBlobUrl(currentSentence.text);
    if (sessionId !== state.playSessionId || !state.isPlaying) return;

    dom.neuralAudioPlayer.src = blobUrl;
    dom.neuralAudioPlayer.onended = () => {
      if (sessionId === state.playSessionId && state.isPlaying) {
        advanceToNextSentenceAuto();
      }
    };
    await dom.neuralAudioPlayer.play();
  } catch (err) {
    console.warn("Usando voz del navegador como respaldo:", err);
    if (sessionId === state.playSessionId && state.isPlaying) {
      playWithBrowserSpeech(currentSentence.text, sessionId);
    }
  }
}

function playWithBrowserSpeech(text, sessionId) {
  if (!window.speechSynthesis) {
    stopPlayback();
    return;
  }
  window.speechSynthesis.cancel();
  if (state.speechKeepAliveInterval) {
    clearInterval(state.speechKeepAliveInterval);
    state.speechKeepAliveInterval = null;
  }

  const utter = new SpeechSynthesisUtterance(text);
  utter.rate = state.playbackSpeed;

  if (state.selectedVoice.startsWith("browser:")) {
    const targetName = state.selectedVoice.slice("browser:".length);
    const match = window.speechSynthesis.getVoices().find((v) => v.name === targetName);
    if (match) {
      utter.voice = match;
      utter.lang = match.lang;
    }
  } else {
    utter.lang = state.selectedVoice.startsWith("en") ? "en-US" : "es-ES";
  }

  utter.onend = () => {
    if (state.speechKeepAliveInterval) {
      clearInterval(state.speechKeepAliveInterval);
      state.speechKeepAliveInterval = null;
    }
    if (sessionId === state.playSessionId && state.isPlaying) {
      advanceToNextSentenceAuto();
    }
  };

  utter.onerror = (e) => {
    if (state.speechKeepAliveInterval) {
      clearInterval(state.speechKeepAliveInterval);
      state.speechKeepAliveInterval = null;
    }
    console.warn("Speech synthesis notice:", e);
  };

  // Keep-alive para SpeechSynthesis en segundo plano (evita suspensión a los 15s)
  state.speechKeepAliveInterval = setInterval(() => {
    if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
      window.speechSynthesis.pause();
      window.speechSynthesis.resume();
    }
  }, 10000);

  window.speechSynthesis.speak(utter);
}

async function advanceToNextSentenceAuto() {
  if (!state.docData) return;
  const pageObj = state.docData.pages[state.currentPage - 1];
  const sentences = pageObj?.sentences || [];

  if (state.currentSentenceIdx + 1 < sentences.length) {
    state.currentSentenceIdx++;
    await playCurrentSentence();
  } else if (state.currentPage < state.docData.total_pages) {
    await goToPage(state.currentPage + 1, 0, true);
  } else {
    stopPlayback();
    dom.nowPlayingSentence.textContent = "Lectura del documento finalizada.";
  }
}

async function stepSentence(delta) {
  if (!state.docData) return;
  const wasPlaying = state.isPlaying;
  const pageObj = state.docData.pages[state.currentPage - 1];
  const sentences = pageObj?.sentences || [];
  const nextIdx = state.currentSentenceIdx + delta;

  if (nextIdx >= 0 && nextIdx < sentences.length) {
    state.currentSentenceIdx = nextIdx;
    highlightActiveSentence();
    saveReadingProgress();
    if (wasPlaying) playCurrentSentence();
  } else if (nextIdx >= sentences.length && state.currentPage < state.docData.total_pages) {
    await goToPage(state.currentPage + 1, 0, wasPlaying);
  } else if (nextIdx < 0 && state.currentPage > 1) {
    const prevPageSentences = state.docData.pages[state.currentPage - 2]?.sentences || [];
    const lastIdx = Math.max(0, prevPageSentences.length - 1);
    await goToPage(state.currentPage - 1, lastIdx, wasPlaying);
  }
}

function getProgressStorageKey(docId) {
  return `voxpdf_progress_${docId}`;
}

function getSavedProgressObject(docId) {
  try {
    const raw = localStorage.getItem(getProgressStorageKey(docId));
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function saveReadingProgress() {
  if (!state.docData) return;
  const payload = {
    doc_id: state.docData.doc_id,
    page: state.currentPage,
    sentence: state.currentSentenceIdx,
    voice: state.selectedVoice,
    speed: state.playbackSpeed,
    updatedAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem(getProgressStorageKey(state.docData.doc_id), JSON.stringify(payload));
  } catch (_) {}
}

function checkSavedProgress(docId) {
  const saved = getSavedProgressObject(docId);
  if (!saved || (saved.page === 1 && saved.sentence === 0)) {
    dom.resumeBanner.classList.add("hidden");
    return;
  }

  dom.resumeBannerText.textContent = `Continuar desde la página ${saved.page}, oración ${saved.sentence + 1}.`;
  dom.resumeBanner.classList.remove("hidden");

  dom.btnResumeConfirm.onclick = () => {
    dom.resumeBanner.classList.add("hidden");
    goToPage(saved.page, saved.sentence, false);
  };
  dom.btnResumeDismiss.onclick = () => {
    dom.resumeBanner.classList.add("hidden");
    saveReadingProgress();
  };
}
