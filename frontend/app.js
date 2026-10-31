/**
 * VoxPDF Studio - Frontend Controller (Arquitectura Híbrida Python FastAPI + GitHub Pages Live Mode)
 * Desarrollado por Edgar López — Portafolio de Ingeniería Mecatrónica & Desarrollo de Software.
 */

if (window.pdfjsLib) {
  window.pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
}

const state = {
  backendAvailable: true,   // Detectado automáticamente al iniciar (/api/health)
  docData: null,            // Respuesta estructurada del documento
  rawFile: null,            // Archivo File original subido por el usuario
  pdfJsDoc: null,           // Instancia de PDF.js para renderizar páginas
  currentPage: 1,           // Página actual (1-based)
  currentSentenceIdx: 0,    // Índice de oración en la página actual (0-based)
  isPlaying: false,         // Estado de reproducción
  selectedVoice: "es-MX-DaliaNeural",
  playbackSpeed: 1.0,
  audioBlobCache: new Map(), // Caché en memoria de Blobs de audio pre-cargados
  playSessionId: 0,         // Token para cancelar reproducciones anteriores al saltar
};

// Referencias DOM
const dom = {
  pdfFileInput: document.getElementById("pdfFileInput"),
  engineBadge: document.getElementById("engineBadge"),
  engineBadgeText: document.getElementById("engineBadgeText"),
  emptyStateDropzone: document.getElementById("emptyStateDropzone"),
  readerSplitContainer: document.getElementById("readerSplitContainer"),

  // Resumen y limpieza
  docTitleText: document.getElementById("docTitleText"),
  docMetaText: document.getElementById("docMetaText"),
  docDurationBadge: document.getElementById("docDurationBadge"),
  statPages: document.getElementById("statPages"),
  statSentences: document.getElementById("statSentences"),
  statWords: document.getElementById("statWords"),
  chkRemoveHeaders: document.getElementById("chkRemoveHeaders"),
  chkRemovePageNums: document.getElementById("chkRemovePageNums"),
  chkFixLineBreaks: document.getElementById("chkFixLineBreaks"),
  countHeadersRemoved: document.getElementById("countHeadersRemoved"),
  countPageNumsRemoved: document.getElementById("countPageNumsRemoved"),

  // Navegación lateral
  chapterList: document.getElementById("chapterList"),
  pageGrid: document.getElementById("pageGrid"),
  btnPrevPageTop: document.getElementById("btnPrevPageTop"),
  btnNextPageTop: document.getElementById("btnNextPageTop"),
  currentPageLabel: document.getElementById("currentPageLabel"),
  totalPagesLabel: document.getElementById("totalPagesLabel"),
  bookProgressPct: document.getElementById("bookProgressPct"),

  // Visor PDF y Guion
  pdfCanvas: document.getElementById("pdfCanvas"),
  pdfHighlightBox: document.getElementById("pdfHighlightBox"),
  sentencesContainer: document.getElementById("sentencesContainer"),

  // Reproductor inferior
  btnPrevSentence: document.getElementById("btnPrevSentence"),
  btnPlayPause: document.getElementById("btnPlayPause"),
  btnNextSentence: document.getElementById("btnNextSentence"),
  iconPlay: document.getElementById("iconPlay"),
  iconPause: document.getElementById("iconPause"),
  audioVisualizer: document.getElementById("audioVisualizer"),
  nowPlayingSentence: document.getElementById("nowPlayingSentence"),
  sentenceCounterLabel: document.getElementById("sentenceCounterLabel"),
  pageProgressFill: document.getElementById("pageProgressFill"),
  voiceSelect: document.getElementById("voiceSelect"),
  speedSelect: document.getElementById("speedSelect"),
  neuralAudioPlayer: document.getElementById("neuralAudioPlayer"),

  // Banner de progreso guardado
  resumeBanner: document.getElementById("resumeBanner"),
  resumeBannerText: document.getElementById("resumeBannerText"),
  btnResumeConfirm: document.getElementById("btnResumeConfirm"),
  btnResumeDismiss: document.getElementById("btnResumeDismiss"),

  // Exportación MP3
  btnOpenExportModal: document.getElementById("btnOpenExportModal"),
  exportModal: document.getElementById("exportModal"),
  btnCloseExportModal: document.getElementById("btnCloseExportModal"),
  btnCancelExport: document.getElementById("btnCancelExport"),
  btnConfirmExport: document.getElementById("btnConfirmExport"),
  exportStartPage: document.getElementById("exportStartPage"),
  exportEndPage: document.getElementById("exportEndPage"),
  btnRangeCurrentPage: document.getElementById("btnRangeCurrentPage"),
  btnRangeAllPages: document.getElementById("btnRangeAllPages"),
  exportStatusMsg: document.getElementById("exportStatusMsg"),
};

