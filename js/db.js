class AppDB {
    constructor() {
        this.dbName = 'OpositestFerroDB';
        this.dbVersion = 1;
        this.db = null;
    }

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('questions')) {
                    const qStore = db.createObjectStore('questions', { keyPath: 'id', autoIncrement: true });
                    qStore.createIndex('category', 'category', { unique: false });
                    qStore.createIndex('isImported', 'isImported', { unique: false });
                    qStore.createIndex('importBatch', 'importBatch', { unique: false });
                }
                if (!db.objectStoreNames.contains('temario')) {
                    db.createObjectStore('temario', { keyPath: 'id', autoIncrement: true });
                }
                if (!db.objectStoreNames.contains('examHistory')) {
                    const hStore = db.createObjectStore('examHistory', { keyPath: 'id', autoIncrement: true });
                    hStore.createIndex('date', 'date', { unique: false });
                    hStore.createIndex('type', 'type', { unique: false });
                }
                if (!db.objectStoreNames.contains('settings')) {
                    db.createObjectStore('settings', { keyPath: 'key' });
                }
                if (!db.objectStoreNames.contains('mastered')) {
                    db.createObjectStore('mastered', { keyPath: 'questionText' });
                }
                if (!db.objectStoreNames.contains('failed')) {
                    db.createObjectStore('failed', { keyPath: 'questionText' });
                }
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve(this.db);
            };

            request.onerror = () => reject(request.error);
        });
    }

    _transaction(storeName, mode = 'readonly') {
        const tx = this.db.transaction(storeName, mode);
        return tx.objectStore(storeName);
    }

    _promise(request) {
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async add(storeName, data) {
        return this._promise(this._transaction(storeName, 'readwrite').add(data));
    }

    async put(storeName, data) {
        return this._promise(this._transaction(storeName, 'readwrite').put(data));
    }

    async get(storeName, key) {
        return this._promise(this._transaction(storeName, 'readwrite').get(key));
    }

    async getAll(storeName) {
        return this._promise(this._transaction(storeName).getAll());
    }

    async delete(storeName, key) {
        return this._promise(this._transaction(storeName, 'readwrite').delete(key));
    }

    async clear(storeName) {
        return this._promise(this._transaction(storeName, 'readwrite').clear());
    }

    async count(storeName) {
        return this._promise(this._transaction(storeName).count());
    }

    async bulkAdd(storeName, items) {
        const store = this._transaction(storeName, 'readwrite');
        return Promise.all(items.map(item => this._promise(store.add(item))));
    }

    async getByIndex(storeName, indexName, value) {
        return new Promise((resolve, reject) => {
            const store = this._transaction(storeName);
            const index = store.index(indexName);
            const request = index.getAll(value);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
}

const db = new AppDB();
