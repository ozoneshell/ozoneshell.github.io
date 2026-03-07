
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
    }
    getValue() {
        return this.value
    }
    setValue(v) {
        this.select(v)
    }
}

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

    if (instance) settings[instance.key] = instance
})