document.addEventListener("DOMContentLoaded", async () => {
  setupEventListeners();
  await detectEnvironmentAndVoices();
  if (window.VoxAdManager) {
    window.VoxAdManager.init();
  }
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
});

async function detectEnvironmentAndVoices() {
  try {
    const healthRes = await fetch("./api/health", { cache: "no-store" });
    if (!healthRes.ok) throw new Error("Static host");
    const voicesRes = await fetch("./api/voices");
    const data = await voicesRes.json();

    state.backendAvailable = true;
    dom.engineBadgeText.textContent = "Motor Python Neuronal Activo";
    dom.voiceSelect.innerHTML = "";
    (data.voices || []).forEach((v) => {
      const opt = document.createElement("option");
      opt.value = v.id;
      opt.textContent = `${v.name} · ${v.badge}`;
      dom.voiceSelect.appendChild(opt);
    });

    const browserOpt = document.createElement("option");
    browserOpt.value = "browser-local";
    browserOpt.textContent = "Voz del Sistema (Offline / Navegador)";
    dom.voiceSelect.appendChild(browserOpt);
  } catch (_) {
    // Modo Web en Vivo (GitHub Pages sin servidor Python activo)
    state.backendAvailable = false;
    state.selectedVoice = "browser-local";
    dom.engineBadgeText.textContent = "Modo Web Live (PDF.js + Web Speech)";
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
    opt.textContent = "Voz del Navegador (Español / Inglés)";
    dom.voiceSelect.appendChild(opt);
    return;
  }

  list.forEach((v) => {
    const opt = document.createElement("option");
    opt.value = `browser:${v.name}`;
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

  [dom.chkRemoveHeaders, dom.chkRemovePageNums, dom.chkFixLineBreaks].forEach((chk) => {
    chk.addEventListener("change", () => {
      if (!state.docData || !state.rawFile) return;
      stopPlayback();
      handleUploadFile(state.rawFile, true);
    });
  });

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));
      btn.classList.add("active");
      const target = btn.dataset.tab === "chapters" ? "tabChapters" : "tabPages";
      document.getElementById(target).classList.add("active");
    });
  });

  document.querySelectorAll(".view-mode-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".view-mode-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      dom.readerSplitContainer.classList.remove("view-split", "view-script", "view-pdf");
      dom.readerSplitContainer.classList.add(`view-${btn.dataset.view}`);
      renderPdfPageCanvas(state.currentPage);
    });
  });

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
    saveReadingProgress();
    if (state.isPlaying) playCurrentSentence();
  });

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

  dom.btnOpenExportModal.addEventListener("click", openExportModal);
  dom.btnCloseExportModal.addEventListener("click", closeExportModal);
  dom.btnCancelExport.addEventListener("click", closeExportModal);
  dom.btnRangeCurrentPage.addEventListener("click", () => {
    dom.exportStartPage.value = state.currentPage;
    dom.exportEndPage.value = state.currentPage;
  });
  dom.btnRangeAllPages.addEventListener("click", () => {
    if (!state.docData) return;
    dom.exportStartPage.value = 1;
    dom.exportEndPage.value = state.docData.total_pages;
  });
  dom.btnConfirmExport.addEventListener("click", handleExportMp3);

  // Botón de desbloqueo de Pase Neuronal / MP3 mediante Anuncio Recompensado
  const btnWatchAdUnlock = document.getElementById("btnWatchAdUnlock");
  if (btnWatchAdUnlock && window.VoxAdManager) {
    btnWatchAdUnlock.addEventListener("click", () => {
      window.VoxAdManager.requestRewardedUnlock();
    });
  }

  // Navegación inferior móvil (App Android / Pantallas táctiles)
  const workspaceEl = document.querySelector(".workspace");
  document.querySelectorAll(".mobile-nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".mobile-nav-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      if (workspaceEl) {
        workspaceEl.classList.toggle("mobile-show-sidebar", btn.dataset.mobilePanel === "sidebar");
      }
    });
  });
}

