function mimeFromPath(path) {
    const i = path.lastIndexOf(".")
    if (i < 0) return "application/octet-stream"
    return state.mimedb[path.slice(i + 1)] || "application/octet-stream"
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
    if (!path) return "/system/settings/general.json"
    if (path.startsWith("/system/settings/")) return path
    if (path.startsWith("system/settings/")) return "/" + path
    return "/system/settings/" + path.replace(/^\//, "")
}

async function readJSON(path) {
    path = resolvePath(path)
    if (!(await exists(path))) return {}
    var file = await readFile(path)
    return JSON.parse(file.data || "{}")
}

async function writeJSON(path, data) {
    path = resolvePath(path)
    var parts = path.split("/")
    parts.pop()
    var dir = parts.join("/")
    if (!(await exists(dir))) await mkdirp(dir)
    await writeFile(path, JSON.stringify(data, null, 2))
}

var settings = {
    set: async function (key, value, path) {
        var file = resolvePath(path)
        var data = await readJSON(file)
        data[key] = value
        await writeJSON(file, data)
    },
    get: async function (key, path) {
        var file = resolvePath(path)
        var data = await readJSON(file)
        return data[key]
    },
    rem: async function (key, path) {
        var file = resolvePath(path)
        var data = await readJSON(file)
        delete data[key]
        await writeJSON(file, data)
    }
}