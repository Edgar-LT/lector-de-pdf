/**
 * VoxPDF Studio - Frontend Controller (Stitch Kinetic Precision Design System)
 * Arquitectura Híbrida: Python FastAPI + PyMuPDF + Edge-TTS / Modo Web Live PDF.js
 * Navegación libre desacoplada: lectura continua en segundo plano sin scroll ni saltos forzados.
 * Desarrollado por Edgar López.
 */

if (window.pdfjsLib) {
  window.pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
}

const state = {
  backendAvailable: true,
  docData: null,
  rawFile: null,
  pdfJsDoc: null,
  pdfRenderTask: null,
  currentPage: 1, // Página que el usuario está visualizando actualmente
  playingPage: 1, // Página donde va la narración de audio actual
  playingSentenceIdx: 0, // Oración actual dentro de playingPage
  isPlaying: false,
  selectedVoice: "es-MX-DaliaNeural",
  playbackSpeed: 1.0,
  audioBlobCache: new Map(),
  playSessionId: 0,
};

const dom = {
  pdfFileInput: document.getElementById("pdfFileInput"),
  engineBadge: document.getElementById("engineBadge"),
  engineBadgeText: document.getElementById("engineBadgeText"),
  headerScreenSubtitle: document.getElementById("headerScreenSubtitle"),
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
  chkRemoveHeaders: document.getElementById("chkRemoveHeaders"),
  chkRemovePageNums: document.getElementById("chkRemovePageNums"),
  chkFixLineBreaks: document.getElementById("chkFixLineBreaks"),
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

  // Visor PDF y DAW Focus Card
  pdfHeaderDocName: document.getElementById("pdfHeaderDocName"),
  activeParaBadge: document.getElementById("activeParaBadge"),
  activeParaPreviewText: document.getElementById("activeParaPreviewText"),
  pdfCanvas: document.getElementById("pdfCanvas"),
  pdfHighlightBox: document.getElementById("pdfHighlightBox"),
  sentencesContainer: document.getElementById("sentencesContainer"),

  // Reproductor flotante Stitch
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
  neuralAudioPlayer: document.getElementById("neuralAudioPlayer"),

  // Banner progreso guardado
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
    dom.engineBadgeText.textContent = "Python Neural";
    dom.voiceSelect.innerHTML = "";
    (data.voices || []).forEach((v) => {
      const opt = document.createElement("option");
      opt.value = v.id;
      opt.className = "bg-surface-container text-primary";
      opt.textContent = `${v.name}`;
      dom.voiceSelect.appendChild(opt);
    });

    const browserOpt = document.createElement("option");
    browserOpt.value = "browser-local";
    browserOpt.className = "bg-surface-container text-primary";
    browserOpt.textContent = "Voz del Sistema (Offline)";
    dom.voiceSelect.appendChild(browserOpt);
  } catch (_) {
    state.backendAvailable = false;
    state.selectedVoice = "browser-local";
    dom.engineBadgeText.textContent = "Web Live Engine";
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
    opt.className = "bg-surface-container text-primary";
    opt.textContent = "Voz del Navegador (ES/EN)";
    dom.voiceSelect.appendChild(opt);
    return;
  }

  list.forEach((v) => {
    const opt = document.createElement("option");
    opt.value = `browser:${v.name}`;
    opt.className = "bg-surface-container text-primary";
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

  // Segmented Tabs: Chapters (TOC) vs Page Grid
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => {
        b.className =
          "tab-btn py-2.5 rounded-lg text-on-surface-variant font-label-md text-label-md font-medium flex items-center justify-center gap-2 hover:text-on-surface transition-all";
      });
      btn.className =
        "tab-btn active py-2.5 rounded-lg bg-surface-container-high text-primary-container font-label-md text-label-md font-semibold shadow-[0_0_12px_rgba(0,240,255,0.2)] flex items-center justify-center gap-2 transition-all";

      const showChapters = btn.dataset.tab === "chapters";
      document.getElementById("tabChapters").classList.toggle("hidden", !showChapters);
      document.getElementById("tabPages").classList.toggle("hidden", showChapters);
    });
  });

  // Segmented View Mode Switcher (Split / Script / PDF)
  document.querySelectorAll(".view-mode-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".view-mode-btn").forEach((b) => {
        b.className =
          "view-mode-btn py-1.5 px-2 rounded font-label-sm text-label-sm text-center font-medium text-on-surface-variant hover:text-primary transition-all";
      });
      btn.className =
        "view-mode-btn active py-1.5 px-2 rounded font-label-sm text-label-sm text-center font-medium bg-primary-container text-on-primary shadow-[0_0_12px_rgba(0,240,255,0.3)] transition-all";

      dom.readerSplitContainer.classList.remove("view-split", "view-script", "view-pdf");
      dom.readerSplitContainer.classList.add(`view-${btn.dataset.view}`);
      renderPdfPageCanvas(state.currentPage);
    });
  });

  // Botones de cambio de página: cambian libremente la página visualizada sin cortar ni forzar el audio
  dom.btnPrevPageTop.addEventListener("click", () => viewPage(state.currentPage - 1));
  dom.btnNextPageTop.addEventListener("click", () => viewPage(state.currentPage + 1));

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

  const btnWatchAdUnlock = document.getElementById("btnWatchAdUnlock");
  if (btnWatchAdUnlock && window.VoxAdManager) {
    btnWatchAdUnlock.addEventListener("click", () => {
      window.VoxAdManager.requestRewardedUnlock();
    });
  }

  // Stitch Mobile Bottom Navigation Switching (< 1024px) — solo bajo acción explícita del usuario
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
      ? "mobile-nav-btn flex flex-col items-center justify-center min-w-[44px] min-h-[44px] px-space-md text-primary-container font-semibold transition-colors active:scale-95"
      : "mobile-nav-btn flex flex-col items-center justify-center min-w-[44px] min-h-[44px] px-space-md text-on-surface-variant transition-colors active:scale-95";
  });

  if (dom.headerScreenSubtitle) {
    dom.headerScreenSubtitle.textContent = showSidebar
      ? "Chapters & Cleaning · Kinetic Precision"
      : "Reader & Audio · Kinetic Precision";
  }

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

  dom.nowPlayingSentence.textContent = "Analizando PDF y aplicando limpieza inteligente BBox...";

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

