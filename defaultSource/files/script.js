var state = {
    mode: "browser",
    currentView: "grid",
    path: "downloads",

    get chosen_path() {
        const el = document.querySelector(".selected");
        if (el && el.dataset.path) {
            return el.dataset.path;
        }
        return this.path;
    }
};

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
    const wrapper = document.createElement("div")
    wrapper.className = "tree-node"
    wrapper.style.setProperty("--depth", depth)

    wrapper.dataset.path = node.path

    const header = document.createElement("div")
    header.className = "subel"
    header.innerText = node.name

    const childrenContainer = document.createElement("div")
    childrenContainer.className = "children"

    wrapper.appendChild(header)
    wrapper.appendChild(childrenContainer)
    parent.appendChild(wrapper)

    if (node.children?.length) {
        wrapper.classList.add("has-children")

        header.addEventListener("click", () => {
            wrapper.classList.toggle("collapsed")
        })

        for (const c of node.children) {
            render(c, childrenContainer, depth + 1)
        }
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
        document.title = "Choose files - Files"
    } else if (sessionDeterminer == "folder_selector") {
        state.mode = sessionDeterminer;
    }

    renderFiles();

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

    (() => {
        const container = document.getElementById('path_input');
        const input = document.getElementById('path_input_element');

        let originalPath = input.value;

        function setActive(state) {
            container.classList.toggle('input_active', state);
        }

        container.addEventListener('click', () => {
            input.focus();
        });

        input.addEventListener('focus', () => {
            originalPath = input.value;
            setActive(true);
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const newPath = input.value.trim();

                try {
                    renderFiles(newPath);
                    originalPath = newPath;
                    input.blur();
                } catch {
                    input.value = originalPath;
                    input.blur();
                }
            }
        });

        input.addEventListener('blur', () => {
            if (input.value.trim() !== originalPath) {
                input.value = originalPath;
            }
            setActive(false);
        });
    })();
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
    "tiff": "image",
    "bmp": "image",
    "jpg": "image",
    "gif": "image",
    "mp3": "music_note",
    "flac": "music_note",
    "opus": "music_note",
    "midi": "music_note",
    "aac": "music_note",
    "m4a": "music_note",
    "ogg": "music_note",
    "wav": "music_note",
    "mp4": "video_file",
    "mpeg": "video_file",
    "webm": "video_file",
    "mov": "video_file",
    "avi": "video_file",
    "wmv": "video_file",
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
        this.el.dataset.path = item.path;

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

async function renderFiles(path = state.path) {
    const container = document.querySelector("#filesList")
    container.innerHTML = ""
    state.path = path;

    const items = await api.files.list(path)

    for (const item of items) {
        new FileItem(item, container)
    }
    container.dataset.view = state.currentView
    document.querySelector("#path_input_element").value = path
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
    go_parent: () => {
        const parts = state.path.split('/').filter(Boolean);
        state.path = parts.slice(0, -1).join('/');
        renderFiles();
    },
    delete_folder: async () => {
        await api.files.remove(state.chosen_path)
        renderFiles();
        render();
    },

    open_file: () => {
        api.files.open(state.chosen_path)
    },
    delete_file: async () => {
        await api.files.remove(state.chosen_path)
        renderFiles();
    },

    import_file: () => importFiles(),
    import_folder: () => importFolder(),

    grid_view: () => setView("grid"),
    list_view: () => setView("list"),
    column_view: () => setView("column"),

    // to be implemented
    rename_folder: () => { },
    open_with: () => openWith(),
    export_file: () => exportFile(),
    rename_file: () => renameFile(),
}

function setView(view) {
    state.currentView = view
    const container = document.querySelector("#filesList")
    if (container) container.dataset.view = view

    document.querySelectorAll('[data-barpageid="view"] .menu_action').forEach(el => {
        el.classList.toggle("active", el.dataset.action === `${view}_view`)
    })
}