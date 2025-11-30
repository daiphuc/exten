// ===== SHLX AUTO NEXT – VIDEO + AUTO NEXT + AUTO REFRESH (OPTIMIZED) =====

// Cài đặt mặc định
let settings = {
  enabled: false,
  intervalMs: 10000, // 10s check 1 lần cho nhẹ CPU
  threshold: 100,
  refreshSec: 0 // 0 = tắt auto refresh
};

const MIN_LOOP_INTERVAL = 3000; // không cho phép <3s để tránh spam CPU
const LESSON_CACHE_TTL = 60000;
const PROGRESS_CACHE_MS = 2000;

let loopTimerId = null;
let waitingNext = false;

// YouTube control
let ytIframe = null;
let ytPlayIntervalId = null;

// Refresh control
let lastRefreshTime = Date.now();

// Cache bài học
let lessonButtons = null;
let lastLessonScanTime = 0;
let lastProgressSnapshot = { value: 0, ts: 0 };

// --------- LOAD SETTINGS LÚC ĐẦU ----------

chrome.storage.sync.get(
  { enabled: false, intervalMs: 10000, threshold: 100, refreshSec: 0 },
  (data) => {
    settings = {
      enabled: !!data.enabled,
      intervalMs: parseInt(data.intervalMs, 10) || 10000,
      threshold: parseInt(data.threshold, 10) || 100,
      refreshSec: parseInt(data.refreshSec, 10) || 0
    };
    console.log("[SHLX AutoNext] Settings loaded:", settings);
    startLoop();
  }
);

// ---------- UTIL ----------

function normalize(str) {
  return (str || "").toLowerCase().replace(/\s+/g, " ").trim();
}

// Có video hay không
function hasVideoOnPage() {
  const yt = document.querySelector('iframe[src*="youtube.com"]');
  const vid = document.querySelector("video");
  return !!(yt || vid);
}

// Tìm iframe YouTube
function findYoutubeIframe() {
  if (ytIframe && ytIframe.contentWindow) return ytIframe;
  ytIframe = document.querySelector('iframe[src*="youtube.com"]');
  if (!ytIframe || !ytIframe.contentWindow) {
    return null;
  }
  return ytIframe;
}

// Gửi lệnh playVideo định kỳ
function startYoutubeAutoPlayLoop() {
  if (ytPlayIntervalId) return;
  const iframe = findYoutubeIframe();
  if (!iframe) return;

  const sendPlay = () => {
    const frame = findYoutubeIframe();
    if (!frame || !frame.contentWindow) return;

    const msg = JSON.stringify({
      event: "command",
      func: "playVideo",
      args: []
    });

    try {
      frame.contentWindow.postMessage(msg, "*");
    } catch (e) {
      console.log("[SHLX AutoNext] Lỗi postMessage playVideo:", e);
    }
  };

  ytPlayIntervalId = setInterval(() => {
    if (!settings.enabled) {
      stopYoutubeAutoPlayLoop();
      return;
    }
    sendPlay();
  }, 15000);
}

function stopYoutubeAutoPlayLoop() {
  if (ytPlayIntervalId) {
    clearInterval(ytPlayIntervalId);
    ytPlayIntervalId = null;
  }
}

// Đọc % tiến trình
function getProgress(force = false) {
  const now = Date.now();
  if (!force && now - lastProgressSnapshot.ts < PROGRESS_CACHE_MS) {
    return lastProgressSnapshot.value;
  }

  const progressEl = document.querySelector("progress.euiProgress");
  if (progressEl) {
    const val = progressEl.value || progressEl.getAttribute("value");
    const num = parseInt(val, 10);
    if (!isNaN(num)) {
      lastProgressSnapshot = { value: num, ts: now };
      return num;
    }
  }

  const percentText =
    document.querySelector(".euiText.css-unjyk3-euiText-s-euiTextAlign-right") ||
    document.querySelector(".euiText");
  if (percentText) {
    const m = (percentText.textContent || "").trim().match(/(\d+)\s*%/);
    if (m) {
      const num = parseInt(m[1], 10);
      if (!isNaN(num)) {
        lastProgressSnapshot = { value: num, ts: now };
        return num;
      }
    }
  }

  lastProgressSnapshot = { value: 0, ts: now };
  return 0;
}

// Cache danh sách bài học
function getLessonButtons() {
  const now = Date.now();

  if (lessonButtons && now - lastLessonScanTime < LESSON_CACHE_TTL) {
    return lessonButtons;
  }

  lessonButtons = Array.from(document.querySelectorAll("button.euiLink"));
  lastLessonScanTime = now;
  return lessonButtons;
}

function invalidateLessonCache() {
  lessonButtons = null;
  lastLessonScanTime = 0;
}

// reset cache khi click
document.addEventListener(
  "click",
  (evt) => {
    if (evt.target && evt.target.closest && evt.target.closest("button.euiLink")) {
      invalidateLessonCache();
    }
  },
  { capture: true }
);

