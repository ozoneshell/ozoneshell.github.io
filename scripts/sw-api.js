
import { ensureRoot, readFile, writeFile, list, exists, mkdir, mkdirp, remove, streamFile, parentOf, norm } from "/scripts/vfs.js"
import { mimeFromPath, openFile, settings } from "/scripts/utility.js"

export const appParams = new Map()
export const pendingResponses = new Map()
export const liveReloadBases = new Map()

export const rpc = {
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
        getMime: mimeFromPath
    },
    system: {
        ensureRoot,
        parentOf,
        norm
    },

    apps: {
        async open(path, params = {}, mode) {
            const key = path.replace(/^\/+|\/+$/g, "")
            const hasParams = Object.keys(params).length > 0 || mode === "popup"
            const paramsId = hasParams ? crypto.randomUUID() : null
            const url = `/apps/${key}/${paramsId ? `?paramsId=${paramsId}` : ""}`

            if (paramsId) {
                const storedParams = mode === "popup"
                    ? { ...params, __responseId: crypto.randomUUID() }
                    : { ...params }

                appParams.set(paramsId, storedParams)

                if (mode === "popup") {
                    pendingResponses.set(storedParams.__responseId, {
                        resolve: null,
                        settled: false,
                        value: undefined
                    })
                    return { url, responseId: storedParams.__responseId, popup: true }
                }
            }

            return url
        },

        getParams(paramsId) {
            if (!paramsId) return {}
            return appParams.get(paramsId) || {}
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

export function resolveRpc(path) {
    return path.split(".").reduce((o, k) => o?.[k], rpc)
}

export async function handleRpcMessage(e) {
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

export async function openFromSW(path, params = {}) {
    const key = path.replace(/^\/+|\/+$/g, "")
    const hasParams = Object.keys(params).length > 0
    const paramsId = hasParams ? crypto.randomUUID() : null

    if (paramsId) appParams.set(paramsId, { ...params })

    const url = `/apps/${key}/${paramsId ? `?paramsId=${paramsId}` : ""}`

    const clientsList = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true
    })

    const target = clientsList.find(c => c.focused) ?? clientsList[0]
    if (target) {
        target.postMessage({ type: "from-sw", action: "apps.open", url })
    }

    return url
}