async function handleUploadFile(file, keepPosition = false) {
  stopPlayback();
  state.rawFile = file;
  state.audioBlobCache.clear();

  dom.nowPlayingSentence.textContent = "Analizando PDF y aplicando limpieza inteligente...";

  try {
    const arrayBuffer = await file.arrayBuffer();
    let parsed;

    if (state.backendAvailable) {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("remove_headers_footers", dom.chkRemoveHeaders.checked);
      formData.append("remove_page_numbers", dom.chkRemovePageNums.checked);
      formData.append("fix_line_breaks", dom.chkFixLineBreaks.checked);

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
      });
    }

    await initializeDocument(parsed, arrayBuffer, keepPosition);
  } catch (err) {
    alert(`Error: ${err.message}`);
    dom.nowPlayingSentence.textContent = "Error al cargar el documento.";
  }
}

/**
 * Procesador de respaldo en el navegador (PDF.js) cuando se ejecuta en GitHub Pages sin servidor Python.
 */
async function parsePdfClientSide(arrayBuffer, filename, options) {
  const loadingTask = window.pdfjsLib.getDocument({ data: arrayBuffer.slice(0) });
  const pdf = await loadingTask.promise;
  const totalPages = pdf.numPages;

  let removedPageNums = 0;
  let totalSentences = 0;
  let totalWords = 0;
  const pages = [];
  const chapters = [{ id: "ch_1", level: 1, title: "Inicio del documento", page_number: 1 }];
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
    }

    const rawSentences = fullText
      .split(/(?<=[.!?…])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);

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

  return {
    doc_id: `${filename}_${arrayBuffer.byteLength}`,
    filename,
    title: filename.replace(/\.pdf$/i, ""),
    author: "Modo Web PDF.js",
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

async function initializeDocument(parsed, pdfArrayBuffer, keepPosition = false) {
  state.docData = parsed;

  if (window.pdfjsLib && pdfArrayBuffer) {
    try {
      const loadingTask = window.pdfjsLib.getDocument({ data: pdfArrayBuffer.slice(0) });
      state.pdfJsDoc = await loadingTask.promise;
    } catch (e) {
      console.warn("Advertencia PDF.js:", e);
      state.pdfJsDoc = null;
    }
  }

  dom.emptyStateDropzone.classList.add("hidden");
  dom.readerSplitContainer.classList.remove("hidden");

  dom.docTitleText.textContent = parsed.title;
  dom.docMetaText.textContent = `${parsed.filename} · ${parsed.author}`;
  dom.docDurationBadge.textContent = `~${parsed.estimated_duration_minutes} min`;
  dom.statPages.textContent = parsed.total_pages;
  dom.statSentences.textContent = parsed.total_sentences;
  dom.statWords.textContent = parsed.total_words;
  dom.totalPagesLabel.textContent = parsed.total_pages;

  dom.countHeadersRemoved.textContent = parsed.cleaning_stats?.removed_headers_footers ?? 0;
  dom.countPageNumsRemoved.textContent = parsed.cleaning_stats?.removed_page_numbers ?? 0;

  dom.btnPlayPause.disabled = false;
  dom.btnPrevSentence.disabled = false;
  dom.btnNextSentence.disabled = false;
  dom.btnOpenExportModal.disabled = !state.backendAvailable;

  renderChaptersAndPages();

  const targetPage = keepPosition ? Math.min(state.currentPage, parsed.total_pages) : 1;
  const targetSentence = keepPosition ? state.currentSentenceIdx : 0;
  await goToPage(targetPage, targetSentence, false);

  if (!keepPosition) {
    checkSavedProgress(parsed.doc_id);
  }
}

function renderChaptersAndPages() {
  const { chapters, total_pages } = state.docData;

  dom.chapterList.innerHTML = "";
  chapters.forEach((ch) => {
    const li = document.createElement("li");
    li.className = "chapter-item";
    li.dataset.page = ch.page_number;
    li.innerHTML = `
      <span>${ch.title}</span>
      <span class="chapter-page-tag">Pág. ${ch.page_number}</span>
    `;
    li.addEventListener("click", () => goToPage(ch.page_number, 0, state.isPlaying));
    dom.chapterList.appendChild(li);
  });

  dom.pageGrid.innerHTML = "";
  for (let p = 1; p <= total_pages; p++) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "page-pill";
    btn.dataset.page = p;
    btn.textContent = p;
    btn.addEventListener("click", () => goToPage(p, 0, state.isPlaying));
    dom.pageGrid.appendChild(btn);
  }
}

