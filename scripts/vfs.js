// OPFS-backed Virtual File System for Ozone
//
// layout:
//   Inside that directory:
//     .meta   – JSON: { type, parent, size?, meta }
//     .data   – raw file payload (files only)

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
  const r = s.join("/")
  return r || "/"
}

// root

const rootp = navigator.storage.getDirectory()

// go to directory backing VFS path.
// ["vfs", "a", "b", "c"]  for VFS path /a/b/c
// create=true, intermediate dirs are created with getDirectoryHandle({create:true})
async function opfsDir(vfsPath, { create = false } = {}) {
  const root = await rootp
  const parts = ["vfs", ...vfsPath.split("/").filter(Boolean)]
  let cur = root
  for (const part of parts) {
    cur = await cur.getDirectoryHandle(part, { create })
  }
  return cur
}

// meta management

async function readMeta(dir) {
  try {
    const fh = await dir.getFileHandle(".meta")
    const file = await fh.getFile()
    return JSON.parse(await file.text())
  } catch {
    return null
  }
}

async function writeMeta(dir, meta) {
  const fh = await dir.getFileHandle(".meta", { create: true })
  const w = await fh.createWritable()
  await w.write(JSON.stringify(meta))
  await w.close()
}

// api

async function ensureRoot() {
  const dir = await opfsDir("/", { create: true })
  const existing = await readMeta(dir)
  if (!existing) {
    await writeMeta(dir, { path: "/", type: "folder", parent: null, meta: {} })
  }
  return true
}

async function exists(path) {
  path = norm(path)
  try {
    const dir = await opfsDir(path)
    const meta = await readMeta(dir)
    return !!meta
  } catch {
    return false
  }
}

async function mkdir(path) {
  path = norm(path)
  if (path === "/") throw Error("invalid path")

  try {
    const dir = await opfsDir(path)
    const meta = await readMeta(dir)
    if (meta) throw Error("exists")
  } catch (e) {
    if (e.message === "exists") throw e
  }

  const parent = parentOf(path)
  let parentMeta
  try {
    const parentDir = await opfsDir(parent)
    parentMeta = await readMeta(parentDir)
  } catch {
    parentMeta = null
  }
  if (!parentMeta || parentMeta.type !== "folder") throw Error("invalid parent")

  const dir = await opfsDir(path, { create: true })
  await writeMeta(dir, { path, type: "folder", parent, meta: {} })
}

async function mkdirp(path) {
  path = norm(path)
  if (path === "/") return

  const parts = path.split("/").filter(Boolean)
  let cur = ""

  for (const p of parts) {
    cur += "/" + p

    let dir
    try {
      dir = await opfsDir(cur)
      const meta = await readMeta(dir)
      if (meta) {
        if (meta.type !== "folder") throw Error("exists")
        continue
      }
      // dir without meta doesnt exist
    } catch (e) {
      if (e.message === "exists") throw e
    }

    const parent = parentOf(cur)
    let parentMeta
    try {
      const parentDir = await opfsDir(parent)
      parentMeta = await readMeta(parentDir)
    } catch {
      parentMeta = null
    }
    if (!parentMeta || parentMeta.type !== "folder") throw Error("invalid parent")

    dir = await opfsDir(cur, { create: true })
    await writeMeta(dir, { path: cur, type: "folder", parent, meta: {} })
  }
}

async function writeFile(path, data) {
  path = norm(path)
  const parent = parentOf(path)

  if (parent) await mkdirp(parent)

  // dont overwrite a folder
  try {
    const dir = await opfsDir(path)
    const meta = await readMeta(dir)
    if (meta?.type === "folder") throw Error("cannot overwrite folder")
  } catch (e) {
    if (e.message === "cannot overwrite folder") throw e
  }

  const dir = await opfsDir(path, { create: true })

  // write
  const dataFh = await dir.getFileHandle(".data", { create: true })
  const w = await dataFh.createWritable()
  await w.write(data)
  await w.close()

  const size = data?.size ?? data?.length ?? 0

  await writeMeta(dir, {
    path,
    type: "file",
    parent,
    size,
    meta: { modified: Date.now() }
  })
}

async function readFile(path) {
  path = norm(path)
  try {
    const dir = await opfsDir(path)
    const meta = await readMeta(dir)
    if (!meta) return undefined

    if (meta.type === "file") {
      const dataFh = await dir.getFileHandle(".data")
      const file = await dataFh.getFile()
      const data = await file.arrayBuffer()
      return { ...meta, data }
    }

    return meta
  } catch {
    return undefined
  }
}

async function list(path = "/") {
  path = norm(path)
  const results = []

  try {
    const parentDir = await opfsDir(path)
    const parentMeta = await readMeta(parentDir)
    if (!parentMeta || parentMeta.type !== "folder") return results

    for await (const [name, handle] of parentDir) {
      // skip internal
      if (name === ".meta" || name === ".data") continue

      try {
        const childMeta = await readMeta(handle)
        if (childMeta) results.push(childMeta)
      } catch {}
    }
  } catch {}
  return results
}

async function remove(path) {
  path = norm(path)
  const stack = [path]

  while (stack.length) {
    const p = stack.pop()
    const children = await list(p)
    for (const c of children) stack.push(c.path)

    if (p === "/") continue // never delete root

    try {
      const parentPath = parentOf(p)
      const parentDir = await opfsDir(parentPath)
      const segName = p.split("/").filter(Boolean).pop()
      await parentDir.removeEntry(segName, { recursive: true })
    } catch {}
  }
}