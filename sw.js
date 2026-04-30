importScripts("scripts/vfs.js")
importScripts("scripts/utility.js")

ensureRoot()

const appParams = new Map()
const pendingResponses = new Map()

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

function buildInjectedScript(appKey = "", iconSvg = "") {
    const loaderDiv = iconSvg
        ? `<div id="_app_loader"><div id="_app_loader_icon">${iconSvg}</div></div>`
        : ""

    return {
        head: `<style>
html.app-ready #_app_loader { opacity: 0; pointer-events: none; }
html {overflow: hidden;}
html.app-ready {overflow: auto;}
#_app_loader {
    position: fixed; inset: 0; z-index: 2147483647;
    display: flex; align-items: center; justify-content: center;
    transition: opacity 0.45s ease;
    background: inherit;
    pointer-events: none;
}
#_app_loader_icon {
    width: 72px; height: 72px;
}
#_app_loader_icon svg { width: 100%; height: 100%; }
</style>
<script>
(() => {
    if (window.opener) { try { window.opener = null } catch {} }
    window.addEventListener("load", () => document.documentElement.classList.add("app-ready"))
    const _open = window.open
    window.open = (url, target, features) =>
        _open.call(window, url, target || '_blank',
            features ? features + ',noopener,noreferrer' : 'noopener,noreferrer')

    // App key embedded at page-generation time — never in the URL.
    const __appKey = ${JSON.stringify(appKey)}

    class SWBridge {
        static #id = 0
        static #wait = new Map()
        static async call(method, ...args) {
            return new Promise(async res => {
                const id = ++this.#id
                this.#wait.set(id, res)
                let controller = navigator.serviceWorker.controller
                if (!controller) {
                    await navigator.serviceWorker.ready
                    controller = navigator.serviceWorker.controller
                }
                controller?.postMessage({ type: "rpc", id, method, args })
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
                open: async (path, params, mode) => {
                    const result = await SWBridge.call("apps.open", path, params, mode)

                    if (typeof result === "string") {
                        window.open(result, "_blank", "noopener,noreferrer")
                        return null
                    }

                    const screenWidth = window.screen.availWidth
                    const screenHeight = window.screen.availHeight
                    const maxWidth = screenWidth * 0.8
                    const maxHeight = screenHeight * 0.8
                    let width = maxWidth
                    let height = width * (6 / 9)
                    if (height > maxHeight) { height = maxHeight; width = height * (9 / 6) }
                    height = Math.min(height, maxHeight)
                    width = Math.min(width, maxWidth)
                    const left = Math.max(0, (screenWidth - width) / 2)
                    const top = Math.max(0, (screenHeight - height) / 2)

                    // FIX (doc1 bug): popup was never captured, so pollClose could never detect close
                    const popup = _open.call(window,
                        result.url,
                        "_blank",
                        \`popup=yes,width=\${Math.floor(width)},height=\${Math.floor(height)},left=\${Math.floor(left)},top=\${Math.floor(top)},noopener,noreferrer\`
                    )

                    const pollClose = setInterval(async () => {
                        if (popup?.closed) {
                            clearInterval(pollClose)
                            await SWBridge.call("apps.notifyPopupClosed", result.responseId)
                        }
                    }, 500)

                    const value = await SWBridge.call("apps.waitForResponse", result.responseId)
                    clearInterval(pollClose)
                    return value
                },

                respond: async (value) => {
                    // Use embedded __appKey — no URL parsing, no one-time-claim destruction
                    const params = await SWBridge.call("apps.getParams", __appKey)
                    if (params?.__responseId) {
                        await SWBridge.call("apps.respond", params.__responseId, value)
                        await new Promise(r => setTimeout(r, 50))
                        window.close()
                    }
                }
            }

            if (prop === "params") {
                if (!window.__appParamsCache) {
                    window.__appParamsCache = SWBridge.call("apps.getParams", __appKey)
                }
                return window.__appParamsCache
            }

            return createProxy(prop)
        }
    })
})()
</script>`,
        loaderDiv
    }
}

