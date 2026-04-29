var state = {
    "mode": "browser"
}

async function buildTree(dir) {
    const entries = await api.files.list(dir)

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
        name: (node.name == "/") ? "Home" : node.name,
        path: node.path,
        type: node.type,
        children: (node.children || []).map(normalize)
    }
}
function render(node, parent, depth = 0) {
    const el = document.createElement("div")
    el.className = "tree-node"
    const subel = document.createElement("div");
    subel.className = "subel";
    subel.innerText = node.name;
    el.appendChild(subel);
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

    const sessionDeterminer = (await api.params)?.type;
    if (sessionDeterminer == "file_selector") {
        state.mode = sessionDeterminer;
    } else if (sessionDeterminer == "folder_selector") {
        state.mode = sessionDeterminer;
    }

    renderFiles("/");

    const btns = document.querySelectorAll('[data-openbarpage]')
    const pages = document.querySelectorAll('.menu_bar .page')

    btns.forEach(btn => {
        pages.forEach(p => p.style.display = 'none')
        btn.addEventListener('click', () => {
            const id = btn.dataset.openbarpage

            pages.forEach(p => p.style.display = 'none')
            btns.forEach(b => b.classList.remove('active'))

            const page = document.querySelector(`.menu_bar .page[data-barpageid="${id}"]`)
            if (page) page.style.display = 'flex'

            btn.classList.add('active')
        })
    });
    openTopBarPage("folder");
})

function openTopBarPage(pageId) {
    const btns = document.querySelectorAll('[data-openbarpage]')
    const pages = document.querySelectorAll('.menu_bar .page')

    pages.forEach(p => p.style.display = 'none')
    btns.forEach(b => b.classList.remove('active'))

    const page = document.querySelector(`.menu_bar .page[data-barpageid="${pageId}"]`)
    if (page) page.style.display = 'flex'

    const btn = document.querySelector(`[data-openbarpage="${pageId}"]`)
    if (btn) btn.classList.add('active')
}

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
    "mp3": "music_note",
    "mp4": "video_file",
    "mpeg": "video_file",
    "webm": "video_file",
    "mkv": "video_file"
}

function getExtension(name) {
    const i = name.lastIndexOf(".")
    return i > 0 ? name.slice(i + 1).toLowerCase() : ""
}

class FileItem {
    constructor(item, container) {
        this.item = item
        this.el = document.createElement("div")
        this.el.className = "singular_file"

        const fileName = item.path.split("/").pop()

        const icon = document.createElement("div")
        icon.className = "icon"
        icon.textContent = item.type === "folder" ? "folder" : "description"

        if (item.type === "file") {
            const ext = getExtension(fileName)
            if (fileTypeIcons[ext]) icon.textContent = fileTypeIcons[ext]
        }

        const name = document.createElement("div")
        name.className = "fileName"
        name.textContent = fileName

        this.el.append(icon, name)
        container.appendChild(this.el)

        this.el.addEventListener("click", e => this.handleClick(e))
    }

    handleClick() {
        if (this.el.classList.contains("selected")) {
            this.open()
            return
        }
        if (this.item.type == "file") {
            openTopBarPage("file");
        } else {
            openTopBarPage("folder");
        }

        document.querySelectorAll(".singular_file.selected")
            .forEach(e => e.classList.remove("selected"))

        this.el.classList.add("selected")
    }

    open() {
        if (this.item.type === "folder") renderFiles(this.item.path)
        else {
            if (state.mode == "file_selector") {
                api.apps.respond(this.item.path)
            } else {
                api.files.open(this.item.path)
            }
        }
    }
}

async function renderFiles(path) {
    const container = document.querySelector("#filesList")
    container.innerHTML = ""

    const items = await api.files.list(path)

    for (const item of items) {
        new FileItem(item, container)
    }
    openTopBarPage("folder");
}
const input = document.getElementById("filePicker")

function importFiles() {
    input.click()
}
input.addEventListener("change", async e => {
    for (const file of e.target.files) {
        const content = await file.arrayBuffer()
        await api.files.write(`downloads/${file.name}`, content)
    }
})

document.addEventListener("click", e => {
    const el = e.target.closest(".menu_action")
    if (!el) return
    const fn = actionMap[el.dataset.action]
    if (fn) fn(el)
})

const actionMap = {
    go_parent: () => navigateToParent(),
    rename_folder: () => renameFolder(),
    delete_folder: () => deleteFolder(),

    open_file: () => openFile(),
    open_with: () => openWith(),
    export_file: () => exportFile(),
    rename_file: () => renameFile(),
    delete_file: () => deleteFile(),

    import_file: () => importFiles(),
    import_folder: () => importFolder()
}