async function parsePdfClientSide(arrayBuffer, filename, options) {
  const loadingTask = window.pdfjsLib.getDocument({ data: arrayBuffer.slice(0) });
  const pdf = await loadingTask.promise;
  const totalPages = pdf.numPages;

  let removedPageNums = 0;
  let totalSentences = 0;
  let totalWords = 0;
  const pages = [];
  const chapters = [{ id: "ch_1", level: 1, title: "1. Inicio del Documento", page_number: 1 }];
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

  const sizeMb = state.rawFile ? `${(state.rawFile.size / (1024 * 1024)).toFixed(1)} MB` : "PDF Master";
  dom.docTitleText.textContent = parsed.title;
  dom.docTitleText.title = parsed.title;
  dom.docMetaText.textContent = sizeMb;
  dom.pdfHeaderDocName.textContent = `Doc: ${parsed.filename}`;
  dom.docDurationBadge.textContent = `~${parsed.estimated_duration_minutes} min listen`;
  dom.statPages.textContent = parsed.total_pages;
  dom.statSentences.textContent = parsed.total_sentences.toLocaleString();
  dom.statWords.textContent = parsed.total_words.toLocaleString();
  dom.totalPagesLabel.textContent = parsed.total_pages;

  dom.countHeadersRemoved.textContent = parsed.cleaning_stats?.removed_headers_footers ?? 0;
  dom.countPageNumsRemoved.textContent = parsed.cleaning_stats?.removed_page_numbers ?? 0;

  dom.btnPlayPause.disabled = false;
  dom.btnPrevSentence.disabled = false;
  dom.btnNextSentence.disabled = false;
  dom.btnOpenExportModal.disabled = !state.backendAvailable;

  renderChaptersAndPages();

  const targetPage = keepPosition ? Math.min(state.playingPage, parsed.total_pages) : 1;
  const targetSentence = keepPosition ? state.playingSentenceIdx : 0;
  await goToPage(targetPage, targetSentence, false);

  if (!keepPosition) {
    checkSavedProgress(parsed.doc_id);
  }
}

