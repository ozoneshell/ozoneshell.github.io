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
async function route(request, parts) {
    const [creator, app, ...rest] = parts

    let vfsPath

    if (rest[0] === "sharedAssets") {
        const file = rest.slice(1).join("/") || "index.html"
        vfsPath = `/system/sharedAssets/${file}`
    } else {
        const file = rest.join("/") || "index.html"
        vfsPath = `/system/apps/${creator}/${app}/${file}`
    }

    if (!/^\/system\/(sharedAssets|apps\/[^/]+\/[^/]+)\//.test(vfsPath)) {
        return new Response("Forbidden", { status: 403 })
    }

    const f = await readFile(vfsPath)

    if (!f || f.type !== "file") {
        return new Response("Not found", { status: 404 })
    }

    const type = mime(vfsPath)

    if (type !== "text/html") {
        return new Response(f.data, {
            headers: {
                "Content-Type": type,
                "Cross-Origin-Opener-Policy": "same-origin"
            }
        })
    }

    const text = new TextDecoder().decode(f.data)

    const injectedScript = `
<script>
(() => {
    if (window.opener) {
        try { window.opener = null } catch {}
    }

    const _open = window.open
    window.open = function(url, target, features) {
        const f = features ? features + ',noopener,noreferrer' : 'noopener,noreferrer'
        return _open.call(window, url, target || '_blank', f)
    }

    class SWBridge {
        static #id = 0
        static #wait = new Map()

        static call(method, ...args) {
            return new Promise(res => {
                const id = ++this.#id
                this.#wait.set(id, res)

                navigator.serviceWorker.controller?.postMessage({
                    type: "rpc",
                    id,
                    method,
                    args
                })
            })
        }

        static init() {
            navigator.serviceWorker.addEventListener("message", e => {
                const d = e.data

                if (d?.type === "rpc-res") {
                    const fn = SWBridge.#wait.get(d.id)
                    if (fn) {
                        SWBridge.#wait.delete(d.id)
                        fn(d.result)
                    }
                    return
                }

                if (d?.type === "from-sw") {
                    if (d.action === "apps.open") {
                        try {
                            new URL(d.url, location.origin)
                            window.open(d.url, "_blank", "noopener,noreferrer")
                        } catch {
                            console.error("Invalid URL from SW:", d.url)
                        }
                    }
                }
            })
        }
    }

    SWBridge.init()

    const proxyCache = new Map()

    function createProxy(path = []) {
        const key = path.join('.')
        if (proxyCache.has(key)) return proxyCache.get(key)

        const p = new Proxy(() => {}, {
            get(_, prop) {
                return createProxy([...path, prop])
            },
            apply(_, __, args) {
                return SWBridge.call(path.join('.'), ...args)
            }
        })

        proxyCache.set(key, p)
        return p
    }

    window.api = new Proxy({}, {
        get(_, prop) {
            if (prop === "apps") {
                return {
                    open: async (path, params) => {
                        const url = await SWBridge.call("apps.open", path, params)
                        try {
                            new URL(url)
                            return window.open(url)
                        } catch {
                            console.error("Invalid URL:", url)
                            return null
                        }
                    }
                }
            }

            if (prop === "params") {
                return SWBridge.call(
                    "apps.getParams",
                    location.pathname.split("/").slice(2).join("/")
                )
            }

            return createProxy([prop])
        }
    })
})()
</script>
`

    const html = text.replace("</head>", `${injectedScript}</head>`)

    return new Response(html, {
        headers: {
            "Content-Type": "text/html",
            "Cross-Origin-Opener-Policy": "same-origin"
        }
    })
}

function mime(p) {
    const ext = p.split(".").pop().toLowerCase()

    return {
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
    }[ext] || "application/octet-stream"
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

    for (const client of clientsList) {
        client.postMessage({
            type: "from-sw",
            action: "apps.open",
            url
        })
    }

    return url
}

self.addEventListener("install", () => {
    self.skipWaiting()
})

self.addEventListener("activate", e => {
    e.waitUntil(clients.claim())
})