import { ensureRoot, readFile, streamFile } from "./scripts/vfs.js"
import { handleRpcMessage, liveReloadBases, appParams, rpc } from "./scripts/sw-api.js"
import { registerWindow } from "./scripts/sw-registry.js"
import { mimeFromPath, sysDialog } from "./scripts/utility.js"

ensureRoot()

class LRU {
    #max; #map
    constructor(max) {
        this.#max = max
        this.#map = new Map()
    }
    get(key) {
        const map = this.#map
        if (!map.has(key)) return undefined
        const val = map.get(key)
        map.delete(key)
        map.set(key, val)
        return val
    }
    set(key, val) {
        const map = this.#map
        if (map.has(key)) {
            map.delete(key)
        } else if (map.size >= this.#max) {
            map.delete(map.keys().next().value)
        }
        map.set(key, val)
        return val
    }
    delete(key) { return this.#map.delete(key) }
    get size() { return this.#map.size }
}

self.addEventListener("install", () => {
    log("install")
    self.skipWaiting()
})
self.addEventListener("activate", e => {
    log("activate")
    e.waitUntil(clients.claim())
})

const SW_URL = new URL(self.location.href)
const DEBUG_LOGS = SW_URL.searchParams.get("log") === "true"

function log(...args) {
    if (DEBUG_LOGS) console.log("[SW]", ...args)
}

self.__OZONE_CONFIG__ = {
    launcher: JSON.parse(
        decodeURIComponent(SW_URL.searchParams.get("launcher") ?? "null")
    )
}

log("config", self.__OZONE_CONFIG__)

self.addEventListener("message", handleRpcMessage)

self.addEventListener("fetch", e => {
    const { request } = e
    if (request.method !== "GET") return

    const url = new URL(request.url)
    const { pathname } = url

    log("fetch", { method: request.method, url: request.url, mode: request.mode })

    if (pathname.startsWith("/apps/") || pathname.startsWith("/sharedAssets/")) {
        const parts = pathname.split("/").filter(Boolean)

        log("apps route", { pathname, parts })

        if (!pathname.endsWith("/")) {
            const last = parts[parts.length - 1]
            if (!last.includes(".")) {
                log("redirecting trailing slash", pathname + "/")
                e.respondWith(Response.redirect(pathname + "/", 301))
                return
            }
        }

        e.respondWith(route(request, url, parts))

        if (e.clientId && parts.length >= 3) {
            const appKey = `${parts[1]}/${parts[2]}`
            const paramsId = url.searchParams.get("paramsId") ?? null
            rpc.settings.get(appKey, "appRegistry.json").then(registryItem => {
                const permissions = registryItem?.permissions ?? []
                registerWindow(e.clientId, appKey, paramsId, permissions)
            })
        }
        return
    }

    if (request.mode === "navigate") {
        log("navigation request", pathname)
        e.respondWith(handleNavigation(request, pathname))

        const cfg = self.__OZONE_CONFIG__
        if (e.clientId && cfg?.launcher) {
            const { author, name } = cfg.launcher
            const appKey = `${author}/${name}`
            rpc.settings.get(appKey, "appRegistry.json").then(registryItem => {
                const permissions = registryItem?.permissions ?? []
                registerWindow(e.clientId, appKey, null, permissions)
            })
        }
    }
})

import { debugRegistry } from "./scripts/sw-registry.js"
self.__debug = { registry: debugRegistry }

async function handleNavigation(request, pathname) {
    const launcherPath = getLauncherPath()

    log("handleNavigation", { request: request.url, launcherPath })

    if (!launcherPath) {
        log("no launcher configured, falling back to fetch")
        return fetch(request)
    }

    if (
        pathname.startsWith("/scripts/") ||
        pathname.startsWith("/assets/") ||
        pathname.startsWith("/defaultSource/") ||
        pathname.startsWith("/favicon")
    ) {
        log("bypassing navigation interception", pathname)
        return fetch(request)
    }

    log("serving launcher")
    return serveLauncher(launcherPath)
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function createHtmlInjector(head, loaderDiv) {
    let injected = false
    let buffer = ""

    return new TransformStream({
        transform(chunk, controller) {
            if (injected) {
                controller.enqueue(chunk)
                return
            }

            buffer += decoder.decode(chunk, { stream: true })

            const headMatch = /<head[^>]*>/i.exec(buffer)
            if (!headMatch) {
                if (buffer.length > 8192) {
                    controller.enqueue(encoder.encode(buffer.slice(0, 4096)))
                    buffer = buffer.slice(4096)
                }
                return
            }

            injected = true
            const insertAt = headMatch.index + headMatch[0].length
            let html = buffer.slice(0, insertAt) + head + buffer.slice(insertAt)

            if (loaderDiv) {
                const bodyMatch = /<body[^>]*>/i.exec(html)
                if (bodyMatch) {
                    const bi = bodyMatch.index + bodyMatch[0].length
                    html = html.slice(0, bi) + loaderDiv + html.slice(bi)
                }
            }

            controller.enqueue(encoder.encode(html))
            buffer = ""
        },

        flush(controller) {
            if (!buffer) return

            if (!injected) {
                let html = buffer
                const headMatch = /<head[^>]*>/i.exec(html)
                if (headMatch) {
                    const insertAt = headMatch.index + headMatch[0].length
                    html = html.slice(0, insertAt) + head + html.slice(insertAt)
                } else {
                    html = head + html
                }
                if (loaderDiv) {
                    const bodyMatch = /<body[^>]*>/i.exec(html)
                    if (bodyMatch) {
                        const bi = bodyMatch.index + bodyMatch[0].length
                        html = html.slice(0, bi) + loaderDiv + html.slice(bi)
                    }
                }
                controller.enqueue(encoder.encode(html))
            } else {
                controller.enqueue(encoder.encode(buffer))
            }
        }
    })
}

const SHARED_PREFIX = "/system/sharedAssets/"
const APPS_PREFIX = "/system/apps/"

const manifestCache = new LRU(30)
const vfsBlobCache = new LRU(20)
const injectedScriptCache = new LRU(30)
const liveReloadBodyCache = new LRU(20)

const vfsBlobRevalidating = new Map()
const manifestRevalidating = new Map()

async function cachedStreamFile(vfsPath) {
    const cached = vfsBlobCache.get(vfsPath)
    if (cached !== undefined) {
        scheduleRevalidateBlob(vfsPath)
        return { type: "file", file: cached }
    }
    const result = await streamFile(vfsPath)
    if (result?.type === "file") vfsBlobCache.set(vfsPath, result.file)
    return result
}

function scheduleRevalidateBlob(vfsPath) {
    if (vfsBlobRevalidating.has(vfsPath)) return
    const p = streamFile(vfsPath)
        .then(fresh => {
            if (fresh?.type === "file") vfsBlobCache.set(vfsPath, fresh.file)
            else vfsBlobCache.delete(vfsPath)
        })
        .catch(() => vfsBlobCache.delete(vfsPath))
        .finally(() => vfsBlobRevalidating.delete(vfsPath))
    vfsBlobRevalidating.set(vfsPath, p)
}

function getLauncherPath() {
    const cfg = self.__OZONE_CONFIG__
    if (!cfg?.launcher) return null
    const { author, name } = cfg.launcher
    if (!author || !name) return null
    return `/system/apps/${author}/${name}/index.html`
}

async function serveLauncher(launcherPath) {
    log("serveLauncher", { launcherPath })

    const parts = launcherPath.replace(/^\/system\/apps\//, "").split("/")

    const [streamed, manifest] = await Promise.all([
        cachedStreamFile(launcherPath),
        getManifest(`/system/apps/${parts[0]}/${parts[1]}/manifest.json`)
    ])

    if (!streamed || streamed.type !== "file") {
        log("launcher file missing")
        return new Response("Launcher missing", { status: 404 })
    }

    log("launcher manifest", manifest)

    const iconSvg = typeof manifest?.icon === "string" ? manifest.icon : ""
    const { head, loaderDiv } = buildInjectedScript(iconSvg)

    const injectedHead =
        `<base href="/apps/${parts[0]}/${parts[1]}/">` +
        `<script>window.__APP_BASE__="/apps/${parts[0]}/${parts[1]}/"</script>` +
        head

    const stream = streamed.file
        .stream()
        .pipeThrough(createHtmlInjector(injectedHead, loaderDiv))

    log("launcher served")

    return new Response(stream, {
        headers: {
            "Content-Type": "text/html",
            "Cross-Origin-Opener-Policy": "same-origin"
        }
    })
}
async function getManifest(manifestPath) {
    if (!manifestPath) return null

    const entry = manifestCache.get(manifestPath)
    if (entry !== undefined) {
        scheduleRevalidateManifest(manifestPath)
        return entry
    }

    const value = await fetchManifest(manifestPath)
    manifestCache.set(manifestPath, value)
    return value
}

async function fetchManifest(manifestPath) {
    const mf = await readFile(manifestPath).catch(() => null)
    if (!mf || mf.type !== "file") return null
    try { return JSON.parse(new TextDecoder().decode(mf.data)) }
    catch { return null }
}

function scheduleRevalidateManifest(manifestPath) {
    if (manifestRevalidating.has(manifestPath)) return
    const p = fetchManifest(manifestPath)
        .then(fresh => manifestCache.set(manifestPath, fresh))
        .catch(() => { })
        .finally(() => manifestRevalidating.delete(manifestPath))
    manifestRevalidating.set(manifestPath, p)
}

function buildInjectedScript(iconSvg = "") {
    const cached = injectedScriptCache.get(iconSvg)
    if (cached !== undefined) return cached

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
#_app_loader_icon { width: 72px; height: 72px; }
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

    const __paramsId = new URLSearchParams(location.search).get("paramsId") ?? ""

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
            navigator.serviceWorker.addEventListener("message", ({ data: d, source }) => {
                if (d?.type === "rpc-res") {
                    SWBridge.#wait.get(d.id)?.(d.result)
                    SWBridge.#wait.delete(d.id)
                } else if (d?.type === "from-sw" && d.action === "apps.open") {
                    try { new URL(d.url, location.origin); window.open(d.url, "_blank", "noopener,noreferrer") }
                    catch { console.error("Invalid URL from SW:", d.url) }
                } else if (d?.type === "sys-dialog") {
                    handleSystemDialog(d, source)
                }
            })
        }
    }
    SWBridge.init()

    const proxyCache = new Map()
    function createProxy(path) {
        let p = proxyCache.get(path)
        if (p) return p
        p = new Proxy(() => {}, {
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
                    const sw = window.screen
                    const maxW = sw.availWidth  * 0.8
                    const maxH = sw.availHeight * 0.8
                    let w = maxW, h = w * (6 / 9)
                    if (h > maxH) { h = maxH; w = h * (9 / 6) }
                    h = Math.min(h, maxH); w = Math.min(w, maxW)
                    const left = Math.max(0, (sw.availWidth  - w) / 2)
                    const top  = Math.max(0, (sw.availHeight - h) / 2)
                    const popup = _open.call(window, result.url, "_blank",
                        \`popup=yes,width=\${Math.floor(w)},height=\${Math.floor(h)},left=\${Math.floor(left)},top=\${Math.floor(top)},noopener,noreferrer\`)
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
                    const params = await SWBridge.call("apps.getParams", __paramsId)
                    if (params?.__responseId) {
                        await SWBridge.call("apps.respond", params.__responseId, value)
                        await new Promise(r => setTimeout(r, 50))
                        window.close()
                    }
                }
            }
            if (prop === "params") {
                if (!window.__appParamsCache)
                    window.__appParamsCache = SWBridge.call("apps.getParams", __paramsId)
                return window.__appParamsCache
            }
            return createProxy(prop)
        }
    })

    function handleSystemDialog({ dialogType, message, defaultValue, id }, source) {
        const reply = (payload) => {
            const channel = source || navigator.serviceWorker.controller
            channel?.postMessage(payload)
        }

        switch (dialogType) {
            case "alert":
                alert(message)
                break
            case "confirm":
                reply({ type: "dialog-response", id, value: confirm(message) })
                break
            case "prompt":
                reply({ type: "dialog-response", id, value: prompt(message, defaultValue ?? "") })
                break
        }
    }
})()
</script>`,
        loaderDiv
    }

    injectedScriptCache.set(iconSvg, result)
    return result
}

const HTML_CT = "text/html"
const COOP_HEADER = "Cross-Origin-Opener-Policy"
const COOP_VALUE = "same-origin"

async function route(request, url, parts) {
    log("route:start", { url: request.url, parts })

    const isShared = parts[0] === "sharedAssets"

    if (isShared) {
        if (parts.length < 2) return new Response("Forbidden", { status: 403 })
    } else if (!parts[0] || !parts[1] || parts[0].includes("/") || parts[1].includes("/")) {
        return new Response("Forbidden", { status: 403 })
    }

    const appKey = isShared ? "" : `${parts[1]}/${parts[2]}`
    const vfsPath = isShared
        ? SHARED_PREFIX + (parts.length > 1 ? parts.slice(1).join("/") : "index.html")
        : `${APPS_PREFIX}${parts[1]}/${parts[2]}/${parts.length > 3 ? parts.slice(3).join("/") : "index.html"}`

    log("route:vfsPath", vfsPath)

    const liveBase = liveReloadBases.get(appKey)
    const lrParam = url.searchParams.get("livereload")

    const assetPath = parts.length > 3
        ? parts.slice(3).join("/")
        : "index.html"

    let resolvedLiveUrl = lrParam
    if (!resolvedLiveUrl && liveBase) {
        resolvedLiveUrl = isShared
            ? `${liveBase.replace(/\/$/, "")}/${(url.searchParams.get("sharedAssetsURL") || "defaultSource/sharedAssets").replace(/^\/+|\/+$/g, "")}/${parts.slice(3).join("/")}`
            : `${liveBase.replace(/\/[^/]*$/, "/")}${assetPath}`
    }

    log("live reload resolved", { resolvedLiveUrl })

    if (resolvedLiveUrl) {
        return handleLiveReload(resolvedLiveUrl, lrParam, isShared, appKey, vfsPath)
    }
    const streamed = await cachedStreamFile(vfsPath)

    if (!streamed || streamed.type !== "file") {
        log("not found", vfsPath)
        return new Response("Not found", { status: 404 })
    }

    const contentType = mimeFromPath(vfsPath)
    log("serving asset", { vfsPath, contentType })

    if (contentType !== HTML_CT) {
        return new Response(streamed.file.stream(), {
            headers: { "Content-Type": contentType, [COOP_HEADER]: COOP_VALUE }
        })
    }

    const manifestPath = !isShared
        ? `${APPS_PREFIX}${parts[1]}/${parts[2]}/manifest.json`
        : null
    const manifest = await getManifest(manifestPath)
    const iconSvg = typeof manifest?.icon === "string" ? manifest.icon : ""
    const { head, loaderDiv } = buildInjectedScript(iconSvg)

    return new Response(
        streamed.file.stream().pipeThrough(createHtmlInjector(head, loaderDiv)),
        { headers: { "Content-Type": HTML_CT, [COOP_HEADER]: COOP_VALUE } }
    )
}

async function handleLiveReload(resolvedLiveUrl, lrParam, isShared, appKey, vfsPath) {
    const cacheEntry = liveReloadBodyCache.get(resolvedLiveUrl)

    const networkPromise = fetch(resolvedLiveUrl)
        .then(async res => {
            console.log("LR fetch", resolvedLiveUrl, res.status)

            if (!res.ok) return null

            const ct = (res.headers.get("Content-Type") ?? HTML_CT)
                .split(";")[0]
                .trim()

            const buffer = await res.arrayBuffer()

            const entry = { buffer, ct }

            liveReloadBodyCache.set(resolvedLiveUrl, entry)

            return entry
        })
        .catch(err => {
            console.error("LR fetch failed", resolvedLiveUrl, err)
            return null
        })
    let entry

    if (cacheEntry !== undefined) {
        entry = cacheEntry
        networkPromise.catch(() => { })
    } else {
        entry = await networkPromise
    }

    if (!entry) return new Response("LiveReload error", { status: 500 })

    const { buffer, ct } = entry
    const headers = new Headers({ "Content-Type": ct, [COOP_HEADER]: COOP_VALUE })

    if (ct !== HTML_CT) return new Response(buffer, { headers })

    if (lrParam && !isShared) liveReloadBases.set(appKey, lrParam)

    const manifestPath = !isShared
        ? vfsPath.replace(/\/[^/]+$/, "/manifest.json")
        : null
    const manifest = await getManifest(manifestPath)
    const iconSvg = typeof manifest?.icon === "string" ? manifest.icon : ""
    const { head, loaderDiv } = buildInjectedScript(iconSvg)

    const stream = new Blob([buffer]).stream().pipeThrough(createHtmlInjector(head, loaderDiv))
    headers.set("Content-Type", HTML_CT)
    return new Response(stream, { headers })
}