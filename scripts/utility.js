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