async function goToPage(pageNumber, sentenceIndex = 0, autoPlay = false) {
  if (!state.docData) return;
  const total = state.docData.total_pages;
  const clampedPage = Math.max(1, Math.min(total, pageNumber));

  state.currentPage = clampedPage;
  const pageObj = state.docData.pages[clampedPage - 1];
  const sentences = pageObj?.sentences || [];
  state.currentSentenceIdx = Math.max(0, Math.min(Math.max(0, sentences.length - 1), sentenceIndex));

  dom.currentPageLabel.textContent = clampedPage;
  dom.btnPrevPageTop.disabled = clampedPage <= 1;
  dom.btnNextPageTop.disabled = clampedPage >= total;

  document.querySelectorAll(".page-pill").forEach((el) => {
    el.classList.toggle("active", parseInt(el.dataset.page, 10) === clampedPage);
  });

  let activeChapterPage = 1;
  for (const ch of state.docData.chapters) {
    if (ch.page_number <= clampedPage) activeChapterPage = ch.page_number;
  }
  document.querySelectorAll(".chapter-item").forEach((el) => {
    el.classList.toggle("active", parseInt(el.dataset.page, 10) === activeChapterPage);
  });

  renderPageScript(pageObj);
  await renderPdfPageCanvas(clampedPage);
  highlightActiveSentence();
  saveReadingProgress();

  if (autoPlay) {
    playCurrentSentence();
  }
}

function renderPageScript(pageObj) {
  dom.sentencesContainer.innerHTML = "";
  const sentences = pageObj?.sentences || [];

  if (sentences.length === 0) {
    dom.sentencesContainer.innerHTML = `
      <div class="empty-hint">Esta página no contiene texto legible tras la limpieza inteligente.</div>
    `;
    return;
  }

  const paragraphsMap = new Map();
  sentences.forEach((s) => {
    if (!paragraphsMap.has(s.paragraph_index)) {
      paragraphsMap.set(s.paragraph_index, []);
    }
    paragraphsMap.get(s.paragraph_index).push(s);
  });

  paragraphsMap.forEach((paraSentences, paraIdx) => {
    const pBlock = document.createElement("div");
    pBlock.className = "paragraph-block";
    pBlock.dataset.paragraphIndex = paraIdx;

    paraSentences.forEach((s) => {
      const span = document.createElement("span");
      span.className = "sentence-span";
      span.id = `sentence-node-${s.sentence_index}`;
      span.dataset.sentenceIndex = s.sentence_index;
      span.textContent = s.text + " ";
      span.addEventListener("click", () => {
        state.currentSentenceIdx = s.sentence_index;
        highlightActiveSentence();
        saveReadingProgress();
        playCurrentSentence();
      });
      pBlock.appendChild(span);
    });

    dom.sentencesContainer.appendChild(pBlock);
  });
}

