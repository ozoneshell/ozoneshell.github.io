/**
 * Ozone VFS OPFS virtual file system
 * Author: darkdot
 *
 * VFS layout
 * 
 *   vfs/
 *     nodes/
 *       <nodeId>           <- one OPFS file per node
 *     content/
 *       <contentId>        <- one OPFS file per unique blob
 *     idx/
 *       <parentId>_<name>  <- value = nodeId  (parent+name : node index)
 *     meta/
 *       root               <- JSON: { rootId }
 *
 * Node JSON schema
 *   { id, name, parent, type, contentId?, meta: { created, modified } }
 *
 * Content files
 *   Raw bytes only, no wrapping JSON.
 *   contentId = SHA-1 hex of the raw bytes (content-addressable).
 *   A separate refcount file lives at  content/<contentId>.rc  (plain integer text).
 */

async function exists(path) {
  path = norm(path)
  const node = await vfsresolvePath(path)
  return !!node
}

function parentOf(path) {
  path = norm(path)
  if (path === "/") return null

  const idx = path.lastIndexOf("/")
  return idx === 0 ? "/" : path.slice(0, idx)
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

async function sha1hex(arrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-1", arrayBuffer)
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("")
}

function tryParseJSON(text) {
  try { return JSON.parse(text) } catch { return null }
}

function norm(p) {
  if (!p) return "/"
  p = p.replace(/\/+/g, "/")
  if (!p.startsWith("/")) p = "/" + p
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1)
  return p
}

let _root = null
export async function opfsRoot() {
  if (!_root) _root = await navigator.storage.getDirectory()
  return _root
}

async function opfsDir(segments, create = false) {
  let cur = await opfsRoot()
  for (const seg of segments) {
    cur = await cur.getDirectoryHandle(seg, { create })
  }
  return cur
}

const _fhCache = new WeakMap()

async function _fileHandle(dirHandle, filename, create = false) {
  let byName = _fhCache.get(dirHandle)
  if (!byName) { byName = new Map(); _fhCache.set(dirHandle, byName) }
  const cached = byName.get(filename)
  if (cached) return cached
  const fh = await dirHandle.getFileHandle(filename, { create })
  byName.set(filename, fh)
  return fh
}

async function opfsRead(dirHandle, filename) {
  try {
    const fh = await _fileHandle(dirHandle, filename)
    return await (await fh.getFile()).text()
  } catch {
    return null
  }
}

async function opfsWrite(dirHandle, filename, text) {
  const fh = await _fileHandle(dirHandle, filename, true)
  const w = await fh.createWritable()
  await w.write(text)
  await w.close()
}

async function opfsWriteBinary(dirHandle, filename, data) {
  const fh = await _fileHandle(dirHandle, filename, true)
  const w = await fh.createWritable()
  await w.write(data)
  await w.close()
}

async function opfsFile(dirHandle, filename) {
  try {
    return await (await _fileHandle(dirHandle, filename)).getFile()
  } catch {
    return null
  }
}

async function opfsDelete(dirHandle, filename) {
  try {
    _fhCache.get(dirHandle)?.delete(filename)
    await dirHandle.removeEntry(filename)
  } catch { }
}

let _dirs = null
let _initPromise = null

async function dirs() {
  if (_dirs) return _dirs
  if (_initPromise) return _initPromise
  _initPromise = (async () => {
    const root = await opfsRoot()
    const vfs = await root.getDirectoryHandle("vfs", { create: true })
    const [nodes, content, idx, metaDir] = await Promise.all([
      vfs.getDirectoryHandle("nodes",   { create: true }),
      vfs.getDirectoryHandle("content", { create: true }),
      vfs.getDirectoryHandle("idx",     { create: true }),
      vfs.getDirectoryHandle("meta",    { create: true }),
    ])
    _dirs = { nodes, content, idx, metaDir }
    return _dirs
  })()
  return _initPromise
}

const NODE_CACHE = new Map()
const NODE_CACHE_MAX = 2000

async function readNode(id) {
  if (NODE_CACHE.has(id)) return NODE_CACHE.get(id)
  const { nodes } = await dirs()
  const text = await opfsRead(nodes, id)
  const node = text ? JSON.parse(text) : null
  if (node) {
    if (NODE_CACHE.size >= NODE_CACHE_MAX) NODE_CACHE.clear()
    NODE_CACHE.set(id, node)
  }
  return node
}

async function writeNode(node) {
  const { nodes, idx } = await dirs()
  NODE_CACHE.set(node.id, node)
  await opfsWrite(nodes, node.id, JSON.stringify(node))
  if (node.parent !== null) {
    await opfsWrite(idx, _idxKey(node.parent, node.name), node.id)
  }
}

async function deleteNode(node) {
  const { nodes, idx } = await dirs()
  NODE_CACHE.delete(node.id)
  await opfsDelete(nodes, node.id)
  if (node.parent !== null) {
    await opfsDelete(idx, _idxKey(node.parent, node.name))
  }
}

function _idxKey(parentId, name) {
  return parentId + "_" + encodeURIComponent(name)
}

