// primary loader
var loader = document.getElementById("textloader");
var arr = ["Collecting data...", "Compiling application...", "Downloading assets...", "Mounting local data...", "Installing application..."];

setInterval(() => {
    loader.innerText = arr[Math.floor(Math.random() * arr.length)];
}, 3500);
var state = {
    defaultApps: ["files", "settings", "text"],
    appRepo: "additionalApps/",
    "mimedb": {}
}

document.addEventListener("DOMContentLoaded", async () => {
    const mimeurl = "assets/mimedb.json"
    const res = await fetch(mimeurl)
    if (!res.ok) throw new Error("Failed to fetch " + mimeurl)

    const status = await ensureRoot();

    if (!status) {
        console.log("fresh filesystem");
        initializeOzone();
    } else {
        console.log("existing filesystem");
    }

    const data = await res.json()
    state.mimedb = data;
    let directlyLoadApp = new URLSearchParams(window.location.search).get("app")
    if (directlyLoadApp) {
        let appURL = null
        if (!directlyLoadApp.includes("/") && state.defaultApps.includes(directlyLoadApp)) {
            appURL = "defaultSource/" + directlyLoadApp
        } else {
            appURL = state.appRepo + directlyLoadApp.replace("/", "-")
        }
        appURL = new URL(appURL, window.location.href).href
        await packageAppFromURL(appURL);
    }
    ensureSW()
})

async function ensureSW() {
    if (!("serviceWorker" in navigator)) return

    const versions = await fetch("/versions.json").then(r => r.json())
    const v = versions.osware

    const reg = await navigator.serviceWorker.getRegistration()

    if (!reg) {
        await navigator.serviceWorker.register(`/sw.js?v=${v}`)
        localStorage.setItem("osware_sw_version", v)
        return
    }

    const current = localStorage.getItem("osware_sw_version")

    if (current != v) {
        await navigator.serviceWorker.register(`/sw.js?v=${v}`)
        localStorage.setItem("osware_sw_version", v)
    }
}

async function initializeOzone() {
    for (const app of state.defaultApps) {
        const appURL = new URL("defaultSource/" + app, window.location.href).href
        await packageAppFromURL(appURL)
    }
    await copySharedAssets();
}

async function copySharedAssets() {
    const sharedAssets = ["google_sans.ttf", "icons.woff2"];
    const base = `/system/sharedAssets`;

    await Promise.all(
        sharedAssets.map(async file => {
            try {
                const url = new URL(`defaultSource/sharedAssets/${file}`, window.location.href).href;
                const res = await fetch(url);
                if (!res.ok) throw new Error("Failed to fetch " + url);
                const blob = await res.blob();
                await writeFile(`${base}/${file}`, blob);
            } catch (e) {
                console.error(e);
            }
        })
    );
}

async function packageAppFromURL(appURL) {
    const manifestURL = appURL + "/manifest.json"
    const res = await fetch(manifestURL)
    if (!res.ok) throw Error("Failed to fetch " + manifestURL)

    const data = await res.json()
    const base = `/system/${data.author}/${data.name}`
    const sources = data.sources || []

    await Promise.all(
        sources.map(async file => {
            try {
                const fileURL = appURL + "/" + file
                const r = await fetch(fileURL)
                if (!r.ok) return

                const blob = await r.blob()
                const path = `${base}/${file}`

                await writeFile(path, blob)
            } catch { }
        })
    )

    try {
        const landingURL = appURL + "/" + data.landing
        const lr = await fetch(landingURL)
        if (lr.ok) {
            const landingBlob = await lr.blob()
            await writeFile(`${base}/index.html`, landingBlob)
        }
    } catch { }

    const manifestBlob = new Blob(
        [JSON.stringify(data, null, 2)],
        { type: "application/json" }
    )

    await writeFile(`${base}/manifest.json`, manifestBlob)

    return base
}