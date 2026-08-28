(function (root) {
  'use strict';

  const CRC_TABLE = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xEDB88320 ^ (value >>> 1)) : (value >>> 1);
    }
    CRC_TABLE[index] = value >>> 0;
  }

  function crc32(bytes) {
    let value = 0xFFFFFFFF;
    for (let index = 0; index < bytes.length; index += 1) {
      value = CRC_TABLE[(value ^ bytes[index]) & 0xFF] ^ (value >>> 8);
    }
    return (value ^ 0xFFFFFFFF) >>> 0;
  }

  function dosDateTime(date) {
    const value = date instanceof Date ? date : new Date();
    return {
      time: (value.getHours() << 11) | (value.getMinutes() << 5) | Math.floor(value.getSeconds() / 2),
      date: ((value.getFullYear() - 1980) << 9) | ((value.getMonth() + 1) << 5) | value.getDate()
    };
  }

  function write16(view, offset, value) {
    view.setUint16(offset, value & 0xFFFF, true);
  }

  function write32(view, offset, value) {
    view.setUint32(offset, value >>> 0, true);
  }

  async function asBytes(data) {
    if (typeof data === 'string') return new TextEncoder().encode(data);
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (data && typeof data.arrayBuffer === 'function') return new Uint8Array(await data.arrayBuffer());
    throw new TypeError('ZIP 条目必须是字符串、ArrayBuffer、Uint8Array 或 Blob');
  }

  async function createZipBlob(entries) {
    const normalized = [];
    for (const entry of entries || []) {
      const nameBytes = new TextEncoder().encode(String(entry.name || 'unnamed'));
      const dataBytes = await asBytes(entry.data);
      if (nameBytes.length > 0xFFFF || dataBytes.length > 0xFFFFFFFF) {
        throw new Error('ZIP 条目过大：' + entry.name);
      }
      normalized.push({
        nameBytes,
        dataBytes,
        crc: crc32(dataBytes),
        dos: dosDateTime(entry.date)
      });
    }

    let localSize = 0;
    normalized.forEach(entry => {
      localSize += 30 + entry.nameBytes.length + entry.dataBytes.length;
    });
    let centralSize = 0;
    normalized.forEach(entry => {
      centralSize += 46 + entry.nameBytes.length;
    });
    const totalSize = localSize + centralSize + 22;
    if (totalSize > 0xFFFFFFFF) throw new Error('ZIP 文件超过 4GB 限制');

    const output = new Uint8Array(totalSize);
    const view = new DataView(output.buffer);
    const central = [];
    let offset = 0;
    normalized.forEach(entry => {
      const localOffset = offset;
      write32(view, offset, 0x04034B50);
      write16(view, offset + 4, 20);
      write16(view, offset + 6, 0x0800);
      write16(view, offset + 8, 0);
      write16(view, offset + 10, entry.dos.time);
      write16(view, offset + 12, entry.dos.date);
      write32(view, offset + 14, entry.crc);
      write32(view, offset + 18, entry.dataBytes.length);
      write32(view, offset + 22, entry.dataBytes.length);
      write16(view, offset + 26, entry.nameBytes.length);
      write16(view, offset + 28, 0);
      output.set(entry.nameBytes, offset + 30);
      offset += 30 + entry.nameBytes.length;
      output.set(entry.dataBytes, offset);
      offset += entry.dataBytes.length;
      central.push({ entry, localOffset });
    });

    const centralOffset = offset;
    central.forEach(item => {
      const entry = item.entry;
      write32(view, offset, 0x02014B50);
      write16(view, offset + 4, 20);
      write16(view, offset + 6, 20);
      write16(view, offset + 8, 0x0800);
      write16(view, offset + 10, 0);
      write16(view, offset + 12, entry.dos.time);
      write16(view, offset + 14, entry.dos.date);
      write32(view, offset + 16, entry.crc);
      write32(view, offset + 20, entry.dataBytes.length);
      write32(view, offset + 24, entry.dataBytes.length);
      write16(view, offset + 28, entry.nameBytes.length);
      write16(view, offset + 30, 0);
      write16(view, offset + 32, 0);
      write16(view, offset + 34, 0);
      write16(view, offset + 36, 0);
      write32(view, offset + 38, 0);
      write32(view, offset + 42, item.localOffset);
      output.set(entry.nameBytes, offset + 46);
      offset += 46 + entry.nameBytes.length;
    });

    write32(view, offset, 0x06054B50);
    write16(view, offset + 4, 0);
    write16(view, offset + 6, 0);
    write16(view, offset + 8, normalized.length);
    write16(view, offset + 10, normalized.length);
    write32(view, offset + 12, offset - centralOffset);
    write32(view, offset + 16, centralOffset);
    write16(view, offset + 20, 0);

    return new Blob([output], { type: 'application/zip' });
  }

  const api = { createZipBlob };
  root.XianyuZip = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
