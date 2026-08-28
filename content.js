(function () {
  'use strict';

  const SELECTORS = {
    messageItems: '[class*="ant-list-item"]',
    conversationItems: 'li,[role="button"],[class*="ant-list-item"],[class*="conversation"],[class*="session"],[class*="contact"],[class*="roster"],[class*="list-item"],[class*="user-item"],[class*="chat-item"]',
    messageText: '[class*="message-text"]',
    imageContainer: '[class*="image-container"]',
    quoteContainer: '[class*="reply-container"]',
    avatar: '[class*="avatar"]'
  };
  const RISK_TEXT = /(安全验证|身份验证|滑块验证|验证码|访问受限|请求过于频繁|操作频繁|请稍后再试|账号异常)/i;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function isXianyu() {
    return /(^|\.)((goofish|xianyu)\.com)$/i.test(location.hostname);
  }

  function isFiverr() {
    return /(^|\.)fiverr\.com$/i.test(location.hostname);
  }

  function absoluteUrl(value) {
    if (!value) return '';
    try {
      return new URL(value, location.href).href;
    } catch (_) {
      return value;
    }
  }

  function usableUrl(value) {
    const url = absoluteUrl(value);
    if (!url || !/^https?:/i.test(url)) return '';
    return url;
  }

  function cleanText(value) {
    return String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function hash(value) {
    let result = 2166136261;
    const source = String(value || '');
    for (let index = 0; index < source.length; index += 1) {
      result ^= source.charCodeAt(index);
      result = Math.imul(result, 16777619);
    }
    return (result >>> 0).toString(16);
  }

  function isValidAvatar(url) {
    return Boolean(url) &&
      !/tps-(1|2)-[12]|placeholder|default/i.test(url);
  }

  function mediaIdentity(url) {
    const value = String(url || '');
    const productImage = value.match(/O1CN[A-Za-z0-9]+/);
    return productImage ? productImage[0] : value.split('?')[0];
  }

  function getTitle(root) {
    const selectors = [
      '[class*="nickname"]',
      '[class*="user-name"]',
      '[class*="chat-title"]',
      '[class*="conversation-title"]'
    ];
    for (const selector of selectors) {
      const element = root.querySelector(selector);
      const value = cleanText(element && element.textContent);
      if (value && value.length <= 120) return value;
    }
    return '聊天记录';
  }

  function getMessageId(element, index, message) {
    const explicit = [
      element.getAttribute('data-message-id'),
      element.getAttribute('data-msg-id'),
      element.getAttribute('data-id'),
      element.dataset && element.dataset.messageId,
      element.dataset && element.dataset.msgId
    ].find(Boolean);
    if (explicit) return 'id:' + explicit;
    return 'fp:' + hash([
      message.sender,
      message.isMe ? 'me' : 'other',
      message.timestamp,
      message.type,
      message.text,
      message.mediaUrl,
      message.quote,
      message.quoteMediaUrl
    ].join('\u001f'));
  }

  function getTimestamp(element) {
    const directCandidates = [
      element.querySelector('time, [class*="timestamp"], [class*="time"], [class*="date"]'),
      element.closest('[style*="position: relative"]')?.previousElementSibling,
      element.previousElementSibling
    ].filter(Boolean);
    const datePattern = /\b(?:20\d{2}[\/-]\d{1,2}[\/-]\d{1,2}|(?:0?[1-9]|1[0-2])[\/-](?:0?[1-9]|[12]\d|3[01]))(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?/;
    let guard = 0;
    let current = directCandidates[0];
    while (current && guard < 20) {
      const text = cleanText(current.textContent);
      const match = text.match(datePattern);
      if (match) return match[0];
      current = current.previousElementSibling;
      guard += 1;
    }
    for (const candidate of directCandidates.slice(1)) {
      const match = cleanText(candidate.textContent).match(datePattern);
      if (match) return match[0];
    }
    return '';
  }

  function getImageUrl(element, selector) {
    const image = element.querySelector(selector || (SELECTORS.imageContainer + ' img'));
    if (!image) return '';
    const highDefinition = element.querySelector('.ant-image-img');
    return usableUrl((highDefinition && highDefinition.getAttribute('src')) || image.getAttribute('src'));
  }

  function parseXianyu(root) {
    const elements = Array.from(root.querySelectorAll(SELECTORS.messageItems)).filter(element => {
      if (element.querySelector('[class*="price"]')) return false;
      return Boolean(
        element.querySelector(SELECTORS.messageText) ||
        element.querySelector(SELECTORS.imageContainer) ||
        element.querySelector('video') ||
        element.querySelector('audio')
      );
    });

    const chatTitle = getTitle(root);
    let myAvatar = '';
    let otherAvatar = '';
    elements.forEach(element => {
      const style = element.getAttribute('style') || '';
      const isMe = /direction:\s*rtl|text-align:\s*right/i.test(style);
      const avatar = usableUrl(element.querySelector(SELECTORS.avatar)?.getAttribute('src'));
      if (!isValidAvatar(avatar)) return;
      if (isMe && !myAvatar) myAvatar = avatar;
      if (!isMe && !otherAvatar) otherAvatar = avatar;
    });

    const messages = [];
    elements.forEach((element, index) => {
      const style = element.getAttribute('style') || '';
      const isMe = /direction:\s*rtl|text-align:\s*right/i.test(style);
      const textNode = element.querySelector(SELECTORS.messageText + ' > span') ||
        element.querySelector(SELECTORS.messageText);
      let text = cleanText(textNode && textNode.textContent);
      const timestamp = getTimestamp(element);
      const imageUrl = getImageUrl(element);
      const video = element.querySelector('video');
      const videoUrl = usableUrl(video && (video.currentSrc || video.getAttribute('src')));
      const quoteElement = element.querySelector(SELECTORS.quoteContainer);
      let quote = '';
      let quoteMediaUrl = '';
      if (quoteElement) {
        const quoteName = cleanText(quoteElement.querySelector('[class*="user-nickname"]')?.textContent);
        const quoteText = cleanText(
          quoteElement.querySelector('span[style*="opacity"]')?.textContent ||
          quoteElement.querySelector('[class*="reply-content"], [class*="reply-text"]')?.textContent
        );
        const quoteVideo = quoteElement.querySelector('video');
        const quoteImage = quoteElement.querySelector('[class*="reply-image"] img, img');
        quoteMediaUrl = usableUrl(quoteVideo && (quoteVideo.currentSrc || quoteVideo.getAttribute('src'))) ||
          getImageUrl(quoteElement, '[class*="reply-image"] img, img');
        quote = [quoteName, quoteText || (quoteMediaUrl ? '[媒体]' : '')].filter(Boolean).join(': ');
      }

      let actualImageUrl = imageUrl;
      let actualVideoUrl = videoUrl;
      if (quoteMediaUrl && mediaIdentity(quoteMediaUrl) === mediaIdentity(videoUrl)) actualVideoUrl = '';
      if (quoteMediaUrl && mediaIdentity(quoteMediaUrl) === mediaIdentity(imageUrl)) actualImageUrl = '';
      if (!text && actualImageUrl) text = '[图片]';
      if (!text && actualVideoUrl) text = '[视频]';
      if (!text && quote) text = '[引用]';
      if (!text && !actualImageUrl && !actualVideoUrl && !quote) return;

      const hadBodyText = Boolean(textNode && cleanText(textNode.textContent));
      const type = actualImageUrl ? 'image' : actualVideoUrl ? 'video' : quote && !hadBodyText ? 'quote' : 'text';
      const message = {
        key: getMessageId(element, index, {
          sender: isMe ? '我' : chatTitle,
          isMe,
          timestamp,
          type,
          text,
          mediaUrl: actualImageUrl || actualVideoUrl,
          quote,
          quoteMediaUrl
        }),
        sender: isMe ? '我' : chatTitle,
        isMe,
        timestamp,
        type,
        text,
        mediaUrl: actualImageUrl || actualVideoUrl,
        quote,
        quoteMediaUrl,
        avatar: isValidAvatar(usableUrl(element.querySelector(SELECTORS.avatar)?.getAttribute('src')))
          ? usableUrl(element.querySelector(SELECTORS.avatar)?.getAttribute('src'))
          : (isMe ? myAvatar : otherAvatar)
      };
      messages.push(message);
    });
    return { chatTitle, messages };
  }

  function parseFiverr(root) {
    const messages = [];
    const chatTitle = cleanText(root.querySelector('[class*="conversation"] h1, h1')?.textContent) || 'Fiverr Chat';
    root.querySelectorAll('.message').forEach((element, index) => {
      const fullText = element.textContent || '';
      const displayName = cleanText(element.querySelector('p')?.textContent);
      const isMe = displayName === 'Me';
      const timeMatch = fullText.match(/(\d{1,2}\s+\w+\s+\d{4},\s+\d{1,2}:\d{2})/);
      const timestamp = timeMatch ? timeMatch[1] : '';
      let text = timeMatch ? fullText.slice(fullText.indexOf(timeMatch[0]) + timeMatch[0].length).trim() : cleanText(fullText);
      if (displayName && text.startsWith(displayName)) text = text.slice(displayName.length).trim();
      const imageUrl = usableUrl(element.querySelector('.message-content img:not(figure img)')?.getAttribute('src'));
      if (!text && imageUrl) text = '[图片]';
      if (!text && !imageUrl) return;
      const message = {
        sender: isMe ? 'Me' : (displayName || chatTitle),
        isMe,
        timestamp,
        type: imageUrl ? 'image' : 'text',
        text,
        mediaUrl: imageUrl,
        quote: '',
        quoteMediaUrl: '',
        avatar: usableUrl(element.querySelector('figure img')?.getAttribute('src'))
      };
      message.key = 'fp:' + hash([message.sender, message.timestamp, message.type, message.text, message.mediaUrl, index].join('\u001f'));
      messages.push(message);
    });
    return { chatTitle, messages };
  }

  function currentMessages() {
    if (isXianyu()) return parseXianyu(document);
    if (isFiverr()) return parseFiverr(document);
    return { chatTitle: '聊天记录', messages: [] };
  }

  function isScrollable(element) {
    if (!element || element === document.body || element === document.documentElement) return false;
    const style = getComputedStyle(element);
    return element.clientHeight > 100 &&
      element.scrollHeight > element.clientHeight + 20 &&
      /(auto|scroll|overlay|hidden)/.test(style.overflowY);
  }

  function allScrollableElements(root) {
    return [root.documentElement, root.body, ...Array.from(root.querySelectorAll('*'))]
      .filter(element => isScrollable(element));
  }

  function hasMessageMarker(element) {
    return Boolean(element.querySelector(SELECTORS.messageText + ',' + SELECTORS.imageContainer + ',video,audio'));
  }

  function candidateTitle(element) {
    const nameNode = element.querySelector('[class*="nickname"], [class*="user-name"], [class*="name"]');
    const name = cleanText(nameNode?.textContent);
    if (name && name.length <= 100) return name;
    const lines = String(element.innerText || element.textContent || '')
      .split(/\n+/).map(cleanText).filter(Boolean);
    return (lines[0] || '').slice(0, 100);
  }

  function isConversationCandidate(element) {
    if (!element || element === document.body || element === document.documentElement) return false;
    if (hasMessageMarker(element)) return false;
    const text = cleanText(element.innerText || element.textContent);
    if (text.length < 1 || text.length > 180) return false;
    const className = String(element.className || '');
    const likelyClass = /(conversation|session|contact|chat[-_]?item|roster|list[-_]?item|user[-_]?item|ant-list-item)/i.test(className);
    const avatar = element.querySelector('img');
    const role = element.getAttribute('role');
    const cursor = getComputedStyle(element).cursor;
    const rect = element.getBoundingClientRect();
    const rowLike = rect.width >= 140 && rect.height >= 28 && rect.height <= 180;
    return rowLike && (likelyClass || role === 'button' || cursor === 'pointer' || Boolean(avatar));
  }

  function findConversationContainer() {
    const containers = [document.body, ...allScrollableElements(document)];
    let best = { element: document.body, score: -1, candidates: [] };
    containers.forEach(container => {
      const nodes = conversationNodes(container);
      const unique = [];
      const seen = new Set();
      nodes.forEach(node => {
        const title = candidateTitle(node);
        if (!title) return;
        const key = title + '|' + (node.querySelector('img')?.getAttribute('src') || '');
        if (seen.has(key)) return;
        seen.add(key);
        unique.push(node);
      });
      const rect = container.getBoundingClientRect();
      const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
      const looksLikeLeftSidebar = viewportWidth > 0 && rect.left < viewportWidth * 0.45 &&
        rect.width < viewportWidth * 0.55 && rect.height > 160;
      const hasScrollRange = container.clientHeight > 100 && container.scrollHeight > container.clientHeight + 20;
      const score = unique.length * 10 + (hasScrollRange ? 35 : 0) +
        (looksLikeLeftSidebar ? 60 : 0) -
        (container.querySelectorAll(SELECTORS.messageItems).length * 2);
      if (score > best.score) best = { element: container, score, candidates: unique };
    });
    return best;
  }

  function getConversationAttribute(element) {
    const attrs = [
      'data-conversation-id',
      'data-session-id',
      'data-chat-id',
      'data-user-id',
      'data-id'
    ];
    const candidates = [
      element,
      element.closest('li'),
      element.closest('a'),
      element.closest('button'),
      element.closest('[role="button"]')
    ].filter((node, index, all) => node && all.indexOf(node) === index);
    for (const current of candidates) {
      const attribute = attrs.map(name => current.getAttribute(name)).find(Boolean);
      if (attribute) return attribute;
    }
    return '';
  }

  function getConversationLink(element) {
    const link = element.closest('a')?.href || element.querySelector('a')?.href;
    if (!link) return '';
    const absolute = absoluteUrl(link);
    if (!absolute || absolute === location.href) return '';
    // Ignore generic links shared by every row. Keep links that carry a route or
    // query parameter that can identify one conversation.
    if (!/(?:chat|conversation|session|message|im|user)/i.test(absolute) &&
      !/[?&](?:id|uid|userId|sessionId|conversationId)=/i.test(absolute)) return '';
    return absolute;
  }

  function conversationIdentity(element, index) {
    const attribute = getConversationAttribute(element);
    const link = getConversationLink(element);
    const title = candidateTitle(element) || '未命名会话';
    const avatar = usableUrl(element.querySelector('img')?.getAttribute('src'));
    const preview = cleanText(element.innerText || element.textContent).slice(0, 180);
    // Preview text is deliberately excluded from the fallback identity. On a
    // virtualized list the same row can be recycled with different text while
    // scrolling, which previously created duplicate conversations in the ZIP.
    const stableFallback = [cleanText(title).toLocaleLowerCase(), mediaIdentity(avatar).toLocaleLowerCase()].join('\u001f');
    const key = attribute ? 'id:' + attribute : link ? 'url:' + link : 'fp:' + hash(stableFallback);
    return {
      id: key,
      key,
      title,
      avatar,
      preview,
      index
    };
  }

  function visibleConversationSignature(container) {
    return conversationNodes(container).map(node => conversationIdentity(node, 0).key).join('|');
  }

  async function scanConversations() {
    const best = findConversationContainer();
    const container = best.element;
    const scrollTarget = (container === document.body || container === document.documentElement)
      ? document.scrollingElement
      : container;
    const originalTop = scrollTarget.scrollTop || 0;
    const records = new Map();
    let noNewAtEnd = 0;
    scrollTarget.scrollTop = 0;
    scrollTarget.dispatchEvent(new Event('scroll', { bubbles: true }));
    await sleep(700);
    for (let pass = 0; pass < 160; pass += 1) {
      const nodes = conversationNodes(container);
      nodes.forEach((node, index) => {
        const record = conversationIdentity(node, index);
        if (!records.has(record.key)) records.set(record.key, record);
      });
      const before = scrollTarget.scrollTop;
      const beforeHeight = scrollTarget.scrollHeight;
      const beforeSignature = visibleConversationSignature(container);
      const step = Math.max(160, Math.floor(scrollTarget.clientHeight * 0.8));
      scrollTarget.scrollTop = Math.min(scrollTarget.scrollHeight, scrollTarget.scrollTop + step);
      scrollTarget.dispatchEvent(new Event('scroll', { bubbles: true }));
      // Some Xianyu layouts virtualize the sidebar without exposing a useful
      // scrollTop on its wrapper. Moving the last visible row to the bottom
      // gives the real list viewport a native scroll action as a fallback.
      if (scrollTarget.scrollTop === before && nodes.length) {
        nodes[nodes.length - 1].scrollIntoView({ block: 'end', inline: 'nearest', behavior: 'auto' });
        scrollTarget.dispatchEvent(new Event('scroll', { bubbles: true }));
      }
      // Xianyu may request the next page only after the list reaches the
      // bottom. Give the DOM and the network-backed virtual list time to grow.
      await sleep(900);
      const afterSignature = visibleConversationSignature(container);
      const atEnd = scrollTarget.scrollTop + scrollTarget.clientHeight >= scrollTarget.scrollHeight - 8;
      const listChanged = beforeHeight !== scrollTarget.scrollHeight || beforeSignature !== afterSignature;
      if (atEnd && before === scrollTarget.scrollTop && !listChanged) noNewAtEnd += 1;
      else noNewAtEnd = 0;
      if (noNewAtEnd >= 3) break;
    }
    scrollTarget.scrollTop = originalTop;
    scrollTarget.dispatchEvent(new Event('scroll', { bubbles: true }));
    return Array.from(records.values()).map((record, index) => Object.assign(record, { index }));
  }

  function conversationNodes(container) {
    const candidates = Array.from(container.querySelectorAll(SELECTORS.conversationItems)).filter(isConversationCandidate);
    const candidateSet = new Set(candidates);
    return candidates.filter(node => {
      let parent = node.parentElement;
      while (parent && parent !== container) {
        if (candidateSet.has(parent)) return false;
        parent = parent.parentElement;
      }
      return true;
    });
  }

  function matchConversationNode(nodes, conversation) {
    return nodes.find(node => {
      const record = conversationIdentity(node, 0);
      return record.key === conversation.key ||
        (record.title === conversation.title && record.avatar === conversation.avatar);
    }) || nodes.find(node => candidateTitle(node) === conversation.title);
  }

  async function findConversationElement(conversation) {
    const best = findConversationContainer();
    const container = best.element;
    const scrollTarget = (container === document.body || container === document.documentElement)
      ? document.scrollingElement
      : container;
    const originalTop = scrollTarget.scrollTop || 0;

    // A virtualized conversation list only keeps visible rows in the DOM. Scan
    // from the current position first, then from the top so the next item can be
    // found regardless of whether it is above or below the previous item.
    for (let cycle = 0; cycle < 2; cycle += 1) {
      if (cycle === 1) {
        scrollTarget.scrollTop = 0;
        scrollTarget.dispatchEvent(new Event('scroll', { bubbles: true }));
        await sleep(350);
      }
      let lastTop = -1;
      for (let pass = 0; pass < 80; pass += 1) {
        const match = matchConversationNode(conversationNodes(container), conversation);
        if (match) return match;
        const before = scrollTarget.scrollTop;
        const step = Math.max(160, Math.floor(scrollTarget.clientHeight * 0.8));
        scrollTarget.scrollTop = Math.min(scrollTarget.scrollHeight, before + step);
        scrollTarget.dispatchEvent(new Event('scroll', { bubbles: true }));
        await sleep(350);
        const atEnd = scrollTarget.scrollTop + scrollTarget.clientHeight >= scrollTarget.scrollHeight - 8;
        if (atEnd && lastTop === scrollTarget.scrollTop) break;
        lastTop = scrollTarget.scrollTop;
      }
    }
    scrollTarget.scrollTop = originalTop;
    scrollTarget.dispatchEvent(new Event('scroll', { bubbles: true }));
    return null;
  }

  function messageSignature(data) {
    const messages = data && data.messages ? data.messages : [];
    const last = messages[messages.length - 1];
    return [messages.length, last?.timestamp, last?.text, last?.mediaUrl].join('|');
  }

  function visibleMessageSignature(data) {
    return (data && data.messages ? data.messages : []).map(message => [
      message.sender,
      message.isMe ? 'me' : 'other',
      message.type,
      message.text,
      message.mediaUrl,
      message.quote,
      message.quoteMediaUrl
    ].join('\u001e')).join('\u001f');
  }

  async function waitForConversationChange(previousTitle, previousSignature, timeoutMs, target) {
    const started = Date.now();
    while (Date.now() - started < (timeoutMs || 15000)) {
      checkRiskControl();
      const data = currentMessages();
      if (data.messages.length &&
        (data.chatTitle !== previousTitle ||
          messageSignature(data) !== previousSignature ||
          (Date.now() - started > 700 && target && /(^|[\s_-])(active|selected|current)([\s_-]|$)/i.test(String(target.className || ''))))) return data;
      await sleep(400);
    }
    throw new Error('打开会话超时');
  }

  async function openConversation(conversation) {
    const element = await findConversationElement(conversation);
    if (!element) throw new Error('找不到会话：' + conversation.title);
    const previous = currentMessages();
    const previousTitle = previous.chatTitle;
    const previousSignature = messageSignature(previous);
    element.scrollIntoView({ block: 'center', behavior: 'auto' });
    const target = element.closest('a,button,[role="button"]') || element;
    target.click();
    await waitForConversationChange(previousTitle, previousSignature, 15000, target);
    return currentMessages();
  }

  function findMessageScroller() {
    const message = Array.from(document.querySelectorAll(SELECTORS.messageItems)).find(hasMessageMarker);
    let current = message;
    const candidates = [];
    while (current) {
      if (isScrollable(current)) candidates.push(current);
      current = current.parentElement;
    }
    candidates.sort((a, b) => {
      const aCount = a.querySelectorAll(SELECTORS.messageItems).length;
      const bCount = b.querySelectorAll(SELECTORS.messageItems).length;
      return bCount - aCount;
    });
    return candidates[0] || document.scrollingElement;
  }

  function scrollToTop(scroller) {
    if (scroller === document.scrollingElement) {
      window.scrollTo({ top: 0, behavior: 'auto' });
    } else {
      scroller.scrollTop = 0;
    }
    scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
  }

  function scrollToBottom(scroller) {
    if (scroller === document.scrollingElement) {
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'auto' });
    } else {
      scroller.scrollTop = scroller.scrollHeight;
    }
    scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
  }

  function scrollPosition(scroller) {
    return scroller === document.scrollingElement ? window.scrollY : scroller.scrollTop;
  }

  function dispatchWheel(scroller, deltaY) {
    const target = scroller === document.scrollingElement ? document : scroller;
    if (typeof WheelEvent === 'function') {
      target.dispatchEvent(new WheelEvent('wheel', {
        deltaY,
        deltaMode: 0,
        bubbles: true,
        cancelable: true
      }));
    }
  }

  function scrollUpOnePage(scroller) {
    const viewportHeight = scroller === document.scrollingElement
      ? (window.innerHeight || 600)
      : (scroller.clientHeight || 600);
    const amount = Math.max(160, Math.floor(viewportHeight * 0.72));
    const current = scrollPosition(scroller);
    dispatchWheel(scroller, -amount);
    if (scroller === document.scrollingElement) {
      window.scrollTo({ top: Math.max(0, current - amount), behavior: 'auto' });
    } else {
      scroller.scrollTop = Math.max(0, current - amount);
    }
    scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
  }

  function triggerTopHistoryLoad(scroller) {
    const viewportHeight = scroller === document.scrollingElement
      ? (window.innerHeight || 600)
      : (scroller.clientHeight || 600);
    const nudge = Math.max(120, Math.floor(viewportHeight * 0.35));

    // A synthetic wheel event reaches the same React event path as a user's
    // wheel. The one-pixel bounce additionally retriggers top sentinels that
    // only run when the scroll position changes from/to zero.
    dispatchWheel(scroller, -nudge);
    if (scroller === document.scrollingElement) {
      window.scrollTo({ top: 1, behavior: 'auto' });
      scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
      window.scrollTo({ top: 0, behavior: 'auto' });
    } else {
      const maxTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      scroller.scrollTop = Math.min(1, maxTop);
      scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
      scroller.scrollTop = 0;
    }
    scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
    dispatchWheel(scroller, -nudge);
  }

  async function waitForMessageUpdate(scroller, beforeSignature, timeoutMs) {
    const started = Date.now();
    let lastSignature = beforeSignature;
    let stableRounds = 0;
    let latest = currentMessages();
    while (Date.now() - started < timeoutMs) {
      checkRiskControl();
      latest = currentMessages();
      const signature = visibleMessageSignature(latest);
      if (signature !== beforeSignature) {
        if (signature === lastSignature) stableRounds += 1;
        else stableRounds = 0;
        lastSignature = signature;
        // Wait for two identical reads after the first change so a virtual
        // list has finished replacing rows before we persist the viewport.
        if (stableRounds >= 2) return latest;
      }
      await sleep(180);
    }
    return latest;
  }

  function checkRiskControl() {
    const riskNodes = Array.from(document.querySelectorAll(
      '[role="dialog"], [class*="captcha"], [class*="verify"], [class*="security"], [class*="risk"], [class*="slider"]'
    )).filter(node => {
      const style = getComputedStyle(node);
      return style.display !== 'none' && style.visibility !== 'hidden' && node.getBoundingClientRect().width > 0;
    });
    const visibleText = riskNodes.map(node => node.innerText || node.textContent || '').join(' ').slice(0, 10000);
    if (riskNodes.length && RISK_TEXT.test(visibleText)) {
      throw new Error('检测到闲鱼安全验证或访问限制，任务已暂停');
    }
  }

  function mergeMessages(ordered, index, batch, prepend) {
    const fresh = [];
    batch.forEach(message => {
      if (index.has(message.key)) return;
      index.set(message.key, message);
      fresh.push(message);
    });
    if (prepend) ordered.unshift(...fresh);
    else ordered.push(...fresh);
  }

  async function collectAllMessages(jobId, conversationId) {
    const scroller = findMessageScroller();
    const ordered = [];
    const index = new Map();
    let noNewPasses = 0;
    let topNoNewPasses = 0;

    // Capture the newest viewport first. This prevents a conversation that was
    // previously left halfway up the list from losing its newest messages.
    scrollToBottom(scroller);
    await sleep(500);
    const newest = currentMessages();
    mergeMessages(ordered, index, newest.messages, false);
    if (jobId) await persistMessageSnapshot(jobId, conversationId, ordered);

    for (let pass = 0; pass < 300; pass += 1) {
      const before = index.size;
      checkRiskControl();
      // Move upward in viewport-sized wheel steps. Xianyu loads older records
      // when the user approaches the top, but a single jump to scrollTop=0 can
      // leave the first page unloaded.
      const beforeViewport = currentMessages();
      const beforeViewportSignature = visibleMessageSignature(beforeViewport);
      const positionBefore = scrollPosition(scroller);
      const viewportHeight = scroller === document.scrollingElement
        ? (window.innerHeight || 600)
        : (scroller.clientHeight || 600);
      scrollUpOnePage(scroller);
      const current = await waitForMessageUpdate(
        scroller,
        beforeViewportSignature,
        positionBefore <= viewportHeight ? 2600 : 1200
      );
      await sleep(300);
      mergeMessages(ordered, index, current.messages, true);
      if (index.size === before) {
        noNewPasses += 1;
      } else {
        noNewPasses = 0;
        topNoNewPasses = 0;
        if (jobId) await persistMessageSnapshot(jobId, conversationId, ordered);
      }
      const atTop = scrollPosition(scroller) <= 4;
      if (!atTop) topNoNewPasses = 0;

      // On Xianyu the first page is sometimes fetched only after the chat
      // viewport has actually reached zero. A programmatic jump can arrive at
      // zero before that request starts, so probe the top with a small bounce
      // and wait for the virtual list to settle. Do not finish on the first
      // empty read at the top.
      if (atTop && noNewPasses >= 1) {
        const beforeTop = currentMessages();
        const beforeTopSignature = visibleMessageSignature(beforeTop);
        triggerTopHistoryLoad(scroller);
        const topData = await waitForMessageUpdate(scroller, beforeTopSignature, 4200);
        await sleep(300);
        const beforeTopMerge = index.size;
        mergeMessages(ordered, index, topData.messages, true);
        if (index.size !== beforeTopMerge) {
          noNewPasses = 0;
          topNoNewPasses = 0;
          if (jobId) await persistMessageSnapshot(jobId, conversationId, ordered);
        } else {
          topNoNewPasses += 1;
        }
      }

      if (atTop && topNoNewPasses >= 2) break;
      if (jobId) {
        const response = await chrome.runtime.sendMessage({ action: 'JOB_SHOULD_PAUSE', jobId });
        if (response && response.pause) throw new Error('任务已暂停');
      }
    }

    // Leave the page at the real top and capture one final settled DOM state.
    scrollToTop(scroller);
    await sleep(500);
    const finalData = currentMessages();
    const beforeFinal = index.size;
    mergeMessages(ordered, index, finalData.messages, true);
    if (jobId && index.size !== beforeFinal) await persistMessageSnapshot(jobId, conversationId, ordered);
    return {
      chatTitle: getTitle(document),
      messages: ordered.map((message, order) => Object.assign({}, message, { order }))
    };
  }

  async function persistMessageSnapshot(jobId, conversationId, ordered) {
    if (!jobId || !ordered.length) return;
    await sendChunks(jobId, conversationId, ordered.map((message, order) => Object.assign({}, message, { order })));
  }

  async function sendChunks(jobId, conversationId, messages) {
    const chunkSize = 50;
    for (let index = 0; index < messages.length; index += chunkSize) {
      const chunk = messages.slice(index, index + chunkSize);
      const response = await chrome.runtime.sendMessage({
        action: 'CONVERSATION_CHUNK',
        jobId,
        conversationId,
        messages: chunk
      });
      if (response && response.ok === false) throw new Error(response.error || '保存消息失败');
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    (async () => {
      try {
        if (message.action === 'SCAN_CONVERSATIONS') {
          if (!isXianyu()) throw new Error('批量功能只支持闲鱼网页');
          sendResponse({ ok: true, conversations: await scanConversations() });
          return;
        }
        if (message.action === 'GET_CURRENT_MESSAGES') {
          const data = currentMessages();
          sendResponse({ ok: true, platform: isXianyu() ? 'xianyu' : isFiverr() ? 'fiverr' : 'unknown', ...data });
          return;
        }
        if (message.action === 'PROCESS_CONVERSATION') {
          if (!isXianyu()) throw new Error('批量功能只支持闲鱼网页');
          await openConversation(message.conversation);
          const data = await collectAllMessages(message.jobId, message.conversation.id);
          await sendChunks(message.jobId, message.conversation.id, data.messages);
          sendResponse({ ok: true, chatTitle: data.chatTitle, messageCount: data.messages.length });
          return;
        }
        sendResponse({ ok: false, error: '未知操作' });
      } catch (error) {
        sendResponse({ ok: false, error: error.message || String(error), riskControl: /安全验证|访问限制|任务已暂停/.test(error.message || '') });
      }
    })();
    return true;
  });
})();
