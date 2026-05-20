import { readFile, writeFile, list, exists, mkdirp, parentOf } from "/scripts/vfs.js"
import { openFromSW } from "/scripts/sw-api.js"

function mimeFromPath(path) {
    const MIME_MAP = {
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
    }
    const i = path.lastIndexOf(".")
    if (i < 0) return "application/octet-stream"
    return MIME_MAP[path.slice(i + 1)] || "application/octet-stream"
}

function getExtension(s) {
    let start = -1;

    for (let i = s.length - 1; i >= 0; i--) {
        if (s[i] === '.') {
            start = i + 1;
            break;
        }
    }

    if (start === -1)
        return '';

    let res = '';

    for (let i = start; i < s.length; i++) {
        let c = s.charCodeAt(i);
        if (c >= 65 && c <= 90)
            c += 32;
        res += String.fromCharCode(c);
    }

    return res;
}
function resolvePath(path) {
    if (typeof path !== "string") {
        return "/system/settings/general.json"
    }

    if (!path) return "/system/settings/general.json"

    if (path.startsWith("/system/settings/")) return path
    if (path.startsWith("system/settings/")) return "/" + path

    return "/system/settings/" + path.replace(/^\//, "")
}

async function readJSON(path) {
    path = resolvePath(path)

    if (!(await exists(path))) return {}

    const file = await readFile(path)

    if (!file?.data) return {}

    const text = new TextDecoder().decode(file.data)

    return JSON.parse(text || "{}")
}

async function writeJSON(path, data) {
    path = resolvePath(path)

    const dirPath = parentOf(path)

    if (dirPath) {
        await mkdirp(dirPath)
    }

    await writeFile(path, JSON.stringify(data, null, 2))
}

var settings = {
    set: async function (key, value, path = "general.json") {
        var file = resolvePath(path)
        var data = await readJSON(file)

        data[key] = value

        await writeJSON(file, data)
    },

    get: async function (key, path = "general.json") {
        var file = resolvePath(path)
        var data = await readJSON(file)

        return key === "all" ? data : data[key]
    },

    rem: async function (key, path = "general.json") {
        var file = resolvePath(path)
        var data = await readJSON(file)

        delete data[key]

        await writeJSON(file, data)
    }
}

function resolveAppStoragePath(tag) {
    if (!tag?.appKey) {
        throw new Error("Missing appKey in tag")
    }

    return `/system/apps/${tag.appKey}/appStorage.json`
}

var appStorage = {
    set: async function (key, value, tag) {
        const path = resolveAppStoragePath(tag)
        const data = await readJSON(path)

        data[key] = value

        await writeJSON(path, data)
    },

    get: async function (key, tag) {
        const path = resolveAppStoragePath(tag)
        const data = await readJSON(path)

        return key === "all" ? data : data[key]
    },

    rem: async function (key, tag) {
        const path = resolveAppStoragePath(tag)
        const data = await readJSON(path)

        delete data[key]

        await writeJSON(path, data)
    }
}

let dialogId = 0
const pendingDialogs = new Map()

async function openFile(path) {
    const fileExt = getExtension(path);
    let appTag = (await settings.get("FileBindings"))?.[fileExt]?.[0];
    if (appTag) {
        openFromSW(appTag, { "file": path })
    } else {
        await sysDialog({
            message: `No installed application can handle '.${fileExt}' files. Please install an app that supports it from the app store.`
        })
    }
}

async function sysDialog({ message = "", type = "alert", defaultValue = "" }) {
    const clientsList = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true
    })

    const target = clientsList.find(c => c.focused) ?? clientsList[0]
    if (!target) return null

    if (type === "alert") {
        target.postMessage({
            type: "sys-dialog",
            dialogType: type,
            message,
            defaultValue
        })
        return
    }

    return new Promise(resolve => {
        const id = ++dialogId
        pendingDialogs.set(id, resolve)

        target.postMessage({
            type: "sys-dialog",
            id,
            dialogType: type,
            message,
            defaultValue
        })
    })
}

export {
    mimeFromPath,
    getExtension,
    resolvePath,
    readJSON,
    writeJSON,
    settings,
    openFile,
    sysDialog,
    appStorage,
    pendingDialogs
}