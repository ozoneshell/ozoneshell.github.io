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

let editDialog = document.querySelector("#editDialog");

function toggleSettings() {
    editDialog.showModal();
}
const fields = {
    greeting: document.querySelector("#gree"),
    wall: document.querySelector("#wallp")
};


const bgimg = document.querySelector(".bgimg");
const mainLogo = document.querySelector(".main_logo");
const apply = () => {
    if (fields.wall.value) {
        bgimg.src = fields.wall.value;
    }

    if (fields.greeting.value) {
        mainLogo.innerText = fields.greeting.value;
    }
};

const init = async () => {
    for (const [key, el] of Object.entries(fields)) {
        const saved = await api.appStorage.get(key);

        if (saved) {
            el.value = saved;
        }

        el.addEventListener("input", async () => {
            await api.appStorage.set(key, el.value);
            apply();
        });
    }

    apply();
};

init();

const searchinput = document.querySelector(".searchbar>input");
searchinput.addEventListener("keyup", (event) => {
    if (event.key == "Enter")
        searchStuff()
})
function searchStuff() {
    const query = encodeURIComponent(searchinput.value.trim());
    const engine = searchEngineDrpDwn.value;

    let url = "https://www.google.com/search?q=" + query;

    if (engine === "DuckDuckGo") {
        url = "https://duckduckgo.com/?q=" + query;
    } else if (engine === "Ecosia") {
        url = "https://www.ecosia.org/search?q=" + query;
    } else if (engine === "Startpage") {
        url = "https://www.startpage.com/sp/search?query=" + query;
    } else if (engine === "Bing") {
        url = "https://www.bing.com/search?q=" + query;
    } else if (engine === "Wikipedia") {
        url = "https://en.wikipedia.org/w/index.php?search=" + query;
    }

    if (query) {
        console.log(query)
        window.open(url, "_blank");
    }

    searchinput.value = "";
}