async function lookupChild(parentId, name) {
  const { idx } = await dirs()
  const nodeId = await opfsRead(idx, _idxKey(parentId, name))
  if (!nodeId) return null
  return readNode(nodeId.trim())
}

async function listChildren(parentId) {
  const { idx } = await dirs()
  const prefix = parentId + "_"
  const names = []
  for await (const [name] of idx) {
    if (name.startsWith(prefix)) names.push(name)
  }
  const nodeIds = await Promise.all(names.map(n => opfsRead(idx, n)))
  const nodes = await Promise.all(
    nodeIds
      .map(id => id?.trim())
      .filter(Boolean)
      .map(id => readNode(id))
  )
  return nodes.filter(Boolean)
}

async function writeBlob(data) {
  const { content } = await dirs()

  let buf

  if (data instanceof ArrayBuffer) {
    buf = data

  } else if (ArrayBuffer.isView(data)) {
    buf = data.buffer.slice(
      data.byteOffset,
      data.byteOffset + data.byteLength
    )

  } else if (data instanceof Blob) {
    buf = await data.arrayBuffer()

  } else if (typeof data === "string") {
    buf = new TextEncoder().encode(data).buffer

  } else if (data?.getReader) {
    const reader = data.getReader()
    const chunks = []

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }

    const total = chunks.reduce((n, c) => n + c.byteLength, 0)
    const merged = new Uint8Array(total)

    let off = 0
    for (const c of chunks) {
      merged.set(new Uint8Array(c), off)
      off += c.byteLength
    }

    buf = merged.buffer
  } else {
    throw new Error("Unsupported data type for writeBlob")
  }

  const id = await sha1hex(buf)
  const existing = await opfsRead(content, id + ".rc")

  if (existing === null) {
    await opfsWriteBinary(content, id, buf)
    await opfsWrite(content, id + ".rc", "1")
  } else {
    const rc = parseInt(existing, 10) || 0
    await opfsWrite(content, id + ".rc", String(rc + 1))
  }

  return id
}

async function retainBlob(contentId) {
  const { content } = await dirs()
  const rc = parseInt(await opfsRead(content, contentId + ".rc") || "0", 10)
  await opfsWrite(content, contentId + ".rc", String(rc + 1))
}

async function releaseBlob(contentId) {
  if (!contentId) return
  const { content } = await dirs()
  const rc = parseInt(await opfsRead(content, contentId + ".rc") || "0", 10)
  if (rc <= 1) {
    await opfsDelete(content, contentId)
    await opfsDelete(content, contentId + ".rc")
  } else {
    await opfsWrite(content, contentId + ".rc", String(rc - 1))
  }
}

async function readBlob(contentId) {
  const { content } = await dirs()
  const file = await opfsFile(content, contentId)
  if (!file) return null
  return file.arrayBuffer()
}

async function streamBlob(contentId) {
  const { content } = await dirs()
  return opfsFile(content, contentId)
}

let _rootId = null

async function ensureRoot() {
  if (_rootId) return _rootId
  const { metaDir } = await dirs()

  const stored = await opfsRead(metaDir, "root")
  if (stored) {
    _rootId = tryParseJSON(stored)?.rootId
    if (_rootId) return _rootId
  }

  const id = uid()
  const rootNode = {
    id,
    name: "",
    parent: null,
    type: "folder",
    meta: { created: Date.now(), modified: Date.now() }
  }
  await writeNode(rootNode)
  await opfsWrite(metaDir, "root", JSON.stringify({ rootId: id }))
  _rootId = id
  return _rootId
}

async function _initVfs() {
  await dirs()
  await ensureRoot()
}

async function vfsresolvePath(path) {
  path = norm(path)
  const rootId = await ensureRoot()
  if (path === "/") return readNode(rootId)

  const parts = path.split("/").filter(Boolean)
  let curId = rootId
  for (const part of parts) {
    const child = await lookupChild(curId, part)
    if (!child) return null
    curId = child.id
  }
  return readNode(curId)
}

async function resolveParent(path) {
  path = norm(path)
  if (path === "/") throw new Error("root has no parent")
  const parts = path.split("/").filter(Boolean)
  const name = parts.pop()
  const parentPath = "/" + parts.join("/")
  const parentNode = await vfsresolvePath(parentPath)
  if (!parentNode || parentNode.type !== "folder") {
    throw new Error(`Parent directory not found: ${parentPath}`)
  }
  return { parentNode, name }
}

async function mkdir(path) {
  path = norm(path)
  await ensureRoot()
  if (await vfsresolvePath(path)) throw new Error(`Already exists: ${path}`)
  const { parentNode, name } = await resolveParent(path)
  const node = {
    id: uid(), name, parent: parentNode.id, type: "folder",
    meta: { created: Date.now(), modified: Date.now() }
  }
  await writeNode(node)
}

