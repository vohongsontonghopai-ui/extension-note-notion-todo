// ==========================================
// Notion Task AI - Background Service Worker
// ==========================================

// Import config (contains API keys - gitignored)
try {
  importScripts('config.js');
} catch (e) {
  console.warn('config.js not found, using empty defaults. Configure via popup settings.');
}

const DEFAULT_CONFIG = (typeof CONFIG !== 'undefined') ? CONFIG : {
  openrouterApiKey: '',
  notionToken: '',
  notionDatabaseId: '',
  aiModel: 'google/gemini-2.0-flash-001'
};

// ---- Context Menu Setup ----
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'send-to-notion',
    title: '📋 Gửi vào Notion',
    contexts: ['selection']
  });

  // Auto-save default config on first install
  chrome.storage.sync.get(DEFAULT_CONFIG, (existing) => {
    if (!existing.openrouterApiKey || !existing.notionToken || !existing.notionDatabaseId) {
      chrome.storage.sync.set(DEFAULT_CONFIG, () => {
        console.log('Notion Task AI: Config saved.');
      });
    }
  });
});

// ---- Context Menu Click Handler ----
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'send-to-notion' && info.selectionText) {
    const selectedText = info.selectionText.trim();
    if (!selectedText) return;

    // Notify user: processing
    sendToContentScript(tab.id, {
      type: 'NOTION_TASK_STATUS',
      status: 'processing',
      message: 'Đang phân tích nội dung...'
    });

    try {
      const config = await getConfig();

      // Step 1: AI Analysis
      sendToContentScript(tab.id, {
        type: 'NOTION_TASK_STATUS',
        status: 'processing',
        message: 'AI đang phân tích...'
      });
      const aiResult = await analyzeWithAI(selectedText, config);

      // Step 2: Send to Notion
      sendToContentScript(tab.id, {
        type: 'NOTION_TASK_STATUS',
        status: 'processing',
        message: 'Đang gửi vào Notion...'
      });
      const notionResult = await createNotionPage(aiResult, config);

      // Step 3: Success
      sendToContentScript(tab.id, {
        type: 'NOTION_TASK_STATUS',
        status: 'success',
        message: `✅ Đã gửi: "${aiResult.task}"`,
        data: aiResult
      });

      // Save to history
      await saveToHistory(aiResult, notionResult.url);

    } catch (error) {
      console.error('Notion Task AI Error:', error);
      sendToContentScript(tab.id, {
        type: 'NOTION_TASK_STATUS',
        status: 'error',
        message: `❌ Lỗi: ${error.message}`
      });
    }
  }
});

// ---- Send message to content script ----
function sendToContentScript(tabId, message) {
  chrome.tabs.sendMessage(tabId, message).catch(() => {
    // Content script might not be ready, ignore
  });
}

// ---- Get config from storage ----
async function getConfig() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(DEFAULT_CONFIG, (items) => {
      resolve(items);
    });
  });
}

// ---- AI Analysis via OpenRouter ----
async function analyzeWithAI(text, config) {
  const systemPrompt = `Bạn là trợ lý AI chuyên phân tích văn bản và tạo nhiệm vụ cho ứng dụng Notion.
Khi nhận được một đoạn văn bản, hãy phân tích và trả về JSON với các trường sau:

{
  "task": "Tên nhiệm vụ ngắn gọn (tối đa 50 ký tự)",
  "content": "Nội dung chi tiết, được soạn lại rõ ràng và có cấu trúc. Sử dụng dấu gạch đầu dòng (-) cho danh sách nếu cần",
  "category": "Một trong các loại: Công việc, AI, Cá nhân, Mua sắm, Nghiên cứu và học tập",
  "priority": "Một trong: Khẩn cấp, Không khẩn cấp"
}

Quy tắc:
- "task": Trích xuất ý chính thành tên nhiệm vụ ngắn gọn, rõ ràng
- "content": Soạn lại nội dung gốc thành dạng có cấu trúc, dễ đọc. Nếu là danh sách thì dùng dấu gạch đầu dòng
- "category": Phân loại dựa trên nội dung:
  + "Mua sắm" - liên quan đến mua đồ, giá cả
  + "Cá nhân" - việc cá nhân, sinh hoạt
  + "Công việc" - công việc, dự án
  + "AI" - liên quan đến AI, công nghệ
  + "Nghiên cứu và học tập" - học tập, nghiên cứu, tài liệu
- "priority": Mặc định "Không khẩn cấp", chỉ "Khẩn cấp" nếu nội dung thể hiện sự cấp bách

CHỈ trả về JSON, không thêm bất kỳ text nào khác.`;

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.openrouterApiKey}`,
      'HTTP-Referer': 'chrome-extension://notion-task-ai',
      'X-Title': 'Notion Task AI Extension'
    },
    body: JSON.stringify({
      model: config.aiModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text }
      ],
      temperature: 0.3,
      max_tokens: 1000
    })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(`OpenRouter API lỗi: ${response.status} - ${errorData.error?.message || 'Unknown'}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('AI không trả về kết quả');
  }

  // Parse JSON from AI response (handle markdown code blocks)
  let jsonStr = content.trim();
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  try {
    const result = JSON.parse(jsonStr);
    // Validate required fields
    if (!result.task || !result.content || !result.category || !result.priority) {
      throw new Error('Missing fields');
    }
    return result;
  } catch (e) {
    throw new Error(`Không thể phân tích kết quả AI: ${e.message}`);
  }
}

// ---- Create Notion Page ----
async function createNotionPage(aiResult, config) {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  const pageData = {
    parent: {
      database_id: config.notionDatabaseId
    },
    properties: {
      'Nhiệm vụ': {
        title: [
          {
            text: {
              content: aiResult.task
            }
          }
        ]
      },
      'Tiến độ': {
        status: {
          name: 'Chưa làm'
        }
      },
      'Nội dung': {
        rich_text: [
          {
            text: {
              content: aiResult.content.substring(0, 2000) // Notion limit
            }
          }
        ]
      },
      'Date': {
        date: {
          start: today
        }
      },
      'Loại công việc': {
        select: {
          name: aiResult.category
        }
      },
      'Độ ưu tiên': {
        select: {
          name: aiResult.priority
        }
      }
    }
  };

  const response = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.notionToken}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28'
    },
    body: JSON.stringify(pageData)
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(`Notion API lỗi: ${response.status} - ${errorData.message || 'Unknown'}`);
  }

  return response.json();
}

// ---- Save to History ----
async function saveToHistory(aiResult, notionUrl) {
  return new Promise((resolve) => {
    chrome.storage.local.get({ history: [] }, (data) => {
      const history = data.history;
      history.unshift({
        task: aiResult.task,
        category: aiResult.category,
        priority: aiResult.priority,
        url: notionUrl,
        timestamp: new Date().toISOString()
      });
      // Keep only last 20 entries
      if (history.length > 20) history.length = 20;
      chrome.storage.local.set({ history }, resolve);
    });
  });
}

// ---- Listen for messages from popup ----
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_HISTORY') {
    chrome.storage.local.get({ history: [] }, (data) => {
      sendResponse(data.history);
    });
    return true; // async response
  }
  if (message.type === 'SAVE_CONFIG') {
    chrome.storage.sync.set(message.config, () => {
      sendResponse({ success: true });
    });
    return true;
  }
  if (message.type === 'GET_CONFIG') {
    getConfig().then((config) => {
      sendResponse(config);
    });
    return true;
  }
});
