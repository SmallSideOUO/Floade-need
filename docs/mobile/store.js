let database
function open() {
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open('floade-mobile', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('data')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  return database
}
export async function get(key) {
  const db = await open()
  return new Promise((resolve, reject) => {
    const request = db.transaction('data').objectStore('data').get(key)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
export async function clear() {
  const db = await open()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('data', 'readwrite')
    transaction.objectStore('data').clear()
    transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error)
  })
}
export async function put(key, value) {
  const db = await open()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('data', 'readwrite')
    const store = transaction.objectStore('data')
    if (value === undefined) store.delete(key); else store.put(value, key)
    transaction.oncomplete = resolve
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error || new Error('無法保留草稿。'))
  })
}
