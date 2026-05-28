// scripts/vfs.js
async function exists(path) {
  path = norm(path);
  const node = await vfsresolvePath(path);
  return !!node;
}
function parentOf(path) {
  path = norm(path);
  if (path === "/") return null;
  const idx = path.lastIndexOf("/");
  return idx === 0 ? "/" : path.slice(0, idx);
}
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
async function sha1hex(arrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-1", arrayBuffer);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function tryParseJSON(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
function norm(p) {
  if (!p) return "/";
  p = p.replace(/\/+/g, "/");
  if (!p.startsWith("/")) p = "/" + p;
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p;
}
var _root = null;
async function opfsRoot() {
  if (!_root) _root = await navigator.storage.getDirectory();
  return _root;
}
var _fhCache = /* @__PURE__ */ new WeakMap();
async function _fileHandle(dirHandle, filename, create = false) {
  let byName = _fhCache.get(dirHandle);
  if (!byName) {
    byName = /* @__PURE__ */ new Map();
    _fhCache.set(dirHandle, byName);
  }
  const cached = byName.get(filename);
  if (cached) return cached;
  const fh = await dirHandle.getFileHandle(filename, { create });
  byName.set(filename, fh);
  return fh;
}
async function opfsRead(dirHandle, filename) {
  try {
    const fh = await _fileHandle(dirHandle, filename);
    return await (await fh.getFile()).text();
  } catch {
    return null;
  }
}
async function opfsWrite(dirHandle, filename, text) {
  const fh = await _fileHandle(dirHandle, filename, true);
  const w = await fh.createWritable();
  await w.write(text);
  await w.close();
}
async function opfsWriteBinary(dirHandle, filename, data) {
  const fh = await _fileHandle(dirHandle, filename, true);
  const w = await fh.createWritable();
  await w.write(data);
  await w.close();
}
async function opfsFile(dirHandle, filename) {
  try {
    return await (await _fileHandle(dirHandle, filename)).getFile();
  } catch {
    return null;
  }
}
async function opfsDelete(dirHandle, filename) {
  try {
    _fhCache.get(dirHandle)?.delete(filename);
    await dirHandle.removeEntry(filename);
  } catch {
  }
}
var _dirs = null;
var _initPromise = null;
async function dirs() {
  if (_dirs) return _dirs;
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    const root = await opfsRoot();
    const vfs = await root.getDirectoryHandle("vfs", { create: true });
    const [nodes, content, idx, metaDir] = await Promise.all([
      vfs.getDirectoryHandle("nodes", { create: true }),
      vfs.getDirectoryHandle("content", { create: true }),
      vfs.getDirectoryHandle("idx", { create: true }),
      vfs.getDirectoryHandle("meta", { create: true })
    ]);
    _dirs = { nodes, content, idx, metaDir };
    return _dirs;
  })();
  return _initPromise;
}
var NODE_CACHE = /* @__PURE__ */ new Map();
var NODE_CACHE_MAX = 2e3;
async function readNode(id) {
  if (NODE_CACHE.has(id)) return NODE_CACHE.get(id);
  const { nodes } = await dirs();
  const text = await opfsRead(nodes, id);
  const node = text ? JSON.parse(text) : null;
  if (node) {
    if (NODE_CACHE.size >= NODE_CACHE_MAX) NODE_CACHE.clear();
    NODE_CACHE.set(id, node);
  }
  return node;
}
async function writeNode(node) {
  const { nodes, idx } = await dirs();
  NODE_CACHE.set(node.id, node);
  await opfsWrite(nodes, node.id, JSON.stringify(node));
  if (node.parent !== null) {
    await opfsWrite(idx, _idxKey(node.parent, node.name), node.id);
  }
}
async function deleteNode(node) {
  const { nodes, idx } = await dirs();
  NODE_CACHE.delete(node.id);
  await opfsDelete(nodes, node.id);
  if (node.parent !== null) {
    await opfsDelete(idx, _idxKey(node.parent, node.name));
  }
}
function _idxKey(parentId, name) {
  return parentId + "_" + encodeURIComponent(name);
}
async function lookupChild(parentId, name) {
  const { idx } = await dirs();
  const nodeId = await opfsRead(idx, _idxKey(parentId, name));
  if (!nodeId) return null;
  return readNode(nodeId.trim());
}
async function listChildren(parentId) {
  const { idx } = await dirs();
  const prefix = parentId + "_";
  const names = [];
  for await (const [name] of idx) {
    if (name.startsWith(prefix)) names.push(name);
  }
  const nodeIds = await Promise.all(names.map((n) => opfsRead(idx, n)));
  const nodes = await Promise.all(
    nodeIds.map((id) => id?.trim()).filter(Boolean).map((id) => readNode(id))
  );
  return nodes.filter(Boolean);
}
async function writeBlob(data) {
  const { content } = await dirs();
  let buf;
  if (data instanceof ArrayBuffer) {
    buf = data;
  } else if (ArrayBuffer.isView(data)) {
    buf = data.buffer.slice(
      data.byteOffset,
      data.byteOffset + data.byteLength
    );
  } else if (data instanceof Blob) {
    buf = await data.arrayBuffer();
  } else if (typeof data === "string") {
    buf = new TextEncoder().encode(data).buffer;
  } else if (data?.getReader) {
    const reader = data.getReader();
    const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const total = chunks.reduce((n, c) => n + c.byteLength, 0);
    const merged = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      merged.set(new Uint8Array(c), off);
      off += c.byteLength;
    }
    buf = merged.buffer;
  } else {
    throw new Error("Unsupported data type for writeBlob");
  }
  const id = await sha1hex(buf);
  const existing = await opfsRead(content, id + ".rc");
  if (existing === null) {
    await opfsWriteBinary(content, id, buf);
    await opfsWrite(content, id + ".rc", "1");
  } else {
    const rc = parseInt(existing, 10) || 0;
    await opfsWrite(content, id + ".rc", String(rc + 1));
  }
  return id;
}
async function retainBlob(contentId) {
  const { content } = await dirs();
  const rc = parseInt(await opfsRead(content, contentId + ".rc") || "0", 10);
  await opfsWrite(content, contentId + ".rc", String(rc + 1));
}
async function releaseBlob(contentId) {
  if (!contentId) return;
  const { content } = await dirs();
  const rc = parseInt(await opfsRead(content, contentId + ".rc") || "0", 10);
  if (rc <= 1) {
    await opfsDelete(content, contentId);
    await opfsDelete(content, contentId + ".rc");
  } else {
    await opfsWrite(content, contentId + ".rc", String(rc - 1));
  }
}
async function readBlob(contentId) {
  const { content } = await dirs();
  const file = await opfsFile(content, contentId);
  if (!file) return null;
  return file.arrayBuffer();
}
async function streamBlob(contentId) {
  const { content } = await dirs();
  return opfsFile(content, contentId);
}
var _rootId = null;
async function ensureRoot() {
  if (_rootId) return _rootId;
  const { metaDir } = await dirs();
  const stored = await opfsRead(metaDir, "root");
  if (stored) {
    _rootId = tryParseJSON(stored)?.rootId;
    if (_rootId) return _rootId;
  }
  const id = uid();
  const rootNode = {
    id,
    name: "",
    parent: null,
    type: "folder",
    meta: { created: Date.now(), modified: Date.now() }
  };
  await writeNode(rootNode);
  await opfsWrite(metaDir, "root", JSON.stringify({ rootId: id }));
  _rootId = id;
  return _rootId;
}
async function vfsresolvePath(path) {
  path = norm(path);
  const rootId = await ensureRoot();
  if (path === "/") return readNode(rootId);
  const parts = path.split("/").filter(Boolean);
  let curId = rootId;
  for (const part of parts) {
    const child = await lookupChild(curId, part);
    if (!child) return null;
    curId = child.id;
  }
  return readNode(curId);
}
async function resolveParent(path) {
  path = norm(path);
  if (path === "/") throw new Error("root has no parent");
  const parts = path.split("/").filter(Boolean);
  const name = parts.pop();
  const parentPath = "/" + parts.join("/");
  const parentNode = await vfsresolvePath(parentPath);
  if (!parentNode || parentNode.type !== "folder") {
    throw new Error(`Parent directory not found: ${parentPath}`);
  }
  return { parentNode, name };
}
async function mkdir(path) {
  path = norm(path);
  await ensureRoot();
  if (await vfsresolvePath(path)) throw new Error(`Already exists: ${path}`);
  const { parentNode, name } = await resolveParent(path);
  const node = {
    id: uid(),
    name,
    parent: parentNode.id,
    type: "folder",
    meta: { created: Date.now(), modified: Date.now() }
  };
  await writeNode(node);
}
async function mkdirp(path) {
  path = norm(path);
  if (path === "/") return;
  await ensureRoot();
  const parts = path.split("/").filter(Boolean);
  let cur = "/";
  for (const part of parts) {
    const next = cur === "/" ? `/${part}` : `${cur}/${part}`;
    const existing = await vfsresolvePath(next);
    if (existing) {
      if (existing.type !== "folder") throw new Error(`Not a directory: ${next}`);
    } else {
      const { parentNode } = await resolveParent(next);
      await writeNode({
        id: uid(),
        name: part,
        parent: parentNode.id,
        type: "folder",
        meta: { created: Date.now(), modified: Date.now() }
      });
    }
    cur = next;
  }
}
async function writeFile(path, data) {
  path = norm(path);
  await ensureRoot();
  const existing = await vfsresolvePath(path);
  if (existing?.type === "folder") {
    throw new Error(`Is a directory: ${path}`);
  }
  await mkdirp(path.split("/").slice(0, -1).join("/") || "/");
  let contentId;
  if (existing?.contentId) {
    const buf = typeof data === "string" ? new TextEncoder().encode(data).buffer : data instanceof Blob ? await data.arrayBuffer() : data;
    const newId = await sha1hex(buf);
    if (newId === existing.contentId) {
      contentId = existing.contentId;
    } else {
      contentId = await writeBlob(buf);
      await releaseBlob(existing.contentId);
    }
  } else {
    contentId = await writeBlob(data);
  }
  const now = Date.now();
  if (existing) {
    await writeNode({
      ...existing,
      contentId,
      meta: {
        ...existing.meta,
        modified: now
      }
    });
  } else {
    const { parentNode, name } = await resolveParent(path);
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
    });
  }
}
async function readFile(path) {
  path = norm(path);
  const node = await vfsresolvePath(path);
  if (!node || node.type !== "file") return null;
  const data = await readBlob(node.contentId);
  if (data === null) return null;
  return { ...node, data };
}
async function streamFile(path) {
  path = norm(path);
  const node = await vfsresolvePath(path);
  if (!node || node.type !== "file") return null;
  const file = await streamBlob(node.contentId);
  if (!file) return null;
  return { ...node, file };
}
async function list(path = "/") {
  path = norm(path);
  const node = await vfsresolvePath(path);
  if (!node || node.type !== "folder") return [];
  const children = await listChildren(node.id);
  return children.map((child) => ({
    ...child,
    path: path === "/" ? `/${child.name}` : `${path}/${child.name}`
  }));
}
async function move(srcPath, dstPath) {
  srcPath = norm(srcPath);
  dstPath = norm(dstPath);
  if (srcPath === "/") throw new Error("Cannot move root");
  const srcNode = await vfsresolvePath(srcPath);
  if (!srcNode) throw new Error(`Not found: ${srcPath}`);
  if (await vfsresolvePath(dstPath)) throw new Error(`Already exists: ${dstPath}`);
  if (srcNode.type === "folder" && dstPath.startsWith(srcPath + "/")) {
    throw new Error("Cannot move a folder into itself");
  }
  const { parentNode: dstParent, name: dstName } = await resolveParent(dstPath);
  const { idx } = await dirs();
  await opfsDelete(idx, _idxKey(srcNode.parent, srcNode.name));
  await writeNode({ ...srcNode, name: dstName, parent: dstParent.id });
}
async function copy(srcPath, dstPath) {
  srcPath = norm(srcPath);
  dstPath = norm(dstPath);
  if (srcPath === "/") throw new Error("Cannot copy root");
  const srcNode = await vfsresolvePath(srcPath);
  if (!srcNode) throw new Error(`Not found: ${srcPath}`);
  await _copyNode(srcNode, dstPath);
}
async function _copyNode(srcNode, dstPath) {
  if (await vfsresolvePath(dstPath)) throw new Error(`Already exists: ${dstPath}`);
  const { parentNode, name } = await resolveParent(dstPath);
  const now = Date.now();
  if (srcNode.type === "file") {
    await retainBlob(srcNode.contentId);
    await writeNode({
      id: uid(),
      name,
      parent: parentNode.id,
      type: "file",
      contentId: srcNode.contentId,
      meta: { created: now, modified: now }
    });
  } else {
    const newFolder = {
      id: uid(),
      name,
      parent: parentNode.id,
      type: "folder",
      meta: { created: now, modified: now }
    };
    await writeNode(newFolder);
    const children = await listChildren(srcNode.id);
    await Promise.all(children.map((child) => _copyNode(child, `${dstPath}/${child.name}`)));
  }
}
async function remove(path) {
  path = norm(path);
  if (path === "/") throw new Error("Cannot remove root");
  const node = await vfsresolvePath(path);
  if (!node) return;
  await _removeNode(node);
}
async function _removeNode(node) {
  if (node.type === "folder") {
    const children = await listChildren(node.id);
    await Promise.all(children.map((child) => _removeNode(child)));
  } else {
    await releaseBlob(node.contentId);
  }
  await deleteNode(node);
}

