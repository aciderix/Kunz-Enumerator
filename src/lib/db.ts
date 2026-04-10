export interface KunzTaskResult {
    m: number;
    k_max: number;
    d_min: number;
    d_max: number;
    w_max: number;
    has_w_max: boolean;
    res: any; // KunzResult
    timestamp: number;
    timeTakenMs: number;
}

const DB_NAME = 'kunz_db';
const STORE_NAME = 'results';

export function openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: ['m', 'k_max'] });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

export async function saveResult(result: KunzTaskResult) {
    const db = await openDB();
    return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const req = tx.objectStore(STORE_NAME).put(result);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

export async function getResult(m: number, k_max: number): Promise<KunzTaskResult | undefined> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).get([m, k_max]);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

export async function getAllResults(): Promise<KunzTaskResult[]> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

export async function getAllKeys(): Promise<[number, number][]> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).getAllKeys();
        req.onsuccess = () => resolve(req.result as [number, number][]);
        req.onerror = () => reject(req.error);
    });
}
