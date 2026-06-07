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
    const entries = await api.fileUtil.list(dir)

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
    wrapper.dataset.context = "tree";

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

        header.addEventListener("click", (e) => {
            const rect = header.getBoundingClientRect()

            const clickX = e.clientX - rect.left

            if (clickX <= 40) {
                wrapper.classList.toggle("collapsed")
            }
        })

        for (const c of node.children) {
            render(c, childrenContainer, depth + 1)
        }
    }
}
function resolveDirIcon(path) {
    switch (path) {
        case "/":
            return "home";
        default:
            return "folder";
    }
}
async function renderPinned() {
    const pinnedDirs = await api.appStorage.get("pinnedDirs");
    if (!pinnedDirs) return;
    const container = document.querySelector("#pinnedFolders")
    pinnedDirs.forEach(item => {
        const element = document.createElement("div");
        element.classList.add("single_dir");
        element.dataset.path = item;
        element.dataset.context = "folder";

        const icondiv = document.createElement("div");
        icondiv.classList.add("icon");
        icondiv.innerText = resolveDirIcon(item);

        const namediv = document.createElement("div");
        namediv.classList.add("name");
        namediv.innerText = item;

        element.append(icondiv, namediv);
        container.appendChild(element);
    });
}
async function loadFoldersBar() {
    const raw = await buildTree("/")
    const tree = normalize(raw)

    const container = document.querySelector("#filesystemTree");
    container.innerHTML = "";
    render(tree, container)

    renderPinned();
    const containerwhole = document.querySelector(".sidebar");
    containerwhole.addEventListener("click", e => {
        const el = e.target.closest("[data-path]")
        if (!el) return
        renderFiles(el.dataset.path)
    })

}
document.addEventListener("DOMContentLoaded", async () => {
    loadFoldersBar();

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
        this.item = item;
        this.el = document.createElement("div");
        this.el.className = "singular_file";
        this.el.dataset.path = item.path;
        this.el.dataset.context = item.type === "folder" ? "folder" : "file";

        const fileName = item.path.split("/").pop();

        const icon = document.createElement("div");
        icon.className = "icon";
        icon.textContent = item.type === "folder" ? "folder" : "description";

        const ext = getExtension(fileName);
        if (item.type === "file" && fileTypeIcons[ext]) {
            icon.textContent = fileTypeIcons[ext];
        }

        const name = document.createElement("div");
        name.className = "fileName";
        name.textContent = fileName;

        this.el.append(icon, name);
        container.appendChild(this.el);

        this.el.addEventListener("click", e => this.handleClick());
    }

    handleClick() {
        document.querySelectorAll(".singular_file.selected")
            .forEach(e => e.classList.remove("selected"));

        this.el.classList.add("selected");

        this.open();
    }

    open() {
        if (this.item.type === "folder") {
            renderFiles(this.item.path);
        } else {
            if (state.mode === "file_selector") {
                api.apps.respond(this.item.path);
            } else {
                api.fileUtil.open(this.item.path);
            }
        }
    }
}

async function renderFiles(path = state.path) {
    [...document.querySelectorAll(`.active`)].forEach(element => element.classList.remove("active"));
    const btnsMatching = document.querySelectorAll(`[data-path='${path}']`);
    [...btnsMatching].forEach(element => {
        element.classList.add("active");
    })
    const container = document.querySelector("#filesList")
    container.innerHTML = ""
    state.path = path;

    const items = await api.fileUtil.list(path)

    for (const item of items) {
        new FileItem(item, container)
    }
    container.dataset.view = state.currentView
    document.querySelector("#path_input_element").value = path
    openTopBarPage("folder");
}
const fileInput = document.getElementById("filePicker")
const folderInput = document.getElementById("folderPicker")

function importFiles() {
    fileInput.click()
}

function importFolder() {
    folderInput.click()
}

fileInput.addEventListener("change", async e => {
    for (const file of e.target.files) {
        const content = await file.arrayBuffer()
        await api.fileSet.write(`downloads/${file.name}`, content)
    }
})

folderInput.addEventListener("change", async e => {
    for (const file of e.target.files) {
        const content = await file.arrayBuffer()

        const path = file.webkitRelativePath || file.name

        await api.fileSet.write(`downloads/${path}`, content)
    }
})

const actionMap = {
    go_parent: () => {
        const parts = state.path.split('/').filter(Boolean);
        state.path = parts.slice(0, -1).join('/');
        renderFiles();
    },
    delete_folder: async () => {
        await api.fileSet.remove(state.chosen_path)
        renderFiles();
        render();
    },

    open_file: () => {
        api.fileUtil.open(state.chosen_path)
    },
    delete_file: async () => {
        await api.fileSet.remove(state.chosen_path)
        renderFiles();
    },

    import_file: () => importFiles(),
    import_folder: () => importFolder(),

    grid_view: () => setView("grid"),
    list_view: () => setView("list"),
    column_view: () => setView("column"),

    // to be implemented
    rename_folder: () => {
        const oldname = state.chosen_path.split("/").pop()
        api.utility.sysDialog({ message: "Rename file:", type: "prompt", defaultValue: oldname })
    },
    open_with: () => openWith(),
    export_file: () => exportFile(),
    rename_file: async () => {
        const oldPath = state.chosen_path

        const oldName = oldPath.split("/").pop()

        const newName =
            await api.utility.sysDialog({
                message: "Rename file:",
                type: "prompt",
                defaultValue: oldName
            }) ?? oldName

        if (!newName || newName === oldName) {
            return
        }

        const newPath = oldPath.replace(/[^/]+$/, newName)

        await api.fileSet.move(oldPath, newPath)
    }
}

document.addEventListener("click", e => {
    const el = e.target.closest(".menu_action")
    if (!el) return
    const fn = actionMap[el.dataset.action]
    if (fn) fn(el)
})

function setView(view) {
    state.currentView = view
    const container = document.querySelector("#filesList")
    if (container) container.dataset.view = view

    document.querySelectorAll('[data-barpageid="view"] .menu_action').forEach(el => {
        el.classList.toggle("active", el.dataset.action === `${view}_view`)
    })
}

SystemContextMenu.init([
    {
        "data-context": "file",
        actions: [
            { label: "Open", fn: el => actionMap.open_file(el) },
            { label: "Rename", fn: el => actionMap.rename_file(el) },
            { label: "Delete", fn: el => actionMap.delete_file(el) },
            {
                label: "More",
                actions: [
                    { label: "Open With", fn: el => actionMap.open_with(el) },
                    { label: "Export", fn: el => actionMap.export_file(el) }
                ]
            }
        ]
    },

    {
        "data-context": "folder",
        actions: [
            { label: "Open", fn: el => renderFiles(el.dataset.path) },
            { label: "Rename", fn: el => actionMap.rename_folder(el) },
            { label: "Delete", fn: el => actionMap.delete_folder(el) },
            {
                label: "View",
                actions: [
                    { label: "Grid", fn: () => setView("grid") },
                    { label: "List", fn: () => setView("list") },
                    { label: "Column", fn: () => setView("column") }
                ]
            }
        ]
    },

    {
        "data-context": "tree",
        actions: [
            { label: "Open", fn: el => renderFiles(el.dataset.path) },
            { label: "Collapse", fn: el => el.closest(".tree-node")?.classList.toggle("collapsed") }
        ]
    }
]);