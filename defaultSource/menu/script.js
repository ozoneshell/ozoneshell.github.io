document.addEventListener("DOMContentLoaded", async () => {
    const items = await api.settings.get("all", "appRegistry.json")
    const appList = document.getElementById("menu")

    const shortcuts = await Promise.all(
        Object.keys(items).map(async (tag) => {
            if (tag === "darkdot/TinyDE") return ""

            const name = tag.split("/").pop()

            return `
            <div class="app_shortcut" data-tag="${tag}" onclick="openApp(this)">
            <div class="app_icon">${items[tag]?.icon ?? name[0]}</div> 
            <div class="app_name">${name}</div> 
                
            </div>
        `
        })
    )

    appList.innerHTML = shortcuts.join("")
})

function openApp(el) {
    const tag = el.dataset.tag
    const [author, appName] = tag.split("/")

    window.open(`/apps/${author}/${appName}`, "blank")
}


class DropdownSetting {
    constructor(el) {
        this.el = el
        this.key = el.dataset.setting
        this.current = el.querySelector(".current_element")
        this.text = this.current.querySelector(".current_element_text")
        this.items = [...el.querySelectorAll(".dropdown_content .item")]
        this.value = this.text.textContent.trim()
        this.open = false
        this.current.addEventListener("click", () => this.toggle())
        this.items.forEach(i => {
            i.addEventListener("click", () => {
                this.select(i.textContent.trim())
            })
        })
        document.addEventListener("click", e => {
            if (!this.el.contains(e.target)) this.close()
        })
    }
    toggle() {
        this.open = !this.open
        this.el.classList.toggle("open", this.open)
    }
    close() {
        this.open = false
        this.el.classList.remove("open")
    }
    select(v) {
        this.value = v
        this.text.textContent = v
        this.close()
        this.onChange?.(this.getValue())
    }
    getValue() {
        return this.value
    }
    setValue(v) {
        this.select(v)
    }
}
let el = document.getElementById("searchEngineDrpDwn")
var searchEngineDrpDwn = new DropdownSetting(el)