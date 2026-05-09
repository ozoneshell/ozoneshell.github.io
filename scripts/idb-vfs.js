/**
 * Ozone VFS IndexedDB Version
 * Fallback companion to the OPFS VFS: identical public API and node schema.
 *
 * IDB store layout
 *
 *   Object store "nodes"
 *     keyPath : id
 *     index   : "parent_name"  on [parent, name]   (parent+name lookup)
 *     index   : "parent"       on parent            (listChildren)
 *
 *   Object store "content"
 *     keyPath : id   (SHA-1 hex of raw bytes)
 *     fields  : { id, data: ArrayBuffer, rc: number }
 *
 * Node schema  (matches OPFS version exactly)
 *   { id, name, parent, type, contentId?, meta: { created, modified } }
 */

const _reqp = r => new Promise((res, rej) => {
  r.onsuccess = e => res(e.target.result)
  r.onerror   = e => rej(e.target.error)
})

const _txdone = tx => new Promise((res, rej) => {
  tx.oncomplete = () => res()
  tx.onerror    = e => rej(e.target.error)
  tx.onabort    = e => rej(e.target.error)
})

const _dbp = new Promise((res, rej) => {
  const req = indexedDB.open("ozoneVFS2", 1)

  req.onblocked = () => console.warn("ozoneVFS2: blocked")

  req.onupgradeneeded = e => {
    const db = e.target.result

    const nodes = db.createObjectStore("nodes", { keyPath: "id" })
    nodes.createIndex("parent",      "parent",           { unique: false })
    nodes.createIndex("parent_name", ["parent", "name"], { unique: true  })

    db.createObjectStore("content", { keyPath: "id" })
  }

  req.onsuccess = e => {
    const db = e.target.result
    db.onversionchange = () => db.close()
    res(db)
  }

  req.onerror = () => rej(req.error)
})

//  Utilities 

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

async function sha1hex(arrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-1", arrayBuffer)
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("")
}

function norm(p) {
  if (!p) return "/"
  p = p.replace(/\/+/g, "/")
  if (!p.startsWith("/")) p = "/" + p
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1)
  return p
}

function parentOf(path) {
  path = norm(path)
  if (path === "/") return null
  const idx = path.lastIndexOf("/")
  return idx === 0 ? "/" : path.slice(0, idx)
}

async function _readNode(id, store) {
  return _reqp(store.get(id))
}

async function _writeNode(node, store) {
  return _reqp(store.put(node))
}

async function _deleteNode(id, store) {
  return _reqp(store.delete(id))
}

async function _lookupChild(parentId, name, store) {
  const index = store.index("parent_name")
  return _reqp(index.get([parentId, name]))
}

async function _listChildren(parentId, store) {
  const index = store.index("parent")
  return _reqp(index.getAll(parentId))
}

async function _toArrayBuffer(data) {
  if (data instanceof ArrayBuffer) return data
  if (data instanceof Blob)        return data.arrayBuffer()
  if (typeof data === "string")    return new TextEncoder().encode(data).buffer

  const reader = data.getReader()
  const chunks = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }
  const total  = chunks.reduce((n, c) => n + c.byteLength, 0)
  const merged = new Uint8Array(total)
  let off = 0
  for (const c of chunks) { merged.set(new Uint8Array(c), off); off += c.byteLength }
  return merged.buffer
}

async function _writeBlob(data, store) {
  const buf = await _toArrayBuffer(data)
  const id  = await sha1hex(buf)

  const existing = await _reqp(store.get(id))
  if (existing) {
    await _reqp(store.put({ ...existing, rc: existing.rc + 1 }))
  } else {
    await _reqp(store.put({ id, data: buf, rc: 1 }))
  }

  return id
}

async function _retainBlob(contentId, store) {
  const rec = await _reqp(store.get(contentId))
  if (!rec) return
  await _reqp(store.put({ ...rec, rc: rec.rc + 1 }))
}

async function _releaseBlob(contentId, store) {
  if (!contentId) return
  const rec = await _reqp(store.get(contentId))
  if (!rec) return
  if (rec.rc <= 1) {
    await _reqp(store.delete(contentId))
  } else {
    await _reqp(store.put({ ...rec, rc: rec.rc - 1 }))
  }
}

async function _readBlob(contentId, store) {
  const rec = await _reqp(store.get(contentId))
  return rec ? rec.data : null
}


let _rootId = null

