importScripts('storage.js');

const activeJobs = new Map();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function hash(value) {
  let result = 2166136261;
  const source = String(value || '');
  for (let index = 0; index < source.length; index += 1) {
    result ^= source.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(16);
}

function safeFileName(value, fallback) {
  const text = String(value || fallback || '未命名')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim();
  return (text || fallback || '未命名').slice(0, 120);
}

function controlFor(jobId) {
  if (!activeJobs.has(jobId)) {
    activeJobs.set(jobId, { pauseRequested: false, stopRequested: false, running: null });
  }
  return activeJobs.get(jobId);
}

async function updateJob(jobId, updater) {
  const job = await XianyuStorage.getJob(jobId);
  if (!job) throw new Error('批量任务不存在');
  const next = typeof updater === 'function' ? updater(job) : Object.assign(job, updater);
  await XianyuStorage.putJob(next);
  return next;
}

async function updateConversation(jobId, conversationId, updater) {
  return updateJob(jobId, job => {
    const conversation = job.conversations.find(item => item.id === conversationId);
    if (conversation) updater(conversation, job);
    return job;
  });
}

async function isRunnable(jobId) {
  const control = controlFor(jobId);
  const job = await XianyuStorage.getJob(jobId);
  return Boolean(job) &&
    !control.stopRequested &&
    !control.pauseRequested &&
    job.status !== 'stopped' &&
    job.status !== 'paused';
}

async function waitUntilRunnable(jobId) {
  while (true) {
    const control = controlFor(jobId);
    const job = await XianyuStorage.getJob(jobId);
    if (!job || control.stopRequested || job.status === 'stopped') return false;
    if (job.status !== 'paused' && !control.pauseRequested) {
      control.pauseRequested = false;
      return true;
    }
    await sleep(600);
  }
}

async function sendToTab(tabId, payload) {
  if (!tabId) throw new Error('没有可用的闲鱼页面标签页');
  try {
    return await chrome.tabs.sendMessage(tabId, payload);
  } catch (firstError) {
    // Recover when the tab was opened before the extension was installed or updated.
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      await sleep(50);
      return await chrome.tabs.sendMessage(tabId, payload);
    } catch (retryError) {
      const message = retryError && retryError.message ? retryError.message : String(retryError || firstError);
      if (/Receiving end does not exist|Could not establish connection|message port closed/i.test(message)) {
        throw new Error('当前闲鱼页面还没有加载插件脚本，请刷新页面后继续任务。');
      }
      throw new Error('无法连接闲鱼页面：' + message);
    }
  }
}

function isXianyuUrl(url) {
  try {
    return /(^|\.)((goofish|xianyu)\.com)$/i.test(new URL(url).hostname);
  } catch (_) {
    return false;
  }
}

async function resolveXianyuTab(preferredTabId, previousTabId) {
  const candidates = [];
  for (const tabId of [preferredTabId, previousTabId]) {
    if (!tabId || candidates.some(tab => tab.id === tabId)) continue;
    try {
      const tab = await chrome.tabs.get(tabId);
      if (isXianyuUrl(tab.url)) candidates.push(tab);
    } catch (_) {
      // The tab may have been closed; continue with the current Xianyu tabs.
    }
  }
  const activeTabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  activeTabs.forEach(tab => {
    if (isXianyuUrl(tab.url) && !candidates.some(item => item.id === tab.id)) candidates.push(tab);
  });
  if (!candidates.length) {
    const xianyuTabs = await chrome.tabs.query({
      url: ['*://xianyu.com/*', '*://*.xianyu.com/*', '*://goofish.com/*', '*://*.goofish.com/*']
    });
    xianyuTabs.forEach(tab => {
      if (!candidates.some(item => item.id === tab.id)) candidates.push(tab);
    });
  }
  if (!candidates.length) throw new Error('请先打开已登录的闲鱼卖家页面，再点击继续任务。');
  return candidates[0];
}

function extensionForMime(mime, url) {
  const known = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/quicktime': 'mov'
  };
  if (known[mime]) return known[mime];
  try {
    const path = new URL(url).pathname;
    const match = path.match(/\.([a-z0-9]{2,5})$/i);
    if (match) return match[1].toLowerCase();
  } catch (_) {
    // Ignore malformed media URLs; use a generic extension.
  }
  return 'bin';
}

