import type {
  IndexedDbBundle,
  IndexedDbDatabase,
  IndexedDbIndex,
  IndexedDbKeyPath,
  IndexedDbObjectStore,
  IndexedDbRecord,
  SerializedStorageValue,
  StorageImportBundle
} from '../shared/contracts';

const MAX_WARNING_COUNT = 100;
export const MAX_STORAGE_IMPORT_FILE_BYTES = 128 * 1024 * 1024;
const MAX_DATABASES = 64;
const MAX_OBJECT_STORES_PER_DATABASE = 256;
const MAX_INDEXES_PER_STORE = 256;
const MAX_RECORDS_PER_STORE = 100_000;
const MAX_TOTAL_RECORDS = 250_000;
const MAX_VALUE_DEPTH = 32;
const MAX_OBJECT_KEYS = 10_000;
const MAX_ARRAY_ITEMS = 20_000;
const MAX_NAME_LENGTH = 512;
const MAX_KEY_PATH_LENGTH = 1024;
const MAX_STRING_VALUE_LENGTH = 4_000_000;
const MAX_BINARY_VALUE_LENGTH = 128_000_000;
const INVALID_KEY_PATH = Symbol('invalid-key-path');

type JsonObject = Record<string, unknown>;
type NormalizedValue = { ok: true; value: SerializedStorageValue } | { ok: false };

export type IndexedDbNormalization = {
  bundle?: IndexedDbBundle;
  warnings: string[];
  databaseCount: number;
  recordCount: number;
};

function object(value: unknown): JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

function property(raw: unknown, ...keys: string[]): unknown {
  const source = object(raw);
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key)) return source[key];
    const match = Object.keys(source).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
    if (match) return source[match];
  }
  return undefined;
}

function hasProperty(raw: unknown, ...keys: string[]): boolean {
  const source = object(raw);
  return keys.some((key) => Object.prototype.hasOwnProperty.call(source, key) || Object.keys(source).some((candidate) => candidate.toLowerCase() === key.toLowerCase()));
}

function text(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

function bool(value: unknown): boolean {
  return value === true || value === 1 || ['true', '1', 'yes', 'on'].includes(text(value).toLowerCase());
}

function boundedName(value: unknown, label: string, warnings: string[]): string | null {
  const name = text(value);
  if (!name || name.length > MAX_NAME_LENGTH || name.includes('\u0000')) {
    addWarning(warnings, `${label}名称无效或过长，已跳过`);
    return null;
  }
  return name;
}

function addWarning(warnings: string[], message: string): void {
  if (warnings.length < MAX_WARNING_COUNT) warnings.push(message);
}

function normalizeKeyPath(value: unknown, label: string, warnings: string[]): IndexedDbKeyPath | null | undefined | typeof INVALID_KEY_PATH {
  if (value === undefined || value === null) return value === null ? null : undefined;
  if (typeof value === 'string') {
    if (value.length <= MAX_KEY_PATH_LENGTH && !value.includes('\u0000')) return value;
    addWarning(warnings, `${label} keyPath 无效，已跳过`);
    return INVALID_KEY_PATH;
  }
  if (!Array.isArray(value) || value.length === 0 || value.length > 32) {
    addWarning(warnings, `${label} keyPath 数组无效，已跳过`);
    return INVALID_KEY_PATH;
  }
  const paths = value.map((item) => typeof item === 'string' && item.length <= MAX_KEY_PATH_LENGTH && !item.includes('\u0000') ? item : null);
  if (paths.some((item): item is null => item === null)) {
    addWarning(warnings, `${label} keyPath 数组包含无效值，已跳过`);
    return INVALID_KEY_PATH;
  }
  return paths as string[];
}

function normalizeValue(value: unknown, label: string, warnings: string[], depth = 0): NormalizedValue {
  if (value === null || typeof value === 'boolean') return { ok: true, value };
  if (typeof value === 'number') return Number.isFinite(value) ? { ok: true, value } : { ok: false };
  if (typeof value === 'string') {
    if (value.length <= MAX_STRING_VALUE_LENGTH) return { ok: true, value };
    addWarning(warnings, `${label}字符串过大，已跳过`);
    return { ok: false };
  }
  if (depth >= MAX_VALUE_DEPTH || typeof value !== 'object') {
    addWarning(warnings, `${label}嵌套层级或类型无效，已跳过`);
    return { ok: false };
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_ITEMS) {
      addWarning(warnings, `${label}数组过大，已跳过`);
      return { ok: false };
    }
    const output: SerializedStorageValue[] = [];
    for (const [index, item] of value.entries()) {
      const normalized = normalizeValue(item, `${label}[${index}]`, warnings, depth + 1);
      if (!normalized.ok) return normalized;
      output.push(normalized.value);
    }
    return { ok: true, value: output };
  }

  const source = object(value);
  const marker = property(source, '__type');
  if (typeof marker === 'string') {
    if (marker === 'Date') {
      const dateValue = property(source, 'value');
      if ((typeof dateValue === 'string' && dateValue.length <= MAX_STRING_VALUE_LENGTH) || (typeof dateValue === 'number' && Number.isFinite(dateValue))) {
        return { ok: true, value: { __type: 'Date', value: dateValue } };
      }
      addWarning(warnings, `${label} Date 标记无效，已跳过`);
      return { ok: false };
    }
    const binaryTypes = new Set(['ArrayBuffer', 'Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array', 'Float32Array', 'Float64Array', 'BigInt64Array', 'BigUint64Array']);
    if (binaryTypes.has(marker)) {
      const binary = property(source, 'value');
      if (typeof binary === 'string' && binary.length <= MAX_BINARY_VALUE_LENGTH) {
        return { ok: true, value: { __type: marker as 'ArrayBuffer' | 'Int8Array' | 'Uint8Array' | 'Uint8ClampedArray' | 'Int16Array' | 'Uint16Array' | 'Int32Array' | 'Uint32Array' | 'Float32Array' | 'Float64Array' | 'BigInt64Array' | 'BigUint64Array', value: binary } };
      }
      addWarning(warnings, `${label}二进制标记无效或过大，已跳过`);
      return { ok: false };
    }
    if (marker === 'Blob') {
      const mimeType = property(source, 'mimeType');
      return { ok: true, value: { __type: 'Blob', ...(typeof mimeType === 'string' && mimeType.length <= 255 ? { mimeType } : {}) } };
    }
  }

  const keys = Object.keys(source);
  if (keys.length > MAX_OBJECT_KEYS) {
    addWarning(warnings, `${label}对象字段过多，已跳过`);
    return { ok: false };
  }
  const output: Record<string, SerializedStorageValue> = {};
  for (const key of keys) {
    if (key.length > MAX_NAME_LENGTH || key.includes('\u0000')) {
      addWarning(warnings, `${label}包含无效字段名，已跳过整个值`);
      return { ok: false };
    }
    const normalized = normalizeValue(source[key], `${label}.${key}`, warnings, depth + 1);
    if (!normalized.ok) return normalized;
    Object.defineProperty(output, key, { value: normalized.value, enumerable: true, configurable: true, writable: true });
  }
  return { ok: true, value: output };
}

