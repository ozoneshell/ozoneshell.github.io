async function buildTree(dir) {
    const entries = await api.list(dir)

    const node = {
        name: dir.split("/").filter(Boolean).pop() || dir,
        path: dir,
        type: "folder",
        children: []
    }

    const folders = entries.filter(e => e.type === "folder")

    const children = await Promise.all(
        folders.map(e => buildTree(e.path))
    )

    node.children = children
    return node
}
function normalize(node) {
    return {
        name: node.name,
        path: node.path,
        type: node.type,
        children: (node.children || []).map(normalize)
    }
}
function render(node, parent, depth = 0) {
    const el = document.createElement("div")
    el.className = "tree-node"
    el.textContent = node.name
    el.dataset.path = node.path
    el.style.setProperty("--depth", depth)
    parent.appendChild(el)

    if (node.children?.length) {
        for (const c of node.children) render(c, parent, depth + 1)
    }
}
document.addEventListener("DOMContentLoaded", async () => {
    const raw = await buildTree("/")
    const tree = normalize(raw)

    const container = document.querySelector("#filesystemTree")
    render(tree, container)

    container.addEventListener("click", e => {
        const el = e.target.closest("[data-path]")
        if (!el) return
        renderFiles(el.dataset.path)
    })
})

var fileTypeIcons = {
    "json": "data_object",
    "html": "code",
    "md": "developer_guide",
    "js": "terminal",
    "css": "imagesearch_roller",
    "png": "image",
    "jpeg": "image",
    "webp": "image",
    "jpg": "image",
    "mp3": "music",
    "mp4": "video",
    "mpeg": "video",
    "webm": "video",
    "mkv": "video"
}

function getExtension(name) {
    const i = name.lastIndexOf(".")
    return i > 0 ? name.slice(i + 1).toLowerCase() : ""
}

async function renderFiles(path) {
    console.log("renderfiles", path)
    const container = document.querySelector("#filesList")
    container.innerHTML = "";

    const items = await api.list(path)

    for (const item of items) {
        const el = document.createElement("div")
        el.className = "singular_file"

        let fileName = item.path.split("/").pop();

        const icon = document.createElement("div")
        icon.className = "icon"
        icon.textContent = item.type === "folder" ? "folder" : "description"
        if (item.type === "file") {
            let extension = getExtension(fileName);
            if (Object.keys(fileTypeIcons).includes(extension)) {
                icon.textContent = fileTypeIcons[extension];
            }
        }

        const name = document.createElement("div")
        name.className = "fileName"
        name.textContent = fileName

        el.append(icon, name)
        container.appendChild(el)
    }
}