// primary loader
var loader = document.getElementById("textloader");
var arr = ["Collecting data...", "Compiling application...", "Downloading assets...", "Mounting local data...", "Installing application..."];

setInterval(() => {
    loader.innerText = arr[Math.floor(Math.random() * arr.length)];
}, 3500);
var state = {
    defaultApps: ["files", "settings"],
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

    navigator.serviceWorker.register("/sw.js")
})

async function initializeOzone() {
    for (const app of state.defaultApps) {
        const appURL = new URL("defaultSource/" + app, window.location.href).href
        await packageAppFromURL(appURL)
    }
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