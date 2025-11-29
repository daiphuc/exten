// ====== POPUP SCRIPT ======

document.addEventListener("DOMContentLoaded", () => {
  const enabledEl = document.getElementById("enabled");
  const intervalEl = document.getElementById("interval");
  const thresholdEl = document.getElementById("threshold");
  const statusEl = document.getElementById("status");

  const currentLessonEl = document.getElementById("currentLesson");
  const currentProgressEl = document.getElementById("currentProgress");
  const nextLessonEl = document.getElementById("nextLesson");
  const hasVideoEl = document.getElementById("hasVideo");

  // ➕ input mới: thời gian auto refresh (giây)
  const refreshEl = document.getElementById("refreshInterval");

  const saveBtn = document.getElementById("save");

  chrome.storage.sync.get(
    // thêm refreshSec với default = 0 (tức là tắt)
    { enabled: false, intervalMs: 5000, threshold: 100, refreshSec: 0 },
    (data) => {
      enabledEl.checked = data.enabled;
      intervalEl.value = data.intervalMs;
      thresholdEl.value = data.threshold;
      if (refreshEl) {
        refreshEl.value = data.refreshSec;
      }
    }
  );

  refreshStatus();

  saveBtn.addEventListener("click", () => {
    const newSettings = {
      enabled: enabledEl.checked,
      intervalMs: parseInt(intervalEl.value, 10) || 5000,
      threshold: parseInt(thresholdEl.value, 10) || 100,
      // đọc thêm refreshSec từ ô input, 0 = tắt auto refresh
      refreshSec: refreshEl ? (parseInt(refreshEl.value, 10) || 0) : 0
    };

    chrome.storage.sync.set(newSettings, () => {
      statusEl.textContent = "Đã lưu cài đặt.";

      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs[0];
        if (!tab || !tab.id) return;

        // Nếu không phải trang SHLX thì khỏi gửi message, tránh lỗi
        if (!tab.url || !tab.url.startsWith("https://loctho.lms.shlx.vn/")) {
          console.log("[SHLX AutoNext] UPDATE_SETTINGS: tab không phải SHLX, bỏ qua sendMessage.");
          return;
        }

        chrome.tabs.sendMessage(
          tab.id,
          { type: "UPDATE_SETTINGS", payload: newSettings },
          (res) => {
            if (chrome.runtime.lastError) {
              console.log(
                "[SHLX AutoNext] UPDATE_SETTINGS error:",
                chrome.runtime.lastError.message
              );
            }
          }
        );
      });

      setTimeout(() => {
        statusEl.textContent = "";
      }, 2000);
    });
  });


  function refreshStatus() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab || !tab.id) {
        currentLessonEl.textContent = "Không có tab nào.";
        currentProgressEl.textContent = "?";
        nextLessonEl.textContent = "—";
        hasVideoEl.textContent = "Không";
        return;
      }

      if (!tab.url || !tab.url.startsWith("https://loctho.lms.shlx.vn/")) {
        currentLessonEl.textContent = "Hãy mở popup trên tab SHLX.";
        currentProgressEl.textContent = "?";
        nextLessonEl.textContent = "—";
        hasVideoEl.textContent = "Không";
        return;
      }

      chrome.tabs.sendMessage(
        tab.id,
        { type: "GET_STATUS" },
        (res) => {
          if (chrome.runtime.lastError) {
            console.log("GET_STATUS error:", chrome.runtime.lastError.message);
            currentLessonEl.textContent = "Không kết nối được với trang.";
            currentProgressEl.textContent = "?";
            nextLessonEl.textContent = "—";
            hasVideoEl.textContent = "Không";
            return;
          }

          if (!res) {
            currentLessonEl.textContent = "Không lấy được trạng thái.";
            currentProgressEl.textContent = "?";
            nextLessonEl.textContent = "—";
            hasVideoEl.textContent = "Không";
            return;
          }

          currentLessonEl.textContent = res.currentTitle || "Không xác định";
          currentProgressEl.textContent =
            (typeof res.progress === "number" ? res.progress : "?") + "%";
          nextLessonEl.textContent =
            res.nextTitle || "Không tìm thấy bài kế tiếp.";

          // hiển thị video
          if (res.hasVideo) {
            hasVideoEl.textContent = "Có";
          } else {
            hasVideoEl.textContent = "Không";
          }

          if (res.enabled !== undefined) {
            enabledEl.checked = res.enabled;
          }
        }
      );
    });
  }
});