function renderChaptersAndPages() {
  const { chapters, total_pages, pages } = state.docData;

  if (dom.chapterCountLabel) {
    dom.chapterCountLabel.textContent = `${chapters.length} Capítulos Identificados`;
  }

  dom.chapterList.innerHTML = "";
  chapters.forEach((ch, idx) => {
    const nextChPage = chapters[idx + 1] ? chapters[idx + 1].page_number - 1 : total_pages;
    const endPage = Math.max(ch.page_number, nextChPage);
    let sentsInChapter = 0;
    for (let p = ch.page_number; p <= endPage && p <= pages.length; p++) {
      sentsInChapter += pages[p - 1]?.sentences?.length || 0;
    }

    const li = document.createElement("li");
    li.className =
      "chapter-item bg-surface-container-low p-space-sm rounded-xl flex items-center justify-between gap-space-sm relative overflow-hidden cursor-pointer hover:bg-surface-container transition-all";
    li.dataset.page = ch.page_number;
    li.dataset.endPage = endPage;
    li.dataset.title = ch.title;

    li.innerHTML = `
      <div class="chapter-accent-bar hidden absolute left-0 top-0 bottom-0 w-1 bg-primary-container shadow-[0_0_10px_#00f0ff]"></div>
      <div class="flex items-center gap-space-sm min-w-0 pl-1">
        <div class="relative w-10 h-10 flex-shrink-0 flex items-center justify-center">
          <svg class="w-10 h-10 -rotate-90" viewBox="0 0 36 36">
            <path class="text-surface-container-highest" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="currentColor" stroke-width="3"></path>
            <path class="chapter-ring-path text-secondary" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="currentColor" stroke-dasharray="0, 100" stroke-linecap="round" stroke-width="3"></path>
          </svg>
          <span class="chapter-ring-icon material-symbols-outlined text-secondary text-[16px] absolute">auto_stories</span>
        </div>
        <div class="flex flex-col min-w-0">
          <span class="chapter-title-text font-headline-sm text-[15px] leading-tight text-on-surface font-medium truncate">${ch.title}</span>
          <div class="flex items-center gap-2 mt-0.5">
            <span class="font-label-sm text-label-sm text-on-surface-variant">Págs. ${ch.page_number}–${endPage}</span>
            <span class="w-1 h-1 rounded-full bg-surface-variant"></span>
            <span class="font-label-sm text-label-sm text-primary-container font-semibold">${sentsInChapter} oraciones</span>
          </div>
        </div>
      </div>
      <div class="flex items-center gap-1 flex-shrink-0">
        <button type="button" title="Reproducir desde este capítulo" class="chapter-play-btn w-9 h-9 rounded-lg bg-surface-container-high text-on-surface flex items-center justify-center active:scale-90 transition-transform">
          <span class="material-symbols-outlined text-[20px]" style="font-variation-settings: 'FILL' 1;">play_arrow</span>
        </button>
      </div>
    `;

    // Clic en la fila del capítulo: solo muestra esa página sin cortar el audio ni cambiar de pestaña forzosamente
    li.addEventListener("click", () => {
      viewPage(ch.page_number);
    });

    // Clic en el botón Play del capítulo: inicia la narración en ese capítulo sin forzar scroll ni cambiar de pestaña
    const playBtn = li.querySelector(".chapter-play-btn");
    if (playBtn) {
      playBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        goToPage(ch.page_number, 0, true);
      });
    }

    dom.chapterList.appendChild(li);
  });

  dom.pageGrid.innerHTML = "";
  for (let p = 1; p <= total_pages; p++) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className =
      "page-pill py-2.5 rounded-lg bg-surface-container-low border border-white/5 text-on-surface font-label-md text-label-md hover:bg-surface-container-high transition-all";
    btn.dataset.page = p;
    btn.textContent = p;
    btn.addEventListener("click", () => {
      viewPage(p);
    });
    dom.pageGrid.appendChild(btn);
  }
}