function normalizeIndex(raw: unknown, label: string, warnings: string[]): IndexedDbIndex | null {
  const source = object(raw);
  const name = boundedName(property(source, 'name', 'Name'), label, warnings);
  const keyPath = normalizeKeyPath(property(source, 'keyPath', 'KeyPath'), label, warnings);
  if (!name || keyPath === undefined || keyPath === null || keyPath === INVALID_KEY_PATH) {
    if (keyPath === null || keyPath === INVALID_KEY_PATH) addWarning(warnings, `${label}索引 keyPath 无效，已跳过`);
    return null;
  }
  return { name, keyPath, unique: bool(property(source, 'unique', 'Unique')), multiEntry: bool(property(source, 'multiEntry', 'MultiEntry')) };
}

function normalizeRecord(raw: unknown, label: string, warnings: string[]): IndexedDbRecord | null {
  const source = object(raw);
  if (!hasProperty(source, 'value', 'Value')) {
    addWarning(warnings, `${label}缺少 value，已跳过`);
    return null;
  }
  const value = normalizeValue(property(source, 'value', 'Value'), `${label}.value`, warnings);
  if (!value.ok) return null;
  if (!hasProperty(source, 'key', 'Key')) return { value: value.value };
  const key = normalizeValue(property(source, 'key', 'Key'), `${label}.key`, warnings);
  return key.ok ? { key: key.value, value: value.value } : null;
}

