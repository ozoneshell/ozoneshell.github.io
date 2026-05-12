import { rpc } from "./sw-api.js"

export const windowRegistry = new Map()

export const appParams = new Map()
export const pendingResponses = new Map()
export const liveReloadBases = new Map()

export function registerWindow(clientId, appKey, paramsId = null, permissions = []) {
    windowRegistry.set(clientId, { appKey, paramsId, permissions, registeredAt: Date.now() })
}

export function unregisterWindow(clientId) {
    windowRegistry.delete(clientId)
}

export function getWindowEntry(clientId) {
    return windowRegistry.get(clientId) ?? null
}

export function getAppKeyForClient(clientId) {
    return windowRegistry.get(clientId)?.appKey ?? null
}

export async function isNamespaceAllowed(appKey, namespace, clientId = null) {
    if (namespace === "apps") return true

    if (clientId) {
        const entry = windowRegistry.get(clientId)
        if (entry?.permissions) {
            return entry.permissions.includes(namespace)
        }
    }

    const registryItem = await rpc.settings.get(appKey, "appRegistry.json")
    return registryItem?.permissions?.includes(namespace) ?? false
}

export function debugRegistry() {
    return {
        windows: [...windowRegistry.entries()],
        params: [...appParams.keys()],
        pendingResponses: [...pendingResponses.keys()],
        liveReloadBases: [...liveReloadBases.entries()],
    }
}