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
  const systemPrompt = `You are a JSON-only API. You analyze text and return a single JSON object.
Required format:
{"task":"short name max 50 chars","content":"structured detail","category":"one of: Công việc, AI, Cá nhân, Mua sắm, Nghiên cứu và học tập","priority":"Khẩn cấp or Không khẩn cấp"}

Rules:
- task: extract the main idea as a short, clear task name (Vietnamese)
- content: rewrite the original text in structured, readable Vietnamese. Use dash (-) for lists
- category: classify based on content (Mua sắm=shopping, Cá nhân=personal, Công việc=work, AI=tech/AI, Nghiên cứu và học tập=study)
- priority: default "Không khẩn cấp", only "Khẩn cấp" if urgent

RESPOND WITH ONLY THE JSON OBJECT. No markdown. No code blocks. No explanation.`;

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
      temperature: 0.2,
      max_tokens: 800,
      response_format: { type: 'json_object' }
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

  const result = extractJSON(content);
  if (!result) {
    console.error('AI raw response:', content);
    throw new Error('Không thể phân tích kết quả AI');
  }

  // Validate and set defaults
  return {
    task: (result.task || 'Nhiệm vụ mới').substring(0, 50),
    content: result.content || text.substring(0, 2000),
    category: ['Công việc', 'AI', 'Cá nhân', 'Mua sắm', 'Nghiên cứu và học tập'].includes(result.category)
      ? result.category : 'Công việc',
    priority: result.priority === 'Khẩn cấp' ? 'Khẩn cấp' : 'Không khẩn cấp'
  };
}

// ---- Bulletproof JSON extractor ----
function extractJSON(text) {
  const raw = text.trim();

  // Attempt 1: Direct parse (ideal case)
  try { return JSON.parse(raw); } catch (e) { /* continue */ }

  // Attempt 2: Extract from code block ```json ... ``` or ``` ... ```
  const codeBlock = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (codeBlock) {
    try { return JSON.parse(codeBlock[1].trim()); } catch (e) { /* continue */ }
  }

  // Attempt 3: Find first { ... } containing "task"
  const braceMatch = raw.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g);
  if (braceMatch) {
    for (const candidate of braceMatch) {
      try {
        const obj = JSON.parse(candidate);
        if (obj.task) return obj;
      } catch (e) { /* try next */ }
    }
  }

  // Attempt 4: Aggressive cleanup - remove ALL markdown then find JSON
  let cleaned = raw
    .replace(/```(?:json)?\s*\n?/g, '')  // Remove opening code blocks
    .replace(/\n?\s*```/g, '')            // Remove closing code blocks
    .replace(/\*\*([^*]*)\*\*/g, '$1')    // Remove **bold**
    .replace(/\*([^*]*)\*/g, '$1')        // Remove *italic*
    .replace(/^[^{]*/, '')                // Remove everything before first {
    .replace(/[^}]*$/, '')                // Remove everything after last }
    .trim();

  try { return JSON.parse(cleaned); } catch (e) { /* continue */ }

  // Attempt 5: Line-by-line reconstruction
  const lines = raw.split('\n');
  let inJson = false;
  let jsonLines = [];
  for (const line of lines) {
    if (line.trim().startsWith('{')) inJson = true;
    if (inJson) jsonLines.push(line);
    if (line.trim().endsWith('}') && inJson) {
      try { return JSON.parse(jsonLines.join('\n')); } catch (e) {
        jsonLines = [];
        inJson = false;
      }
    }
  }

  return null;
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
