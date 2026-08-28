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

  function isVisible(element) {
    if (!element) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' &&
      rect.width > 0 && rect.height > 0;
  }

  function isIgnoredProductText(value) {
    const text = cleanText(value);
    if (!text || text.length < 2 || text.length > 160) return true;
    if (/^(当前宝贝|当前商品|收藏宝贝|咨询过的宝贝|全部|待付款|待发货|已发货|退款中|交易关闭|详情|查看评价|查看钱款|在线)$/i.test(text)) return true;
    if (/^(暂无相关信息|暂无商品信息|暂无宝贝信息|未找到相关商品|暂无数据)$/i.test(text)) return true;
    if (/^(?:¥|￥)?[\d,.]+(?:元)?$/.test(text)) return true;
    if (/^(?:订单号|订单编号|发货时间|发货状态|物流信息|完结时间|订单备注|数据更新至|本店购买|本店累计|本店平均)/.test(text)) return true;
    return false;
  }

  function getProductName(root) {
    if (!isXianyu()) return '';
    const markers = Array.from(root.querySelectorAll('*')).filter(element =>
      isVisible(element) && /^(当前宝贝|当前商品)$/.test(cleanText(element.textContent))
    );
    if (!markers.length) return '';
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    markers.sort((a, b) => {
      const aRight = a.getBoundingClientRect().left > viewportWidth * 0.55;
      const bRight = b.getBoundingClientRect().left > viewportWidth * 0.55;
      return Number(bRight) - Number(aRight);
    });

    // The seller page links the “当前宝贝” tab to a dedicated tab panel.
    // Read the item-name node in that panel first; scanning the whole right
    // sidebar can otherwise select “暂无相关信息” from the buyer-info card.
    const documentRoot = root.ownerDocument || root;
    const productPanels = [];
    markers.forEach(marker => {
      const tab = marker.matches('[role="tab"]') ? marker : marker.querySelector('[role="tab"]');
      const panelId = tab && tab.getAttribute('aria-controls');
      const panel = panelId && documentRoot.getElementById ? documentRoot.getElementById(panelId) : null;
      if (panel && !productPanels.includes(panel)) productPanels.push(panel);
    });
    const directTitles = productPanels.flatMap(panel => Array.from(panel.querySelectorAll('*')).filter(element => {
      if (!isVisible(element)) return false;
      const className = String(element.className || '');
      const titleLike = /(item[-_]?name|product[-_]?name|goods[-_]?name|commodity[-_]?name)/i.test(className);
      return titleLike && !isIgnoredProductText(element.textContent);
    }));
    directTitles.sort((a, b) => {
      const aLeaf = a.children.length === 0;
      const bLeaf = b.children.length === 0;
      return Number(bLeaf) - Number(aLeaf) || cleanText(a.textContent).length - cleanText(b.textContent).length;
    });
    if (directTitles.length) return cleanText(directTitles[0].textContent);

    const marker = markers[0];
    const markerRect = marker.getBoundingClientRect();
    let panel = marker;
    const candidates = [];
    for (let level = 0; panel && level < 8; level += 1, panel = panel.parentElement) {
      const panelRect = panel.getBoundingClientRect();
      if (panelRect.width < 220 || panelRect.height < 100) continue;
      const nodes = [panel, ...Array.from(panel.querySelectorAll('*'))];
      nodes.forEach(node => {
        if (!isVisible(node)) return;
        const text = cleanText(node.textContent);
        if (isIgnoredProductText(text)) return;
        const rect = node.getBoundingClientRect();
        const afterMarker = rect.top + rect.height >= markerRect.bottom - 4;
        const nearby = rect.top <= markerRect.bottom + 280;
        if (!afterMarker || !nearby) return;
        const className = String(node.className || '');
        const titleLike = /(goods|product|commodity|item|title|name|宝贝|商品)/i.test(className);
        const leaf = node.children.length === 0;
        const hasImage = Boolean(node.parentElement && node.parentElement.querySelector('img'));
        const distance = Math.max(0, rect.top - markerRect.bottom);
        const score = (titleLike ? 70 : 0) + (leaf ? 20 : 0) +
          (hasImage ? 15 : 0) + (nearby ? 55 : 0) - Math.min(distance, 280) / 12 - text.length / 120;
        candidates.push({ text, score });
      });
      if (candidates.length && level >= 2) break;
    }
    candidates.sort((a, b) => b.score - a.score || a.text.length - b.text.length);
    return candidates[0]?.text || '';
  }

  async function waitForProductName(timeoutMs) {
    const started = Date.now();
    while (Date.now() - started < (timeoutMs || 1200)) {
      const productName = getProductName(document);
      if (productName) return productName;
      await sleep(180);
    }
    return getProductName(document);
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
    const elements = messageElements(root).filter(element => !element.querySelector('[class*="price"]'));

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

  function messageElements(root) {
    const candidates = Array.from(root.querySelectorAll(SELECTORS.messageItems)).filter(hasMessageMarker);
    const candidateSet = new Set(candidates);
    // `[class*="ant-list-item"]` also matches the list wrapper
    // `ant-list-items`. Keep only actual message rows so the wrapper is not
    // parsed as a duplicate/garbled message.
    return candidates.filter(element => !Array.from(element.querySelectorAll(SELECTORS.messageItems))
      .some(child => candidateSet.has(child)));
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

  async function scanConversations(limit) {
    const requestedLimit = Number.parseInt(limit, 10);
    const maxRecords = limit === null
      ? Infinity
      : Number.isInteger(requestedLimit) && requestedLimit > 0
        ? requestedLimit
        : 20;
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
    const maxPasses = maxRecords === Infinity
      ? 5000
      : Math.min(5000, Math.max(800, maxRecords * 2));
    for (let pass = 0; pass < maxPasses; pass += 1) {
      const nodes = conversationNodes(container);
      nodes.forEach((node, index) => {
        if (records.size >= maxRecords) return;
        const record = conversationIdentity(node, index);
        if (!records.has(record.key)) records.set(record.key, record);
      });
      if (records.size >= maxRecords) break;
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
    const messageRows = messageElements(document);
    const candidateMap = new Map();
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    messageRows.forEach(message => {
      let current = message;
      let distance = 0;
      while (current) {
        const style = getComputedStyle(current);
        const nativeOverflow = /(auto|scroll|overlay)/.test(style.overflowY);
        const hasRange = current.scrollHeight > current.clientHeight + 4;
        if (hasRange || nativeOverflow) {
          let entry = candidateMap.get(current);
          if (!entry) {
            entry = { element: current, messages: new Set(), distance: Infinity };
            candidateMap.set(current, entry);
          }
          entry.messages.add(message);
          entry.distance = Math.min(entry.distance, distance);
        }
        current = current.parentElement;
        distance += 1;
      }
    });

    const candidates = Array.from(candidateMap.values()).map(entry => {
      const element = entry.element;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const nativeOverflow = /(auto|scroll|overlay)/.test(style.overflowY);
      const hasRange = element.scrollHeight > element.clientHeight + 4;
      const fullWidth = viewportWidth > 0 && rect.width > viewportWidth * 0.9;
      // Xianyu places the chat viewport between the left conversation list
      // and the right order panel. This helps reject the page scroller when
      // both the page and the embedded chat area can scroll.
      const centralPanel = viewportWidth > 0 && rect.left < viewportWidth * 0.72 &&
        rect.right > viewportWidth * 0.45 && !fullWidth;
      const score = entry.messages.size * 100 +
        (hasRange ? 80 : 0) +
        (nativeOverflow ? 40 : 0) +
        (centralPanel ? 80 : 0) +
        (fullWidth ? -100 : 0) +
        (entry.messages.size > 1 ? 30 : 0) +
        Math.max(0, 50 - entry.distance * 8);
      return Object.assign(entry, { score });
    });
    candidates.sort((a, b) => b.score - a.score || a.distance - b.distance);
    return candidates[0]?.element || document.scrollingElement;
  }

  function isReverseScroller(scroller) {
    return scroller !== document.scrollingElement &&
      getComputedStyle(scroller).flexDirection === 'column-reverse';
  }

  function scrollBounds(scroller) {
    if (scroller === document.scrollingElement) {
      return {
        min: 0,
        max: Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
      };
    }
    const range = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    return isReverseScroller(scroller) ? { min: -range, max: 0 } : { min: 0, max: range };
  }

  function isAtVisualTop(scroller) {
    const bounds = scrollBounds(scroller);
    return scrollPosition(scroller) <= bounds.min + 4;
  }

  function isNearVisualTop(scroller, viewportHeight) {
    const bounds = scrollBounds(scroller);
    return scrollPosition(scroller) <= bounds.min + viewportHeight;
  }

  function scrollToTop(scroller) {
    const bounds = scrollBounds(scroller);
    if (scroller === document.scrollingElement) {
      window.scrollTo({ top: bounds.min, behavior: 'auto' });
    } else {
      scroller.scrollTop = bounds.min;
    }
    scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
  }

  function scrollToBottom(scroller) {
    const bounds = scrollBounds(scroller);
    if (scroller === document.scrollingElement) {
      window.scrollTo({ top: bounds.max, behavior: 'auto' });
    } else {
      scroller.scrollTop = bounds.max;
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

  async function scrollUpOnePage(scroller) {
    const viewportHeight = scroller === document.scrollingElement
      ? (window.innerHeight || 600)
      : (scroller.clientHeight || 600);
    const amount = Math.max(120, Math.floor(viewportHeight * 0.36));
    const tick = Math.max(40, Math.floor(amount / 3));

    // Imitate a user's continuous wheel movement: several small wheel ticks
    // are more reliable for Xianyu's virtual list than one large jump.
    for (let index = 0; index < 3; index += 1) {
      const current = scrollPosition(scroller);
      dispatchWheel(scroller, -tick);
      const bounds = scrollBounds(scroller);
      const nextTop = Math.max(bounds.min, current - tick);
      if (scroller === document.scrollingElement) {
        window.scrollTo({ top: nextTop, behavior: 'auto' });
      } else {
        scroller.scrollTop = nextTop;
      }
      scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
      await sleep(80);
    }
  }

  function triggerTopHistoryLoad(scroller) {
    const viewportHeight = scroller === document.scrollingElement
      ? (window.innerHeight || 600)
      : (scroller.clientHeight || 600);
    const nudge = Math.max(120, Math.floor(viewportHeight * 0.35));

    // A synthetic wheel event reaches the same React event path as a user's
    // wheel. The one-pixel bounce additionally retriggers top sentinels that
    // only run when the scroll position changes from/to the visual top.
    for (let index = 0; index < 3; index += 1) dispatchWheel(scroller, -nudge);
    const bounds = scrollBounds(scroller);
    if (scroller === document.scrollingElement) {
      window.scrollTo({ top: Math.min(bounds.max, bounds.min + 1), behavior: 'auto' });
      scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
      window.scrollTo({ top: bounds.min, behavior: 'auto' });
    } else {
      scroller.scrollTop = Math.min(bounds.max, bounds.min + 1);
      scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
      scroller.scrollTop = bounds.min;
    }
    scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
    for (let index = 0; index < 3; index += 1) dispatchWheel(scroller, -nudge);
  }

  async function waitForMessageUpdate(scroller, beforeSignature, beforeHeight, timeoutMs) {
    const started = Date.now();
    let lastSignature = beforeSignature;
    let lastHeight = beforeHeight;
    let stableRounds = 0;
    let latest = currentMessages();
    while (Date.now() - started < timeoutMs) {
      checkRiskControl();
      latest = currentMessages();
      const signature = visibleMessageSignature(latest);
      const currentHeight = scroller ? scroller.scrollHeight : beforeHeight;
      const heightChanged = currentHeight !== beforeHeight;
      if (signature !== beforeSignature || heightChanged) {
        if (signature === lastSignature && currentHeight === lastHeight) stableRounds += 1;
        else stableRounds = 0;
        lastSignature = signature;
        lastHeight = currentHeight;
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
      // Move upward in small wheel steps. Xianyu loads older records when the
      // user approaches the visual top; reverse chat lists use negative
      // scrollTop values, so zero is the newest-message end, not the top.
      const beforeViewport = currentMessages();
      const beforeViewportSignature = visibleMessageSignature(beforeViewport);
      const heightBefore = scroller.scrollHeight;
      const viewportHeight = scroller === document.scrollingElement
        ? (window.innerHeight || 600)
        : (scroller.clientHeight || 600);
      await scrollUpOnePage(scroller);
      const current = await waitForMessageUpdate(
        scroller,
        beforeViewportSignature,
        heightBefore,
        isNearVisualTop(scroller, viewportHeight) ? 2600 : 1200
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
      const atTop = isAtVisualTop(scroller);
      if (!atTop) topNoNewPasses = 0;

      // On Xianyu the first page is sometimes fetched only after the chat
      // viewport has actually reached its visual top. A programmatic jump can
      // arrive there before that request starts, so probe the top with a bounce
      // and wait for the virtual list to settle. Do not finish on the first
      // empty read at the top.
      if (atTop && noNewPasses >= 1) {
        const beforeTop = currentMessages();
        const beforeTopSignature = visibleMessageSignature(beforeTop);
        const beforeTopHeight = scroller.scrollHeight;
        triggerTopHistoryLoad(scroller);
        const topData = await waitForMessageUpdate(scroller, beforeTopSignature, beforeTopHeight, 4200);
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
          sendResponse({ ok: true, conversations: await scanConversations(message.limit) });
          return;
        }
        if (message.action === 'GET_CURRENT_MESSAGES') {
          const data = currentMessages();
          sendResponse({ ok: true, platform: isXianyu() ? 'xianyu' : isFiverr() ? 'fiverr' : 'unknown',
            productName: getProductName(document), ...data });
          return;
        }
        if (message.action === 'PROCESS_CONVERSATION') {
          if (!isXianyu()) throw new Error('批量功能只支持闲鱼网页');
          await openConversation(message.conversation);
          const data = await collectAllMessages(message.jobId, message.conversation.id);
          // The product card is loaded independently from the chat list and may
          // appear after the conversation itself has finished rendering.
          const productName = await waitForProductName(2200);
          await sendChunks(message.jobId, message.conversation.id, data.messages);
          sendResponse({ ok: true, chatTitle: data.chatTitle, productName, messageCount: data.messages.length });
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