// scripts/sw-registry.js
var appParams = /* @__PURE__ */ new Map();
var pendingResponses = /* @__PURE__ */ new Map();

// scripts/sw-api.js
var appsRPCHandler = {
  async open(path, params = {}, mode) {
    const key = path.replace(/^\/+|\/+$/g, "");
    const hasParams = Object.keys(params).length > 0 || mode === "popup";
    const paramsId = hasParams ? crypto.randomUUID() : null;
    const url = `/apps/${key}/${paramsId ? `?paramsId=${paramsId}` : ""}`;
    if (paramsId) {
      const storedParams = mode === "popup" ? { ...params, __responseId: crypto.randomUUID() } : { ...params };
      appParams.set(paramsId, storedParams);
      if (mode === "popup") {
        pendingResponses.set(storedParams.__responseId, {
          resolve: null,
          settled: false,
          value: void 0
        });
        return { url, responseId: storedParams.__responseId, popup: true };
      }
    }
    return url;
  },
  getParams(paramsId) {
    if (!paramsId) return {};
    return appParams.get(paramsId) || {};
  },
  waitForResponse(responseId) {
    return new Promise((resolve) => {
      const entry = pendingResponses.get(responseId);
      if (!entry) return resolve(null);
      if (entry.settled) return resolve(entry.value);
      const timer = setTimeout(() => {
        entry.settled = true;
        entry.value = null;
        pendingResponses.delete(responseId);
        resolve(null);
      }, 5 * 60 * 1e3);
      entry.resolve = (val) => {
        clearTimeout(timer);
        entry.settled = true;
        entry.value = val;
        pendingResponses.delete(responseId);
        resolve(val);
      };
    });
  },
  respond(responseId, value) {
    const entry = pendingResponses.get(responseId);
    if (entry?.resolve) entry.resolve(value);
    else if (entry) {
      entry.settled = true;
      entry.value = value;
    }
  },
  notifyPopupClosed(responseId) {
    const entry = pendingResponses.get(responseId);
    if (!entry || entry.settled) return;
    entry.settled = true;
    entry.value = null;
    if (entry.resolve) {
      entry.resolve(null);
    }
    pendingResponses.delete(responseId);
  }
};
var channels = /* @__PURE__ */ new Map();
var channelOwners = /* @__PURE__ */ new Map();
var rpc = {
  fileGet: {
    read: readFile,
    stream: streamFile
  },
  fileSet: {
    write: writeFile,
    mkdir,
    mkdirp,
    remove,
    move,
    copy
  },
  fileUtil: {
    list,
    exists,
    open: openFile
  },
  utility: {
    getMime: mimeFromPath,
    getNamespaces: () => {
      return Object.keys(rpc);
    },
    norm,
    sysDialog
  },
  system: {
    ensureRoot,
    parentOf
  },
  apps: appsRPCHandler,
  settings,
  events: {
    register(channelKey, { appKey } = {}) {
      const key = channelKey || crypto.randomUUID();
      if (!channels.has(key)) {
        channels.set(key, /* @__PURE__ */ new Set());
        channelOwners.set(key, appKey);
      }
      return key;
    },
    subscribe(channelKey, { clientId } = {}) {
      if (!channels.has(channelKey)) return { ok: false, error: "unknown channel" };
      channels.get(channelKey).add(clientId);
      return { ok: true };
    },
    unsubscribe(channelKey, { clientId } = {}) {
      channels.get(channelKey)?.delete(clientId);
      return { ok: true };
    },
    async broadcast(channelKey, data, { appKey } = {}) {
      const subs = channels.get(channelKey);
      if (!subs) return { ok: false, error: "unknown channel" };
      const clientsList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const clientMap = new Map(clientsList.map((c) => [c.id, c]));
      let sent = 0;
      for (const clientId of subs) {
        const client = clientMap.get(clientId);
        if (!client) {
          subs.delete(clientId);
          continue;
        }
        client.postMessage({ type: "channel-event", channelKey, data, from: appKey });
        sent++;
      }
      return { ok: true, sent };
    }
  },
  appStorage,
  appEmbed: {
    // create appembed
    // distroy appembed
  },
  store: {
    async installFromURL(appURL) {
      try {
        const res = await fetch(`${appURL}/manifest.json`);
        if (!res.ok) {
          return {
            ok: false,
            error: `manifest fetch failed: ${res.status}`
          };
        }
        const data = await res.json();
        const base = `/system/apps/${data.author}/${data.name}`;
        const sources = data.sources || [];
        const files = {};
        await Promise.all(
          sources.map(async (file) => {
            try {
              const r = await fetch(`${appURL}/${file}`);
              if (!r.ok) {
                console.warn(`missing file: ${file}`);
                return;
              }
              files[file] = await r.blob();
            } catch (err) {
              console.warn(`failed fetching ${file}`, err);
            }
          })
        );
        if (data.landing) {
          try {
            const r = await fetch(`${appURL}/${data.landing}`);
            if (r.ok) {
              files["index.html"] = await r.blob();
            } else {
              console.warn(`landing file missing: ${data.landing}`);
            }
          } catch (err) {
            console.warn(`failed fetching landing file`, err);
          }
        }
        files["manifest.json"] = new Blob(
          [JSON.stringify(data, null, 2)],
          { type: "application/json" }
        );
        const path = await rpc.store.install(base, files, data);
        return { ok: true, path };
      } catch (err) {
        console.error(err);
        return { ok: false, error: err.message };
      }
    },
    async install(base, files, metadata = null) {
      const parts = base.replace(/^\/+|\/+$/g, "").split("/");
      const author = parts.at(-2);
      const name = parts.at(-1);
      if (!author || !name) {
        throw new Error("invalid install path");
      }
      if (metadata) {
        await settings.set(
          `${author}/${name}`,
          { icon: metadata.icon, permissions: metadata.permissions },
          "appRegistry.json"
        );
        if (metadata.capabilities) {
          const FileBindings = await settings.get("FileBindings") ?? {};
          const key = `${author}/${name}`;
          for (const ext of metadata.capabilities) {
            FileBindings[ext] = [
              .../* @__PURE__ */ new Set([...FileBindings[ext] ?? [], key])
            ];
          }
          await settings.set("FileBindings", FileBindings);
        }
      }
      await Promise.all(
        Object.entries(files).map(
          ([file, blob]) => writeFile(`${base}/${file}`, blob)
        )
      );
      return base;
    },
    async isInstalled(tag) {
      return await exists("system/apps/" + tag);
    }
  }
};
async function openFromSW(path, params = {}) {
  const key = path.replace(/^\/+|\/+$/g, "");
  const hasParams = Object.keys(params).length > 0;
  const paramsId = hasParams ? crypto.randomUUID() : null;
  if (paramsId) appParams.set(paramsId, { ...params });
  const url = `/apps/${key}/${paramsId ? `?paramsId=${paramsId}` : ""}`;
  const clientsList = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true
  });
  const target = clientsList.find((c) => c.focused) ?? clientsList[0];
  if (target) {
    target.postMessage({ type: "from-sw", action: "apps.open", url });
  }
  return url;
}