function normalizeStore(raw: unknown, label: string, warnings: string[], remainingRecords: { value: number }): IndexedDbObjectStore | null {
  const source = object(raw);
  const name = boundedName(property(source, 'name', 'Name'), label, warnings);
  if (!name) return null;
  const keyPath = normalizeKeyPath(property(source, 'keyPath', 'KeyPath'), label, warnings);
  if (keyPath === INVALID_KEY_PATH) return null;
  const rawIndexes = property(source, 'indexes', 'Indexes');
  const indexes: IndexedDbIndex[] = [];
  if (rawIndexes !== undefined && !Array.isArray(rawIndexes)) addWarning(warnings, `${label} indexes 不是数组，已忽略`);
  for (const [index, item] of (Array.isArray(rawIndexes) ? rawIndexes : []).entries()) {
    if (indexes.length >= MAX_INDEXES_PER_STORE) {
      addWarning(warnings, `${label}索引超过限制，后续索引已忽略`);
      break;
    }
    const normalized = normalizeIndex(item, `${label}.indexes[${index}]`, warnings);
    if (normalized && !indexes.some((existing) => existing.name === normalized.name)) indexes.push(normalized);
  }
  const rawRecords = property(source, 'records', 'Records');
  const records: IndexedDbRecord[] = [];
  if (rawRecords !== undefined && !Array.isArray(rawRecords)) addWarning(warnings, `${label} records 不是数组，已忽略`);
  for (const [index, item] of (Array.isArray(rawRecords) ? rawRecords : []).entries()) {
    if (records.length >= MAX_RECORDS_PER_STORE || remainingRecords.value >= MAX_TOTAL_RECORDS) {
      addWarning(warnings, `${label}记录超过导入限制，后续记录已忽略`);
      break;
    }
    const normalized = normalizeRecord(item, `${label}.records[${index}]`, warnings);
    if (normalized) {
      records.push(normalized);
      remainingRecords.value += 1;
    }
  }
  return { name, ...(keyPath !== undefined ? { keyPath } : {}), autoIncrement: bool(property(source, 'autoIncrement', 'AutoIncrement')), indexes, records };
}

function normalizeDatabase(raw: unknown, label: string, warnings: string[], remainingRecords: { value: number }): IndexedDbDatabase | null {
  const source = object(raw);
  const name = boundedName(property(source, 'name', 'Name'), label, warnings);
  if (!name) return null;
  const versionValue = Number(property(source, 'version', 'Version'));
  const version = Number.isInteger(versionValue) && versionValue > 0 && versionValue <= 2_147_483_647 ? versionValue : 1;
  const rawStores = property(source, 'objectStores', 'ObjectStores', 'stores', 'Stores');
  if (rawStores !== undefined && !Array.isArray(rawStores)) addWarning(warnings, `${label} objectStores 不是数组，已忽略`);
  const objectStores: IndexedDbObjectStore[] = [];
  for (const [index, item] of (Array.isArray(rawStores) ? rawStores : []).entries()) {
    if (objectStores.length >= MAX_OBJECT_STORES_PER_DATABASE) {
      addWarning(warnings, `${label}对象仓库超过限制，后续仓库已忽略`);
      break;
    }
    const normalized = normalizeStore(item, `${label}.objectStores[${index}]`, warnings, remainingRecords);
    if (normalized && !objectStores.some((existing) => existing.name === normalized.name)) objectStores.push(normalized);
  }
  return { name, version, objectStores };
}

export function normalizeIndexedDbBundle(raw: unknown): IndexedDbNormalization {
  const warnings: string[] = [];
  const source = Array.isArray(raw) ? raw : property(raw, 'databases', 'Databases');
  if (source !== undefined && !Array.isArray(source)) {
    addWarning(warnings, 'IndexedDB databases 不是数组，未导入');
    return { warnings, databaseCount: 0, recordCount: 0 };
  }
  const remainingRecords = { value: 0 };
  const databases: IndexedDbDatabase[] = [];
  for (const [index, item] of (Array.isArray(source) ? source : []).entries()) {
    if (databases.length >= MAX_DATABASES) {
      addWarning(warnings, 'IndexedDB 数据库数量超过限制，后续数据库已忽略');
      break;
    }
    const normalized = normalizeDatabase(item, `indexedDB.databases[${index}]`, warnings, remainingRecords);
    if (normalized && !databases.some((existing) => existing.name === normalized.name)) databases.push(normalized);
  }
  return { bundle: { databases }, warnings, databaseCount: databases.length, recordCount: remainingRecords.value };
}

function embeddedJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

