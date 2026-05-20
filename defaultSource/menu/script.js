document.addEventListener("DOMContentLoaded", async () => {
    const items = await api.settings.get("all", "appRegistry.json")
    const appList = document.getElementById("menu")

    const shortcuts = await Promise.all(
        Object.keys(items).map(async (tag) => {
            if (tag === "darkdot/TinyDE") return ""

            const name = tag.split("/").pop()

            return `
            <div class="app_shortcut" data-tag="${tag}" onclick="openApp(this)">
            <div class="app_icon">${name[0]}</div> 
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