const HTML_HEADERS = { "Content-Type": "text/html", "Cross-Origin-Opener-Policy": "same-origin" }
const ASSET_HEADERS = { "Cross-Origin-Opener-Policy": "same-origin" }

async function route(request, parts) {
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

    // Stable app key derived from path — no UUID, no URL param needed
    const appKey = isShared ? "" : parts[0] + "/" + parts[1]

    let iconSvg = ""
    if (!isShared) {
        const manifestPath = APPS_PREFIX + parts[0] + "/" + parts[1] + "/manifest.json"
        const mf = await readFile(manifestPath)
        if (mf?.type === "file") {
            try {
                const manifest = JSON.parse(new TextDecoder().decode(mf.data))
                if (typeof manifest.icon === "string") iconSvg = manifest.icon
            } catch { }
        }
    }

    const { head, loaderDiv } = buildInjectedScript(appKey, iconSvg)

    const headIdx = body.indexOf("</head>")
    let html = headIdx === -1
        ? body + head
        : body.slice(0, headIdx) + head + "</head>" + body.slice(headIdx + 7)

    if (loaderDiv) {
        const bodyIdx = html.indexOf("<body")
        const bodyTagEnd = bodyIdx !== -1 ? html.indexOf(">", bodyIdx) + 1 : -1
        if (bodyTagEnd !== -1) {
            html = html.slice(0, bodyTagEnd) + loaderDiv + html.slice(bodyTagEnd)
        } else {
            html = loaderDiv + html
        }
    }

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
        async open(path, params = {}, mode) {
            const key = path.replace(/\/+$/, "")
            const url = `/apps/${key}/`

            if (mode !== "popup") {
                appParams.set(key, { ...params })
                return url
            }

            const responseId = crypto.randomUUID()
            appParams.set(key, { ...params, __responseId: responseId })
            pendingResponses.set(responseId, { resolve: null, settled: false, value: undefined })
            return { url, responseId, popup: true }
        },

        getParams(path) {
            const key = path.replace(/^\/+|\/+$/g, "")
            return appParams.get(key) || {}
        },

        waitForResponse(responseId) {
            return new Promise(resolve => {
                const entry = pendingResponses.get(responseId)
                if (!entry) return resolve(null)
                if (entry.settled) return resolve(entry.value)

                const timer = setTimeout(() => {
                    entry.settled = true
                    entry.value = null
                    pendingResponses.delete(responseId)
                    resolve(null)
                }, 5 * 60 * 1000)

                entry.resolve = (val) => {
                    clearTimeout(timer)
                    entry.settled = true
                    entry.value = val
                    pendingResponses.delete(responseId)
                    resolve(val)
                }
            })
        },

        respond(responseId, value) {
            const entry = pendingResponses.get(responseId)
            if (entry?.resolve) entry.resolve(value)
            else if (entry) {
                entry.settled = true
                entry.value = value
            }
        },

        notifyPopupClosed(responseId) {
            const entry = pendingResponses.get(responseId)
            if (!entry || entry.settled) return
            // Grace period: give a respond() call that's in-flight a chance to land first
            setTimeout(() => {
                const latest = pendingResponses.get(responseId)
                if (!latest || latest.settled) return
                latest.resolve?.(null)
                pendingResponses.delete(responseId)
            }, 100)
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
        if (fn) result = await fn(...d.args)
        else console.warn(d.method, "is not a valid endpoint")
    } catch (err) {
        console.warn(err)
    }

    e.source.postMessage({ type: "rpc-res", id: d.id, result })
})

async function openFromSW(path, params = {}) {
    const key = path.replace(/\/+$/, "")
    appParams.set(key, params)
    const url = `/apps/${key}/`

    const clientsList = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true
    })

    const target = clientsList.find(c => c.focused) ?? clientsList[0]
    if (target) target.postMessage({ type: "from-sw", action: "apps.open", url })

    return url
}

self.addEventListener("install", () => self.skipWaiting())
self.addEventListener("activate", e => e.waitUntil(clients.claim()))