export function buildStorageImportScript(bundle: StorageImportBundle): string {
  const payload: Record<string, unknown> = {};
  if (Object.prototype.hasOwnProperty.call(bundle, 'localStorage')) payload.localStorage = bundle.localStorage ?? {};
  if (Object.prototype.hasOwnProperty.call(bundle, 'sessionStorage')) payload.sessionStorage = bundle.sessionStorage ?? {};
  if (bundle.indexedDb) payload.indexedDB = bundle.indexedDb;
  const json = embeddedJson(payload);
  return `(async () => {
  const bundle = JSON.parse(${JSON.stringify(json)});
  const result = { local: 0, session: 0, indexedDB: 0, errors: [] };
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
  const errorText = error => String(error && error.message ? error.message : error || 'unknown_error');
  const pushError = message => { if (result.errors.length < 100) result.errors.push(String(message).slice(0, 1000)); };
  const restoreWebStorage = (storage, data) => {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return 0;
    storage.clear();
    let count = 0;
    for (const [key, value] of Object.entries(data)) {
      if (key === '__export_error__') continue;
      try { storage.setItem(String(key), value == null ? '' : String(value)); count += 1; } catch (error) { pushError('webStorage:' + errorText(error)); }
    }
    return count;
  };
  const base64ToArrayBuffer = base64 => {
    const binary = atob(base64 || '');
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes.buffer;
  };
  const typedArrayFromBase64 = (type, base64) => {
    const constructor = globalThis[type];
    if (typeof constructor !== 'function') throw new Error('unsupported_typed_array:' + type);
    return new constructor(base64ToArrayBuffer(base64));
  };
  const assignSafe = (target, key, value) => { Object.defineProperty(target, key, { value, enumerable: true, configurable: true, writable: true }); };
  const fromSerializableValue = value => {
    if (Array.isArray(value)) return value.map(fromSerializableValue);
    if (!value || typeof value !== 'object') return value;
    const type = typeof value.__type === 'string' ? value.__type : '';
    if (type === 'Date') return new Date(value.value);
    if (type === 'ArrayBuffer') return base64ToArrayBuffer(value.value);
    if (['Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array', 'Float32Array', 'Float64Array', 'BigInt64Array', 'BigUint64Array'].includes(type)) return typedArrayFromBase64(type, value.value);
    if (type === 'Blob') return new Blob([], { type: typeof value.mimeType === 'string' ? value.mimeType : '' });
    const output = {};
    for (const [key, item] of Object.entries(value)) assignSafe(output, key, fromSerializableValue(item));
    return output;
  };
  const deleteIndexedDBDatabase = name => new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onerror = () => reject(request.error || new Error('indexedDB_delete_failed'));
    request.onblocked = () => reject(new Error('indexedDB_delete_blocked'));
    request.onsuccess = () => resolve();
  });
  const importDatabase = database => new Promise(async (resolve, reject) => {
    try {
      await deleteIndexedDBDatabase(database.name);
      const request = indexedDB.open(database.name, Math.max(1, Number(database.version) || 1));
      request.onerror = () => reject(request.error || new Error('indexedDB_open_failed'));
      request.onblocked = () => reject(new Error('indexedDB_open_blocked'));
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const storeInfo of database.objectStores || []) {
          const options = { autoIncrement: Boolean(storeInfo.autoIncrement) };
          if (storeInfo.keyPath !== undefined && storeInfo.keyPath !== null) options.keyPath = storeInfo.keyPath;
          const store = db.createObjectStore(storeInfo.name, options);
          for (const indexInfo of storeInfo.indexes || []) {
            try { store.createIndex(indexInfo.name, indexInfo.keyPath, { unique: Boolean(indexInfo.unique), multiEntry: Boolean(indexInfo.multiEntry) }); }
            catch (error) { pushError('indexedDB:' + database.name + ':' + storeInfo.name + ':index:' + errorText(error)); }
          }
        }
      };
      request.onsuccess = async () => {
        const db = request.result;
        try {
          let records = 0;
          for (const storeInfo of database.objectStores || []) {
            const transaction = db.transaction(storeInfo.name, 'readwrite');
            const store = transaction.objectStore(storeInfo.name);
            await new Promise((storeResolve, storeReject) => {
              let settled = false;
              const fail = error => { if (!settled) { settled = true; storeReject(error || new Error('indexedDB_import_failed')); } };
              transaction.onerror = () => fail(transaction.error);
              transaction.onabort = () => fail(transaction.error || new Error('indexedDB_import_aborted'));
              transaction.oncomplete = () => { if (!settled) { settled = true; storeResolve(); } };
              try {
                for (const record of storeInfo.records || []) {
                  const value = fromSerializableValue(record.value);
                  if (store.keyPath == null && own(record, 'key')) store.put(value, fromSerializableValue(record.key));
                  else store.put(value);
                  records += 1;
                }
              } catch (error) { fail(error); }
            });
          }
          db.close();
          resolve(records);
        } catch (error) {
          try { db.close(); } catch {}
          reject(error);
        }
      };
    } catch (error) { reject(error); }
  });
  try {
    if (own(bundle, 'localStorage')) result.local = restoreWebStorage(localStorage, bundle.localStorage);
  } catch (error) { pushError('localStorage:' + errorText(error)); }
  try {
    if (own(bundle, 'sessionStorage')) result.session = restoreWebStorage(sessionStorage, bundle.sessionStorage);
  } catch (error) { pushError('sessionStorage:' + errorText(error)); }
  const databases = Array.isArray(bundle.indexedDB && bundle.indexedDB.databases) ? bundle.indexedDB.databases : [];
  for (const database of databases) {
    try { await importDatabase(database); result.indexedDB += 1; }
    catch (error) { pushError('indexedDB:' + database.name + ':' + errorText(error)); }
  }
  return result;
})()`;
}
