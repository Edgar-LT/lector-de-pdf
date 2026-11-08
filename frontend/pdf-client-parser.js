/**
 * VoxPDF Studio — Motor de Dominio Cliente (Extracción PDF.js y Limpieza de Texto)
 * Funciones puras y libres de referencias al DOM para modo Web Live / Offline.
 */

window.VoxClientParser = (function () {
  const PAGE_NUM_REGEX = /^\s*(?:p[áa]gina|p[áa]g\.?|page)?\s*\d+\s*(?:(?:de|of|\/|-)\s*\d+)?\s*$/i;
  const ABBR_REGEX = /^(?:p[áa]g|p[áa]gs|cap|caps|art|arts|dr|dra|sr|sra|prof|ing|lic|ej|fig|figs|vs|no|n[úu]m)\.$/i;
  const CHAPTER_HEADING_REGEX = /^\s*(?:cap[íi]tulo|cap\.|acto|secci[óo]n|parte|arco|libro)\s+([0-9ivxlcdm]+|[a-záéíóúñ]+)/i;
  const WORDS_PER_MINUTE = 155;

  function escapeHtml(str) {
    return String(str || "").replace(/[&<>"']/g, (m) => {
      switch (m) {
        case "&":
          return "&amp;";
        case "<":
          return "&lt;";
        case ">":
          return "&gt;";
        case '"':
          return "&quot;";
        case "'":
          return "&#39;";
        default:
          return m;
      }
    });
  }

  function escapeRegex(str) {
    return String(str || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function formatSentenceWithSearch(text, searchQuery) {
    const safeText = escapeHtml(text);
    if (!searchQuery) return safeText;
    try {
      const regex = new RegExp(`(${escapeRegex(searchQuery)})`, "gi");
      return safeText.replace(
        regex,
        `<mark class="bg-amber-400/30 text-amber-200 px-0.5 rounded font-semibold">$1</mark>`
      );
    } catch (_) {
      return safeText;
    }
  }

  function getLastWord(text) {
    let i = text.length - 1;
    while (i >= 0 && /\s/.test(text[i])) {
      i--;
    }
    if (i < 0) return "";
    const end = i + 1;
    while (i >= 0 && !/\s/.test(text[i])) {
      i--;
    }
    return text.slice(i + 1, end);
  }

  function cleanPageText(lines, options) {
    let fullText = lines.join(" ");
    if (options.fixLineBreaks) {
      fullText = fullText.replace(/([A-Za-zÁÉÍÓÚáéíóúÑñ]{2,})-\s+([a-záéíóúñ]{2,})/g, "$1$2");
      fullText = fullText.replace(/\b([A-Za-zÁÉÍÓÚÑa-záéíóúñ])\s+(?=[A-Za-zÁÉÍÓÚÑa-záéíóúñ]\b)/g, "$1");
      fullText = fullText.replace(/\s{2,}/g, " ");
    }
    if (options.removeAcademicCitations && fullText.includes("[")) {
      fullText = fullText.replace(/\s*\[\s*\d+(?:\s*[,–-]\s*\d+)*\s*\]/g, "");
    }
    return fullText.trim();
  }

  function splitTextIntoSentences(fullText, splitByCommas = true) {
    if (!fullText) return [];
    
    // Autómata determinista O(N) sin regex lookbehind
    const rawParts = [];
    const n = fullText.length;
    let start = 0;
    let i = 0;

    while (i < n) {
      const ch = fullText[i];
      const isTerminal = ch === "." || ch === "!" || ch === "?" || ch === "…";
      const isComma = splitByCommas !== false && (ch === "," || ch === ";" || ch === ":");

      if (isTerminal || isComma) {
        if (i + 1 === n || /\s/.test(fullText[i + 1])) {
          if (isComma && i > 0 && /\d/.test(fullText[i - 1])) {
            i++;
            continue;
          }
          const segment = fullText.slice(start, i + 1).trim();
          if (segment) {
            rawParts.push(segment);
          }
          i++;
          while (i < n && /\s/.test(fullText[i])) {
            i++;
          }
          start = i;
          continue;
        }
      }
      i++;
    }

    const remainder = fullText.slice(start, n).trim();
    if (remainder) {
      rawParts.push(remainder);
    }

    const sentences = [];
    let currentChunk = [];

    for (const piece of rawParts) {
      if (currentChunk.length === 0) {
        currentChunk.push(piece);
        continue;
      }
      const lastWord = getLastWord(currentChunk[currentChunk.length - 1]);
      if (ABBR_REGEX.test(lastWord)) {
        currentChunk.push(piece);
        continue;
      }
      sentences.push(currentChunk.join(" "));
      currentChunk = [piece];
    }
    if (currentChunk.length > 0) {
      sentences.push(currentChunk.join(" "));
    }
    return sentences;
  }

  async function extractOutlineOrInferChapters(pdf, pages) {
    const chapters = [];
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

    if (chapters.length === 0) {
      pages.forEach((pg) => {
        const firstSentence = pg.sentences?.[0]?.text || "";
        if (CHAPTER_HEADING_REGEX.test(firstSentence)) {
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
      chapters.push({ id: "ch_1", level: 1, title: "Inicio del documento", page_number: 1 });
    }
    return chapters;
  }

  async function parsePdfClientSide(arrayBuffer, filename, options) {
    const loadingTask = window.pdfjsLib.getDocument({ data: arrayBuffer.slice(0), isEvalSupported: false });
    const pdf = await loadingTask.promise;
    const totalPages = pdf.numPages;

    let removedPageNums = 0;
    let totalSentences = 0;
    let totalWords = 0;
    const pages = [];

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

        if (options.removePageNums && inMargin && PAGE_NUM_REGEX.test(str)) {
          removedPageNums++;
          continue;
        }
        lines.push(str);
      }

      const fullText = cleanPageText(lines, options);
      const rawSentences = splitTextIntoSentences(fullText, options.splitByCommas);

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

    const chapters = await extractOutlineOrInferChapters(pdf, pages);

    return {
      doc_id: `${filename}_${arrayBuffer.byteLength}`,
      filename,
      title: filename.replace(/\.pdf$/i, ""),
      author: "",
      total_pages: totalPages,
      total_sentences: totalSentences,
      total_words: totalWords,
      estimated_duration_minutes: Math.round((totalWords / WORDS_PER_MINUTE) * 10) / 10,
      cleaning_stats: {
        removed_headers_footers: 0,
        removed_page_numbers: removedPageNums,
        fix_line_breaks: options.fixLineBreaks,
      },
      chapters,
      pages,
    };
  }

  return {
    escapeHtml,
    escapeRegex,
    formatSentenceWithSearch,
    parsePdfClientSide,
  };
})();
