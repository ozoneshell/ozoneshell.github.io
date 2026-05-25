
import { ensureRoot, readFile, writeFile, list, exists, mkdir, mkdirp, remove, move, copy, streamFile, parentOf, norm } from "/scripts/vfs.js"
import { mimeFromPath, openFile, settings, appStorage } from "/scripts/utility.js"
import { appParams, pendingResponses, liveReloadBases, getWindowEntry, isNamespaceAllowed } from "./sw-registry.js"
import { sysDialog, pendingDialogs } from "./utility.js"

export { appParams, pendingResponses, liveReloadBases }

var appsRPCHandler = {
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

        entry.settled = true
        entry.value = null

        if (entry.resolve) {
            entry.resolve(null)
        }

        pendingResponses.delete(responseId)
    }
}

// events
const channels = new Map()
const channelOwners = new Map()

export const rpc = {
    fileGet: {
        read: readFile,
        stream: streamFile,
    },
    fileSet: {
        write: writeFile,
        mkdir,
        mkdirp,
        remove,
        move,
        copy
    },
    fileUtil: {
        list,
        exists,
        open: openFile
    },
    utility: {
        getMime: mimeFromPath,
        getNamespaces: () => {
            return Object.keys(rpc);
        },
        norm,
        sysDialog
    },
    system: {
        ensureRoot,
        parentOf
    },
    apps: appsRPCHandler,
    settings,
    events: {
        register(channelKey, { appKey } = {}) {
            const key = channelKey || crypto.randomUUID()
            if (!channels.has(key)) {
                channels.set(key, new Set())
                channelOwners.set(key, appKey)
            }
            return key
        },

        subscribe(channelKey, { clientId } = {}) {
            if (!channels.has(channelKey)) return { ok: false, error: "unknown channel" }
            channels.get(channelKey).add(clientId)
            return { ok: true }
        },

        unsubscribe(channelKey, { clientId } = {}) {
            channels.get(channelKey)?.delete(clientId)
            return { ok: true }
        },

        async broadcast(channelKey, data, { appKey } = {}) {
            const subs = channels.get(channelKey)
            if (!subs) return { ok: false, error: "unknown channel" }

            const clientsList = await self.clients.matchAll({ type: "window", includeUncontrolled: true })
            const clientMap = new Map(clientsList.map(c => [c.id, c]))

            let sent = 0
            for (const clientId of subs) {
                const client = clientMap.get(clientId)
                if (!client) {
                    subs.delete(clientId)
                    continue
                }
                client.postMessage({ type: "channel-event", channelKey, data, from: appKey })
                sent++
            }
            return { ok: true, sent }
        },
    },
    appStorage,
    appEmbed: {
        // create appembed
        // distroy appembed
    },
    store: {
        async installFromURL(appURL) {
            try {
                const res = await fetch(`${appURL}/manifest.json`)

                if (!res.ok) {
                    return {
                        ok: false,
                        error: `manifest fetch failed: ${res.status}`
                    }
                }

                const data = await res.json()
                const base = `/system/apps/${data.author}/${data.name}`
                const sources = data.sources || []
                const files = {}

                await Promise.all(
                    sources.map(async file => {
                        try {
                            const r = await fetch(`${appURL}/${file}`)
                            if (!r.ok) {
                                console.warn(`missing file: ${file}`)
                                return
                            }
                            files[file] = await r.blob()
                        } catch (err) {
                            console.warn(`failed fetching ${file}`, err)
                        }
                    })
                )

                if (data.landing) {
                    try {
                        const r = await fetch(`${appURL}/${data.landing}`)
                        if (r.ok) {
                            files["index.html"] = await r.blob()
                        } else {
                            console.warn(`landing file missing: ${data.landing}`)
                        }
                    } catch (err) {
                        console.warn(`failed fetching landing file`, err)
                    }
                }

                files["manifest.json"] = new Blob(
                    [JSON.stringify(data, null, 2)],
                    { type: "application/json" }
                )

                const path = await rpc.store.install(base, files, data)
                return { ok: true, path }
            } catch (err) {
                console.error(err)
                return { ok: false, error: err.message }
            }
        },

        async install(base, files, metadata = null) {
            const parts = base.replace(/^\/+|\/+$/g, "").split("/")
            const author = parts.at(-2)
            const name = parts.at(-1)

            if (!author || !name) {
                throw new Error("invalid install path")
            }

            if (metadata) {
                await settings.set(
                    `${author}/${name}`,
                    { icon: metadata.icon, permissions: metadata.permissions },
                    "appRegistry.json"
                )

                if (metadata.capabilities) {
                    const FileBindings = (await settings.get("FileBindings")) ?? {}
                    const key = `${author}/${name}`
                    for (const ext of metadata.capabilities) {
                        FileBindings[ext] = [
                            ...new Set([...(FileBindings[ext] ?? []), key])
                        ]
                    }
                    await settings.set("FileBindings", FileBindings)
                }
            }

            await Promise.all(
                Object.entries(files).map(([file, blob]) =>
                    writeFile(`${base}/${file}`, blob)
                )
            )

            return base
        },

        async isInstalled(tag) {
            return await exists("system/apps/" + tag);
        },
    }
}

export function resolveRpc(path) {
    return path.split(".").reduce((o, k) => o?.[k], rpc)
}

export async function handleRpcMessage(e) {
    const d = e.data
    if (d?.type === "dialog-response") {
        const resolve = pendingDialogs.get(d.id)
        if (resolve) {
            pendingDialogs.delete(d.id)
            resolve(d.value)
        }
        return
    }

    if (d?.type !== "rpc") return

    const clientId = e.source?.id ?? null
    const entry = clientId ? getWindowEntry(clientId) : null
    const appKey = entry?.appKey ?? null

    if (!appKey) {
        console.warn("[SW] RPC rejected: missing appKey")
        e.source?.postMessage({
            type: "rpc-res",
            id: d.id,
            result: null,
            blocked: true
        })
        return
    }

    const namespace = d.method.split(".")[0]
    if (!await isNamespaceAllowed(appKey, namespace, clientId)) {
        console.warn(`[SW] RPC blocked: ${appKey ?? "unregistered"} → ${d.method}`)
        e.source.postMessage({ type: "rpc-res", id: d.id, result: null, blocked: true })
        return
    }

    const fn = resolveRpc(d.method)
    let result = null

    try {
        if (fn) {
            result = await fn(...d.args, {
                appKey,
                clientId,
                method: d.method
            })
        } else console.warn(d.method, "is not a valid endpoint")
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