async function ensureRoot() {
  if (_rootId) return _rootId

  const db = await _dbp
  const tx    = db.transaction("nodes", "readwrite")
  const store = tx.objectStore("nodes")

  const allRoots = await _reqp(store.index("parent").getAll(null))
  if (allRoots.length) {
    _rootId = allRoots[0].id
    await _txdone(tx)
    return _rootId
  }

  const id   = uid()
  const root = { id, name: "", parent: null, type: "folder", meta: { created: Date.now(), modified: Date.now() } }
  await _writeNode(root, store)
  await _txdone(tx)

  _rootId = id
  return _rootId
}

async function _resolvePath(path, nodeStore) {
  path = norm(path)
  const rootId = await ensureRoot()
  if (path === "/") return _readNode(rootId, nodeStore)

  const parts = path.split("/").filter(Boolean)
  let curId   = rootId

  for (const part of parts) {
    const child = await _lookupChild(curId, part, nodeStore)
    if (!child) return null
    curId = child.id
  }
  return _readNode(curId, nodeStore)
}

async function _resolveParent(path, nodeStore) {
  path = norm(path)
  if (path === "/") throw new Error("root has no parent")

  const parts      = path.split("/").filter(Boolean)
  const name       = parts.pop()
  const parentPath = "/" + parts.join("/")
  const parentNode = await _resolvePath(parentPath, nodeStore)

  if (!parentNode || parentNode.type !== "folder") {
    throw new Error(`Parent directory not found: ${parentPath}`)
  }
  return { parentNode, name }
}

async function exists(path) {
  path = norm(path)
  const db    = await _dbp
  const tx    = db.transaction("nodes", "readonly")
  const node  = await _resolvePath(path, tx.objectStore("nodes"))
  await _txdone(tx)
  return !!node
}

async function mkdir(path) {
  path = norm(path)
  if (path === "/") throw new Error("invalid path")
  await ensureRoot()

  const db    = await _dbp
  const tx    = db.transaction("nodes", "readwrite")
  const store = tx.objectStore("nodes")

  if (await _resolvePath(path, store)) throw new Error(`Already exists: ${path}`)
  const { parentNode, name } = await _resolveParent(path, store)

  const node = {
    id:     uid(),
    name,
    parent: parentNode.id,
    type:   "folder",
    meta:   { created: Date.now(), modified: Date.now() }
  }
  await _writeNode(node, store)
  await _txdone(tx)
}

async function mkdirp(path) {
  path = norm(path)
  if (path === "/") return
  await ensureRoot()

  const parts = path.split("/").filter(Boolean)
  let   cur   = "/"

  for (const part of parts) {
    const next = cur === "/" ? `/${part}` : `${cur}/${part}`
    const db    = await _dbp
    const tx    = db.transaction("nodes", "readwrite")
    const store = tx.objectStore("nodes")

    const existing = await _resolvePath(next, store)
    if (existing) {
      if (existing.type !== "folder") throw new Error(`Not a directory: ${next}`)
      await _txdone(tx)
    } else {
      const { parentNode } = await _resolveParent(next, store)
      const node = {
        id:     uid(),
        name:   part,
        parent: parentNode.id,
        type:   "folder",
        meta:   { created: Date.now(), modified: Date.now() }
      }
      await _writeNode(node, store)
      await _txdone(tx)
    }

    cur = next
  }
}

async function writeFile(path, data) {
  path = norm(path)
  await ensureRoot()

  const parentPath = path.split("/").slice(0, -1).join("/") || "/"
  await mkdirp(parentPath)

  const db      = await _dbp
  const tx      = db.transaction(["nodes", "content"], "readwrite")
  const nodes   = tx.objectStore("nodes")
  const content = tx.objectStore("content")

  const existing = await _resolvePath(path, nodes)
  if (existing?.type === "folder") throw new Error(`Is a directory: ${path}`)

  const contentId = await _writeBlob(data, content)
  const now       = Date.now()

  if (existing) {
    if (existing.contentId && existing.contentId !== contentId) {
      await _releaseBlob(existing.contentId, content)
    }
    await _writeNode({ ...existing, contentId, meta: { ...existing.meta, modified: now } }, nodes)
  } else {
    const { parentNode, name } = await _resolveParent(path, nodes)
    const node = {
      id:        uid(),
      name,
      parent:    parentNode.id,
      type:      "file",
      contentId,
      meta:      { created: now, modified: now }
    }
    await _writeNode(node, nodes)
  }

  await _txdone(tx)
}

async function readFile(path) {
  // Returns { ...node, data: ArrayBuffer } or null if not found.
  path = norm(path)
  const db      = await _dbp
  const tx      = db.transaction(["nodes", "content"], "readonly")
  const nodes   = tx.objectStore("nodes")
  const content = tx.objectStore("content")

  const node = await _resolvePath(path, nodes)
  if (!node || node.type !== "file") { await _txdone(tx); return null }

  const data = await _readBlob(node.contentId, content)
  await _txdone(tx)
  if (data === null) return null

  return { ...node, data }
}

