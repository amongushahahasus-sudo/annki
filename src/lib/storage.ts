export interface SheetRecord {
  id: string;
  name: string;
  blob: Blob;
  createdAt: number;
  lastOpened: number;
  page: number;
  totalPages: number;
  subject: string;
  bookmarks: number[];
  sensitivity: number;
}

const DATABASE = 'aka-sheet-library';
const STORE = 'sheets';
const connections = new Map<string, Promise<IDBDatabase>>();

function openDatabase(ownerId: string): Promise<IDBDatabase> {
  const name = ownerId === 'guest' ? DATABASE : `${DATABASE}:user:${ownerId}`;
  const existing = connections.get(name);
  if (existing) return existing;
  const connection = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('このブラウザでは端末への保存を利用できません。'));
      return;
    }
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        connections.delete(name);
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error || new Error('端末の保存領域を開けませんでした。'));
    request.onblocked = () => reject(new Error('別のタブを閉じてから、もう一度お試しください。'));
  });
  connections.set(name, connection);
  connection.catch(() => { connections.delete(name); });
  return connection;
}

async function transact<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
  ownerId: string,
): Promise<T> {
  const db = await openDatabase(ownerId);
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const request = operation(transaction.objectStore(STORE));
    let result: T;
    request.onsuccess = () => { result = request.result; };
    request.onerror = () => reject(request.error || new Error('教材を保存できませんでした。'));
    // A successful request does not imply a committed write (quota, abort, etc.).
    transaction.oncomplete = () => resolve(result);
    transaction.onabort = () => reject(transaction.error || new Error('教材の保存処理が中断されました。'));
    transaction.onerror = () => reject(transaction.error || new Error('保存領域でエラーが発生しました。'));
  });
}

export async function listSheets(ownerId = 'guest'): Promise<SheetRecord[]> {
  const sheets = await transact<SheetRecord[]>('readonly', store => store.getAll(), ownerId);
  return sheets.sort((a, b) => b.lastOpened - a.lastOpened);
}

export async function getSheet(id: string, ownerId = 'guest'): Promise<SheetRecord | undefined> {
  return transact<SheetRecord | undefined>('readonly', store => store.get(id), ownerId);
}

export async function putSheet(record: SheetRecord, ownerId = 'guest'): Promise<void> {
  await transact<IDBValidKey>('readwrite', store => store.put(record), ownerId);
}

export async function deleteSheet(id: string, ownerId = 'guest'): Promise<void> {
  await transact<undefined>('readwrite', store => store.delete(id), ownerId);
}
