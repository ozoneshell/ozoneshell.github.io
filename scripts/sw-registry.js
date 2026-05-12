export const windowRegistry = new Map()

export const appParams = new Map()
export const pendingResponses = new Map()
export const liveReloadBases = new Map()

export const APP_PERMISSIONS = {
    "*": new Set(["utility", "apps", "fileGet", "fileSet", "fileUtil", "settings", "store"]),
    "ozone/Files": new Set(["utility", "apps", "fileGet", "fileSet", "fileUtil", "settings"]),
    "system/launcher": new Set(["utility", "apps", "fileGet", "fileUtil", "settings"])
}

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

export function isNamespaceAllowed(appKey, namespace) {
    const specific = APP_PERMISSIONS[appKey]
    if (specific?.has(namespace)) return true
    return APP_PERMISSIONS["*"]?.has(namespace) ?? false
}

export function debugRegistry() {
    return {
        windows: [...windowRegistry.entries()],
        params: [...appParams.keys()],
        pendingResponses: [...pendingResponses.keys()],
        liveReloadBases: [...liveReloadBases.entries()],
    }
}