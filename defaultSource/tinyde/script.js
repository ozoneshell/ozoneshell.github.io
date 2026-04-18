document.addEventListener("DOMContentLoaded", async () => {
    const items = await api.settings.get("all", "TagPathIndex.json")
    const appList = document.getElementById("applist")

    const shortcuts = await Promise.all(
        Object.entries(items).map(async ([tag, path]) => {
            if (tag === "darkdot/TinyDE") return ""

            const name = path.split("/").pop()

            return `
            <div class="app_shortcut" data-tag="${tag}" onclick="openApp(this)">
                ${name}
            </div>
        `
        })
    )

    appList.innerHTML = shortcuts.join("")
})
function openApp(el) {
    const tag = el.dataset.tag
    const [author, appName] = tag.split("/")

    new AppWindow({
        appName,
        appId: `${author}-${appName}`.toLowerCase(),
        url: `http://127.0.0.1:5500/apps/${author}/${appName}`
    })
}

class Resizer {
    constructor(win) {
        this.win = win
        this.enabled = true
        this.handles = {}
        this.create()
    }

    create() {
        const dirs = ["n", "s", "e", "w", "ne", "nw", "se", "sw"]

        dirs.forEach(dir => {
            const h = document.createElement("div")
            h.className = `resize-handle ${dir}`
            h.dataset.dir = dir
            this.win.appendChild(h)
            this.handles[dir] = h
            h.addEventListener("mousedown", e => this.start(e, dir))
        })
    }

    start(e, dir) {
        if (!this.enabled) return

        e.preventDefault()

        const rect = this.win.getBoundingClientRect()

        const state = {
            dir,
            startX: e.clientX,
            startY: e.clientY,
            x: rect.left,
            y: rect.top,
            w: rect.width,
            h: rect.height
        }

        const move = ev => this.resize(ev, state)
        const up = () => {
            document.removeEventListener("mousemove", move)
            document.removeEventListener("mouseup", up)
        }

        document.addEventListener("mousemove", move)
        document.addEventListener("mouseup", up)
    }

    resize(e, s) {
        let dx = e.clientX - s.startX
        let dy = e.clientY - s.startY

        let x = s.x
        let y = s.y
        let w = s.w
        let h = s.h

        if (s.dir.includes("e")) w = s.w + dx
        if (s.dir.includes("s")) h = s.h + dy
        if (s.dir.includes("w")) {
            w = s.w - dx
            x = s.x + dx
        }
        if (s.dir.includes("n")) {
            h = s.h - dy
            y = s.y + dy
        }

        w = Math.max(260, w)
        h = Math.max(180, h)

        Object.assign(this.win.style, {
            left: x + "px",
            top: y + "px",
            width: w + "px",
            height: h + "px"
        })
    }
}
class AppWindow {
    static z = 100

    constructor({ appName, appId, url, width = 700, height = 500, x = 80, y = 80 }) {
        this.appName = appName
        this.appId = appId
        this.url = url
        this.width = width
        this.height = height
        this.x = x
        this.y = y
        this.maximized = false
        this.minimized = false
        this.prev = {}

        this.create()
        this.mount()
        this.focus()
        this.drag()
        this.controls()
        this.resizer = new Resizer(this.el)
    }

    create() {
        this.el = document.createElement("div")
        this.el.className = "window"
        this.el.dataset.appId = this.appId

        this.el.innerHTML = `
            <div class="topbar">
                <div class="grp">
                    <b>${this.appName}</b>
                </div>
                <div class="grp">
                    <a class="topbar_item max">Minimize</a>
                    <a class="topbar_item min">Restore</a>
                    <a class="topbar_item close">Close</a>
                </div>
            </div>
            <iframe src="${this.url}" frameborder="0"></iframe>
        `

        Object.assign(this.el.style, {
            position: "absolute",
            left: this.x + "px",
            top: this.y + "px",
            width: this.width + "px",
            height: this.height + "px",
            zIndex: ++AppWindow.z
        })
    }

    mount(parent = document.getElementById("workstation")) {
        parent.appendChild(this.el)
    }

    bringToFront() {
        this.el.style.zIndex = ++AppWindow.z
    }

    focus() {
        this.el.addEventListener("mousedown", () => this.bringToFront())
    }

    setFramesPointer(state) {
        document.querySelectorAll("iframe").forEach(frame => {
            frame.style.pointerEvents = state
        })
    }

    drag() {
        const bar = this.el.querySelector(".topbar")

        bar.addEventListener("mousedown", e => {
            if (e.target.classList.contains("topbar_item")) return
            if (this.maximized) return

            this.bringToFront()

            const rect = this.el.getBoundingClientRect()
            const ox = e.clientX - rect.left
            const oy = (e.clientY + 36) - rect.top

            this.setFramesPointer("none")

            const move = ev => {
                this.el.style.left = ev.clientX - ox + "px"
                this.el.style.top = ev.clientY - oy + "px"
            }

            const up = () => {
                this.setFramesPointer("auto")
                document.removeEventListener("mousemove", move)
                document.removeEventListener("mouseup", up)
            }

            document.addEventListener("mousemove", move)
            document.addEventListener("mouseup", up)
        })
    }

    controls() {
        this.el.querySelector(".close").onclick = () => this.close()
        this.el.querySelector(".min").onclick = () => this.minimize()
        this.el.querySelector(".max").onclick = () => this.maximize()
    }

    close() {
        this.el.remove()
    }

    minimize() {
        const frame = this.el.querySelector("iframe")

        if (!this.minimized) {
            this.prev.height = this.el.style.height
            frame.style.display = "none"
            this.el.style.height = "42px"
            this.minimized = true
        } else {
            frame.style.display = "block"
            this.el.style.height = this.prev.height || this.height + "px"
            this.minimized = false
        }
    }

    maximize() {
        this.bringToFront()

        if (!this.maximized) {
            const r = this.el.getBoundingClientRect()

            this.prev = {
                left: r.left + "px",
                top: r.top + "px",
                width: r.width + "px",
                height: r.height + "px"
            }

            Object.assign(this.el.style, {
                left: "0px",
                top: "0px",
                width: "100%",
                height: "100%"
            })

            this.maximized = true
        } else {
            Object.assign(this.el.style, this.prev)
            this.maximized = false
        }
    }
}