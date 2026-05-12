import { rpc } from "./sw-api.js"

export const windowRegistry = new Map()

export const appParams = new Map()
export const pendingResponses = new Map()
export const liveReloadBases = new Map()

export function registerWindow(clientId, appKey, paramsId = null) {
    windowRegistry.set(clientId, { appKey, paramsId, registeredAt: Date.now() })
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

export async function isNamespaceAllowed(appKey, namespace) {
    let registryItem = await rpc.settings.get(appKey, "appRegistry.json")
    if (registryItem.permissions.includes(namespace)) {
        return true;
    }
    return namespace == "apps" ?? false
}

export function debugRegistry() {
    return {
        windows: [...windowRegistry.entries()],
        params: [...appParams.keys()],
        pendingResponses: [...pendingResponses.keys()],
        liveReloadBases: [...liveReloadBases.entries()],
    }
}