async function downloadMediaForConversation(jobId, conversationId) {
  const messages = await XianyuStorage.getMessages(jobId, conversationId);
  const urls = [];
  const seen = new Set();
  messages.forEach(message => {
    [message.mediaUrl, message.quoteMediaUrl].filter(Boolean).forEach(url => {
      if (!seen.has(url)) {
        seen.add(url);
        urls.push(url);
      }
    });
  });

  const mediaByUrl = {};
  const usedNames = new Set();
  const conversation = (await XianyuStorage.getConversations(jobId)).find(item => item.id === conversationId);
  const baseName = safeFileName(conversation?.title, '会话');

  for (let index = 0; index < urls.length; index += 1) {
    if (!(await isRunnable(jobId))) {
      const control = controlFor(jobId);
      throw new Error(control.stopRequested ? '任务已停止' : '任务已暂停');
    }
    const url = urls[index];
    const mediaKey = jobId + ':' + conversationId + ':' + hash(url);
    let record = {
      mediaKey,
      jobId,
      conversationId,
      url,
      status: 'failed',
      localPath: '',
      mimeType: '',
      size: 0,
      error: ''
    };
    try {
      let response;
      let lastError;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          response = await fetch(url, { credentials: 'include', cache: 'no-store' });
          if (response.ok) break;
          lastError = new Error('HTTP ' + response.status);
        } catch (error) {
          lastError = error;
        }
        if (attempt === 0) await sleep(500);
      }
      if (!response || !response.ok) throw lastError || new Error('媒体下载失败');
      const blob = await response.blob();
      if (!blob.size) throw new Error('媒体内容为空');
      const mimeType = blob.type || response.headers.get('content-type') || 'application/octet-stream';
      const extension = extensionForMime(mimeType.split(';')[0].trim(), url);
      let fileName = baseName + '_' + String(index + 1).padStart(3, '0') + '.' + extension;
      let suffix = 1;
      while (usedNames.has(fileName)) {
        fileName = baseName + '_' + String(index + 1).padStart(3, '0') + '_' + suffix + '.' + extension;
        suffix += 1;
      }
      usedNames.add(fileName);
      record = Object.assign(record, {
        status: 'downloaded',
        localPath: 'media/' + fileName,
        mimeType,
        size: blob.size,
        blob
      });
    } catch (error) {
      record.error = error.message || String(error);
    }
    await XianyuStorage.putMedia(record);
    mediaByUrl[url] = record;
  }

  await XianyuStorage.updateMessages(jobId, conversationId, message => {
    const main = message.mediaUrl ? mediaByUrl[message.mediaUrl] : null;
    const quote = message.quoteMediaUrl ? mediaByUrl[message.quoteMediaUrl] : null;
    return Object.assign(message, {
      mediaLocalPath: main && main.status === 'downloaded' ? main.localPath : '',
      quoteMediaLocalPath: quote && quote.status === 'downloaded' ? quote.localPath : ''
    });
  });

  return {
    total: urls.length,
    downloaded: Object.values(mediaByUrl).filter(item => item.status === 'downloaded').length,
    failed: Object.values(mediaByUrl).filter(item => item.status !== 'downloaded').length
  };
}

