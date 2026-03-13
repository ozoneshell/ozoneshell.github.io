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

const api = new Proxy({},{
    get(_,prop){
        return (...args)=>SWBridge.call(prop,...args)
    }
})
</script></head>`
        )

        return new Response(injected, {
            headers: { "Content-Type": type }
        })
    }

    const body = f.data instanceof Blob ? f.data : new Blob([f.data])

    return new Response(body, {
        headers: { "Content-Type": type }
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
    readFile,
    writeFile,
    list,
    ensureRoot
}

self.addEventListener("message", async e => {
    const d = e.data
    if (d?.type !== "rpc") return

    const fn = rpc[d.method]
    let result = null

    if (fn) result = await fn(...d.args)

    e.source.postMessage({
        type: "rpc-res",
        id: d.id,
        result
    })
})