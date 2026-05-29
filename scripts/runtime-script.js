function createBootTrigger() {
  return `
const __paramsId = new URLSearchParams(location.search).get("paramsId") ?? ""

let __popupResponded = false

if (window.opener) {
    try {
        window.opener = null
    } catch {}
}

window.addEventListener(
    "load",
    () => document.documentElement.classList.add("app-ready")
)
`
}

function createSWBridger() {
  return `
class SWBridge {
    static #id = 0
    static #wait = new Map()
    static #ready = null

    static async init() {
    if (this.#ready) {
        return this.#ready
    }

    this.#ready = (async () => {
        await navigator.serviceWorker.ready

        if (!navigator.serviceWorker.controller) {
            await new Promise(resolve => {
                navigator.serviceWorker.addEventListener(
                    "controllerchange",
                    resolve,
                    { once: true }
                )
            })
        }

        const controller =
            navigator.serviceWorker.controller

        if (!controller) {
            throw new Error(
                "Missing service worker controller"
            )
        }

        const parts = location.pathname
    .split("/")
    .filter(Boolean)

const derivedAppKey =
    window.__APP_KEY__ ||
    (
        parts[0] === "apps" &&
        parts.length >= 3
            ? parts[1] + "/" + parts[2]
            : null
    )

        if (derivedAppKey) {
            await new Promise(resolve => {
                const onMessage = ({ data }) => {
                    if (
                        data?.type ===
                        "register-window-ok"
                    ) {
                        navigator.serviceWorker.removeEventListener(
                            "message",
                            onMessage
                        )

                        resolve()
                    }
                }

                navigator.serviceWorker.addEventListener(
                    "message",
                    onMessage
                )

                controller.postMessage({
                    type: "register-window",
                    appKey: derivedAppKey
                })
            })
        }

        navigator.serviceWorker.addEventListener(
            "message",
            ({ data, source }) => {
                if (data?.type === "rpc-res") {
                    SWBridge.#wait.get(data.id)?.(
                        data.result
                    )

                    SWBridge.#wait.delete(data.id)

                    return
                }

                if (
                    data?.type === "from-sw" &&
                    data.action === "apps.open"
                ) {
                    try {
                        new URL(
                            data.url,
                            location.origin
                        )

                        window.open(
                            data.url,
                            "_blank",
                            "noopener,noreferrer"
                        )
                    } catch {
                        console.error(
                            "Invalid URL from SW:",
                            data.url
                        )
                    }

                    return
                }

                if (data?.type === "sys-dialog") {
                    handleSystemDialog(
                        data,
                        source
                    )
                }
            }
        )
    })()

    return this.#ready
}

    static async call(method, ...args) {
        await this.init()

        return new Promise(async resolve => {
            const id = ++this.#id

            this.#wait.set(id, resolve)

            let controller =
                navigator.serviceWorker.controller

            if (!controller) {
                await navigator.serviceWorker.ready
                controller =
                    navigator.serviceWorker.controller
            }

            controller?.postMessage({
                type: "rpc",
                id,
                method,
                args
            })
        })
    }
}

SWBridge.init()

const rpc = SWBridge.call.bind(SWBridge)
`
}

function createWindowOpenPatcher() {
  return `
const __nativeOpen = window.open

window.open = async (url, target, features) => {
    const finalURL = new URL(url, location.href).href

    if (window.__embedChannel) {
        try {
            await rpc(
                "events.broadcast",
                __embedChannel,
                {
                    type: "window.open",
                    url: finalURL,
                    target: target || "_blank",
                    features: features || ""
                }
            )

            return null
        } catch (err) {
            console.error(
                "Embedded window.open dispatch failed",
                err
            )

            return null
        }
    }

    return __nativeOpen.call(
        window,
        finalURL,
        target || "_blank",
        features
            ? features + ",noopener,noreferrer"
            : "noopener,noreferrer"
    )
}
`
}

function createPopupManagerSystem() {
  return `
class PopupManager {
    static async open(path, params, mode) {
        const result = await rpc(
            "apps.open",
            path,
            params,
            mode
        )

        if (typeof result === "string") {
            window.open(
                result,
                "_blank",
                "noopener,noreferrer"
            )

            return null
        }

        const sw = window.screen

        const maxW = sw.availWidth * 0.8
        const maxH = sw.availHeight * 0.8

        let w = maxW
        let h = w * (6 / 9)

        if (h > maxH) {
            h = maxH
            w = h * (9 / 6)
        }

        h = Math.min(h, maxH)
        w = Math.min(w, maxW)

        const left = Math.max(
            0,
            (sw.availWidth - w) / 2
        )

        const top = Math.max(
            0,
            (sw.availHeight - h) / 2
        )

        const popup = __nativeOpen.call(
            window,
            result.url,
            "_blank",
            \`popup=yes,width=\${Math.floor(w)},height=\${Math.floor(h)},left=\${Math.floor(left)},top=\${Math.floor(top)}\`
        )

        if (!popup) {
            await rpc(
                "apps.notifyPopupClosed",
                result.responseId
            )

            return null
        }

        const pollClose = setInterval(async () => {
            if (popup.closed) {
                clearInterval(pollClose)

                await rpc(
                    "apps.notifyPopupClosed",
                    result.responseId
                )
            }
        }, 500)

        const value = await rpc(
            "apps.waitForResponse",
            result.responseId
        )

        clearInterval(pollClose)

        return value
    }

    static async respond(value) {
        const params = await rpc(
            "apps.getParams",
            __paramsId
        )

        if (!params?.__responseId) {
            return
        }

        __popupResponded = true

        await rpc(
            "apps.respond",
            params.__responseId,
            value
        )

        await new Promise(resolve => setTimeout(resolve, 50))

        window.close()
    }
}
`
}

