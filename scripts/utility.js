function mimeFromPath(path) {
    const i = path.lastIndexOf(".")
    if (i < 0) return "application/octet-stream"
    return state.mimedb[path.slice(i + 1)] || "application/octet-stream"
}