/**
 * Cambia libremente la página visualizada (PDF + Guion) sin interrumpir la reproducción activa
 * ni mover el scroll de la pantalla. Si el reproductor está en pausa, sincroniza la página inicial.
 */
async function viewPage(pageNumber) {
  if (!state.docData) return;
  const total = state.docData.total_pages;
  const clampedPage = Math.max(1, Math.min(total, pageNumber));

  state.currentPage = clampedPage;

  if (!state.isPlaying) {
    state.playingPage = clampedPage;
    state.playingSentenceIdx = 0;
  }

  updateViewedPageUI();
  const pageObj = state.docData.pages[clampedPage - 1];
  renderPageScript(pageObj);
  await renderPdfPageCanvas(clampedPage);
  highlightActiveSentence();
}

/**
 * Posiciona tanto la vista como el cursor de narración en una página y oración específicas
 * (sin mover el scroll de la ventana ni cambiar pestañas).
 */
async function goToPage(pageNumber, sentenceIndex = 0, autoPlay = false) {
  if (!state.docData) return;
  const total = state.docData.total_pages;
  const clampedPage = Math.max(1, Math.min(total, pageNumber));

  state.currentPage = clampedPage;
  state.playingPage = clampedPage;

  const pageObj = state.docData.pages[clampedPage - 1];
  const sentences = pageObj?.sentences || [];
  state.playingSentenceIdx = Math.max(0, Math.min(Math.max(0, sentences.length - 1), sentenceIndex));

  updateViewedPageUI();
  renderPageScript(pageObj);
  await renderPdfPageCanvas(clampedPage);
  highlightActiveSentence();
  saveReadingProgress();

  if (autoPlay) {
    playCurrentSentence();
  }
}

function updateViewedPageUI() {
  if (!state.docData) return;
  const total = state.docData.total_pages;
  const viewed = state.currentPage;

  dom.currentPageLabel.textContent = viewed;
  dom.btnPrevPageTop.disabled = viewed <= 1;
  dom.btnNextPageTop.disabled = viewed >= total;

  // Actualizar cuadrícula de páginas (destaca la página vista y marca si otra página está sonando)
  document.querySelectorAll(".page-pill").forEach((el) => {
    const p = parseInt(el.dataset.page, 10);
    const isViewed = p === viewed;
    const isPlayingHere = state.isPlaying && p === state.playingPage;

    if (isViewed) {
      el.className =
        "page-pill py-2.5 rounded-lg bg-primary-container text-on-primary font-label-md text-label-md font-bold shadow-[0_0_12px_rgba(0,240,255,0.3)]";
    } else if (isPlayingHere) {
      el.className =
        "page-pill py-2.5 rounded-lg bg-secondary-container/60 border border-primary-container/60 text-primary font-label-md text-label-md font-semibold";
    } else {
      el.className =
        "page-pill py-2.5 rounded-lg bg-surface-container-low border border-white/5 text-on-surface font-label-md text-label-md hover:bg-surface-container-high transition-all";
    }
  });
}

function renderPageScript(pageObj) {
  dom.sentencesContainer.innerHTML = "";
  const sentences = pageObj?.sentences || [];

  if (sentences.length === 0) {
    dom.sentencesContainer.innerHTML = `
      <div class="p-4 rounded-lg bg-surface-container/60 text-center font-body-sm text-body-sm text-on-surface-variant">
        Esta página no contiene texto legible tras la limpieza inteligente.
      </div>
    `;
    return;
  }

  sentences.forEach((s) => {
    const card = document.createElement("div");
    card.id = `sentence-node-${s.sentence_index}`;
    card.dataset.sentenceIndex = s.sentence_index;
    card.addEventListener("click", () => {
      state.playingPage = state.currentPage;
      state.playingSentenceIdx = s.sentence_index;
      highlightActiveSentence();
      saveReadingProgress();
      playCurrentSentence();
    });
    dom.sentencesContainer.appendChild(card);
  });
}