// scripts/utility.js
function mimeFromPath(path) {
  const MIME_MAP = {
    html: "text/html",
    js: "application/javascript",
    css: "text/css",
    json: "application/json",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    svg: "image/svg+xml",
    woff2: "font/woff2",
    ttf: "font/ttf",
    mp4: "video/mp4",
    webm: "video/webm",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    ogg: "audio/ogg",
    txt: "text/plain"
  };
  const i = path.lastIndexOf(".");
  if (i < 0) return "application/octet-stream";
  return MIME_MAP[path.slice(i + 1)] || "application/octet-stream";
}
function getExtension(s) {
  let start = -1;
  for (let i = s.length - 1; i >= 0; i--) {
    if (s[i] === ".") {
      start = i + 1;
      break;
    }
  }
  if (start === -1)
    return "";
  let res = "";
  for (let i = start; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c >= 65 && c <= 90)
      c += 32;
    res += String.fromCharCode(c);
  }
  return res;
}
function resolvePath(path) {
  if (typeof path !== "string") {
    return "/system/settings/general.json";
  }
  if (!path) {
    return "/system/settings/general.json";
  }
  if (path.startsWith("/")) {
    return path;
  }
  if (path.startsWith("system/settings/")) {
    return "/" + path;
  }
  if (path.startsWith("/system/settings/")) {
    return path;
  }
  return "/system/settings/" + path.replace(/^\//, "");
}
async function readJSON(path) {
  path = resolvePath(path);
  if (!await exists(path)) return {};
  const file = await readFile(path);
  if (!file?.data) return {};
  const text = new TextDecoder().decode(file.data);
  return JSON.parse(text || "{}");
}
async function writeJSON(path, data) {
  path = resolvePath(path);
  const dirPath = parentOf(path);
  if (dirPath) {
    await mkdirp(dirPath);
  }
  await writeFile(path, JSON.stringify(data, null, 2));
}
var settings = {
  set: async function(key, value, path = "general.json") {
    var file = resolvePath(path);
    var data = await readJSON(file);
    data[key] = value;
    await writeJSON(file, data);
  },
  get: async function(key, path = "general.json") {
    var file = resolvePath(path);
    var data = await readJSON(file);
    return key === "all" ? data : data[key];
  },
  rem: async function(key, path = "general.json") {
    var file = resolvePath(path);
    var data = await readJSON(file);
    delete data[key];
    await writeJSON(file, data);
  }
};
function resolveAppStoragePath(tag) {
  if (!tag?.appKey || typeof tag.appKey !== "string") {
    throw new Error("Missing or invalid appKey in tag");
  }
  const cleanTag = tag.appKey.replace(/^\/+|\/+$/g, "");
  return `/system/apps/${cleanTag}/appStorage.json`;
}
var appStorage = {
  set: async function(key, value, tag) {
    const path = resolveAppStoragePath(tag);
    const data = await readJSON(path);
    data[key] = value;
    await writeJSON(path, data);
  },
  get: async function(key, tag) {
    console.log(tag);
    const path = resolveAppStoragePath(tag);
    const data = await readJSON(path);
    return key === "all" ? data : data[key];
  },
  rem: async function(key, tag) {
    const path = resolveAppStoragePath(tag);
    const data = await readJSON(path);
    delete data[key];
    await writeJSON(path, data);
  }
};
var dialogId = 0;
var pendingDialogs = /* @__PURE__ */ new Map();
async function openFile(path) {
  const fileExt = getExtension(path);
  let appTag = (await settings.get("FileBindings"))?.[fileExt]?.[0];
  if (appTag) {
    openFromSW(appTag, { "file": path });
  } else {
    await sysDialog({
      message: `No installed application can handle '.${fileExt}' files. Please install an app that supports it from the app store.`
    });
  }
}
async function sysDialog({ message = "", type = "alert", defaultValue = "" }) {
  const clientsList = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true
  });
  const target = clientsList.find((c) => c.focused) ?? clientsList[0];
  if (!target) return null;
  if (type === "alert") {
    target.postMessage({
      type: "sys-dialog",
      dialogType: type,
      message,
      defaultValue
    });
    return;
  }
  return new Promise((resolve) => {
    const id = ++dialogId;
    pendingDialogs.set(id, resolve);
    target.postMessage({
      type: "sys-dialog",
      id,
      dialogType: type,
      message,
      defaultValue
    });
  });
}

