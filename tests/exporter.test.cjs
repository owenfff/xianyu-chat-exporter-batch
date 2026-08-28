const assert = require('node:assert/strict');
const test = require('node:test');
const exporter = require('../exporter.js');

test('safeFileName removes Windows-invalid characters and preserves Chinese text', () => {
  assert.equal(exporter.safeFileName('张三:/订单*1?', '会话'), '张三__订单_1_');
  assert.equal(exporter.safeFileName('...', '会话'), '会话');
});

test('messageFingerprint is stable and distinguishes message changes', () => {
  const message = { sender: '张三', isMe: false, timestamp: '08-28 10:00', type: 'text', text: '你好' };
  assert.equal(exporter.messageFingerprint(message), exporter.messageFingerprint(Object.assign({}, message)));
  assert.notEqual(exporter.messageFingerprint(message), exporter.messageFingerprint(Object.assign({}, message, { text: '再见' })));
});

test('HTML export references local media relative to conversations directory', () => {
  const html = exporter.renderConversationHtml(
    { title: '张三' },
    [{ sender: '我', isMe: true, timestamp: '10:00', type: 'image', text: '[图片]', mediaUrl: 'https://img.alicdn.com/a.jpg' }],
    { 'https://img.alicdn.com/a.jpg': { status: 'downloaded', localPath: 'media/张三_001.jpg' } },
    { fromConversationFile: true }
  );
  assert.ok(html.includes('../media/张三_001.jpg'));
  assert.ok(!html.includes('https://img.alicdn.com/a.jpg'));
});

test('failed media keeps the original URL in HTML', () => {
  const html = exporter.renderConversationHtml(
    { title: '张三' },
    [{ sender: '对方', isMe: false, type: 'image', text: '[图片]', mediaUrl: 'https://img.alicdn.com/expired.jpg' }],
    { 'https://img.alicdn.com/expired.jpg': { status: 'failed', localPath: '', error: 'HTTP 403' } },
    { fromConversationFile: true }
  );
  assert.ok(html.includes('https://img.alicdn.com/expired.jpg'));
});