async function runJob(jobId) {
  const control = controlFor(jobId);
  if (control.running) return control.running;
  control.running = (async () => {
    try {
      let job = await XianyuStorage.getJob(jobId);
      if (!job) return;
      await updateJob(jobId, { status: 'running' });
      for (const conversation of job.conversations) {
        if (conversation.status === 'completed') continue;
        if (!(await waitUntilRunnable(jobId))) break;
        await updateJob(jobId, { status: 'running', currentConversationId: conversation.id });
        await updateConversation(jobId, conversation.id, item => {
          item.status = 'running';
          item.error = '';
        });
        try {
          await XianyuStorage.clearConversation(jobId, conversation.id);
          const response = await sendToTab(job.tabId, {
            action: 'PROCESS_CONVERSATION',
            jobId,
            conversation
          });
          if (!response || response.ok === false) {
            const error = new Error(response?.error || '会话采集失败');
            error.riskControl = Boolean(response?.riskControl);
            throw error;
          }
          const media = await downloadMediaForConversation(jobId, conversation.id);
          await updateConversation(jobId, conversation.id, item => {
            item.status = 'completed';
            if (response.productName) item.productName = response.productName;
            item.messageCount = response.messageCount || 0;
            item.mediaCount = media.downloaded;
            item.mediaFailed = media.failed;
          });
        } catch (error) {
          const stopped = control.stopRequested || /任务已停止/.test(error.message || '');
          const risk = !stopped && (Boolean(error.riskControl) ||
            /安全验证|验证码|访问受限|请求过于频繁|无法连接闲鱼页面|任务已暂停/.test(error.message || ''));
          await updateConversation(jobId, conversation.id, item => {
            item.status = risk ? 'paused' : 'failed';
            item.error = error.message || String(error);
          });
          if (risk) {
            await updateJob(jobId, { status: 'paused', pauseReason: error.message || '检测到页面访问限制' });
            break;
          }
          if (stopped) break;
        }
        job = await XianyuStorage.getJob(jobId);
      }
      job = await XianyuStorage.getJob(jobId);
      if (job && job.status === 'running') {
        const unfinished = job.conversations.some(item => item.status === 'pending' || item.status === 'running');
        await updateJob(jobId, { status: unfinished ? 'paused' : 'completed', currentConversationId: '' });
      }
    } catch (error) {
      await updateJob(jobId, { status: 'paused', pauseReason: error.message || String(error) }).catch(() => {});
    } finally {
      control.running = null;
    }
  })();
  return control.running;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      if (message.action === 'CONVERSATION_CHUNK') {
        await XianyuStorage.putMessages(message.jobId, message.conversationId, message.messages || []);
        const messageCount = (await XianyuStorage.getMessages(message.jobId, message.conversationId)).length;
        await updateConversation(message.jobId, message.conversationId, item => {
          item.messageCount = messageCount;
          item.error = '';
        });
        sendResponse({ ok: true });
        return;
      }
      if (message.action === 'JOB_SHOULD_PAUSE') {
        const job = await XianyuStorage.getJob(message.jobId);
        const control = controlFor(message.jobId);
        sendResponse({ ok: true, pause: !job || job.status === 'paused' || control.pauseRequested || control.stopRequested });
        return;
      }
      if (message.action === 'START_JOB') {
        const existing = await XianyuStorage.getLatestJob();
        if (existing && ['running', 'paused'].includes(existing.status)) {
          sendResponse({ ok: false, error: '已有批量任务正在进行，请先暂停或停止' });
          return;
        }
        const selectedConversations = [];
        const selectedIds = new Set();
        (message.conversations || []).forEach(item => {
          if (!item || !item.id || selectedIds.has(item.id)) return;
          selectedIds.add(item.id);
          selectedConversations.push(item);
        });
        const job = {
          jobId: 'job-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          status: 'pending',
          tabId: message.tabId,
          currentConversationId: '',
          pauseReason: '',
          conversations: selectedConversations.map(item => Object.assign({}, item, {
            status: 'pending',
            messageCount: 0,
            mediaCount: 0,
            mediaFailed: 0,
            error: ''
          }))
        };
        if (!job.conversations.length) throw new Error('没有选择会话');
        await XianyuStorage.createJob(job);
        controlFor(job.jobId);
        runJob(job.jobId);
        sendResponse({ ok: true, job });
        return;
      }
      if (message.action === 'PAUSE_JOB') {
        const job = await updateJob(message.jobId, { status: 'paused', pauseReason: '用户手动暂停' });
        controlFor(message.jobId).pauseRequested = true;
        sendResponse({ ok: true, job });
        return;
      }
      if (message.action === 'RESUME_JOB') {
        const current = await XianyuStorage.getJob(message.jobId);
        if (!current) throw new Error('批量任务不存在');
        const tab = await resolveXianyuTab(message.tabId, current.tabId);
        const job = await updateJob(message.jobId, item => {
          item.status = 'running';
          item.pauseReason = '';
          item.tabId = tab.id;
          return item;
        });
        const control = controlFor(message.jobId);
        control.pauseRequested = false;
        control.stopRequested = false;
        runJob(message.jobId);
        sendResponse({ ok: true, job });
        return;
      }
      if (message.action === 'STOP_JOB') {
        const control = controlFor(message.jobId);
        control.stopRequested = true;
        const job = await updateJob(message.jobId, { status: 'stopped', pauseReason: '用户停止任务' });
        sendResponse({ ok: true, job });
        return;
      }
      if (message.action === 'GET_JOB_STATUS') {
        const job = message.jobId ? await XianyuStorage.getJob(message.jobId) : await XianyuStorage.getLatestJob();
        if (job && job.status === 'running' && !controlFor(job.jobId).running) runJob(job.jobId);
        sendResponse({ ok: true, job });
        return;
      }
      if (message.action === 'EXPORT_JOB') {
        sendResponse({ ok: true, jobId: message.jobId, handledBy: 'popup' });
        return;
      }
      sendResponse({ ok: false, error: '未知操作' });
    } catch (error) {
      sendResponse({ ok: false, error: error.message || String(error) });
    }
  })();
  return true;
});