// ozone.js
var Ozone = class {
  constructor(config = {}) {
    this.config = {
      defaultApps: ["files", "settings", "text", "media", "menu"],
      sharedAssets: [
        "google_sans.ttf",
        "icons.woff2",
        "ozone_gui.css",
        "ozone_std_util.js"
      ],
      swKey: "osware_sw_version",
      dbName: "vfs",
      sourceURL: new URL("./defaultSource", import.meta.url).pathname,
      versionURL: new URL("./versions.json", import.meta.url).pathname,
      launcher: null,
      ...config
    };
  }
  async fetchJSON(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed fetch: ${url}`);
    return res.json();
  }
  async initializeOzone() {
    for (const app of this.config.defaultApps) {
      const url = `${this.config.sourceURL}/${app}`;
      await rpc.store.installFromURL(url);
    }
    await Promise.all(
      this.config.sharedAssets.map(async (file) => {
        const url = `${this.config.sourceURL}/sharedAssets/${file}`;
        const res = await fetch(url);
        if (!res.ok) return;
        const blob = await res.blob();
        await rpc.fileSet.write(`/system/sharedAssets/${file}`, blob);
      })
    );
    return true;
  }
  async ensureServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    const versions = await this.fetchJSON(this.config.versionURL);
    const v = versions.osware;
    const launcher = encodeURIComponent(
      JSON.stringify(this.config.launcher ?? null)
    );
    const sw = new URL("./sw.js", import.meta.url);
    sw.searchParams.set("v", v);
    sw.searchParams.set("launcher", launcher);
    const swUrl = sw.toString();
    const existing = await navigator.serviceWorker.getRegistration();
    if (!existing) {
      await navigator.serviceWorker.register(swUrl, {
        type: "module"
      });
      localStorage.setItem(this.config.swKey, swUrl);
      return;
    }
    const current = localStorage.getItem(this.config.swKey);
    if (current !== swUrl) {
      await existing.unregister();
      await navigator.serviceWorker.register(swUrl, {
        type: "module"
      });
      localStorage.setItem(this.config.swKey, swUrl);
    }
  }
  async install() {
    try {
      await ensureRoot();
      await this.initializeOzone();
      await this.ensureServiceWorker();
      return true;
    } catch {
      return false;
    }
  }
  async update() {
    try {
      await ensureRoot();
      await this.initializeOzone();
      await this.ensureServiceWorker();
      return true;
    } catch {
      return false;
    }
  }
  async reset() {
    try {
      const root = await opfsRoot();
      await root.removeEntry("vfs", { recursive: true });
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
      await new Promise((resolve) => {
        const req = indexedDB.deleteDatabase(this.config.dbName);
        req.onsuccess = resolve;
        req.onerror = resolve;
        req.onblocked = resolve;
      });
      localStorage.removeItem(this.config.swKey);
      return true;
    } catch {
      return false;
    }
  }
  async info() {
    const versions = await this.fetchJSON(this.config.versionURL).catch(() => null);
    const reg = await navigator.serviceWorker.getRegistration().catch(() => null);
    const swVersion = localStorage.getItem(this.config.swKey);
    return {
      versions,
      serviceWorker: {
        registered: !!reg,
        version: swVersion || null
      },
      config: this.config
    };
  }
};
export {
  Ozone
};
