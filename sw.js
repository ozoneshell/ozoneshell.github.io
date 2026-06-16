import { ensureRoot, readFile, streamFile } from "./scripts/vfs.js"
import { handleRpcMessage, liveReloadBases, appParams, rpc } from "./scripts/sw-api.js"
import { registerWindow } from "./scripts/sw-registry.js"
import { mimeFromPath, sysDialog } from "./scripts/utility.js"
import { buildRuntimeScript } from "./scripts/runtime-script.js"

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

self.addEventListener("message", async e => {
    if (e.data?.type === "register-window") {
        registerWindow(
            e.source.id,
            e.data.appKey
        )

        e.source?.postMessage({
            type: "register-window-ok"
        })

        return
    }

    handleRpcMessage(e)
})
self.addEventListener("activate", e => {
    log("activate")
    e.waitUntil(
        clients.claim().then(startClientPruner)
    )
})

function startClientPruner() {
    setInterval(async () => {
        const live = await self.clients.matchAll({ type: "window", includeUncontrolled: true })
        const liveIds = new Set(live.map(c => c.id))
        for (const [, subs] of channels) {
            for (const id of subs) {
                if (!liveIds.has(id)) subs.delete(id)
            }
        }
    }, 30_000)
}

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
                e.respondWith(
                    Response.redirect(new URL(pathname + "/", request.url), 301)
                )
                return
            }
        }

        const isShared = pathname.startsWith("/sharedAssets/")

        e.respondWith(route(request, url, parts))

        if (
            !isShared &&
            e.clientId &&
            request.mode === "navigate" &&
            parts.length >= 3
        ) {
            const author = parts[1]
            const appName = parts[2]
            const clientId = e.clientId

            rpc.settings.get(`${author}/${appName}`, "appRegistry.json")
                .then(registryItem => {
                    const capitalizedName = appName.charAt(0).toUpperCase() + appName.slice(1)
                    return rpc.settings.get(`${author}/${capitalizedName}`, "appRegistry.json")
                        .then(item => {
                            if (item) {
                                const permissions = item?.permissions ?? []
                                registerWindow(clientId, `${author}/${capitalizedName}`, null, permissions)
                            }
                        })
                })
                .catch(() => { })
        }

        return
    }

    if (request.mode === "navigate") {
        log("navigation request", pathname)
        e.respondWith(handleNavigation(request, pathname))
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

    const url = new URL(request.url)

    if (url.searchParams.get("launcher") === "false") {
        log("launcher disabled via param")
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
    return serveLauncher(launcherPath, request)
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

const injectedScriptCache = new LRU(30)
const liveReloadBodyCache = new LRU(20)

const vfsBlobRevalidating = new Map()
const manifestRevalidating = new Map()

const vfsBlobCache = new LRU(100)
const manifestCache = new LRU(50)
const channels = new Map()

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

async function serveLauncher(launcherPath, request) {
    log("serveLauncher", { launcherPath })

    const parts = launcherPath.replace(/^\/system\/apps\//, "").split("/")

    const [streamed, manifest] = await Promise.all([
        cachedStreamFile(launcherPath),
        getManifest(`/system/apps/${parts[0]}/${parts[1]}/manifest.json`)
    ])

    if (!streamed || streamed.type !== "file") {
        log("launcher file missing, falling back to network")
        return fetch(location.pathname + location.search)
    }

    log("launcher manifest", manifest)

    const iconSvg = typeof manifest?.icon === "string" ? manifest.icon : ""
    const { head, loaderDiv } = buildInjectedScript(iconSvg)

    const appKey = `${parts[0]}/${parts[1]}`
    const favicon = iconSvg
        ? `<link rel="icon" type="image/svg+xml" href="${svgToFaviconDataUrl(iconSvg)}">`
        : ""
    const injectedHead =
        favicon +
        `<base href="/apps/${parts[0]}/${parts[1]}/">` +
        `<script>
        window.__APP_BASE__="/apps/${parts[0]}/${parts[1]}/"
        window.__APP_KEY__="${appKey}"
    <\/script>` +
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

const INJECTED_CSS = `
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
`

function svgToFaviconDataUrl(svg) {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

function buildInjectedScript(iconSvg = "") {
    const cached = injectedScriptCache.get(iconSvg)

    if (cached !== undefined) {
        return cached
    }

    const loaderDiv = iconSvg
        ? `
      <div id="_app_loader">
          <div id="_app_loader_icon">
              ${iconSvg}
          </div>
      </div>
      `
        : ""

    const faviconLink = iconSvg
        ? `<link rel="icon" type="image/svg+xml" href="${svgToFaviconDataUrl(iconSvg)}">`
        : ""

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
    }

    injectedScriptCache.set(iconSvg, result)

    return result
}

const HTML_CT = "text/html"
const COOP_HEADER = "Cross-Origin-Opener-Policy"
const COOP_VALUE = "same-origin"

const appNameCache = new Map()

async function getAppKey(author, appName) {
    const cacheKey = `${author}/${appName}`

    if (appNameCache.has(cacheKey)) {
        return appNameCache.get(cacheKey)
    }

    let registryItem = await rpc.settings.get(cacheKey, "appRegistry.json").catch(() => null)
    if (registryItem) {
        appNameCache.set(cacheKey, cacheKey)
        return cacheKey
    }

    const capitalizedName = appName.charAt(0).toUpperCase() + appName.slice(1)
    const capitalizedKey = `${author}/${capitalizedName}`
    registryItem = await rpc.settings.get(capitalizedKey, "appRegistry.json").catch(() => null)
    if (registryItem) {
        appNameCache.set(cacheKey, capitalizedKey)
        return capitalizedKey
    }

    return cacheKey
}

async function route(request, url, parts) {
    log("route:start", { url: request.url, parts })

    const isAppSharedAsset =
        parts[0] === "apps" &&
        parts.length >= 5 &&
        parts[3] === "sharedAssets"

    if (isAppSharedAsset) {
        const vfsPath =
            SHARED_PREFIX + parts.slice(4).join("/")

        const streamed = await cachedStreamFile(vfsPath)

        if (!streamed || streamed.type !== "file") {
            return new Response("Not found", { status: 404 })
        }

        return new Response(streamed.file.stream(), {
            headers: {
                "Content-Type": mimeFromPath(vfsPath),
                [COOP_HEADER]: COOP_VALUE
            }
        })
    }

    const isShared = parts[0] === "sharedAssets"

    if (isShared) {
        if (parts.length < 2) return new Response("Forbidden", { status: 403 })
    } else if (!parts[0] || !parts[1] || parts[0].includes("/") || parts[1].includes("/")) {
        return new Response("Forbidden", { status: 403 })
    }

    let appKey = isShared ? "" : await getAppKey(parts[1], parts[2])
    const [author, name] = appKey.split("/")

    const vfsPath = isShared
        ? SHARED_PREFIX + (parts.length > 1 ? parts.slice(1).join("/") : "index.html")
        : `${APPS_PREFIX}${author}/${name}/${parts.length > 3 ? parts.slice(3).join("/") : "index.html"}`

    log("route:vfsPath", vfsPath)

    const liveBase = liveReloadBases.get(appKey)
    const lrParam = url.searchParams.get("livereload")

    const assetPath = parts.length > 3
        ? parts.slice(3).join("/")
        : "index.html"

    let resolvedLiveUrl = null

    if (lrParam) {
        const base = lrParam.replace(/\/[^/?#]*(\?.*)?$/, "/")
        if (!isShared) liveReloadBases.set(appKey, { base, ts: Date.now() })
        resolvedLiveUrl = isShared
            ? `${lrParam.replace(/\/$/, "")}/${(url.searchParams.get("sharedAssetsURL") || "defaultSource/sharedAssets").replace(/^\/+|\/+$/g, "")}/${parts.slice(3).join("/")}`
            : `${base}${assetPath}`
    } else if (liveBase) {
        const age = Date.now() - liveBase.ts
        if (age < 5000) {
            resolvedLiveUrl = isShared
                ? `${liveBase.base.replace(/\/$/, "")}/${(url.searchParams.get("sharedAssetsURL") || "defaultSource/sharedAssets").replace(/^\/+|\/+$/g, "")}/${parts.slice(3).join("/")}`
                : `${liveBase.base}${assetPath}`
        } else {
            liveReloadBases.delete(appKey)
        }
    }

    log("live reload resolved", { resolvedLiveUrl })

    if (resolvedLiveUrl) {
        return handleLiveReload(resolvedLiveUrl, lrParam, isShared, appKey, vfsPath)
    }

    const streamed = await cachedStreamFile(vfsPath)

    if (!streamed || streamed.type !== "file") {
        log("not found", vfsPath)
        if (isShared) {
            const devUrl = request.url.replace(/\/sharedAssets\//, "/defaultSource/sharedAssets/")
            log("sharedAsset not in VFS, trying dev path", devUrl)
            return fetch(devUrl)
        }
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
        ? `${APPS_PREFIX}${author}/${name}/manifest.json`
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
            log("LR fetch", resolvedLiveUrl, res.status)

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