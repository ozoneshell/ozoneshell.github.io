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
    mkv: "video/mkv",
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
    if (key === "all") {
      await writeJSON(file, value);
      return;
    }
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
    if (key === "all") {
      await writeJSON(path, value);
      return;
    }
    data[key] = value;
    await writeJSON(path, data);
  },
  get: async function(key, tag) {
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

// scripts/sw-registry.js
var windowRegistry = /* @__PURE__ */ new Map();
var appParams = /* @__PURE__ */ new Map();
var pendingResponses = /* @__PURE__ */ new Map();
var liveReloadBases = /* @__PURE__ */ new Map();
function registerWindow(clientId, appKey, paramsId = null, permissions = []) {
  if (windowRegistry.has(clientId)) {
    return;
  }
  windowRegistry.set(clientId, { appKey, paramsId, permissions, registeredAt: Date.now() });
}
function getWindowEntry(clientId) {
  return windowRegistry.get(clientId) ?? null;
}
async function isNamespaceAllowed(appKey, namespace, clientId = null) {
  return true;
  if (namespace === "apps") return true;
  if (clientId) {
    const entry = windowRegistry.get(clientId);
    if (entry?.permissions) {
      return entry.permissions.includes(namespace);
    }
  }
  const registryItem = await rpc.settings.get(appKey, "appRegistry.json");
  return registryItem?.permissions?.includes(namespace) ?? false;
}
function debugRegistry() {
  return {
    windows: [...windowRegistry.entries()],
    params: [...appParams.keys()],
    pendingResponses: [...pendingResponses.keys()],
    liveReloadBases: [...liveReloadBases.entries()]
  };
}

// scripts/sw-api.js
var appsRPCHandler = {
  async open(path, params, mode) {
    params = params ?? {};
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
    async create(appTag) {
      const eventch = rpc.events.register(0, { appTag });
      const appURL = new URL(
        `apps/${appTag}?OzoneAppEmbed=${eventch}`,
        SW_URL
      ).href;
      return { appURL, eventch };
    }
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
          {
            icon: metadata.icon,
            permissions: metadata.permissions,
            handler: metadata.handler
          },
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
        if (metadata.handle) {
          const existing = await settings.get(
            metadata.handle,
            "handlers.json"
          );
          if (!existing) {
            await settings.set(
              metadata.handle,
              `${author}/${name}`,
              "handlers.json"
            );
          }
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
function resolveRpc(path) {
  return path.split(".").reduce((o, k) => o?.[k], rpc);
}
var systemChannelKey = rpc.events.register("systemEvents", {
  appKey: null
});
async function handleRpcMessage(e) {
  const d = e.data;
  if (d?.type === "dialog-response") {
    const resolve = pendingDialogs.get(d.id);
    if (resolve) {
      pendingDialogs.delete(d.id);
      resolve(d.value);
    }
    return;
  }
  if (d?.type !== "rpc") return;
  const clientId = e.source?.id ?? null;
  let entry = clientId ? getWindowEntry(clientId) : null;
  if (!entry && clientId) {
    const url = e.source?.url;
    if (url) {
      const parsed = new URL(url);
      const parts = parsed.pathname.split("/").filter(Boolean);
      if (parts[0] === "apps" && parts.length >= 3) {
        const appKey2 = `${parts[1]}/${parts[2]}`;
        registerWindow(clientId, appKey2);
        entry = getWindowEntry(clientId);
      }
    }
  }
  const appKey = entry?.appKey ?? null;
  if (!appKey) {
    e.source?.postMessage({
      type: "rpc-res",
      id: d.id,
      result: null,
      blocked: true
    });
    return;
  }
  const namespace = d.method.split(".")[0];
  if (!await isNamespaceAllowed(appKey, namespace, clientId)) {
    e.source.postMessage({
      type: "rpc-res",
      id: d.id,
      result: null,
      blocked: true
    });
    return;
  }
  const fn = resolveRpc(d.method);
  rpc.events.broadcast("systemChannelKey", {
    type: "api_call",
    namespace,
    fn
  }, {});
  let result = null;
  try {
    if (fn) {
      result = await fn(...d.args, {
        appKey,
        clientId,
        method: d.method
      });
    }
  } catch (err) {
  }
  e.source.postMessage({ type: "rpc-res", id: d.id, result });
}
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
var SYSTEM_CHANNEL = "system";
rpc.events.register(SYSTEM_CHANNEL, {
  appKey: "system"
});

// scripts/vfs.js
function emitFs(action, target) {
  rpc.events.broadcast("system", {
    type: "fs",
    action,
    time: Date.now(),
    target
  });
}
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
  emitFs("mkdir", path);
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
      emitFs("mkdir", next);
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
  emitFs("write", path);
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
  emitFs("move", dstPath);
}
async function copy(srcPath, dstPath) {
  srcPath = norm(srcPath);
  dstPath = norm(dstPath);
  if (srcPath === "/") throw new Error("Cannot copy root");
  const srcNode = await vfsresolvePath(srcPath);
  if (!srcNode) throw new Error(`Not found: ${srcPath}`);
  await _copyNode(srcNode, dstPath);
  emitFs("copy", dstPath);
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
  emitFs("remove", path);
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

// scripts/runtime-script.js
function createBootTrigger() {
  return `
const __paramsId = new URLSearchParams(location.search).get("paramsId") ?? ""

let __popupResponded = false

if (window.opener) {
    try {
        window.opener = null
    } catch {}
}

window.addEventListener(
    "load",
    () => document.documentElement.classList.add("app-ready")
)
`;
}
function createSWBridger() {
  return `
class SWBridge {
    static #id = 0
    static #wait = new Map()
    static #ready = null

    static async init() {
    if (this.#ready) {
        return this.#ready
    }

    this.#ready = (async () => {
        await navigator.serviceWorker.ready

        if (!navigator.serviceWorker.controller) {
            await new Promise(resolve => {
                navigator.serviceWorker.addEventListener(
                    "controllerchange",
                    resolve,
                    { once: true }
                )
            })
        }

        const controller =
            navigator.serviceWorker.controller

        if (!controller) {
            throw new Error(
                "Missing service worker controller"
            )
        }

        const parts = location.pathname
    .split("/")
    .filter(Boolean)

const derivedAppKey =
    window.__APP_KEY__ ||
    (
        parts[0] === "apps" &&
        parts.length >= 3
            ? parts[1] + "/" + parts[2]
            : null
    )

        if (derivedAppKey) {
            await new Promise(resolve => {
                const onMessage = ({ data }) => {
                    if (
                        data?.type ===
                        "register-window-ok"
                    ) {
                        navigator.serviceWorker.removeEventListener(
                            "message",
                            onMessage
                        )

                        resolve()
                    }
                }

                navigator.serviceWorker.addEventListener(
                    "message",
                    onMessage
                )

                controller.postMessage({
                    type: "register-window",
                    appKey: derivedAppKey
                })
            })
        }

        navigator.serviceWorker.addEventListener(
            "message",
            ({ data, source }) => {
                if (data?.type === "rpc-res") {
                    SWBridge.#wait.get(data.id)?.(
                        data.result
                    )

                    SWBridge.#wait.delete(data.id)

                    return
                }

                if (
                    data?.type === "from-sw" &&
                    data.action === "apps.open"
                ) {
                    try {
                        new URL(
                            data.url,
                            location.origin
                        )

                        window.open(
                            data.url,
                            "_blank",
                            "noopener,noreferrer"
                        )
                    } catch {
                        console.error(
                            "Invalid URL from SW:",
                            data.url
                        )
                    }

                    return
                }

                if (data?.type === "sys-dialog") {
                    handleSystemDialog(
                        data,
                        source
                    )
                }
            }
        )
    })()

    return this.#ready
}

    static async call(method, ...args) {
        await this.init()

        return new Promise(async resolve => {
            const id = ++this.#id

            this.#wait.set(id, resolve)

            let controller =
                navigator.serviceWorker.controller

            if (!controller) {
                await navigator.serviceWorker.ready
                controller =
                    navigator.serviceWorker.controller
            }

            controller?.postMessage({
                type: "rpc",
                id,
                method,
                args
            })
        })
    }
}

SWBridge.init()

const rpc = SWBridge.call.bind(SWBridge)
`;
}
function createWindowOpenPatcher() {
  return `
const __nativeOpen = window.open

window.open = async (url, target, features) => {
    const finalURL = new URL(url, location.href).href

    if (window.__embedChannel) {
        try {
            await rpc(
                "events.broadcast",
                __embedChannel,
                {
                    type: "window.open",
                    url: finalURL,
                    target: target || "_blank",
                    features: features || ""
                }
            )

            return null
        } catch (err) {
            console.error(
                "Embedded window.open dispatch failed",
                err
            )

            return null
        }
    }

    return __nativeOpen.call(
        window,
        finalURL,
        target || "_blank",
        features
            ? features + ",noopener,noreferrer"
            : "noopener,noreferrer"
    )
}
`;
}
function createPopupManagerSystem() {
  return `
class PopupManager {
    static async open(path, params, mode) {
        const result = await rpc(
            "apps.open",
            path,
            params,
            mode
        )

        if (typeof result === "string") {
            window.open(
                result,
                "_blank",
                "noopener,noreferrer"
            )

            return null
        }

        const sw = window.screen

        const maxW = sw.availWidth * 0.8
        const maxH = sw.availHeight * 0.8

        let w = maxW
        let h = w * (6 / 9)

        if (h > maxH) {
            h = maxH
            w = h * (9 / 6)
        }

        h = Math.min(h, maxH)
        w = Math.min(w, maxW)

        const left = Math.max(
            0,
            (sw.availWidth - w) / 2
        )

        const top = Math.max(
            0,
            (sw.availHeight - h) / 2
        )

        const popup = __nativeOpen.call(
            window,
            result.url,
            "_blank",
            \`popup=yes,width=\${Math.floor(w)},height=\${Math.floor(h)},left=\${Math.floor(left)},top=\${Math.floor(top)}\`
        )

        if (!popup) {
            await rpc(
                "apps.notifyPopupClosed",
                result.responseId
            )

            return null
        }

        const pollClose = setInterval(async () => {
            if (popup.closed) {
                clearInterval(pollClose)

                await rpc(
                    "apps.notifyPopupClosed",
                    result.responseId
                )
            }
        }, 500)

        const value = await rpc(
            "apps.waitForResponse",
            result.responseId
        )

        clearInterval(pollClose)

        return value
    }

    static async respond(value) {
        const params = await rpc(
            "apps.getParams",
            __paramsId
        )

        if (!params?.__responseId) {
            return
        }

        __popupResponded = true

        await rpc(
            "apps.respond",
            params.__responseId,
            value
        )

        await new Promise(resolve => setTimeout(resolve, 50))

        window.close()
    }
}
`;
}
function createEventsAPI() {
  return `
function createEventsAPI() {
    return {
        async register(channelKey) {
            return rpc(
                "events.register",
                channelKey ?? null
            )
        },

        async listen(channelKey, callback) {
            await rpc(
                "events.subscribe",
                channelKey
            )

            if (!window.__channelListeners) {
                window.__channelListeners = new Map()

                navigator.serviceWorker.addEventListener(
                    "message",
                    ({ data }) => {
                        if (data?.type !== "channel-event") {
                            return
                        }

                        const fns =
                            window.__channelListeners.get(
                                data.channelKey
                            )

                        if (fns) {
                            fns.forEach(fn =>
                                fn(data.data, data.from)
                            )
                        }
                    }
                )
            }

            if (
                !window.__channelListeners.has(channelKey)
            ) {
                window.__channelListeners.set(
                    channelKey,
                    new Set()
                )
            }

            window.__channelListeners
                .get(channelKey)
                .add(callback)

            return () => {
                const set =
                    window.__channelListeners.get(
                        channelKey
                    )

                if (!set) {
                    return
                }

                set.delete(callback)

                if (set.size === 0) {
                    window.__channelListeners.delete(
                        channelKey
                    )

                    rpc(
                        "events.unsubscribe",
                        channelKey
                    )
                }
            }
        },

        async broadcast(channelKey, data) {
            return rpc(
                "events.broadcast",
                channelKey,
                data
            )
        }
    }
}
`;
}
function createProxySystem() {
  return `
const proxyCache = new Map()

function createProxy(path) {
    let proxy = proxyCache.get(path)

    if (proxy) {
        return proxy
    }

    proxy = new Proxy(
        () => {},
        {
            get(_, prop) {
                return createProxy(
                    path + "." + prop
                )
            },

            apply(_, __, args) {
                return rpc(path, ...args)
            }
        }
    )

    proxyCache.set(path, proxy)

    return proxy
}
`;
}
function createClientAPIProxy() {
  return `
const appsAPI = {
    open: PopupManager.open,
    respond: PopupManager.respond
}

const eventsAPI = createEventsAPI()

window.api = new Proxy(
    {
        apps: appsAPI,
        events: eventsAPI
    },
    {
        get(target, prop) {
            if (prop === "params") {
                if (!window.__appParamsCache) {
                    window.__appParamsCache = rpc(
                        "apps.getParams",
                        __paramsId
                    )
                }

                return window.__appParamsCache
            }

            if (prop in target) {
                return target[prop]
            }

            return createProxy(prop)
        }
    }
)
`;
}
function createLifecycleCode() {
  return `
window.addEventListener(
    "pagehide",
    async () => {
        if (__popupResponded) {
            return
        }

        try {
            const params = await rpc(
                "apps.getParams",
                __paramsId
            )

            if (params?.__responseId) {
                await rpc(
                    "apps.notifyPopupClosed",
                    params.__responseId
                )
            }
        } catch {}
    }
)
`;
}
function createDialogHandlerCode() {
  return `
function handleSystemDialog(
    {
        dialogType,
        message,
        defaultValue,
        id
    },
    source
) {
    const reply = payload => {
        const channel =
            source ||
            navigator.serviceWorker.controller

        channel?.postMessage(payload)
    }

    switch (dialogType) {
        case "alert":
            alert(message)
            break

        case "confirm":
            reply({
                type: "dialog-response",
                id,
                value: confirm(message)
            })
            break

        case "prompt":
            reply({
                type: "dialog-response",
                id,
                value: prompt(
                    message,
                    defaultValue ?? ""
                )
            })
            break
    }
}
`;
}
function buildRuntimeScript() {
  return [
    createBootTrigger(),
    createSWBridger(),
    createWindowOpenPatcher(),
    createPopupManagerSystem(),
    createEventsAPI(),
    createProxySystem(),
    createClientAPIProxy(),
    createLifecycleCode(),
    createDialogHandlerCode()
  ].join("\n");
}

// sw.js
ensureRoot();
var LRU = class {
  #max;
  #map;
  constructor(max) {
    this.#max = max;
    this.#map = /* @__PURE__ */ new Map();
  }
  get(key) {
    const map = this.#map;
    if (!map.has(key)) return void 0;
    const val = map.get(key);
    map.delete(key);
    map.set(key, val);
    return val;
  }
  set(key, val) {
    const map = this.#map;
    if (map.has(key)) {
      map.delete(key);
    } else if (map.size >= this.#max) {
      map.delete(map.keys().next().value);
    }
    map.set(key, val);
    return val;
  }
  delete(key) {
    return this.#map.delete(key);
  }
  get size() {
    return this.#map.size;
  }
};
self.addEventListener("install", () => {
  log("install");
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  log("activate");
  e.waitUntil(clients.claim());
});
var SW_URL2 = new URL(self.location.href);
var DEBUG_LOGS = SW_URL2.searchParams.get("log") === "true";
function log(...args) {
  if (DEBUG_LOGS) console.log("[SW]", ...args);
}
self.__OZONE_CONFIG__ = {
  launcher: JSON.parse(
    decodeURIComponent(SW_URL2.searchParams.get("launcher") ?? "null")
  )
};
log("config", self.__OZONE_CONFIG__);
self.addEventListener("message", async (e) => {
  if (e.data?.type === "register-window") {
    registerWindow(
      e.source.id,
      e.data.appKey
    );
    e.source?.postMessage({
      type: "register-window-ok"
    });
    return;
  }
  handleRpcMessage(e);
});
self.addEventListener("activate", (e) => {
  log("activate");
  e.waitUntil(
    clients.claim().then(startClientPruner)
  );
});
function startClientPruner() {
  setInterval(async () => {
    const live = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const liveIds = new Set(live.map((c) => c.id));
    for (const [, subs] of channels2) {
      for (const id of subs) {
        if (!liveIds.has(id)) subs.delete(id);
      }
    }
  }, 3e4);
}
self.addEventListener("fetch", (e) => {
  const { request } = e;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  const { pathname } = url;
  log("fetch", { method: request.method, url: request.url, mode: request.mode });
  if (pathname.startsWith("/apps/") || pathname.startsWith("/sharedAssets/")) {
    const parts = pathname.split("/").filter(Boolean);
    log("apps route", { pathname, parts });
    if (!pathname.endsWith("/")) {
      const last = parts[parts.length - 1];
      if (!last.includes(".")) {
        log("redirecting trailing slash", pathname + "/");
        e.respondWith(
          Response.redirect(new URL(pathname + "/", request.url), 301)
        );
        return;
      }
    }
    const isShared = pathname.startsWith("/sharedAssets/");
    e.respondWith(route(request, url, parts));
    if (!isShared && e.clientId && request.mode === "navigate" && parts.length >= 3) {
      const author = parts[1];
      const appName = parts[2];
      const clientId = e.clientId;
      rpc.settings.get(`${author}/${appName}`, "appRegistry.json").then((registryItem) => {
        const capitalizedName = appName.charAt(0).toUpperCase() + appName.slice(1);
        return rpc.settings.get(`${author}/${capitalizedName}`, "appRegistry.json").then((item) => {
          if (item) {
            const permissions = item?.permissions ?? [];
            registerWindow(clientId, `${author}/${capitalizedName}`, null, permissions);
          }
        });
      }).catch(() => {
      });
    }
    return;
  }
  if (request.mode === "navigate") {
    log("navigation request", pathname);
    e.respondWith(handleNavigation(request, pathname));
  }
});
self.__debug = { registry: debugRegistry };
async function handleNavigation(request, pathname) {
  const launcherPath = getLauncherPath();
  log("handleNavigation", { request: request.url, launcherPath });
  if (!launcherPath) {
    log("no launcher configured, falling back to fetch");
    return fetch(request);
  }
  const url = new URL(request.url);
  if (url.searchParams.get("launcher") === "false") {
    log("launcher disabled via param");
    return fetch(request);
  }
  if (pathname.startsWith("/scripts/") || pathname.startsWith("/assets/") || pathname.startsWith("/defaultSource/") || pathname.startsWith("/favicon")) {
    log("bypassing navigation interception", pathname);
    return fetch(request);
  }
  log("serving launcher");
  return serveLauncher(launcherPath, request);
}
var encoder = new TextEncoder();
var decoder = new TextDecoder();
function createHtmlInjector(head, loaderDiv) {
  let injected = false;
  let buffer = "";
  return new TransformStream({
    transform(chunk, controller) {
      if (injected) {
        controller.enqueue(chunk);
        return;
      }
      buffer += decoder.decode(chunk, { stream: true });
      const headMatch = /<head[^>]*>/i.exec(buffer);
      if (!headMatch) {
        if (buffer.length > 8192) {
          controller.enqueue(encoder.encode(buffer.slice(0, 4096)));
          buffer = buffer.slice(4096);
        }
        return;
      }
      injected = true;
      const insertAt = headMatch.index + headMatch[0].length;
      let html = buffer.slice(0, insertAt) + head + buffer.slice(insertAt);
      if (loaderDiv) {
        const bodyMatch = /<body[^>]*>/i.exec(html);
        if (bodyMatch) {
          const bi = bodyMatch.index + bodyMatch[0].length;
          html = html.slice(0, bi) + loaderDiv + html.slice(bi);
        }
      }
      controller.enqueue(encoder.encode(html));
      buffer = "";
    },
    flush(controller) {
      if (!buffer) return;
      if (!injected) {
        let html = buffer;
        const headMatch = /<head[^>]*>/i.exec(html);
        if (headMatch) {
          const insertAt = headMatch.index + headMatch[0].length;
          html = html.slice(0, insertAt) + head + html.slice(insertAt);
        } else {
          html = head + html;
        }
        if (loaderDiv) {
          const bodyMatch = /<body[^>]*>/i.exec(html);
          if (bodyMatch) {
            const bi = bodyMatch.index + bodyMatch[0].length;
            html = html.slice(0, bi) + loaderDiv + html.slice(bi);
          }
        }
        controller.enqueue(encoder.encode(html));
      } else {
        controller.enqueue(encoder.encode(buffer));
      }
    }
  });
}
var SHARED_PREFIX = "/system/sharedAssets/";
var APPS_PREFIX = "/system/apps/";
var injectedScriptCache = new LRU(30);
var liveReloadBodyCache = new LRU(20);
var vfsBlobRevalidating = /* @__PURE__ */ new Map();
var manifestRevalidating = /* @__PURE__ */ new Map();
var vfsBlobCache = new LRU(100);
var manifestCache = new LRU(50);
var channels2 = /* @__PURE__ */ new Map();
async function cachedStreamFile(vfsPath) {
  const cached = vfsBlobCache.get(vfsPath);
  if (cached !== void 0) {
    scheduleRevalidateBlob(vfsPath);
    return { type: "file", file: cached };
  }
  const result = await streamFile(vfsPath);
  if (result?.type === "file") vfsBlobCache.set(vfsPath, result.file);
  return result;
}
function scheduleRevalidateBlob(vfsPath) {
  if (vfsBlobRevalidating.has(vfsPath)) return;
  const p = streamFile(vfsPath).then((fresh) => {
    if (fresh?.type === "file") vfsBlobCache.set(vfsPath, fresh.file);
    else vfsBlobCache.delete(vfsPath);
  }).catch(() => vfsBlobCache.delete(vfsPath)).finally(() => vfsBlobRevalidating.delete(vfsPath));
  vfsBlobRevalidating.set(vfsPath, p);
}
function getLauncherPath() {
  const cfg = self.__OZONE_CONFIG__;
  if (!cfg?.launcher) return null;
  const { author, name } = cfg.launcher;
  if (!author || !name) return null;
  return `/system/apps/${author}/${name}/index.html`;
}
async function serveLauncher(launcherPath, request) {
  log("serveLauncher", { launcherPath });
  const parts = launcherPath.replace(/^\/system\/apps\//, "").split("/");
  const [streamed, manifest] = await Promise.all([
    cachedStreamFile(launcherPath),
    getManifest(`/system/apps/${parts[0]}/${parts[1]}/manifest.json`)
  ]);
  if (!streamed || streamed.type !== "file") {
    log("launcher file missing, falling back to network");
    return fetch(location.pathname + location.search);
  }
  log("launcher manifest", manifest);
  const iconSvg = typeof manifest?.icon === "string" ? manifest.icon : "";
  const { head, loaderDiv } = buildInjectedScript(iconSvg);
  const appKey = `${parts[0]}/${parts[1]}`;
  const favicon = iconSvg ? `<link rel="icon" type="image/svg+xml" href="${svgToFaviconDataUrl(iconSvg)}">` : "";
  const injectedHead = favicon + `<base href="/apps/${parts[0]}/${parts[1]}/"><script>
        window.__APP_BASE__="/apps/${parts[0]}/${parts[1]}/"
        window.__APP_KEY__="${appKey}"
    <\/script>` + head;
  const stream = streamed.file.stream().pipeThrough(createHtmlInjector(injectedHead, loaderDiv));
  log("launcher served");
  return new Response(stream, {
    headers: {
      "Content-Type": "text/html",
      "Cross-Origin-Opener-Policy": "same-origin"
    }
  });
}
async function getManifest(manifestPath) {
  if (!manifestPath) return null;
  const entry = manifestCache.get(manifestPath);
  if (entry !== void 0) {
    scheduleRevalidateManifest(manifestPath);
    return entry;
  }
  const value = await fetchManifest(manifestPath);
  manifestCache.set(manifestPath, value);
  return value;
}
async function fetchManifest(manifestPath) {
  const mf = await readFile(manifestPath).catch(() => null);
  if (!mf || mf.type !== "file") return null;
  try {
    return JSON.parse(new TextDecoder().decode(mf.data));
  } catch {
    return null;
  }
}
function scheduleRevalidateManifest(manifestPath) {
  if (manifestRevalidating.has(manifestPath)) return;
  const p = fetchManifest(manifestPath).then((fresh) => manifestCache.set(manifestPath, fresh)).catch(() => {
  }).finally(() => manifestRevalidating.delete(manifestPath));
  manifestRevalidating.set(manifestPath, p);
}
var INJECTED_CSS = `
html.app-ready #_app_loader {
    opacity: 0;
    pointer-events: none;
}

html {
    overflow: hidden;
}

html.app-ready {
    overflow: auto;
}

#_app_loader {
    position: fixed;
    inset: 0;
    z-index: 2147483647;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: opacity 0.45s ease;
    background: inherit;
    pointer-events: none;
}

#_app_loader_icon {
    width: 72px;
    height: 72px;
}

#_app_loader_icon svg {
    width: 100%;
    height: 100%;
}
`;
function svgToFaviconDataUrl(svg) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
function buildInjectedScript(iconSvg = "") {
  const cached = injectedScriptCache.get(iconSvg);
  if (cached !== void 0) {
    return cached;
  }
  const loaderDiv = iconSvg ? `
      <div id="_app_loader">
          <div id="_app_loader_icon">
              ${iconSvg}
          </div>
      </div>
      ` : "";
  const faviconLink = iconSvg ? `<link rel="icon" type="image/svg+xml" href="${svgToFaviconDataUrl(iconSvg)}">` : "";
  const result = {
    head: `
        ${faviconLink}
        <style>
        ${INJECTED_CSS}
        </style>

        <script>
        ${buildRuntimeScript()}
        <\/script>
    `,
    loaderDiv
  };
  injectedScriptCache.set(iconSvg, result);
  return result;
}
var HTML_CT = "text/html";
var COOP_HEADER = "Cross-Origin-Opener-Policy";
var COOP_VALUE = "same-origin";
var appNameCache = /* @__PURE__ */ new Map();
async function getAppKey(author, appName) {
  const cacheKey = `${author}/${appName}`;
  if (appNameCache.has(cacheKey)) {
    return appNameCache.get(cacheKey);
  }
  let registryItem = await rpc.settings.get(cacheKey, "appRegistry.json").catch(() => null);
  if (registryItem) {
    appNameCache.set(cacheKey, cacheKey);
    return cacheKey;
  }
  const capitalizedName = appName.charAt(0).toUpperCase() + appName.slice(1);
  const capitalizedKey = `${author}/${capitalizedName}`;
  registryItem = await rpc.settings.get(capitalizedKey, "appRegistry.json").catch(() => null);
  if (registryItem) {
    appNameCache.set(cacheKey, capitalizedKey);
    return capitalizedKey;
  }
  return cacheKey;
}
async function route(request, url, parts) {
  log("route:start", { url: request.url, parts });
  const isAppSharedAsset = parts[0] === "apps" && parts.length >= 5 && parts[3] === "sharedAssets";
  if (isAppSharedAsset) {
    const vfsPath2 = SHARED_PREFIX + parts.slice(4).join("/");
    const streamed2 = await cachedStreamFile(vfsPath2);
    if (!streamed2 || streamed2.type !== "file") {
      return new Response("Not found", { status: 404 });
    }
    return new Response(streamed2.file.stream(), {
      headers: {
        "Content-Type": mimeFromPath(vfsPath2),
        [COOP_HEADER]: COOP_VALUE
      }
    });
  }
  const isShared = parts[0] === "sharedAssets";
  if (isShared) {
    if (parts.length < 2) return new Response("Forbidden", { status: 403 });
  } else if (!parts[0] || !parts[1] || parts[0].includes("/") || parts[1].includes("/")) {
    return new Response("Forbidden", { status: 403 });
  }
  let appKey = isShared ? "" : await getAppKey(parts[1], parts[2]);
  const [author, name] = appKey.split("/");
  const vfsPath = isShared ? SHARED_PREFIX + (parts.length > 1 ? parts.slice(1).join("/") : "index.html") : `${APPS_PREFIX}${author}/${name}/${parts.length > 3 ? parts.slice(3).join("/") : "index.html"}`;
  log("route:vfsPath", vfsPath);
  const liveBase = liveReloadBases.get(appKey);
  const lrParam = url.searchParams.get("livereload");
  const assetPath = parts.length > 3 ? parts.slice(3).join("/") : "index.html";
  let resolvedLiveUrl = null;
  if (lrParam) {
    const base = lrParam.replace(/\/[^/?#]*(\?.*)?$/, "/");
    if (!isShared) liveReloadBases.set(appKey, { base, ts: Date.now() });
    resolvedLiveUrl = isShared ? `${lrParam.replace(/\/$/, "")}/${(url.searchParams.get("sharedAssetsURL") || "defaultSource/sharedAssets").replace(/^\/+|\/+$/g, "")}/${parts.slice(3).join("/")}` : `${base}${assetPath}`;
  } else if (liveBase) {
    const age = Date.now() - liveBase.ts;
    if (age < 5e3) {
      resolvedLiveUrl = isShared ? `${liveBase.base.replace(/\/$/, "")}/${(url.searchParams.get("sharedAssetsURL") || "defaultSource/sharedAssets").replace(/^\/+|\/+$/g, "")}/${parts.slice(3).join("/")}` : `${liveBase.base}${assetPath}`;
    } else {
      liveReloadBases.delete(appKey);
    }
  }
  log("live reload resolved", { resolvedLiveUrl });
  if (resolvedLiveUrl) {
    return handleLiveReload(resolvedLiveUrl, lrParam, isShared, appKey, vfsPath);
  }
  const streamed = await cachedStreamFile(vfsPath);
  if (!streamed || streamed.type !== "file") {
    log("not found", vfsPath);
    if (isShared) {
      const devUrl = request.url.replace(/\/sharedAssets\//, "/defaultSource/sharedAssets/");
      log("sharedAsset not in VFS, trying dev path", devUrl);
      return fetch(devUrl);
    }
    return new Response("Not found", { status: 404 });
  }
  const contentType = mimeFromPath(vfsPath);
  log("serving asset", { vfsPath, contentType });
  if (contentType !== HTML_CT) {
    return new Response(streamed.file.stream(), {
      headers: { "Content-Type": contentType, [COOP_HEADER]: COOP_VALUE }
    });
  }
  const manifestPath = !isShared ? `${APPS_PREFIX}${author}/${name}/manifest.json` : null;
  const manifest = await getManifest(manifestPath);
  const iconSvg = typeof manifest?.icon === "string" ? manifest.icon : "";
  const { head, loaderDiv } = buildInjectedScript(iconSvg);
  return new Response(
    streamed.file.stream().pipeThrough(createHtmlInjector(head, loaderDiv)),
    { headers: { "Content-Type": HTML_CT, [COOP_HEADER]: COOP_VALUE } }
  );
}
async function handleLiveReload(resolvedLiveUrl, lrParam, isShared, appKey, vfsPath) {
  const cacheEntry = liveReloadBodyCache.get(resolvedLiveUrl);
  const networkPromise = fetch(resolvedLiveUrl).then(async (res) => {
    log("LR fetch", resolvedLiveUrl, res.status);
    if (!res.ok) return null;
    const ct2 = (res.headers.get("Content-Type") ?? HTML_CT).split(";")[0].trim();
    const buffer2 = await res.arrayBuffer();
    const entry2 = { buffer: buffer2, ct: ct2 };
    liveReloadBodyCache.set(resolvedLiveUrl, entry2);
    return entry2;
  }).catch((err) => {
    console.error("LR fetch failed", resolvedLiveUrl, err);
    return null;
  });
  let entry;
  if (cacheEntry !== void 0) {
    entry = cacheEntry;
    networkPromise.catch(() => {
    });
  } else {
    entry = await networkPromise;
  }
  if (!entry) return new Response("LiveReload error", { status: 500 });
  const { buffer, ct } = entry;
  const headers = new Headers({ "Content-Type": ct, [COOP_HEADER]: COOP_VALUE });
  if (ct !== HTML_CT) return new Response(buffer, { headers });
  const manifestPath = !isShared ? vfsPath.replace(/\/[^/]+$/, "/manifest.json") : null;
  const manifest = await getManifest(manifestPath);
  const iconSvg = typeof manifest?.icon === "string" ? manifest.icon : "";
  const { head, loaderDiv } = buildInjectedScript(iconSvg);
  const stream = new Blob([buffer]).stream().pipeThrough(createHtmlInjector(head, loaderDiv));
  headers.set("Content-Type", HTML_CT);
  return new Response(stream, { headers });
}
