importScripts("scripts/vfs.js")

ensureRoot()

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

    e.respondWith(route(parts.slice(1)))
})

async function route(parts) {
    const [creator, app, ...rest] = parts

    let vfsPath

    if (rest[0] === "sharedAssets") {
        const file = rest.slice(1).join("/") || "index.html"
        vfsPath = `/system/sharedAssets/${file}`
    } else {
        const file = rest.join("/") || "index.html"
        vfsPath = `/system/${creator}/${app}/${file}`
    }
    if (!vfsPath.startsWith(`/system/${creator}/${app}/`) &&
        !vfsPath.startsWith(`/system/sharedAssets/`)) {
        return new Response("Forbidden", { status: 403 })
    }

    const f = await readFile(vfsPath)

    if (!f || f.type !== "file")
        return new Response("Not found", { status: 404 })

    const type = mime(vfsPath)

    if (type === "text/html") {
        const text = f.data instanceof Blob
            ? await f.data.text()
            : String(f.data)

        const injected = text.replace(
            "<head>",
            `<script>
class SWBridge {
    static #id = 0
    static #wait = new Map()

    static call(method,...args){
        return new Promise(res=>{
            const id = ++this.#id
            this.#wait.set(id,res)
            navigator.serviceWorker.controller?.postMessage({
                type:"rpc",
                id,
                method,
                args
            })
        })
    }

    static init(){
        navigator.serviceWorker.addEventListener("message",e=>{
            const d = e.data
            if(d?.type!=="rpc-res") return
            const fn = this.#wait.get(d.id)
            if(fn){
                this.#wait.delete(d.id)
                fn(d.result)
            }
        })
    }
}

SWBridge.init()

const api = new Proxy({}, {
    get(_, prop) {
        return createProxy([prop])
    }
})

function createProxy(path) {
    return new Proxy(() => {}, {
        get(_, prop) {
            return createProxy([...path, prop])
        },
        apply(_, __, args) {
            return SWBridge.call(path.join("."), ...args)
        }
    })
}
</script></head>`
        )

        return new Response(injected, {
            headers: {
                "Content-Type": type,
                "Cross-Origin-Opener-Policy": "same-origin"
            }
        })
    }

    const body = f.data instanceof Blob ? f.data : new Blob([f.data])

    return new Response(body, {
        headers: {
            "Content-Type": type,
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
        txt: "text/plain"
    }[ext] || "application/octet-stream"
}

const rpc = {
    files: {
        read: readFile,
        write: writeFile,
        list
    },
    system: {
        ensureRoot
    }
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