async function renderPdfPageCanvas(pageNumber) {
  if (!state.pdfJsDoc) return;
  try {
    const page = await state.pdfJsDoc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1.15 });
    const canvas = dom.pdfCanvas;
    const ctx = canvas.getContext("2d");
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    await page.render({ canvasContext: ctx, viewport }).promise;
    updatePdfHighlightBox();
  } catch (err) {
    console.warn("No se pudo renderizar el canvas PDF:", err);
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

function highlightActiveSentence() {
  const pageObj = state.docData?.pages?.[state.currentPage - 1];
  const sentences = pageObj?.sentences || [];
  const totalInPage = sentences.length;
  const idx = state.currentSentenceIdx;

  document.querySelectorAll(".sentence-span").forEach((el) => {
    const sIdx = parseInt(el.dataset.sentenceIndex, 10);
    el.classList.toggle("active-sentence", sIdx === idx);
    el.classList.toggle("read-sentence", sIdx < idx);
  });

  const activeNode = document.getElementById(`sentence-node-${idx}`);
  document.querySelectorAll(".paragraph-block").forEach((p) => p.classList.remove("active-paragraph"));
  if (activeNode) {
    activeNode.parentElement?.classList.add("active-paragraph");
    activeNode.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  const currentSentenceObj = sentences[idx];
  if (currentSentenceObj) {
    dom.nowPlayingSentence.textContent = currentSentenceObj.text;
    dom.sentenceCounterLabel.textContent = `${idx + 1} / ${totalInPage}`;
    const pagePct = totalInPage > 0 ? Math.round(((idx + 1) / totalInPage) * 100) : 0;
    dom.pageProgressFill.style.width = `${pagePct}%`;
  } else {
    dom.nowPlayingSentence.textContent = "Página sin texto.";
    dom.sentenceCounterLabel.textContent = "0 / 0";
    dom.pageProgressFill.style.width = "0%";
  }

  if (state.docData) {
    let readBeforePage = 0;
    for (let i = 0; i < state.currentPage - 1; i++) {
      readBeforePage += state.docData.pages[i].sentences.length;
    }
    const globalIdx = readBeforePage + idx + 1;
    const globalTotal = Math.max(1, state.docData.total_sentences);
    const bookPct = Math.min(100, Math.round((globalIdx / globalTotal) * 100));
    dom.bookProgressPct.textContent = `${bookPct}%`;
  }

  updatePdfHighlightBox();
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
  if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
  updatePlayButtonUI(false);
}

function updatePlayButtonUI(playing) {
  dom.iconPlay.classList.toggle("hidden", playing);
  dom.iconPause.classList.toggle("hidden", !playing);
  dom.audioVisualizer.classList.toggle("playing", playing);
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
    throw new Error("Fallo en síntesis neuronal");
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
  const nextIdx = state.currentSentenceIdx + 1;

  if (nextIdx < sentences.length) {
    const nextText = sentences[nextIdx].text;
    fetchSentenceAudioBlobUrl(nextText).catch(() => {});
  } else if (state.currentPage < state.docData.total_pages) {
    const nextPageSentences = state.docData.pages[state.currentPage]?.sentences || [];
    if (nextPageSentences.length > 0) {
      fetchSentenceAudioBlobUrl(nextPageSentences[0].text).catch(() => {});
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
  updatePlayButtonUI(true);
  highlightActiveSentence();
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
    if (sessionId === state.playSessionId && state.isPlaying) {
      advanceToNextSentenceAuto();
    }
  };
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
    dom.nowPlayingSentence.textContent = "🎉 ¡Has terminado de escuchar el documento!";
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
  try {
    const raw = localStorage.getItem(getProgressStorageKey(docId));
    if (!raw) {
      dom.resumeBanner.classList.add("hidden");
      return;
    }
    const saved = JSON.parse(raw);
    if (saved.page === 1 && saved.sentence === 0) {
      dom.resumeBanner.classList.add("hidden");
      return;
    }

    dom.resumeBannerText.textContent = `Guardado automático: te quedaste en la Página ${saved.page}, Oración ${saved.sentence + 1}.`;
    dom.resumeBanner.classList.remove("hidden");

    dom.btnResumeConfirm.onclick = () => {
      dom.resumeBanner.classList.add("hidden");
      goToPage(saved.page, saved.sentence, false);
    };
    dom.btnResumeDismiss.onclick = () => {
      dom.resumeBanner.classList.add("hidden");
      saveReadingProgress();
    };
  } catch (_) {
    dom.resumeBanner.classList.add("hidden");
  }
}

function openExportModal() {
  if (!state.docData) return;
  if (window.VoxAdManager && !window.VoxAdManager.hasNeuralPassActive()) {
    window.VoxAdManager.requestRewardedUnlock(() => {
      openExportModal();
    });
    return;
  }
  dom.exportStartPage.max = state.docData.total_pages;
  dom.exportEndPage.max = state.docData.total_pages;
  dom.exportStartPage.value = state.currentPage;
  dom.exportEndPage.value = state.currentPage;
  dom.exportStatusMsg.classList.add("hidden");
  dom.exportModal.classList.remove("hidden");
}

function closeExportModal() {
  dom.exportModal.classList.add("hidden");
}

async function handleExportMp3() {
  if (!state.docData) return;
  const startPage = Math.max(1, parseInt(dom.exportStartPage.value, 10) || 1);
  const endPage = Math.max(startPage, parseInt(dom.exportEndPage.value, 10) || startPage);

  dom.btnConfirmExport.disabled = true;
  dom.exportStatusMsg.textContent = `Sintetizando audiolibro con voz neuronal (Páginas ${startPage} a ${endPage})...`;
  dom.exportStatusMsg.classList.remove("hidden");

  try {
    const res = await fetch("./api/tts/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        doc_id: state.docData.doc_id,
        start_page: startPage,
        end_page: endPage,
        voice: isBrowserSpeechSelected() ? "es-MX-DaliaNeural" : state.selectedVoice,
        speed: state.playbackSpeed,
        book_title: state.docData.title,
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "No se pudo exportar el MP3");
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${state.docData.title.replace(/[^a-zA-Z0-9_-]/g, "_")}_Pag_${startPage}-${endPage}.mp3`;
    document.body.appendChild(a);
    a.click();
    a.remove();

    dom.exportStatusMsg.textContent = "✓ ¡Audiolibro MP3 generado y descargado con éxito!";
  } catch (err) {
    dom.exportStatusMsg.textContent = `Error: ${err.message}`;
  } finally {
    dom.btnConfirmExport.disabled = false;
  }
}
