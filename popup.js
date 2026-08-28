(function () {
  'use strict';

  let activeTab = null;
  let currentPlatform = 'unknown';
  let currentTitle = '聊天记录';
  let messages = [];
  let conversations = [];
  let job = null;
  let pollTimer = null;

  const $ = id => document.getElementById(id);
  const sendRuntime = payload => new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(payload, response => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(response);
    });
  });
  const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

  async function sendTab(payload) {
    if (!activeTab || !activeTab.id) throw new Error('没有可用的网页标签页');
    try {
      return await chrome.tabs.sendMessage(activeTab.id, payload);
    } catch (firstError) {
      // A tab that was already open before the extension was installed or updated
      // may not have the content script yet. Inject it once and retry the request.
      try {
        await chrome.scripting.executeScript({ target: { tabId: activeTab.id }, files: ['content.js'] });
        await wait(50);
        return await chrome.tabs.sendMessage(activeTab.id, payload);
      } catch (retryError) {
        throw new Error(connectionErrorMessage(retryError || firstError));
      }
    }
  }

  function connectionErrorMessage(error) {
    const message = error && error.message ? error.message : String(error || '');
    if (/Receiving end does not exist|Could not establish connection|message port closed/i.test(message)) {
      return '当前闲鱼页面还没有加载插件脚本，请刷新闲鱼页面后重新打开插件。';
    }
    if (/Cannot access contents of url|The extensions gallery cannot be scripted|Cannot access a chrome-extension/i.test(message)) {
      return '当前页面不允许插件读取，请切换到已登录的闲鱼网页后再试。';
    }
    return '无法连接当前闲鱼页面：' + message;
  }

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    bindEvents();
    try {
      [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const url = activeTab && activeTab.url ? activeTab.url : '';
      if (/(\.|^)fiverr\.com/i.test(new URL(url).hostname)) currentPlatform = 'fiverr';
      else if (/(^|\.)((goofish|xianyu)\.com)$/i.test(new URL(url).hostname)) currentPlatform = 'xianyu';
      else {
        showUnsupported();
        return;
      }
      $('loading').classList.add('hidden');
      $('app').classList.remove('hidden');
      $('headerTitle').textContent = currentPlatform === 'fiverr' ? 'Fiverr Chat Export' : '闲鱼聊天记录批量导出';
      if (currentPlatform !== 'xianyu') {
        $('batchTab').classList.add('hidden');
        $('notice').textContent = '当前页面仅支持单个聊天导出。批量功能只对闲鱼网页开放。';
        $('notice').classList.remove('hidden');
      }
      const response = await sendTab({ action: 'GET_CURRENT_MESSAGES' });
      if (response && response.ok) {
        currentTitle = response.chatTitle || currentTitle;
        messages = (response.messages || []).map(message => Object.assign({ selected: true }, message));
      }
      renderMessages();
      await refreshJob();
      startPolling();
    } catch (error) {
      $('loading').classList.add('hidden');
      if (currentPlatform !== 'unknown') {
        $('app').classList.remove('hidden');
        showNotice(connectionErrorMessage(error), true);
        renderMessages();
        await refreshJob();
        startPolling();
      } else {
        showUnsupported(error.message || '无法读取当前页面');
      }
    }
  }

  function bindEvents() {
    $('singleTab').addEventListener('click', () => setTab('single'));
    $('batchTab').addEventListener('click', () => setTab('batch'));
    $('selectAll').addEventListener('change', event => {
      messages.forEach(message => { message.selected = event.target.checked; });
      renderMessages();
    });
    $('batchSelectAll').addEventListener('change', event => {
      conversations.forEach(conversation => { conversation.selected = event.target.checked; });
      renderConversations();
    });
    $('clearSelection').addEventListener('click', () => {
      conversations.forEach(conversation => { conversation.selected = false; });
      $('batchSelectAll').checked = false;
      renderConversations();
    });
    $('scanConversations').addEventListener('click', scanConversations);
    $('startJob').addEventListener('click', startJob);
    $('pauseJob').addEventListener('click', () => controlJob('PAUSE_JOB'));
    $('resumeJob').addEventListener('click', () => controlJob('RESUME_JOB'));
    $('stopJob').addEventListener('click', () => controlJob('STOP_JOB'));
    $('exportJob').addEventListener('click', exportJob);
    $('exportHtml').addEventListener('click', () => exportSingle('html'));
    $('exportMd').addEventListener('click', () => exportSingle('md'));
  }

  function setTab(tab) {
    const batch = tab === 'batch';
    $('singleTab').classList.toggle('active', !batch);
    $('batchTab').classList.toggle('active', batch);
    $('singleView').classList.toggle('hidden', batch);
    $('batchView').classList.toggle('hidden', !batch);
  }

  function showUnsupported(message) {
    $('loading').classList.add('hidden');
    $('app').classList.add('hidden');
    $('unsupported').classList.remove('hidden');
    if (message) $('unsupported').querySelector('div:last-child').textContent = message;
  }

  function showNotice(message, isError) {
    const element = $('notice');
    element.textContent = message || '';
    element.classList.toggle('hidden', !message);
    element.style.background = isError ? '#fff0f0' : '';
    element.style.color = isError ? '#9b1c1c' : '';
  }

  function renderMessages() {
    const list = $('messageList');
    list.innerHTML = '';
    $('singleEmpty').classList.toggle('hidden', messages.length > 0);
    $('exportHtml').disabled = messages.length === 0;
    $('exportMd').disabled = messages.length === 0;
    messages.forEach((message, index) => {
      const item = document.createElement('label');
      item.className = 'message-item';
      item.innerHTML = '<input type="checkbox" data-index="' + index + '"' + (message.selected ? ' checked' : '') +
        '><div class="message-main"><div class="message-meta"><span class="sender ' +
        (message.isMe ? 'mine' : '') + '">' + XianyuExporter.escapeHtml(message.sender || (message.isMe ? '我' : currentTitle)) +
        '</span><span class="time">' + XianyuExporter.escapeHtml(message.timestamp || '') +
        '</span></div><div class="message-text">' + XianyuExporter.escapeHtml(
          message.text || '[' + (message.type || '消息') + ']') + '</div></div>';
      item.querySelector('input').addEventListener('change', event => {
        messages[index].selected = event.target.checked;
        updateSingleStatus();
      });
      list.appendChild(item);
    });
    updateSingleStatus();
  }

  function updateSingleStatus() {
    const selected = messages.filter(message => message.selected).length;
    $('singleStatus').textContent = '已选择 ' + selected + ' / ' + messages.length + ' 条';
    $('selectAll').checked = messages.length > 0 && selected === messages.length;
  }

  async function scanConversations() {
    const button = $('scanConversations');
    const limit = readScanLimit();
    if (!limit) return;
    button.disabled = true;
    $('scanLimit').disabled = true;
    button.textContent = '扫描中…';
    showNotice('正在扫描前 ' + limit + ' 个会话，请保持闲鱼页面打开。');
    try {
      const response = await sendTab({ action: 'SCAN_CONVERSATIONS', limit });
      if (!response || response.ok === false) throw new Error(response?.error || '扫描失败');
      conversations = (response.conversations || []).map(item => Object.assign({ selected: true }, item));
      renderConversations();
      showNotice(conversations.length
        ? '扫描完成，共发现 ' + conversations.length + ' 个会话（上限 ' + limit + ' 个）。'
        : '没有发现可导出的会话。');
    } catch (error) {
      showNotice(error.message || '扫描失败', true);
    } finally {
      button.disabled = false;
      $('scanLimit').disabled = false;
      button.textContent = '扫描会话列表';
    }
  }

  function renderConversations() {
    const list = $('conversationList');
    list.innerHTML = '';
    $('conversationEmpty').classList.toggle('hidden', conversations.length > 0);
    conversations.forEach((conversation, index) => {
      const item = document.createElement('label');
      item.className = 'conversation-item';
      item.innerHTML = '<input type="checkbox" data-index="' + index + '"' + (conversation.selected ? ' checked' : '') +
        '><div class="conversation-main"><div class="conversation-meta"><span class="conversation-title">' +
        XianyuExporter.escapeHtml(conversation.title) + '</span><span class="time">' +
        XianyuExporter.escapeHtml(conversation.status || '') + '</span></div><div class="conversation-preview">' +
        XianyuExporter.escapeHtml(conversation.preview || '') + '</div></div>';
      item.querySelector('input').addEventListener('change', event => {
        conversations[index].selected = event.target.checked;
        updateConversationStatus();
      });
      list.appendChild(item);
    });
    updateConversationStatus();
  }

  function updateConversationStatus() {
    const selected = conversations.filter(conversation => conversation.selected).length;
    $('conversationStatus').textContent = conversations.length ? '已选 ' + selected + ' / ' + conversations.length + ' 个' : '尚未扫描';
    $('batchSelectAll').checked = conversations.length > 0 && selected === conversations.length;
  }

  function readScanLimit() {
    const input = $('scanLimit');
    const value = Number(input.value);
    if (!Number.isInteger(value) || value < 1 || value > 500) {
      showNotice('扫描数量请输入 1 到 500 之间的整数。', true);
      input.focus();
      return 0;
    }
    input.value = String(value);
    return value;
  }

  async function startJob() {
    const selected = conversations.filter(conversation => conversation.selected);
    if (!selected.length) {
      showNotice('请至少选择一个会话。', true);
      return;
    }
    try {
      const response = await sendRuntime({ action: 'START_JOB', tabId: activeTab.id, conversations: selected });
      if (!response || response.ok === false) throw new Error(response?.error || '无法启动批量任务');
      job = response.job;
      renderJob();
      showNotice('批量任务已启动。关闭此窗口不会清除任务，可重新打开查看进度。');
    } catch (error) {
      showNotice(error.message || '启动失败', true);
    }
  }

  async function controlJob(action) {
    if (!job) return;
    try {
      const response = await sendRuntime({ action, jobId: job.jobId });
      if (!response || response.ok === false) throw new Error(response?.error || '任务控制失败');
      job = response.job;
      renderJob();
    } catch (error) {
      showNotice(error.message || '任务控制失败', true);
    }
  }

  async function refreshJob() {
    try {
      const response = await sendRuntime({ action: 'GET_JOB_STATUS' });
      if (response && response.ok && response.job) {
        job = response.job;
        renderJob();
      }
    } catch (_) {
      // The popup can still provide single-chat export if the background worker is unavailable.
    }
  }

  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      if (!document.hidden) refreshJob();
    }, 1000);
  }

  function renderJob() {
    if (!job) return;
    const total = job.conversations.length;
    const finished = job.conversations.filter(item => item.status === 'completed' || item.status === 'failed').length;
    $('jobProgress').max = Math.max(1, total);
    $('jobProgress').value = finished;
    $('jobCount').textContent = finished + ' / ' + total;
    const current = job.conversations.find(item => item.status === 'running' || item.status === 'paused');
    const labels = { pending: '等待开始', running: '运行中', paused: '已暂停', completed: '已完成', stopped: '已停止' };
    $('jobStatus').textContent = labels[job.status] || job.status;
    $('jobNote').textContent = job.pauseReason || (current && current.error) || '';
    $('jobNote').classList.toggle('hidden', !$('jobNote').textContent);
    const active = job.status === 'running';
    const paused = job.status === 'paused';
    $('startJob').disabled = active || paused;
    $('pauseJob').disabled = !active;
    $('resumeJob').disabled = !paused;
    $('stopJob').disabled = !active && !paused;
    $('exportJob').disabled = finished === 0;
    if (job.conversations) {
      job.conversations.forEach(item => {
        const local = conversations.find(conversation => conversation.id === item.id);
        if (local) Object.assign(local, item);
      });
      renderConversations();
    }
  }

  async function exportSingle(format) {
    const selected = messages.filter(message => message.selected);
    if (!selected.length) {
      showNotice('请至少选择一条消息。', true);
      return;
    }
    const conversation = { title: currentTitle };
    const content = format === 'html'
      ? XianyuExporter.renderConversationHtml(conversation, selected, {}, { fromConversationFile: false })
      : XianyuExporter.renderConversationMarkdown(conversation, selected, {}, { fromConversationFile: false });
    downloadBlob(content, '聊天记录_' + XianyuExporter.safeFileName(currentTitle, '聊天记录') + '_' +
      XianyuExporter.dateString() + (format === 'html' ? '.html' : '.md'), format === 'html' ? 'text/html' : 'text/markdown');
    if ($('debugMode').checked) downloadBlob(JSON.stringify({ exportTime: new Date().toISOString(), conversation, messages: selected }, null, 2),
      '调试数据_' + XianyuExporter.safeFileName(currentTitle, '聊天记录') + '.json', 'application/json');
  }

  async function exportJob() {
    if (!job) return;
    const button = $('exportJob');
    button.disabled = true;
    button.textContent = '打包中…';
    try {
      const result = await buildAndDownloadJob(job.jobId);
      showNotice(result.skipped
        ? 'ZIP 导出完成，已包含 ' + result.exported + ' 个已处理会话，跳过 ' + result.skipped + ' 个未处理会话。'
        : 'ZIP 导出完成。');
    } catch (error) {
      showNotice(error.message || 'ZIP 导出失败', true);
    } finally {
      button.disabled = false;
      button.textContent = '导出 ZIP';
      renderJob();
    }
  }

  async function buildAndDownloadJob(jobId) {
    const storedJob = await XianyuStorage.getJob(jobId);
    if (!storedJob) throw new Error('批量任务不存在');
    const exportRecords = [];
    for (const conversation of storedJob.conversations) {
      const messages = await XianyuStorage.getMessages(jobId, conversation.id);
      const mediaRecords = await XianyuStorage.getMedia(jobId, conversation.id);
      // A paused/stopped task can contain many pending conversations. Do not
      // create empty HTML/JSON files for those; export completed and partial
      // conversations only so the archive remains useful and easy to open.
      if (conversation.status !== 'completed' && !messages.length && !mediaRecords.length) continue;
      exportRecords.push({ conversation, messages, mediaRecords });
    }
    const entries = [];
    const manifest = {
      schemaVersion: 1,
      jobId,
      exportedAt: new Date().toISOString(),
      status: storedJob.status,
      totalConversations: storedJob.conversations.length,
      exportedConversations: exportRecords.length,
      skippedConversationCount: storedJob.conversations.length - exportRecords.length,
      conversations: [],
      mediaFailures: []
    };
    const usedNames = new Set();
    const mediaAdded = new Set();
    const makeName = title => {
      const base = XianyuExporter.safeFileName(title, '会话');
      let name = base;
      let index = 2;
      while (usedNames.has(name)) name = base + '_' + index++;
      usedNames.add(name);
      return name;
    };

    for (const exportRecord of exportRecords) {
      const conversation = exportRecord.conversation;
      const name = makeName(conversation.title);
      const messagesForConversation = exportRecord.messages;
      const mediaRecords = exportRecord.mediaRecords;
      const mediaByUrl = Object.fromEntries(mediaRecords.map(record => [record.url, record]));
      const htmlPath = 'conversations/' + name + '.html';
      const rawPath = 'raw/' + name + '.json';
      entries.push({
        name: htmlPath,
        data: XianyuExporter.renderConversationHtml(conversation, messagesForConversation, mediaByUrl, { fromConversationFile: true })
      });
      entries.push({
        name: rawPath,
        data: JSON.stringify({
          conversation,
          messages: messagesForConversation.map(stripStorageFields)
        }, null, 2)
      });
      mediaRecords.forEach(record => {
        if (record.status === 'downloaded' && record.blob && !mediaAdded.has(record.localPath)) {
          mediaAdded.add(record.localPath);
          entries.push({ name: record.localPath, data: record.blob });
        }
        if (record.status !== 'downloaded') {
          manifest.mediaFailures.push({ conversationId: conversation.id, url: record.url, error: record.error || '下载失败' });
        }
      });
      manifest.conversations.push({
        id: conversation.id,
        title: conversation.title,
        status: conversation.status,
        messageCount: messagesForConversation.length,
        mediaCount: mediaRecords.filter(record => record.status === 'downloaded').length,
        mediaFailures: mediaRecords.filter(record => record.status !== 'downloaded').length,
        htmlPath,
        rawPath
      });
    }
    entries.unshift({ name: 'manifest.json', data: JSON.stringify(manifest, null, 2) });
    try {
      const blob = await XianyuZip.createZipBlob(entries);
      downloadBlob(blob, '闲鱼聊天备份_' + XianyuExporter.dateString() + '.zip', 'application/zip');
      return { exported: exportRecords.length, skipped: manifest.skippedConversationCount };
    } catch (error) {
      if (!storedJob.conversations.length) throw error;
      showNotice('批量 ZIP 过大，改为按会话拆分下载。');
      await downloadConversationParts(storedJob, manifest);
      return { exported: exportRecords.length, skipped: manifest.skippedConversationCount };
    }
  }

  async function downloadConversationParts(storedJob, manifest) {
    for (let partIndex = 0; partIndex < manifest.conversations.length; partIndex += 1) {
      const item = manifest.conversations[partIndex];
      const conversation = storedJob.conversations.find(record => record.id === item.id);
      const messagesForConversation = await XianyuStorage.getMessages(storedJob.jobId, item.id);
      const mediaRecords = await XianyuStorage.getMedia(storedJob.jobId, item.id);
      const mediaByUrl = Object.fromEntries(mediaRecords.map(record => [record.url, record]));
      const partEntries = [
        { name: 'manifest.json', data: JSON.stringify({ schemaVersion: 1, conversations: [item] }, null, 2) },
        { name: item.htmlPath, data: XianyuExporter.renderConversationHtml(conversation, messagesForConversation, mediaByUrl, { fromConversationFile: true }) },
        { name: item.rawPath, data: JSON.stringify({ conversation, messages: messagesForConversation.map(stripStorageFields) }, null, 2) }
      ];
      mediaRecords.filter(record => record.status === 'downloaded' && record.blob).forEach(record => {
        partEntries.push({ name: record.localPath, data: record.blob });
      });
      const blob = await XianyuZip.createZipBlob(partEntries);
      downloadBlob(blob, '闲鱼聊天备份_' + String(partIndex + 1).padStart(3, '0') + '_' +
        XianyuExporter.safeFileName(conversation.title, '会话') + '.zip', 'application/zip', false);
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }

  function stripStorageFields(message) {
    const output = Object.assign({}, message);
    delete output.jobId;
    delete output.conversationId;
    delete output.recordKey;
    return output;
  }

  function downloadBlob(data, filename, mime, saveAs) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    chrome.downloads.download({ url, filename, saveAs: saveAs !== false }, () => {
      const error = chrome.runtime.lastError;
      if (error) showNotice(error.message, true);
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    });
  }
})();