async function mkdirp(path) {
  path = norm(path)
  if (path === "/") return
  await ensureRoot()
  const parts = path.split("/").filter(Boolean)
  let cur = "/"
  for (const part of parts) {
    const next = cur === "/" ? `/${part}` : `${cur}/${part}`
    const existing = await vfsresolvePath(next)
    if (existing) {
      if (existing.type !== "folder") throw new Error(`Not a directory: ${next}`)
    } else {
      const { parentNode } = await resolveParent(next)
      await writeNode({
        id: uid(), name: part, parent: parentNode.id, type: "folder",
        meta: { created: Date.now(), modified: Date.now() }
      })
    }
    cur = next
  }
}

async function writeFile(path, data) {
  path = norm(path)

  await ensureRoot()

  const existing = await vfsresolvePath(path)

  if (existing?.type === "folder") {
    throw new Error(`Is a directory: ${path}`)
  }

  await mkdirp(path.split("/").slice(0, -1).join("/") || "/")

  let contentId

  if (existing?.contentId) {
    const buf =
      typeof data === "string"
        ? new TextEncoder().encode(data).buffer
        : data instanceof Blob
          ? await data.arrayBuffer()
          : data

    const newId = await sha1hex(buf)

    if (newId === existing.contentId) {
      contentId = existing.contentId
    } else {
      contentId = await writeBlob(buf)
      await releaseBlob(existing.contentId)
    }
  } else {
    contentId = await writeBlob(data)
  }

  const now = Date.now()

  if (existing) {
    await writeNode({
      ...existing,
      contentId,
      meta: {
        ...existing.meta,
        modified: now
      }
    })
  } else {
    const { parentNode, name } = await resolveParent(path)

    await writeNode({
      id: uid(),
      name,
      parent: parentNode.id,
      type: "file",
      contentId,
      meta: {
        created: now,
        modified: now
      }
    })
  }
}

async function readFile(path) {
  path = norm(path)
  const node = await vfsresolvePath(path)
  if (!node || node.type !== "file") return null
  const data = await readBlob(node.contentId)
  if (data === null) return null
  return { ...node, data }
}

async function streamFile(path) {
  path = norm(path)
  const node = await vfsresolvePath(path)
  if (!node || node.type !== "file") return null
  const file = await streamBlob(node.contentId)
  if (!file) return null
  return { ...node, file }
}

async function list(path = "/") {
  path = norm(path)
  const node = await vfsresolvePath(path)
  if (!node || node.type !== "folder") return []
  const children = await listChildren(node.id)
  return children.map(child => ({
    ...child,
    path: path === "/" ? `/${child.name}` : `${path}/${child.name}`
  }))
}

async function move(srcPath, dstPath) {
  srcPath = norm(srcPath)
  dstPath = norm(dstPath)
  if (srcPath === "/") throw new Error("Cannot move root")
  const srcNode = await vfsresolvePath(srcPath)
  if (!srcNode) throw new Error(`Not found: ${srcPath}`)
  if (await vfsresolvePath(dstPath)) throw new Error(`Already exists: ${dstPath}`)
  if (srcNode.type === "folder" && dstPath.startsWith(srcPath + "/")) {
    throw new Error("Cannot move a folder into itself")
  }
  const { parentNode: dstParent, name: dstName } = await resolveParent(dstPath)
  const { idx } = await dirs()
  await opfsDelete(idx, _idxKey(srcNode.parent, srcNode.name))
  await writeNode({ ...srcNode, name: dstName, parent: dstParent.id })
}

async function copy(srcPath, dstPath) {
  srcPath = norm(srcPath)
  dstPath = norm(dstPath)
  if (srcPath === "/") throw new Error("Cannot copy root")
  const srcNode = await vfsresolvePath(srcPath)
  if (!srcNode) throw new Error(`Not found: ${srcPath}`)
  await _copyNode(srcNode, dstPath)
}

async function _copyNode(srcNode, dstPath) {
  if (await vfsresolvePath(dstPath)) throw new Error(`Already exists: ${dstPath}`)
  const { parentNode, name } = await resolveParent(dstPath)
  const now = Date.now()
  if (srcNode.type === "file") {
    await retainBlob(srcNode.contentId)
    await writeNode({
      id: uid(), name, parent: parentNode.id, type: "file",
      contentId: srcNode.contentId, meta: { created: now, modified: now }
    })
  } else {
    const newFolder = {
      id: uid(), name, parent: parentNode.id, type: "folder",
      meta: { created: now, modified: now }
    }
    await writeNode(newFolder)
    const children = await listChildren(srcNode.id)
    await Promise.all(children.map(child => _copyNode(child, `${dstPath}/${child.name}`)))
  }
}

async function remove(path) {
  path = norm(path)
  if (path === "/") throw new Error("Cannot remove root")
  const node = await vfsresolvePath(path)
  if (!node) return
  await _removeNode(node)
}

async function _removeNode(node) {
  if (node.type === "folder") {
    const children = await listChildren(node.id)
    await Promise.all(children.map(child => _removeNode(child)))
  } else {
    await releaseBlob(node.contentId)
  }
  await deleteNode(node)
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
  remove,
  vfsresolvePath,
  ensureRoot,
  parentOf,
  norm
}