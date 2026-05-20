const grid = document.getElementById("default_apps_grid");
const appStore = new Map();

function makeTag(app) {
    return `${app.author}/${app.name}`;
}

function registerApp(app) {
    const tag = makeTag(app);
    appStore.set(tag, app);
    return tag;
}

function createApp(app) {
    const tag = registerApp(app);

    const unit = document.createElement("div");
    unit.className = "app_unit";
    unit.dataset.tag = tag;

    const header = document.createElement("div");
    header.className = "app_header";

    const cover = document.createElement("img");
    cover.className = "cover";
    cover.src = app.cover;
    header.appendChild(cover);

    const data = document.createElement("div");
    data.className = "data";

    const icon = document.createElement("div");
    icon.className = "icon";
    icon.textContent = app.icon;
    data.appendChild(icon);

    const name = document.createElement("div");
    name.className = "name";
    name.textContent = app.name;
    data.appendChild(name);

    header.appendChild(data);

    const desc = document.createElement("div");
    desc.className = "app_desc";
    desc.textContent = app.description;

    unit.appendChild(header);
    unit.appendChild(desc);

    return unit;
}

async function loadApps() {
    const res = await fetch("/defaultSource/app_map.json");
    const data = await res.json();

    grid.innerHTML = "";

    data.forEach(app => {
        grid.appendChild(createApp(app));
    });
}

loadApps();

function switchSection(sectionId) {
    const sections = document.querySelectorAll('.settings_section');
    sections.forEach(section => {
        section.classList.remove('active');
    });

    const target = document.getElementById(sectionId);
    if (target) {
        target.classList.add('active');
    }
}

const installer = {
    cover: document.getElementById("app_installer_cover"),
    name: document.getElementById("app_installer_name"),
    desc: document.getElementById("app_desc"),
    buttons: document.getElementById("installer_buttons")
};

async function loadInstaller(app) {
    installer.cover.src = app.cover;
    installer.name.textContent = app.name;
    installer.desc.textContent = app.description;

    installer.buttons.innerHTML = "";

    app.installed = await api.store.isInstalled(`${app.author}/${app.name}`);
    if (app.installed) {
        const openBtn = document.createElement("input");
        openBtn.type = "button";
        openBtn.className = "button secondary";
        openBtn.value = "Open";

        const updateBtn = document.createElement("input");
        updateBtn.type = "button";
        updateBtn.className = "button";
        updateBtn.value = "Update";

        installer.buttons.appendChild(openBtn);
        installer.buttons.appendChild(updateBtn);
    } else {
        const installBtn = document.createElement("input");
        installBtn.type = "button";
        installBtn.className = "button";
        installBtn.value = "Install";

        installer.buttons.appendChild(installBtn);
    }
}

document.addEventListener("click", (e) => {
    const unit = e.target.closest(".app_unit");
    if (!unit) return;

    const tag = unit.dataset.tag;
    const app = appStore.get(tag);
    if (!app) return;

    loadInstaller(app);
    switchSection("installer_page");
});