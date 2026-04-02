// ==========================================
// Notion Task AI - Popup Script
// ==========================================

document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  loadHistory();
  loadSettings();
  setupSaveButton();
});

// ---- Tab Navigation ----
function initTabs() {
  const tabs = document.querySelectorAll('.tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      // Remove active from all
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

      // Activate clicked tab
      tab.classList.add('active');
      const tabId = tab.getAttribute('data-tab');
      document.getElementById(`tab-${tabId}`).classList.add('active');
    });
  });
}

// ---- Load History ----
function loadHistory() {
  chrome.runtime.sendMessage({ type: 'GET_HISTORY' }, (history) => {
    const container = document.getElementById('history-list');

    if (!history || history.length === 0) {
      return; // Keep empty state
    }

    container.innerHTML = '';
    history.forEach(item => {
      const el = document.createElement('a');
      el.className = 'history-item';
      if (item.url) {
        el.href = item.url;
        el.target = '_blank';
      }

      const badgeClass = getCategoryBadgeClass(item.category);
      const timeAgo = getTimeAgo(item.timestamp);

      el.innerHTML = `
        <div class="history-item-title">${escapeHtml(item.task)}</div>
        <div class="history-item-meta">
          <span class="history-badge ${badgeClass}">${escapeHtml(item.category)}</span>
          ${item.priority === 'Khẩn cấp' ? '<span class="history-badge badge-khan-cap">Khẩn cấp</span>' : ''}
          <span class="history-time">${timeAgo}</span>
        </div>
      `;

      container.appendChild(el);
    });
  });
}

// ---- Load Settings ----
function loadSettings() {
  chrome.runtime.sendMessage({ type: 'GET_CONFIG' }, (config) => {
    if (config) {
      document.getElementById('input-openrouter').value = config.openrouterApiKey || '';
      document.getElementById('input-notion-token').value = config.notionToken || '';
      document.getElementById('input-notion-db').value = config.notionDatabaseId || '';
      document.getElementById('input-model').value = config.aiModel || 'google/gemini-2.0-flash-001';
    }
  });
}

// ---- Save Settings ----
function setupSaveButton() {
  document.getElementById('btn-save').addEventListener('click', () => {
    const config = {
      openrouterApiKey: document.getElementById('input-openrouter').value.trim(),
      notionToken: document.getElementById('input-notion-token').value.trim(),
      notionDatabaseId: document.getElementById('input-notion-db').value.trim(),
      aiModel: document.getElementById('input-model').value
    };

    const statusEl = document.getElementById('save-status');

    if (!config.openrouterApiKey || !config.notionToken || !config.notionDatabaseId) {
      statusEl.textContent = '⚠️ Vui lòng điền đầy đủ thông tin';
      statusEl.className = 'save-status error';
      return;
    }

    chrome.runtime.sendMessage({ type: 'SAVE_CONFIG', config }, (response) => {
      if (response?.success) {
        statusEl.textContent = '✅ Đã lưu cài đặt thành công!';
        statusEl.className = 'save-status success';
        setTimeout(() => {
          statusEl.textContent = '';
          statusEl.className = 'save-status';
        }, 3000);
      }
    });
  });
}

// ---- Helpers ----
function getCategoryBadgeClass(category) {
  const map = {
    'Công việc': 'badge-cong-viec',
    'AI': 'badge-ai',
    'Cá nhân': 'badge-ca-nhan',
    'Mua sắm': 'badge-mua-sam',
    'Nghiên cứu và học tập': 'badge-nghien-cuu'
  };
  return map[category] || 'badge-cong-viec';
}

function getTimeAgo(timestamp) {
  const now = new Date();
  const date = new Date(timestamp);
  const diffMs = now - date;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return 'Vừa xong';
  if (diffMin < 60) return `${diffMin} phút trước`;
  if (diffHr < 24) return `${diffHr} giờ trước`;
  if (diffDay < 7) return `${diffDay} ngày trước`;
  return date.toLocaleDateString('vi-VN');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
