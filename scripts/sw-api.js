const appParams = new Map()
const pendingResponses = new Map()
const liveReloadBases = new Map()

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
            const key = path.replace(/^\/+|\/+$/g, "")
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

function resolveRpc(path) {
    return path.split(".").reduce((o, k) => o?.[k], rpc)
}

async function handleRpcMessage(e) {
    const d = e.data
    if (d?.type !== "rpc") return

    const fn = resolveRpc(d.method)
    let result = null

    try {
        if (fn) result = await fn(...d.args)
        else console.warn(d.method, "is not a valid endpoint")
    } catch (err) {
        console.warn(err)
    }

    e.source.postMessage({ type: "rpc-res", id: d.id, result })
}

async function openFromSW(path, params = {}) {
    const key = path.replace(/^\/+|\/+$/g, "")
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