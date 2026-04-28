importScripts("scripts/vfs.js")
importScripts("scripts/utility.js")

ensureRoot()

const appParams = new Map()
self.addEventListener("fetch", e => {
    const url = new URL(e.request.url)

    if (!url.pathname.startsWith("/apps/")) return

    const parts = url.pathname.split("/").filter(Boolean)

    if (!url.pathname.endsWith("/")) {
        const last = parts[parts.length - 1]
        if (!last.includes(".")) {
            e.respondWith(Response.redirect(url.pathname + "/", 301))
            return
        }
    }

    e.respondWith(route(e.request, parts.slice(1)))
})

const SHARED_PREFIX = "/system/sharedAssets/"
const APPS_PREFIX = "/system/apps/"
const INJECTED_SCRIPT = `<script>
(() => {
    if (window.opener) { try { window.opener = null } catch {} }
    const _open = window.open
    window.open = (url, target, features) =>
        _open.call(window, url, target || '_blank',
            features ? features + ',noopener,noreferrer' : 'noopener,noreferrer')

    class SWBridge {
        static #id = 0
        static #wait = new Map()
        static call(method, ...args) {
            return new Promise(res => {
                const id = ++this.#id
                this.#wait.set(id, res)
                navigator.serviceWorker.controller?.postMessage({ type:"rpc", id, method, args })
            })
        }
        static init() {
            navigator.serviceWorker.addEventListener("message", ({ data: d }) => {
                if (d?.type === "rpc-res") {
                    SWBridge.#wait.get(d.id)?.(d.result)
                    SWBridge.#wait.delete(d.id)
                } else if (d?.type === "from-sw" && d.action === "apps.open") {
                    try { new URL(d.url, location.origin); window.open(d.url, "_blank", "noopener,noreferrer") }
                    catch { console.error("Invalid URL from SW:", d.url) }
                }
            })
        }
    }
    SWBridge.init()

    const proxyCache = new Map()
    function createProxy(path) {
        if (proxyCache.has(path)) return proxyCache.get(path)
        const p = new Proxy(() => {}, {
            get(_, prop) { return createProxy(path + '.' + prop) },
            apply(_, __, args) { return SWBridge.call(path, ...args) }
        })
        proxyCache.set(path, p)
        return p
    }

    window.api = new Proxy({}, {
        get(_, prop) {
            if (prop === "apps") return {
                open: async (path, params) => {
                    const url = await SWBridge.call("apps.open", path, params)
                    try { new URL(url); return window.open(url) }
                    catch { console.error("Invalid URL:", url); return null }
                }
            }
            if (prop === "params") return SWBridge.call(
                "apps.getParams", location.pathname.split("/").slice(2).join("/"))
            return createProxy(prop)
        }
    })
})()
</script></head>`

const HTML_HEADERS = { "Content-Type": "text/html", "Cross-Origin-Opener-Policy": "same-origin" }
const ASSET_HEADERS = { "Cross-Origin-Opener-Policy": "same-origin" }

export async function route(request, parts) {
    const rawUrl = request.url
    const lrIdx = rawUrl.indexOf("livereload=")
    const liveReloadUrl = lrIdx !== -1
        ? new URL(rawUrl).searchParams.get("livereload")
        : null

    const isShared = parts[2] === "sharedAssets"
    const vfsPath = isShared
        ? SHARED_PREFIX + (parts.length > 3 ? parts.slice(3).join("/") : "index.html")
        : APPS_PREFIX + parts[0] + "/" + parts[1] + "/" + (parts.length > 2 ? parts.slice(2).join("/") : "index.html")

    if (isShared) {
        if (parts.length < 3) return new Response("Forbidden", { status: 403 })
    } else {
        if (!parts[0] || !parts[1] || parts[0].includes("/") || parts[1].includes("/"))
            return new Response("Forbidden", { status: 403 })
    }

    let contentType, body

    if (liveReloadUrl) {
        let res
        try {
            res = await fetch(liveReloadUrl)
            if (!res.ok) return new Response("LiveReload fetch failed", { status: 502 })
        } catch {
            return new Response("LiveReload error", { status: 500 })
        }

        const ct = res.headers.get("Content-Type") ?? "text/html"
        const semi = ct.indexOf(";")
        contentType = semi === -1 ? ct : ct.slice(0, semi)

        if (contentType !== "text/html") {
            return new Response(res.body, {
                headers: { "Content-Type": contentType, ...ASSET_HEADERS }
            })
        }

        body = await res.text()
    } else {
        const f = await readFile(vfsPath)
        if (!f || f.type !== "file") return new Response("Not found", { status: 404 })

        contentType = mime(vfsPath)

        if (contentType !== "text/html") {
            return new Response(f.data, {
                headers: { "Content-Type": contentType, ...ASSET_HEADERS }
            })
        }

        body = new TextDecoder().decode(f.data)
    }

    const insertAt = body.indexOf("</head>")
    const html = insertAt === -1
        ? body + INJECTED_SCRIPT
        : body.slice(0, insertAt) + INJECTED_SCRIPT + body.slice(insertAt + 7) 
    return new Response(html, { headers: HTML_HEADERS })
}

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
}

function mime(p) {
    const i = p.lastIndexOf(".")
    const ext = i !== -1 ? p.slice(i + 1).toLowerCase() : ""
    return MIME_MAP[ext] || "application/octet-stream"
}

const rpc = {
    files: {
        read: readFile,
        write: writeFile,
        list,
        exists,
        mkdir,
        mkdirp,
        remove,
        open: openFile
    },
    utility: {
        getMime: mime
    },
    system: {
        ensureRoot,
        parentOf,
        norm
    },
    apps: {
        async open(path, params = {}) {
            appParams.set(path, params)
            return `/apps/${path}`
        },
        getParams(path) {
            return appParams.get(path.replace(/\/$/, "")) || {}
        }
    },
    settings
}

self.addEventListener("message", async e => {
    const d = e.data
    if (d?.type !== "rpc") return

    function resolve(obj, path) {
        return path.split(".").reduce((o, k) => o?.[k], obj)
    }

    const fn = resolve(rpc, d.method)

    let result = null

    try {
        if (fn)
            result = await fn(...d.args)
        else
            console.warn(d.method, "is not a valid endpoint")
    } catch (e) {
        console.warn(e)
    }

    e.source.postMessage({
        type: "rpc-res",
        id: d.id,
        result
    })
})

async function openFromSW(path, params = {}) {
    appParams.set(path, params)
    const url = `/apps/${path}`

    const clientsList = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true
    })

    const target = clientsList.find(c => c.focused) ?? clientsList[0]
    if (target) target.postMessage({ type: "from-sw", action: "apps.open", url })

    return url
}

self.addEventListener("install", () => {
    self.skipWaiting()
})

self.addEventListener("activate", e => {
    e.waitUntil(clients.claim())
})