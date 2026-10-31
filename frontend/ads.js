/**
 * VoxPDF Studio — Gestor Unificado de Monetización por Anuncios (AdMob Android + Web AdSense)
 * Desarrollado por Edgar López.
 *
 * NOTA IMPORTANTE PARA PRODUCCIÓN:
 * Los IDs configurados por defecto corresponden a los IDs de prueba oficiales de Google AdMob
 * (https://developers.google.com/admob/android/test-ads) para evitar clics inválidos durante
 * el desarrollo. Antes de subir el .aab a Google Play Console, reemplaza PRODUCTION_IDS con
 * los códigos de tu cuenta de AdMob / AdSense.
 */

window.VoxAdManager = (function () {
  const ADMOB_CONFIG = {
    isTesting: true,
    androidBannerId: "ca-app-pub-3940256099942544/6300978111",     // ID oficial de prueba Google Banner
    androidRewardedId: "ca-app-pub-3940256099942544/5224354917",   // ID oficial de prueba Google Rewarded
    webAdSenseClient: "ca-pub-0000000000000000",                   // Reemplazar en producción Web
    rewardMinutesPerAd: 30,                                        // 30 min de Voz Neuronal Cloud + Exportar MP3
  };

  const STORAGE_KEYS = {
    CONSENT: "voxpdf_privacy_consent_v1",
    NEURAL_PASS_UNTIL: "voxpdf_neural_pass_until",
  };

  let countdownInterval = null;
  let rewardCallback = null;

  function isCapacitorAdMobAvailable() {
    return Boolean(
      window.Capacitor &&
      window.Capacitor.Plugins &&
      window.Capacitor.Plugins.AdMob
    );
  }

  function hasNeuralPassActive() {
    try {
      const until = parseInt(localStorage.getItem(STORAGE_KEYS.NEURAL_PASS_UNTIL) || "0", 10);
      return until > Date.now();
    } catch (_) {
      return false;
    }
  }

  function getRemainingPassMinutes() {
    try {
      const until = parseInt(localStorage.getItem(STORAGE_KEYS.NEURAL_PASS_UNTIL) || "0", 10);
      const diffMs = until - Date.now();
      return diffMs > 0 ? Math.ceil(diffMs / 60000) : 0;
    } catch (_) {
      return 0;
    }
  }

  function grantNeuralReward(minutes = ADMOB_CONFIG.rewardMinutesPerAd) {
    const currentUntil = Math.max(
      Date.now(),
      parseInt(localStorage.getItem(STORAGE_KEYS.NEURAL_PASS_UNTIL) || "0", 10)
    );
    const newUntil = currentUntil + minutes * 60 * 1000;
    try {
      localStorage.setItem(STORAGE_KEYS.NEURAL_PASS_UNTIL, String(newUntil));
    } catch (_) {}
    updatePassBadgeUI();
  }

  function updatePassBadgeUI() {
    const badge = document.getElementById("neuralPassStatus");
    const btnUnlock = document.getElementById("btnWatchAdUnlock");
    if (!badge) return;

    const mins = getRemainingPassMinutes();
    if (mins > 0) {
      badge.textContent = `⚡ Pase Neuronal & MP3: ${mins} min activos`;
      badge.classList.add("pass-active");
      if (btnUnlock) btnUnlock.textContent = "+30 min (Ver Anuncio)";
    } else {
      badge.textContent = "🔒 Voz Neuronal & MP3 (Desbloquear con Anuncio)";
      badge.classList.remove("pass-active");
      if (btnUnlock) btnUnlock.textContent = "🎁 Desbloquear Gratis (Anuncio)";
    }
  }

  async function init() {
    initConsentBanner();
    updatePassBadgeUI();
    setInterval(updatePassBadgeUI, 15000);

    if (isCapacitorAdMobAvailable()) {
      try {
        const { AdMob } = window.Capacitor.Plugins;
        await AdMob.initialize({
          initializeForTesting: ADMOB_CONFIG.isTesting,
        });
        await AdMob.showBanner({
          adId: ADMOB_CONFIG.androidBannerId,
          adSize: "ADAPTIVE_BANNER",
          position: "BOTTOM_CENTER",
          margin: 64,
          isTesting: ADMOB_CONFIG.isTesting,
        });
      } catch (err) {
        console.warn("AdMob init fallback:", err);
      }
    }
  }

  function initConsentBanner() {
    const banner = document.getElementById("gdprConsentBanner");
    const btnAccept = document.getElementById("btnAcceptConsent");
    if (!banner || !btnAccept) return;

    try {
      const accepted = localStorage.getItem(STORAGE_KEYS.CONSENT);
      if (!accepted) {
        banner.classList.remove("hidden");
      }
    } catch (_) {}

    btnAccept.addEventListener("click", () => {
      try {
        localStorage.setItem(STORAGE_KEYS.CONSENT, new Date().toISOString());
      } catch (_) {}
      banner.classList.add("hidden");
    });
  }

  /**
   * Solicita mostrar un Anuncio Recompensado (Rewarded Ad) en AdMob o en el reproductor patrocinado web.
   * Al completarse, otorga 30 minutos de Voz Neuronal Cloud + permiso de Exportación MP3.
   */
  async function requestRewardedUnlock(onSuccess) {
    if (isCapacitorAdMobAvailable()) {
      try {
        const { AdMob } = window.Capacitor.Plugins;
        await AdMob.prepareRewardVideoAd({
          adId: ADMOB_CONFIG.androidRewardedId,
          isTesting: ADMOB_CONFIG.isTesting,
        });
        const rewardItem = await AdMob.showRewardVideoAd();
        if (rewardItem) {
          grantNeuralReward(ADMOB_CONFIG.rewardMinutesPerAd);
          if (typeof onSuccess === "function") onSuccess();
        }
        return;
      } catch (err) {
        console.warn("Fallback a modal de anuncio recompensado:", err);
      }
    }

    // Flujo interactivo de Anuncio Recompensado en Web / Previsualización
    openWebRewardedAdModal(onSuccess);
  }

  function openWebRewardedAdModal(onSuccess) {
    const modal = document.getElementById("rewardedAdModal");
    const timerSpan = document.getElementById("rewardedAdTimer");
    const progressBar = document.getElementById("rewardedAdProgress");
    const btnClaim = document.getElementById("btnClaimAdReward");
    const btnCancel = document.getElementById("btnCancelAdReward");

    if (!modal) {
      grantNeuralReward(ADMOB_CONFIG.rewardMinutesPerAd);
      if (typeof onSuccess === "function") onSuccess();
      return;
    }

    rewardCallback = onSuccess;
    modal.classList.remove("hidden");
    btnClaim.disabled = true;

    let remaining = 5;
    timerSpan.textContent = `${remaining}s`;
    progressBar.style.width = "0%";

    if (countdownInterval) clearInterval(countdownInterval);
    countdownInterval = setInterval(() => {
      remaining -= 1;
      const pct = Math.min(100, Math.round(((5 - remaining) / 5) * 100));
      progressBar.style.width = `${pct}%`;

      if (remaining <= 0) {
        clearInterval(countdownInterval);
        timerSpan.textContent = "¡Recompensa lista!";
        btnClaim.disabled = false;
        btnClaim.focus();
      } else {
        timerSpan.textContent = `${remaining}s`;
      }
    }, 1000);

    btnClaim.onclick = () => {
      if (countdownInterval) clearInterval(countdownInterval);
      modal.classList.add("hidden");
      grantNeuralReward(ADMOB_CONFIG.rewardMinutesPerAd);
      if (typeof rewardCallback === "function") {
        const cb = rewardCallback;
        rewardCallback = null;
        cb();
      }
    };

    btnCancel.onclick = () => {
      if (countdownInterval) clearInterval(countdownInterval);
      modal.classList.add("hidden");
      rewardCallback = null;
    };
  }

  return {
    init,
    hasNeuralPassActive,
    getRemainingPassMinutes,
    grantNeuralReward,
    requestRewardedUnlock,
    updatePassBadgeUI,
  };
})();
