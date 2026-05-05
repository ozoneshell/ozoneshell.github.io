const grid = document.getElementById("default_apps_grid");

function createApp(app) {
    const unit = document.createElement("div");
    unit.className = "app_unit";

    const header = document.createElement("div");
    header.className = "app_header";
    header.style.backgroundImage = `url(${app.cover})`;

    const icon = document.createElement("div");
    icon.className = "icon";
    icon.textContent = app.icon;

    const name = document.createElement("div");
    name.className = "name";
    name.textContent = app.name;

    header.appendChild(icon);
    header.appendChild(name);

    const desc = document.createElement("div");
    desc.className = "app_desc";
    desc.textContent = app.description;

    unit.appendChild(header);
    unit.appendChild(desc);

    return unit;
}

async function loadApps() {
    const res = await fetch("http://127.0.0.1:5500/defaultSource/app_map.json");
    const data = await res.json();

    grid.innerHTML = "";

    data.forEach(app => {
        grid.appendChild(createApp(app));
    });
}

loadApps();