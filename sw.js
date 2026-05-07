importScripts("scripts/vfs.js")
importScripts("scripts/utility.js")
importScripts("scripts/sw-api.js")

ensureRoot()

self.addEventListener("install", () => self.skipWaiting())
self.addEventListener("activate", e => e.waitUntil(clients.claim()))
self.addEventListener("message", handleRpcMessage)
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

// ─── Caches ──────────────────────────────────────────────────────────────────

// manifest: path → { value, revalidating }
const manifestCache = new Map()

// VFS file blobs: vfsPath → Blob
const vfsCache = new Map()

// Injected script strings: appKey|iconSvg → { head, loaderDiv }
const injectedScriptCache = new Map()

// Live-reload responses: url → Response (cloned)
const liveReloadCache = new Map()

/**
 * Read from vfsCache; on miss populate it, then trigger a background
 * revalidation so the next request always gets a fresh copy.
 */
async function cachedReadFile(vfsPath) {
    if (vfsCache.has(vfsPath)) {
        // Revalidate in the background — never blocks the response
        revalidateVfs(vfsPath)
        return vfsCache.get(vfsPath)
    }
    const result = await readFile(vfsPath)
    if (result?.type === "file") vfsCache.set(vfsPath, result)
    return result
}

async function revalidateVfs(vfsPath) {
    const fresh = await readFile(vfsPath).catch(() => null)
    if (fresh?.type === "file") vfsCache.set(vfsPath, fresh)
    else if (fresh === null || fresh?.type !== "file") vfsCache.delete(vfsPath)
}

/**
 * Same stale-while-revalidate pattern for streamed (Blob) VFS reads.
 */
const vfsBlobCache = new Map() // vfsPath → Blob

async function cachedStreamFile(vfsPath) {
    if (vfsBlobCache.has(vfsPath)) {
        revalidateVfsBlob(vfsPath)
        return { type: "file", file: vfsBlobCache.get(vfsPath) }
    }
    const result = await streamFile(vfsPath)
    if (result?.type === "file") vfsBlobCache.set(vfsPath, result.file)
    return result
}

async function revalidateVfsBlob(vfsPath) {
    const fresh = await streamFile(vfsPath).catch(() => null)
    if (fresh?.type === "file") vfsBlobCache.set(vfsPath, fresh.file)
    else vfsBlobCache.delete(vfsPath)
}

/**
 * Manifest: stale-while-revalidate. Returns the cached value immediately,
 * kicks off a background fetch to keep it current.
 */
async function getManifest(manifestPath) {
    if (!manifestPath) return null

    if (manifestCache.has(manifestPath)) {
        const entry = manifestCache.get(manifestPath)
        // Only launch one revalidation at a time
        if (!entry.revalidating) {
            entry.revalidating = true
            revalidateManifest(manifestPath).finally(() => {
                const e = manifestCache.get(manifestPath)
                if (e) e.revalidating = false
            })
        }
        return entry.value
    }

    // Cold path — must await
    const value = await fetchManifest(manifestPath)
    manifestCache.set(manifestPath, { value, revalidating: false })
    return value
}

async function fetchManifest(manifestPath) {
    const mf = await readFile(manifestPath).catch(() => null)
    if (!mf || mf.type !== "file") return null
    try {
        return JSON.parse(new TextDecoder().decode(mf.data))
    } catch {
        return null
    }
}

async function revalidateManifest(manifestPath) {
    const fresh = await fetchManifest(manifestPath)
    const entry = manifestCache.get(manifestPath)
    if (entry) entry.value = fresh
    else manifestCache.set(manifestPath, { value: fresh, revalidating: false })
}

/**
 * Cache the injected <script>/<style> strings — they are pure functions of
 * (appKey, iconSvg) so they never go stale on their own.
 */
