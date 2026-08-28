(function (root) {
  'use strict';

  const DB_NAME = 'xianyu-chat-exporter';
  const DB_VERSION = 1;
  const STORES = {
    jobs: 'jobs',
    conversations: 'conversations',
    messages: 'messages',
    media: 'media'
  };

  function openDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORES.jobs)) {
          db.createObjectStore(STORES.jobs, { keyPath: 'jobId' });
        }
        if (!db.objectStoreNames.contains(STORES.conversations)) {
          const store = db.createObjectStore(STORES.conversations, { keyPath: 'recordKey' });
          store.createIndex('jobId', 'jobId', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORES.messages)) {
          const store = db.createObjectStore(STORES.messages, { keyPath: 'recordKey' });
          store.createIndex('jobConversation', ['jobId', 'conversationId'], { unique: false });
        }
        if (!db.objectStoreNames.contains(STORES.media)) {
          const store = db.createObjectStore(STORES.media, { keyPath: 'mediaKey' });
          store.createIndex('jobConversation', ['jobId', 'conversationId'], { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('无法打开本地数据库'));
    });
  }

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('本地数据库操作失败'));
    });
  }

  async function withStore(storeName, mode, callback) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, mode);
      const store = transaction.objectStore(storeName);
      let result;
      try {
        result = callback(store);
      } catch (error) {
        reject(error);
        return;
      }
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error || new Error('本地数据库事务失败'));
      transaction.onabort = () => reject(transaction.error || new Error('本地数据库事务已中止'));
    });
  }

  async function put(storeName, value) {
    return withStore(storeName, 'readwrite', store => requestResult(store.put(value)));
  }

  async function get(storeName, key) {
    const db = await openDb();
    const transaction = db.transaction(storeName, 'readonly');
    return requestResult(transaction.objectStore(storeName).get(key));
  }

  async function getAll(storeName) {
    const db = await openDb();
    const transaction = db.transaction(storeName, 'readonly');
    return requestResult(transaction.objectStore(storeName).getAll());
  }

  async function deleteRecord(storeName, key) {
    return withStore(storeName, 'readwrite', store => requestResult(store.delete(key)));
  }

  async function getByIndex(storeName, indexName, query) {
    const db = await openDb();
    const transaction = db.transaction(storeName, 'readonly');
    return requestResult(transaction.objectStore(storeName).index(indexName).getAll(query));
  }

  async function deleteByIndex(storeName, indexName, query) {
    const records = await getByIndex(storeName, indexName, query);
    if (!records.length) return;
    return withStore(storeName, 'readwrite', store => {
      records.forEach(record => store.delete(record[storeName === STORES.jobs ? 'jobId' : (storeName === STORES.media ? 'mediaKey' : 'recordKey')]));
    });
  }

  function conversationRecordKey(jobId, conversationId) {
    return jobId + ':' + conversationId;
  }

  function messageRecordKey(jobId, conversationId, messageKey) {
    return jobId + ':' + conversationId + ':' + messageKey;
  }

  const api = {
    STORES,
    conversationRecordKey,
    messageRecordKey,
    async createJob(job) {
      await put(STORES.jobs, job);
      await withStore(STORES.conversations, 'readwrite', store => {
        (job.conversations || []).forEach(conversation => {
          store.put(Object.assign({}, conversation, {
            jobId: job.jobId,
            recordKey: conversationRecordKey(job.jobId, conversation.id)
          }));
        });
      });
      return job;
    },
    getJob(jobId) {
      return get(STORES.jobs, jobId);
    },
    async putJob(job) {
      job.updatedAt = new Date().toISOString();
      await put(STORES.jobs, job);
      return job;
    },
    async getLatestJob() {
      const jobs = await getAll(STORES.jobs);
      return jobs.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0] || null;
    },
    async putConversation(jobId, conversation) {
      const record = Object.assign({}, conversation, {
        jobId,
        recordKey: conversationRecordKey(jobId, conversation.id)
      });
      await put(STORES.conversations, record);
      return record;
    },
    async getConversations(jobId) {
      return getByIndex(STORES.conversations, 'jobId', jobId);
    },
    async putMessages(jobId, conversationId, messages) {
      if (!messages || !messages.length) return;
      return withStore(STORES.messages, 'readwrite', store => {
        messages.forEach(message => {
          const record = Object.assign({}, message, {
            jobId,
            conversationId,
            recordKey: messageRecordKey(jobId, conversationId, message.key)
          });
          store.put(record);
        });
      });
    },
    async getMessages(jobId, conversationId) {
      const records = await getByIndex(STORES.messages, 'jobConversation', [jobId, conversationId]);
      return records.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    },
    async putMedia(record) {
      await put(STORES.media, record);
      return record;
    },
    async getMedia(jobId, conversationId) {
      return getByIndex(STORES.media, 'jobConversation', [jobId, conversationId]);
    },
    async updateMessages(jobId, conversationId, updater) {
      const records = await this.getMessages(jobId, conversationId);
      const changed = records.map(updater).filter(Boolean);
      if (!changed.length) return;
      return withStore(STORES.messages, 'readwrite', store => {
        changed.forEach(record => store.put(record));
      });
    },
    async clearConversation(jobId, conversationId) {
      const messages = await getByIndex(STORES.messages, 'jobConversation', [jobId, conversationId]);
      const media = await getByIndex(STORES.media, 'jobConversation', [jobId, conversationId]);
      return withStore(STORES.messages, 'readwrite', store => {
        messages.forEach(record => store.delete(record.recordKey));
      }).then(() => withStore(STORES.media, 'readwrite', store => {
        media.forEach(record => store.delete(record.mediaKey));
      }));
    },
    async clearJob(jobId) {
      const [conversations, messages, media] = await Promise.all([
        getByIndex(STORES.conversations, 'jobId', jobId),
        getByIndex(STORES.messages, 'jobConversation', IDBKeyRange.bound([jobId, ''], [jobId, '\\uffff'])),
        getByIndex(STORES.media, 'jobConversation', IDBKeyRange.bound([jobId, ''], [jobId, '\\uffff']))
      ]);
      await withStore(STORES.jobs, 'readwrite', store => store.delete(jobId));
      await withStore(STORES.conversations, 'readwrite', store => conversations.forEach(record => store.delete(record.recordKey)));
      await withStore(STORES.messages, 'readwrite', store => messages.forEach(record => store.delete(record.recordKey)));
      await withStore(STORES.media, 'readwrite', store => media.forEach(record => store.delete(record.mediaKey)));
    }
  };

  root.XianyuStorage = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