function highlightActiveSentence() {
  if (!state.docData) return;

  const viewedPageObj = state.docData.pages?.[state.currentPage - 1];
  const viewedSentences = viewedPageObj?.sentences || [];

  const playingPageObj = state.docData.pages?.[state.playingPage - 1];
  const playingSentences = playingPageObj?.sentences || [];
  const totalInPlayingPage = playingSentences.length;
  const playIdx = state.playingSentenceIdx;
  const isViewingPlayingPage = state.currentPage === state.playingPage;

  // 1. Actualizar tarjetas del guion en la página visualizada (sin hacer scrollIntoView)
  viewedSentences.forEach((s, sIdx) => {
    const node = document.getElementById(`sentence-node-${sIdx}`);
    if (!node) return;
    const numTag = `#${String(sIdx + 1).padStart(2, "0")}`;

    if (isViewingPlayingPage && sIdx === playIdx) {
      node.className =
        "relative p-3 rounded-lg bg-surface-container-highest/90 border border-primary-container/35 shadow-[0_0_28px_rgba(0,240,255,0.22)] flex flex-col gap-1.5 transition-all";
      node.innerHTML = `
        <div class="flex items-center justify-between">
          <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary-container text-on-primary font-label-sm text-label-sm font-bold shadow-[0_0_10px_rgba(0,240,255,0.6)]">
            <span class="material-symbols-outlined text-[13px] ${state.isPlaying ? "animate-spin" : ""}">sync</span>
            Now Speaking · ${numTag}
          </span>
          <span class="font-label-sm text-label-sm text-primary-container font-mono">Pág. ${state.playingPage}</span>
        </div>
        <p class="font-body-md text-body-md text-primary font-medium tracking-normal leading-relaxed pl-2 border-l-2 border-primary-container bg-gradient-to-r from-primary-container/10 to-transparent py-1 rounded">
          ${s.text}
        </p>
        <div class="flex items-center gap-2 pt-0.5 font-label-sm text-label-sm text-secondary">
          <span class="material-symbols-outlined text-[14px]">graphic_eq</span>
          <span>Speed: ${state.playbackSpeed}x • Voice: ${state.selectedVoice}</span>
        </div>
      `;
    } else if (state.currentPage < state.playingPage || (isViewingPlayingPage && sIdx < playIdx)) {
      node.className =
        "p-2.5 rounded-lg bg-surface-container/60 opacity-60 flex items-start gap-2.5 cursor-pointer hover:opacity-90 transition-all";
      node.innerHTML = `
        <span class="font-label-sm text-label-sm text-on-surface-variant mt-0.5">${numTag}</span>
        <p class="font-body-sm text-body-sm text-on-surface-variant leading-normal">${s.text}</p>
      `;
    } else {
      node.className =
        "p-2.5 rounded-lg bg-surface-container/60 flex items-start gap-2.5 hover:bg-surface-container-high transition-colors cursor-pointer";
      node.innerHTML = `
        <span class="font-label-sm text-label-sm text-on-surface-variant mt-0.5">${numTag}</span>
        <p class="font-body-sm text-body-sm text-on-surface leading-normal">${s.text}</p>
      `;
    }
  });

  // 2. Actualizar telemetría de reproducción (barra inferior y DAW preview) según donde va la voz
  const currentSentenceObj = playingSentences[playIdx];
  if (currentSentenceObj) {
    dom.nowPlayingSentence.textContent = currentSentenceObj.text;
    dom.sentenceCounterLabel.textContent = isViewingPlayingPage
      ? `Oración ${playIdx + 1} de ${totalInPlayingPage}`
      : `Viendo Pág. ${state.currentPage} · Audio en Pág. ${state.playingPage} (${playIdx + 1}/${totalInPlayingPage})`;

    if (dom.activeParaBadge) {
      dom.activeParaBadge.textContent = `Pág. ${state.playingPage} · Párrafo ${currentSentenceObj.paragraph_index + 1}`;
    }
    if (dom.activeParaPreviewText) {
      dom.activeParaPreviewText.textContent = currentSentenceObj.text;
    }
    const pagePct = totalInPlayingPage > 0 ? Math.round(((playIdx + 1) / totalInPlayingPage) * 100) : 0;
    dom.pageProgressFill.style.width = `${pagePct}%`;
  } else {
    dom.nowPlayingSentence.textContent = "Página sin texto.";
    dom.sentenceCounterLabel.textContent = "Oración 0 de 0";
    dom.pageProgressFill.style.width = "0%";
  }

  // 3. Actualizar progreso global del libro y capítulos en tiempo real
  let readBeforePage = 0;
  for (let i = 0; i < state.playingPage - 1; i++) {
    readBeforePage += state.docData.pages[i]?.sentences?.length || 0;
  }
  const globalIdx = readBeforePage + playIdx + 1;
  const globalTotal = Math.max(1, state.docData.total_sentences);
  const bookPct = Math.min(100, Math.round((globalIdx / globalTotal) * 100));
  dom.bookProgressPct.textContent = `${bookPct}%`;
  if (dom.bookProgressBarFill) {
    dom.bookProgressBarFill.style.width = `${bookPct}%`;
  }

  let activeChapterPage = 1;
  let activeChapterTitle = state.docData.title;
  for (const ch of state.docData.chapters) {
    if (ch.page_number <= state.playingPage) {
      activeChapterPage = ch.page_number;
      activeChapterTitle = ch.title;
    }
  }
  if (dom.playerChapterLabel) {
    dom.playerChapterLabel.textContent = `${activeChapterTitle} · Pág. ${state.playingPage}`;
  }

  document.querySelectorAll(".chapter-item").forEach((el) => {
    const chStart = parseInt(el.dataset.page, 10);
    const chEnd = parseInt(el.dataset.endPage, 10) || chStart;
    const isCurrent = chStart === activeChapterPage;

    const bar = el.querySelector(".chapter-accent-bar");
    const ringIcon = el.querySelector(".chapter-ring-icon");
    const ringPath = el.querySelector(".chapter-ring-path");
    const playBtn = el.querySelector(".chapter-play-btn");

    let chPct = 0;
    if (state.playingPage > chEnd) {
      chPct = 100;
    } else if (state.playingPage >= chStart && state.playingPage <= chEnd) {
      const span = Math.max(1, chEnd - chStart + 1);
      const pageProgress = totalInPlayingPage > 0 ? (playIdx + 1) / totalInPlayingPage : 0;
      chPct = Math.min(100, Math.round((((state.playingPage - chStart) + pageProgress) / span) * 100));
    }

    if (ringPath) {
      ringPath.setAttribute("stroke-dasharray", `${chPct}, 100`);
    }
    if (bar) bar.classList.toggle("hidden", !isCurrent);
    if (ringIcon) {
      ringIcon.textContent = isCurrent ? "volume_up" : chPct >= 100 ? "check_circle" : "auto_stories";
      ringIcon.className = isCurrent
        ? "chapter-ring-icon material-symbols-outlined text-primary-container text-[18px] absolute animate-pulse"
        : "chapter-ring-icon material-symbols-outlined text-secondary text-[16px] absolute";
    }
    if (playBtn) {
      playBtn.className = isCurrent
        ? "chapter-play-btn w-9 h-9 rounded-lg bg-primary-container text-on-primary flex items-center justify-center shadow-[0_0_12px_rgba(0,240,255,0.35)]"
        : "chapter-play-btn w-9 h-9 rounded-lg bg-surface-container-high text-on-surface flex items-center justify-center";
    }
  });

  updateViewedPageUI();
  updatePdfHighlightBox();
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
  if (state.currentPage !== state.playingPage) {
    dom.pdfHighlightBox.classList.add("hidden");
    return;
  }

  const pageObj = state.docData?.pages?.[state.playingPage - 1];
  const currentSentence = pageObj?.sentences?.[state.playingSentenceIdx];
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
  highlightActiveSentence();
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
  const pageObj = state.docData.pages[state.playingPage - 1];
  const sentences = pageObj?.sentences || [];
  const nextIdx = state.playingSentenceIdx + 1;

  if (nextIdx < sentences.length) {
    const nextText = sentences[nextIdx].text;
    fetchSentenceAudioBlobUrl(nextText).catch(() => {});
  } else if (state.playingPage < state.docData.total_pages) {
    const nextPageSentences = state.docData.pages[state.playingPage]?.sentences || [];
    if (nextPageSentences.length > 0) {
      fetchSentenceAudioBlobUrl(nextPageSentences[0].text).catch(() => {});
    }
  }
}