function buildInjectedScript(appKey = "", iconSvg = "") {
    const cacheKey = appKey + "\x00" + iconSvg
    if (injectedScriptCache.has(cacheKey)) return injectedScriptCache.get(cacheKey)

    const loaderDiv = iconSvg
        ? `<div id="_app_loader"><div id="_app_loader_icon">${iconSvg}</div></div>`
        : ""

    const result = {
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

    } else if (d?.type === "sys-dialog") {
        handleSystemDialog(d)
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
       function handleSystemDialog({ dialogType, message, defaultValue }) {
    switch (dialogType) {
        case "alert":
            alert(message)
            break

        case "confirm":
            const result = confirm(message)
            navigator.serviceWorker.controller?.postMessage({
                type: "dialog-response",
                value: result
            })
            break

        case "prompt":
            const value = prompt(message, defaultValue ?? "")
            navigator.serviceWorker.controller?.postMessage({
                type: "dialog-response",
                value
            })
            break
    }
}
})()
</script>`,
        loaderDiv
    }

    injectedScriptCache.set(cacheKey, result)
    return result
}

// ─── Live-reload cache ────────────────────────────────────────────────────────
// Stores the last good Response body as an ArrayBuffer so it can be re-streamed.
const liveReloadBodyCache = new Map()  // url → { buffer: ArrayBuffer, ct: string }

const HTML_HEADERS = { "Content-Type": "text/html", "Cross-Origin-Opener-Policy": "same-origin" }
const ASSET_HEADERS = { "Cross-Origin-Opener-Policy": "same-origin" }

async function route(request, parts) {
    const rawUrl = request.url
    const lrIdx = rawUrl.indexOf("livereload=")

    const liveReloadUrl = lrIdx !== -1
        ? new URL(rawUrl).searchParams.get("livereload")
        : null

    const isShared = parts[2] === "sharedAssets"
    const appKey = isShared ? "" : parts[0] + "/" + parts[1]

    const vfsPath = isShared
        ? SHARED_PREFIX + (parts.length > 3 ? parts.slice(3).join("/") : "index.html")
        : APPS_PREFIX +
        parts[0] +
        "/" +
        parts[1] +
        "/" +
        (parts.length > 2 ? parts.slice(2).join("/") : "index.html")

    if (isShared) {
        if (parts.length < 3) {
            return new Response("Forbidden", { status: 403 })
        }
    } else {
        if (
            !parts[0] ||
            !parts[1] ||
            parts[0].includes("/") ||
            parts[1].includes("/")
        ) {
            return new Response("Forbidden", { status: 403 })
        }
    }

    const liveBase = liveReloadBases.get(appKey)

    const assetPath =
        parts.length > 2
            ? parts.slice(2).join("/")
            : "index.html"

    const resolvedLiveUrl =
        liveReloadUrl ??
        (
            liveBase
                ? liveBase.replace(/\/[^/]*$/, "/") + assetPath
                : null
        )

    const manifestPath = !isShared
        ? APPS_PREFIX + parts[0] + "/" + parts[1] + "/manifest.json"
        : null

    const manifest = await getManifest(manifestPath)

    const iconSvg =
        typeof manifest?.icon === "string"
            ? manifest.icon
            : ""

    const { head, loaderDiv } = buildInjectedScript(appKey, iconSvg)

    function createHtmlInjector(head, loaderDiv) {
        const encoder = new TextEncoder()
        const decoder = new TextDecoder()

        let injected = false
        let buffer = ""

        return new TransformStream({
            transform(chunk, controller) {
                buffer += decoder.decode(chunk, { stream: true })

                if (!injected) {
                    const headMatch = /<\/head>/i.exec(buffer)

                    if (headMatch) {
                        injected = true

                        const headIdx = headMatch.index

                        let html =
                            buffer.slice(0, headIdx) +
                            head +
                            buffer.slice(headIdx)

                        if (loaderDiv) {
                            const bodyMatch = /<body[^>]*>/i.exec(html)

                            if (bodyMatch) {
                                const insertAt =
                                    bodyMatch.index + bodyMatch[0].length

                                html =
                                    html.slice(0, insertAt) +
                                    loaderDiv +
                                    html.slice(insertAt)
                            }
                        }

                        controller.enqueue(
                            encoder.encode(html)
                        )

                        buffer = ""
                        return
                    }

                    if (buffer.length > 8192) {
                        controller.enqueue(
                            encoder.encode(buffer.slice(0, 4096))
                        )

                        buffer = buffer.slice(4096)
                    }

                    return
                }

                controller.enqueue(
                    encoder.encode(buffer)
                )

                buffer = ""
            },

            flush(controller) {
                if (!injected) {
                    let html = buffer + head

                    if (loaderDiv) {
                        const bodyMatch = /<body[^>]*>/i.exec(html)

                        if (bodyMatch) {
                            const insertAt =
                                bodyMatch.index + bodyMatch[0].length

                            html =
                                html.slice(0, insertAt) +
                                loaderDiv +
                                html.slice(insertAt)
                        }
                    }

                    controller.enqueue(
                        encoder.encode(html)
                    )

                    return
                }

                if (buffer) {
                    controller.enqueue(
                        encoder.encode(buffer)
                    )
                }
            }
        })
    }

    if (resolvedLiveUrl) {
        const cacheEntry = liveReloadBodyCache.get(resolvedLiveUrl)

        // Fire a background revalidation regardless
        const networkFetch = fetch(resolvedLiveUrl)
            .then(async res => {
                if (!res.ok) return
                const ct = (res.headers.get("Content-Type") ?? "text/html")
                    .split(";")[0].trim()
                const buffer = await res.arrayBuffer()
                liveReloadBodyCache.set(resolvedLiveUrl, { buffer, ct })
            })
            .catch(() => null)

        if (cacheEntry) {
            // Serve stale immediately; revalidation runs in background
            const { buffer, ct } = cacheEntry
            const headers = new Headers({
                "Content-Type": ct,
                "Cross-Origin-Opener-Policy": "same-origin"
            })

            if (ct !== "text/html") {
                return new Response(buffer, { headers })
            }

            if (liveReloadUrl && !isShared) {
                liveReloadBases.set(appKey, liveReloadUrl)
            }

            const stream = new Blob([buffer])
                .stream()
                .pipeThrough(createHtmlInjector(head, loaderDiv))

            headers.set("Content-Type", "text/html")
            return new Response(stream, { headers })
        }

        // Cold path: must await the network
        const res = await networkFetch.then(() => {
            const entry = liveReloadBodyCache.get(resolvedLiveUrl)
            return entry ?? null
        })

        if (!res) return new Response("LiveReload error", { status: 500 })

        const { buffer, ct } = res
        const headers = new Headers({
            "Content-Type": ct,
            "Cross-Origin-Opener-Policy": "same-origin"
        })

        if (ct !== "text/html") return new Response(buffer, { headers })

        if (liveReloadUrl && !isShared) {
            liveReloadBases.set(appKey, liveReloadUrl)
        }

        const stream = new Blob([buffer])
            .stream()
            .pipeThrough(createHtmlInjector(head, loaderDiv))

        headers.set("Content-Type", "text/html")
        return new Response(stream, { headers })
    }

    // ── VFS path ──────────────────────────────────────────────────────────────
    const streamed = await cachedStreamFile(vfsPath)

    if (!streamed || streamed.type !== "file") {
        return new Response("Not found", { status: 404 })
    }

    const contentType = mime(vfsPath)

    if (contentType !== "text/html") {
        return new Response(
            streamed.file.stream(),
            {
                headers: {
                    "Content-Type": contentType,
                    "Cross-Origin-Opener-Policy": "same-origin"
                }
            }
        )
    }

    const stream = streamed.file
        .stream()
        .pipeThrough(createHtmlInjector(head, loaderDiv))

    return new Response(stream, {
        headers: {
            "Content-Type": "text/html",
            "Cross-Origin-Opener-Policy": "same-origin"
        }
    })
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

self.addEventListener("message", handleRpcMessage)

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