// Lấy bài hiện tại + kế tiếp
function getLessonInfo() {
  const h1 = document.querySelector("h1.euiTitle");
  const currentTitle =
    (h1 ? h1.textContent.trim() : "") || document.title || "Không xác định";
  const currentNorm = normalize(currentTitle);

  const buttons = getLessonButtons();
  if (!buttons.length) {
    return { currentTitle, currentButton: null, nextButton: null };
  }

  let currentIndex = -1;

  for (let i = 0; i < buttons.length; i++) {
    const t = (buttons[i].textContent || "").trim();
    const tn = normalize(t);
    if (!tn) continue;
    if (
      currentNorm === tn ||
      currentNorm.includes(tn) ||
      tn.includes(currentNorm)
    ) {
      currentIndex = i;
      break;
    }
  }

  if (currentIndex === -1) {
    for (let i = 0; i < buttons.length; i++) {
      const fw = window.getComputedStyle(buttons[i]).fontWeight;
      const n = parseInt(fw, 10);
      if (!isNaN(n) && n >= 600) {
        currentIndex = i;
        break;
      }
    }
  }

  if (currentIndex === -1) currentIndex = 0;

  const currentButton = buttons[currentIndex];
  const nextButton =
    currentIndex + 1 < buttons.length ? buttons[currentIndex + 1] : null;

  return { currentTitle, currentButton, nextButton };
}

// ---------- AUTO NEXT (CÓ DELAY 10S SAU KHI NEXT) ----------

function clickNextLesson() {
  const info = getLessonInfo();
  if (info.nextButton) {
    console.log("[SHLX AutoNext] Next to:", info.nextButton.textContent.trim());

    info.nextButton.click();

    // ❗ SAU KHI NEXT → DỪNG LOOP 10 GIÂY
    console.log("[SHLX AutoNext] Đã next bài — chờ 10 giây để trang load...");
    clearLoopTimer();

    setTimeout(() => {
      console.log("[SHLX AutoNext] Bắt đầu kiểm tra lại sau khi chờ 10s!");
      waitingNext = false;
      startLoop(); // chạy lại loop chính
    }, 10000);

  } else {
    console.log("[SHLX AutoNext] No next lesson found.");
  }
}

// ---------- LOOP CHÍNH ----------

function loopCheck() {
  if (!settings.enabled) return;

  // Auto refresh
  if (settings.refreshSec && settings.refreshSec > 0) {
    const now = Date.now();
    const elapsedSec = (now - lastRefreshTime) / 1000;
    if (elapsedSec >= settings.refreshSec) {
      console.log("[SHLX AutoNext] Auto refresh...");
      lastRefreshTime = Date.now();
      location.reload();
      return;
    }
  }

  const hasVideo = hasVideoOnPage();

  if (hasVideo) startYoutubeAutoPlayLoop();
  else stopYoutubeAutoPlayLoop();

  const p = getProgress();
  console.log("[SHLX AutoNext] Progress:", p + "%");

  // Auto next ngay (delay đã đưa vào clickNextLesson)
  if (p >= settings.threshold && !waitingNext) {
    waitingNext = true;
    console.log("[SHLX AutoNext] Đủ % → next ngay.");
    clickNextLesson();
  }
}

// ---------- MESSAGE HANDLER ----------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "UPDATE_SETTINGS") {
    settings.enabled = !!msg.payload.enabled;
    settings.intervalMs = parseInt(msg.payload.intervalMs, 10) || 10000;
    settings.threshold = parseInt(msg.payload.threshold, 10) || 100;
    settings.refreshSec = parseInt(msg.payload.refreshSec, 10) || 0;

    chrome.storage.sync.set(settings);
    console.log("[SHLX AutoNext] Settings updated:", settings);
    startLoop();

    sendResponse({ ok: true });
    return;
  }

  if (msg.type === "GET_STATUS") {
    const progress = getProgress();
    const info = getLessonInfo();
    const hv = hasVideoOnPage();

    sendResponse({
      enabled: settings.enabled,
      progress,
      currentTitle: info.currentTitle,
      nextTitle: info.nextButton ? info.nextButton.textContent.trim() : null,
      hasVideo: hv
    });
    return;
  }
});

// ---------- LOOP CONTROL ----------

function clearLoopTimer() {
  if (loopTimerId) {
    clearTimeout(loopTimerId);
    loopTimerId = null;
  }
}

function queueNextLoop() {
  clearLoopTimer();
  if (!settings.enabled) return;

  const delay = Math.max(
    MIN_LOOP_INTERVAL,
    parseInt(settings.intervalMs, 10) || MIN_LOOP_INTERVAL
  );

  loopTimerId = setTimeout(() => {
    if (!settings.enabled) return;

    const runLoop = () => {
      if (!settings.enabled) return;
      loopCheck();
      queueNextLoop();
    };

    if (typeof window.requestIdleCallback === "function") {
      requestIdleCallback(
        () => runLoop(),
        { timeout: delay }
      );
    } else {
      runLoop();
    }
  }, delay);
}

function startLoop() {
  clearLoopTimer();

  if (!settings.enabled) {
    stopYoutubeAutoPlayLoop();
    return;
  }

  loopCheck();
  queueNextLoop();
}
