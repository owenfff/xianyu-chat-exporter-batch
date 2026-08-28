(function (root) {
  'use strict';

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/\n/g, '<br>');
  }

  function escapeMarkdown(value) {
    return String(value == null ? '' : value).replace(/([*_[\]#>])/g, '\\$1');
  }

  function safeFileName(value, fallback) {
    const text = String(value || fallback || '未命名')
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
      .replace(/[. ]+$/g, '')
      .trim();
    return (text || fallback || '未命名').slice(0, 120);
  }

  function dateString(date) {
    const source = date ? new Date(date) : new Date();
    return source.toISOString().slice(0, 10);
  }

  function messageFingerprint(message) {
    const source = [
      message.sender || '',
      message.isMe ? 'me' : 'other',
      message.timestamp || '',
      message.type || 'text',
      message.text || '',
      message.mediaUrl || '',
      message.quote || '',
      message.quoteMediaUrl || ''
    ].join('\u001f');
    let hash = 2166136261;
    for (let index = 0; index < source.length; index += 1) {
      hash ^= source.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  }

  function relativeMediaPath(localPath, fromConversationFile) {
    if (!localPath) return '';
    return fromConversationFile ? '../' + localPath : localPath;
  }

  function getMediaPath(message, field, mediaByUrl, fromConversationFile) {
    const url = message[field];
    const record = url && mediaByUrl ? mediaByUrl[url] : null;
    return relativeMediaPath(record && record.status === 'downloaded' ? record.localPath : '', fromConversationFile) || url || '';
  }

  function renderQuote(message, mediaByUrl, fromConversationFile) {
    if (!message.quote && !message.quoteMediaUrl) return '';
    const quoteMedia = getMediaPath(message, 'quoteMediaUrl', mediaByUrl, fromConversationFile);
    const mediaRecord = message.quoteMediaUrl && mediaByUrl ? mediaByUrl[message.quoteMediaUrl] : null;
    const isVideo = Boolean(mediaRecord && /^video\//i.test(mediaRecord.mimeType || '')) ||
      /\.(mp4|webm|mov)(?:[?#]|$)/i.test(message.quoteMediaUrl || '');
    const mediaMarkup = quoteMedia
      ? (isVideo
        ? '<video class="quote-media video" src="' + escapeHtml(quoteMedia) + '" controls preload="metadata"></video>'
        : '<a href="' + escapeHtml(quoteMedia) + '"><img class="quote-media" src="' + escapeHtml(quoteMedia) + '" alt="引用媒体"></a>')
      : '';
    return '<div class="quote"><div class="quote-label">↩ 引用</div>' +
      '<div>' + escapeHtml(message.quote || '[媒体]') + '</div>' +
      mediaMarkup +
      '</div>';
  }

  function renderMessage(message, mediaByUrl, fromConversationFile) {
    const media = getMediaPath(message, 'mediaUrl', mediaByUrl, fromConversationFile);
    const avatar = message.avatar
      ? '<img class="avatar" src="' + escapeHtml(message.avatar) + '" alt="">'
      : '';
    let body = '';
    if (message.type === 'image' && media) {
      body = '<a href="' + escapeHtml(media) + '"><img class="media" src="' +
        escapeHtml(media) + '" alt="图片"></a>';
    } else if (message.type === 'video' && media) {
      body = '<video class="media video" src="' + escapeHtml(media) + '" controls preload="metadata"></video>';
    } else {
      body = '<div class="text">' + escapeHtml(message.text || '[' + (message.type || '消息') + ']') + '</div>';
    }
    return '<article class="message ' + (message.isMe ? 'mine' : 'theirs') + '">' +
      '<div class="meta">' + avatar + '<span class="sender">' + escapeHtml(message.sender || (message.isMe ? '我' : '对方')) +
      '</span><span class="time">' + escapeHtml(message.timestamp || '') + '</span></div>' +
      renderQuote(message, mediaByUrl, fromConversationFile) +
      '<div class="bubble">' + body + '</div></article>';
  }

  function renderConversationHtml(conversation, messages, mediaByUrl, options) {
    const opts = options || {};
    const fromConversationFile = opts.fromConversationFile !== false;
    const title = conversation && conversation.title ? conversation.title : '聊天记录';
    const rows = (messages || []).map(message => renderMessage(message, mediaByUrl || {}, fromConversationFile)).join('\n');
    return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>' + escapeHtml(title) + '</title><style>' +
      'body{margin:0;background:#f5f6f8;color:#202124;font:14px/1.6 -apple-system,BlinkSystemFont,"Segoe UI","Microsoft YaHei",sans-serif}' +
      '.wrap{max-width:900px;margin:0 auto;padding:28px 18px 50px}.head{background:#fff;border-radius:14px;padding:20px 22px;margin-bottom:18px;box-shadow:0 2px 12px #0000000d}' +
      'h1{font-size:22px;margin:0 0 8px}.sub{color:#7b8088;font-size:12px}.message{display:flex;flex-direction:column;margin:14px 0;max-width:78%}' +
      '.message.mine{margin-left:auto;align-items:flex-end}.message.theirs{margin-right:auto;align-items:flex-start}.meta{display:flex;align-items:center;gap:7px;color:#8a9099;font-size:12px;margin:0 8px 4px}.avatar{width:22px;height:22px;border-radius:50%;object-fit:cover}' +
      '.sender{font-weight:600;color:#555}.bubble{background:#fff;border-radius:12px;padding:10px 13px;box-shadow:0 2px 8px #0000000a;overflow:hidden}' +
      '.mine .bubble{background:#fff4bd}.text{white-space:normal;word-break:break-word}.media{display:block;max-width:min(520px,70vw);max-height:620px;border-radius:8px;object-fit:contain}.video{background:#111}.quote{margin-bottom:8px;padding:8px 10px;border-left:3px solid #e0b400;background:#fffbe5;color:#656a73;font-size:12px;max-width:520px}.quote-label{font-weight:600;color:#9b7a00;margin-bottom:2px}.quote-media{display:block;max-width:180px;max-height:120px;margin-top:6px;border-radius:6px}' +
      'a{color:inherit;text-decoration:none}' +
      '</style></head><body><main class="wrap"><header class="head"><h1>' + escapeHtml(title) +
      '</h1><div class="sub">导出时间：' + escapeHtml(new Date().toLocaleString('zh-CN')) +
      ' · 消息数：' + messages.length + '</div></header>' + rows + '</main></body></html>';
  }

  function renderConversationMarkdown(conversation, messages, mediaByUrl, options) {
    const opts = options || {};
    const fromConversationFile = opts.fromConversationFile !== false;
    const title = conversation && conversation.title ? conversation.title : '聊天记录';
    let output = '# 聊天记录：' + title + '\n\n';
    output += '> 导出时间：' + new Date().toLocaleString('zh-CN') + '\n\n---\n\n';
    (messages || []).forEach(message => {
      if (message.timestamp) output += '### ' + escapeMarkdown(message.timestamp) + '\n\n';
      output += '**' + escapeMarkdown(message.sender || (message.isMe ? '我' : '对方')) + '**：';
      if (message.quote) output += '\n\n> ' + escapeMarkdown(message.quote) + '\n\n';
      const media = getMediaPath(message, 'mediaUrl', mediaByUrl || {}, fromConversationFile);
      if (message.type === 'image' && media) output += '![' + escapeMarkdown(message.text || '图片') + '](' + media + ')';
      else if (message.type === 'video' && media) output += '[视频](' + media + ')';
      else output += escapeMarkdown(message.text || '[' + (message.type || '消息') + ']');
      output += '\n\n';
    });
    return output;
  }

  const api = {
    escapeHtml,
    safeFileName,
    dateString,
    messageFingerprint,
    renderConversationHtml,
    renderConversationMarkdown
  };

  root.XianyuExporter = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
