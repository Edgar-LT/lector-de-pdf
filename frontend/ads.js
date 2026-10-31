/**
 * VoxPDF Studio — Gestor Unificado de Monetización por Anuncios (AdMob Android + Web AdSense)
 * Desarrollado por Edgar López.
 */

window.VoxAdManager = (function () {
  const ADMOB_CONFIG = {
    isTesting: true,
    androidBannerId: "ca-app-pub-3940256099942544/6300978111",
    androidRewardedId: "ca-app-pub-3940256099942544/5224354917",
    webAdSenseClient: "ca-pub-0000000000000000",
    rewardMinutesPerAd: 30,
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
      badge.textContent = `MP3 activo (${mins} min)`;
      badge.classList.add("pass-active");
      if (btnUnlock) btnUnlock.textContent = "+30 min";
    } else {
      badge.textContent = "Exportación MP3";
      badge.classList.remove("pass-active");
      if (btnUnlock) btnUnlock.textContent = "Activar MP3 (30m)";
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
        timerSpan.textContent = "Listo";
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