async function playCurrentSentence() {
  if (!state.docData) return;
  const pageObj = state.docData.pages[state.playingPage - 1];
  const sentences = pageObj?.sentences || [];

  if (sentences.length === 0) {
    if (state.playingPage < state.docData.total_pages) {
      await advancePlayingPage(state.playingPage + 1, 0, true);
    } else {
      stopPlayback();
    }
    return;
  }

  const currentSentence = sentences[state.playingSentenceIdx];
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

/**
 * Avanza la página de reproducción en segundo plano. Si el usuario estaba en la misma
 * página que se leía, actualiza el contenido en sitio sin mover el scroll; si el usuario
 * estaba explorando otra página, mantiene su vista intacta.
 */
async function advancePlayingPage(newPlayingPage, newSentenceIdx = 0, autoPlay = true) {
  if (!state.docData) return;
  const total = state.docData.total_pages;
  const clamped = Math.max(1, Math.min(total, newPlayingPage));
  const wasViewingSamePage = state.currentPage === state.playingPage;

  state.playingPage = clamped;
  const pageObj = state.docData.pages[clamped - 1];
  const sentences = pageObj?.sentences || [];
  state.playingSentenceIdx = Math.max(0, Math.min(Math.max(0, sentences.length - 1), newSentenceIdx));

  if (wasViewingSamePage) {
    state.currentPage = clamped;
    renderPageScript(pageObj);
    await renderPdfPageCanvas(clamped);
  }

  highlightActiveSentence();
  saveReadingProgress();

  if (autoPlay) {
    await playCurrentSentence();
  }
}

async function advanceToNextSentenceAuto() {
  if (!state.docData) return;
  const pageObj = state.docData.pages[state.playingPage - 1];
  const sentences = pageObj?.sentences || [];

  if (state.playingSentenceIdx + 1 < sentences.length) {
    state.playingSentenceIdx++;
    await playCurrentSentence();
  } else if (state.playingPage < state.docData.total_pages) {
    await advancePlayingPage(state.playingPage + 1, 0, true);
  } else {
    stopPlayback();
    dom.nowPlayingSentence.textContent = "🎉 ¡Has terminado de escuchar el documento!";
  }
}

async function stepSentence(delta) {
  if (!state.docData) return;
  const wasPlaying = state.isPlaying;
  const pageObj = state.docData.pages[state.playingPage - 1];
  const sentences = pageObj?.sentences || [];
  const nextIdx = state.playingSentenceIdx + delta;

  if (nextIdx >= 0 && nextIdx < sentences.length) {
    state.playingSentenceIdx = nextIdx;
    highlightActiveSentence();
    saveReadingProgress();
    if (wasPlaying) playCurrentSentence();
  } else if (nextIdx >= sentences.length && state.playingPage < state.docData.total_pages) {
    await advancePlayingPage(state.playingPage + 1, 0, wasPlaying);
  } else if (nextIdx < 0 && state.playingPage > 1) {
    const prevPageSentences = state.docData.pages[state.playingPage - 2]?.sentences || [];
    const lastIdx = Math.max(0, prevPageSentences.length - 1);
    await advancePlayingPage(state.playingPage - 1, lastIdx, wasPlaying);
  }
}

function getProgressStorageKey(docId) {
  return `voxpdf_progress_${docId}`;
}

function saveReadingProgress() {
  if (!state.docData) return;
  const payload = {
    doc_id: state.docData.doc_id,
    page: state.playingPage,
    sentence: state.playingSentenceIdx,
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