async function streamFile(path) {
  // Returns { ...node, file: Blob } — caller may use .stream() for zero-copy reads.
  // IDB cannot hand out a native File handle, so wrap the ArrayBuffer in a Blob.
  path = norm(path)
  const result = await readFile(path)
  if (!result) return null

  const { data, ...node } = result
  return { ...node, file: new Blob([data]) }
}

async function list(path = "/") {
  // Returns array of node objects, each with a .path property attached.
  path = norm(path)
  const db    = await _dbp
  const tx    = db.transaction("nodes", "readonly")
  const store = tx.objectStore("nodes")

  const node = await _resolvePath(path, store)
  if (!node || node.type !== "folder") { await _txdone(tx); return [] }

  const children = await _listChildren(node.id, store)
  await _txdone(tx)

  return children.map(child => ({
    ...child,
    path: path === "/" ? `/${child.name}` : `${path}/${child.name}`
  }))
}

async function move(srcPath, dstPath) {
  srcPath = norm(srcPath)
  dstPath = norm(dstPath)
  if (srcPath === "/") throw new Error("Cannot move root")

  if (srcPath === dstPath) return

  const db    = await _dbp
  const tx    = db.transaction("nodes", "readwrite")
  const store = tx.objectStore("nodes")

  const srcNode = await _resolvePath(srcPath, store)
  if (!srcNode) throw new Error(`Not found: ${srcPath}`)

  if (await _resolvePath(dstPath, store)) throw new Error(`Already exists: ${dstPath}`)

  if (srcNode.type === "folder" && dstPath.startsWith(srcPath + "/")) {
    throw new Error("Cannot move a folder into itself")
  }

  const { parentNode: dstParent, name: dstName } = await _resolveParent(dstPath, store)

  await _writeNode({ ...srcNode, name: dstName, parent: dstParent.id }, store)
  await _txdone(tx)
}

async function copy(srcPath, dstPath) {
  srcPath = norm(srcPath)
  dstPath = norm(dstPath)
  if (srcPath === "/") throw new Error("Cannot copy root")

  const db      = await _dbp
  const tx      = db.transaction(["nodes", "content"], "readwrite")
  const nodes   = tx.objectStore("nodes")
  const content = tx.objectStore("content")

  const srcNode = await _resolvePath(srcPath, nodes)
  if (!srcNode) throw new Error(`Not found: ${srcPath}`)

  await _copyNode(srcNode, dstPath, nodes, content)
  await _txdone(tx)
}

async function _copyNode(srcNode, dstPath, nodes, content) {
  if (await _resolvePath(dstPath, nodes)) throw new Error(`Already exists: ${dstPath}`)
  const { parentNode, name } = await _resolveParent(dstPath, nodes)
  const now = Date.now()

  if (srcNode.type === "file") {
    await _retainBlob(srcNode.contentId, content)
    await _writeNode({
      id:        uid(),
      name,
      parent:    parentNode.id,
      type:      "file",
      contentId: srcNode.contentId,
      meta:      { created: now, modified: now }
    }, nodes)
  } else {
    const newFolder = {
      id:     uid(),
      name,
      parent: parentNode.id,
      type:   "folder",
      meta:   { created: now, modified: now }
    }
    await _writeNode(newFolder, nodes)

    const children = await _listChildren(srcNode.id, nodes)
    for (const child of children) {
      await _copyNode(child, `${dstPath}/${child.name}`, nodes, content)
    }
  }
}

async function remove(path) {
  path = norm(path)
  if (path === "/") throw new Error("Cannot remove root")

  const db      = await _dbp
  const tx      = db.transaction(["nodes", "content"], "readwrite")
  const nodes   = tx.objectStore("nodes")
  const content = tx.objectStore("content")

  const node = await _resolvePath(path, nodes)
  if (!node) { await _txdone(tx); return }

  await _removeNode(node, nodes, content)
  await _txdone(tx)
}

async function _removeNode(node, nodes, content) {
  if (node.type === "folder") {
    const children = await _listChildren(node.id, nodes)
    for (const child of children) {
      await _removeNode(child, nodes, content)
    }
  } else {
    await _releaseBlob(node.contentId, content)
  }
  await _deleteNode(node.id, nodes)
}

export {
  exists,
  mkdir,
  mkdirp,
  writeFile,
  readFile,
  streamFile,
  list,
  move,
  copy,
  remove
}