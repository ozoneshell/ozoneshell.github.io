
class ToggleSetting {
    constructor(el) {
        this.el = el
        this.key = el.dataset.setting
        this.checked = el.classList.contains("checked")
        el.addEventListener("click", () => this.toggle())
    }
    toggle() {
        this.checked = !this.checked
        this.el.classList.toggle("checked", this.checked)
        this.onChange?.(this.getValue())
    }
    getValue() {
        return this.checked
    }
    setValue(v) {
        this.checked = !!v
        this.el.classList.toggle("checked", this.checked)
    }
}

class ButtonSetting {
    constructor(el, callback) {
        this.el = el
        this.key = el.dataset.setting
        this.callback = callback
        el.addEventListener("click", e => {
            if (this.callback) this.callback(e, this)
            this.onChange?.(null)
        })
    }
    getValue() {
        return null
    }
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

class InputSetting {
    constructor(el, callback) {
        this.el = el
        this.key = el.dataset.setting
        this.value = el.value
        this.callback = callback

        el.addEventListener("input", e => {
            this.value = el.value
            this.callback?.(e, this)
            this.onChange?.(this.getValue())
        })
    }

    getValue() {
        return this.value
    }

    setValue(v) {
        this.value = v ?? ""
        this.el.value = this.value
    }
}

var state = {}

const settings = {}
document.querySelectorAll("[data-setting]").forEach(el => {
    let instance = null

    if (el.classList.contains("setting_toggle")) {
        instance = new ToggleSetting(el)
    } else if (el.classList.contains("setting_button")) {
        instance = new ButtonSetting(el)
    } else if (el.classList.contains("setting_dropdown")) {
        instance = new DropdownSetting(el)
    }

    if (instance) {
        instance.onChange = async value => {
            await api.settings.set(instance.key, value)
        }

        settings[instance.key] = instance
    }
})

async function loadSettings() {
    const data = await api.settings.get("all")

    Object.entries(settings).forEach(([key, instance]) => {
        if (data[key] !== undefined && instance.setValue) {
            instance.setValue(data[key])
        }
    })
}

loadSettings()

function switchSection(sectionId, obj) {
    const target = document.getElementById(sectionId);
    if (obj) {
        document.querySelector(".sidebar>.button.active")?.classList.remove("active");
    }
    const sections = document.querySelectorAll('.settings_section');
    sections.forEach(section => {
        section.classList.remove('active');
    });

    obj?.classList.add("active")
    if (target) {
        target.classList.add('active');
        screenHandlers[sectionId]();
    }
}

function createAppCard({
    appname = "AppName",
    icon = "",
    author = "Unknown Author",
    desc = "No description",
    perms = []
}) {
    const fallbackIcon = `
        <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#e3e3e3">
            <path d="M440-183v-274L200-596v274l240 139Zm80 0 240-139v-274L520-457v274Zm-40-343 237-137-237-137-237 137 237 137ZM160-252q-19-11-29.5-29T120-321v-318q0-22 10.5-40t29.5-29l280-161q19-11 40-11t40 11l280 161q19 11 29.5 29t10.5 40v318q0 22-10.5 40T800-252L520-91q-19 11-40 11t-40-11L160-252Zm320-228Z"/>
        </svg>
    `;

    const app = document.createElement("div");
    app.className = "app";
    app.addEventListener("click", () => {
        state.detAppData = { appname, author, perms }
        switchSection("appDetail")
    })

    app.innerHTML = `
        <div class="icon">
            ${icon || fallbackIcon}
        </div>

        <div class="data">
            <div class="name">${appname}</div>
            <div class="desc">${author} &bull; ${desc}</div>
        </div>
    `;

    return app;
}
const screenHandlers = {
    apps: async () => {
        const appListE = document.getElementById("appList");
        appListE.innerHTML = "";

        let listOfApps = await api.settings.get("all", "appRegistry.json");

        Object.keys(listOfApps).forEach(item => {
            const [author, appName] = item.split("/");

            let element = createAppCard({
                appname: appName,
                icon: listOfApps[item].icon,
                author,
                desc: listOfApps[item].permissions?.length + " Allowed",
                perms: listOfApps[item].permissions
            });

            appListE.appendChild(element);
        });
    },

    general: () => {

    },

    appDetail: async () => {
        document.getElementById("appDetAppName").innerText =
            state.detAppData.appname;

        let allNmsps = await api.utility.getNamespaces();

        let appPermList = document.getElementById("appPermList");
        appPermList.innerHTML = "";

        allNmsps.forEach(element => {
            const settingUnit = document.createElement("div");
            settingUnit.className = "setting_unit";

            const settingText = document.createElement("div");
            settingText.className = "setting_text";
            settingText.textContent = element;

            const settingToggle = document.createElement("div");
            settingToggle.className = "setting_toggle";
            settingToggle.dataset.setting = "toggleSetting";

            settingUnit.append(settingText, settingToggle);
            appPermList.appendChild(settingUnit);

            let set = new ToggleSetting(settingUnit);

            if (state.detAppData?.perms?.includes(element))
                set.toggle();

            set.onChange = async (value) => {
                const appKey =
                    `${state.detAppData.author}/${state.detAppData.appname}`;

                let registry = await api.settings.get(
                    "all",
                    "appRegistry.json"
                );

                if (!registry[appKey].permissions)
                    registry[appKey].permissions = [];

                let perms = registry[appKey].permissions;

                if (value) {
                    if (!perms.includes(element))
                        perms.push(element);
                } else {
                    registry[appKey].permissions =
                        perms.filter(p => p !== element);
                }

                await api.settings.set(
                    appKey,
                    registry[appKey],
                    "appRegistry.json"
                );
            };
        });
    }
};