function createEventsAPI() {
  return `
function createEventsAPI() {
    return {
        async register(channelKey) {
            return rpc(
                "events.register",
                channelKey ?? null
            )
        },

        async listen(channelKey, callback) {
            await rpc(
                "events.subscribe",
                channelKey
            )

            if (!window.__channelListeners) {
                window.__channelListeners = new Map()

                navigator.serviceWorker.addEventListener(
                    "message",
                    ({ data }) => {
                        if (data?.type !== "channel-event") {
                            return
                        }

                        const fns =
                            window.__channelListeners.get(
                                data.channelKey
                            )

                        if (fns) {
                            fns.forEach(fn =>
                                fn(data.data, data.from)
                            )
                        }
                    }
                )
            }

            if (
                !window.__channelListeners.has(channelKey)
            ) {
                window.__channelListeners.set(
                    channelKey,
                    new Set()
                )
            }

            window.__channelListeners
                .get(channelKey)
                .add(callback)

            return () => {
                const set =
                    window.__channelListeners.get(
                        channelKey
                    )

                if (!set) {
                    return
                }

                set.delete(callback)

                if (set.size === 0) {
                    window.__channelListeners.delete(
                        channelKey
                    )

                    rpc(
                        "events.unsubscribe",
                        channelKey
                    )
                }
            }
        },

        async broadcast(channelKey, data) {
            return rpc(
                "events.broadcast",
                channelKey,
                data
            )
        }
    }
}
`
}

function createProxySystem() {
  return `
const proxyCache = new Map()

function createProxy(path) {
    let proxy = proxyCache.get(path)

    if (proxy) {
        return proxy
    }

    proxy = new Proxy(
        () => {},
        {
            get(_, prop) {
                return createProxy(
                    path + "." + prop
                )
            },

            apply(_, __, args) {
                return rpc(path, ...args)
            }
        }
    )

    proxyCache.set(path, proxy)

    return proxy
}
`
}

function createClientAPIProxy() {
  return `
const appsAPI = {
    open: PopupManager.open,
    respond: PopupManager.respond
}

const eventsAPI = createEventsAPI()

window.api = new Proxy(
    {
        apps: appsAPI,
        events: eventsAPI
    },
    {
        get(target, prop) {
            if (prop === "params") {
                if (!window.__appParamsCache) {
                    window.__appParamsCache = rpc(
                        "apps.getParams",
                        __paramsId
                    )
                }

                return window.__appParamsCache
            }

            if (prop in target) {
                return target[prop]
            }

            return createProxy(prop)
        }
    }
)
`
}

function createLifecycleCode() {
  return `
window.addEventListener(
    "pagehide",
    async () => {
        if (__popupResponded) {
            return
        }

        try {
            const params = await rpc(
                "apps.getParams",
                __paramsId
            )

            if (params?.__responseId) {
                await rpc(
                    "apps.notifyPopupClosed",
                    params.__responseId
                )
            }
        } catch {}
    }
)
`
}

function createDialogHandlerCode() {
  return `
function handleSystemDialog(
    {
        dialogType,
        message,
        defaultValue,
        id
    },
    source
) {
    const reply = payload => {
        const channel =
            source ||
            navigator.serviceWorker.controller

        channel?.postMessage(payload)
    }

    switch (dialogType) {
        case "alert":
            alert(message)
            break

        case "confirm":
            reply({
                type: "dialog-response",
                id,
                value: confirm(message)
            })
            break

        case "prompt":
            reply({
                type: "dialog-response",
                id,
                value: prompt(
                    message,
                    defaultValue ?? ""
                )
            })
            break
    }
}
`
}

function buildRuntimeScript() {
  return [
    createBootTrigger(),
    createSWBridger(),
    createWindowOpenPatcher(),
    createPopupManagerSystem(),
    createEventsAPI(),
    createProxySystem(),
    createClientAPIProxy(),
    createLifecycleCode(),
    createDialogHandlerCode()
  ].join("\n")
}

export {
  buildRuntimeScript
}