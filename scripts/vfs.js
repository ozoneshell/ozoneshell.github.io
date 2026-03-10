const reqp = r => new Promise((res, rej) => {
    r.onsuccess = e => res(e.target.result)
    r.onerror = e => rej(e.target.error)
})

const txdone = tx => new Promise((res, rej) => {
    tx.oncomplete = () => res()
    tx.onerror = e => rej(e.target.error)
    tx.onabort = e => rej(e.target.error)
})

const norm = p => {
    if (!p) return "/"
    p = p.replace(/\/+/g, "/")
    if (!p.startsWith("/")) p = "/" + p
    if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1)
    return p
}

const parentOf = p => {
    p = norm(p)
    if (p === "/") return null
    const s = p.split("/")
    s.pop()
    const r = s.join("")
    return r || "/"
}

const dbp = new Promise((res, rej) => {
    const req = indexedDB.open("ozoneVFS", 1)
    req.onupgradeneeded = e => {
        const db = e.target.result
        const store = db.createObjectStore("files", { keyPath: "path" })
        store.createIndex("parent", "parent")
    }
    req.onsuccess = e => res(e.target.result)
    req.onerror = e => rej(e.target.error)
})

async function ensureRoot() {
    const db = await dbp
    const tx = db.transaction("files", "readwrite")
    const store = tx.objectStore("files")
    const root = await reqp(store.get("/"))
    if (!root) store.put({ path: "/", type: "folder", parent: null, meta: {} })
    await txdone(tx)
}

ensureRoot()

async function exists(path) {
    path = norm(path)
    const db = await dbp
    const tx = db.transaction("files", "readonly")
    const store = tx.objectStore("files")
    const v = await reqp(store.get(path))
    await txdone(tx)
    return !!v
}

async function mkdir(path) {
    path = norm(path)
    const db = await dbp
    const parent = parentOf(path)
    const tx = db.transaction("files", "readwrite")
    const store = tx.objectStore("files")

    if (await reqp(store.get(path))) throw Error("exists")

    const p = await reqp(store.get(parent))
    if (!p || p.type !== "folder") throw Error("invalid parent")

    store.put({ path, type: "folder", parent, meta: {} })
    await txdone(tx)
}

async function writeFile(path, data) {
    path = norm(path)
    const db = await dbp
    const parent = parentOf(path)
    const tx = db.transaction("files", "readwrite")
    const store = tx.objectStore("files")

    const p = await reqp(store.get(parent))
    if (!p || p.type !== "folder") throw Error("invalid parent")

    store.put({
        path,
        type: "file",
        parent,
        data,
        size: data.size || data.length || 0,
        meta: { modified: Date.now() }
    })

    await txdone(tx)
}

async function readFile(path) {
    path = norm(path)
    const db = await dbp
    const tx = db.transaction("files", "readonly")
    const store = tx.objectStore("files")
    const v = await reqp(store.get(path))
    await txdone(tx)
    return v
}

async function list(path) {
    path = norm(path)
    const db = await dbp
    const tx = db.transaction("files", "readonly")
    const index = tx.objectStore("files").index("parent")
    const r = await reqp(index.getAll(path))
    await txdone(tx)
    return r
}

async function remove(path) {
    path = norm(path)
    const db = await dbp
    const tx = db.transaction("files", "readwrite")
    const store = tx.objectStore("files")
    const index = store.index("parent")

    const stack = [path]

    while (stack.length) {
        const p = stack.pop()
        const children = await reqp(index.getAll(p))
        for (const c of children) stack.push(c.path)
        if (p !== "/") store.delete(p)
    }

    await txdone(tx)
}