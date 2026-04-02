// ==========================================
// Notion Task AI - Content Script (Toast UI)
// ==========================================

(function () {
  let toastContainer = null;
  let hideTimeout = null;

  function getOrCreateContainer() {
    if (toastContainer && document.body.contains(toastContainer)) {
      return toastContainer;
    }
    toastContainer = document.createElement('div');
    toastContainer.id = 'notion-task-ai-toast';
    toastContainer.className = 'nta-toast-container';
    document.body.appendChild(toastContainer);
    return toastContainer;
  }

  function showToast(status, message, data) {
    const container = getOrCreateContainer();

    // Clear previous timeout
    if (hideTimeout) {
      clearTimeout(hideTimeout);
      hideTimeout = null;
    }

    // Icon mapping
    const icons = {
      processing: `<div class="nta-spinner"></div>`,
      success: `<svg class="nta-icon nta-icon-success" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
      error: `<svg class="nta-icon nta-icon-error" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`
    };

    // Category badge
    let categoryBadge = '';
    if (data && data.category) {
      const categoryColors = {
        'Công việc': '#8b5cf6',
        'AI': '#f59e0b',
        'Cá nhân': '#3b82f6',
        'Mua sắm': '#ec4899',
        'Nghiên cứu và học tập': '#f97316'
      };
      const color = categoryColors[data.category] || '#6b7280';
      categoryBadge = `<span class="nta-badge" style="background:${color}20;color:${color};border:1px solid ${color}40">${data.category}</span>`;
    }

    container.innerHTML = `
      <div class="nta-toast nta-toast-${status}">
        <div class="nta-toast-header">
          <div class="nta-toast-icon">${icons[status] || ''}</div>
          <div class="nta-toast-brand">Notion Task AI</div>
        </div>
        <div class="nta-toast-body">
          <div class="nta-toast-message">${escapeHtml(message)}</div>
          ${categoryBadge ? `<div class="nta-toast-meta">${categoryBadge}</div>` : ''}
        </div>
      </div>
    `;

    // Trigger animation
    requestAnimationFrame(() => {
      const toast = container.querySelector('.nta-toast');
      if (toast) toast.classList.add('nta-toast-visible');
    });

    // Auto-hide after delay
    if (status === 'success' || status === 'error') {
      hideTimeout = setTimeout(() => {
        const toast = container.querySelector('.nta-toast');
        if (toast) {
          toast.classList.remove('nta-toast-visible');
          toast.classList.add('nta-toast-hiding');
          setTimeout(() => {
            if (container.parentNode) container.remove();
            toastContainer = null;
          }, 400);
        }
      }, status === 'success' ? 4000 : 6000);
    }
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Listen for messages from background
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'NOTION_TASK_STATUS') {
      showToast(message.status, message.message, message.data);
    }
  });
})();
