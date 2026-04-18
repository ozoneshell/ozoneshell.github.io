var state = {
    defaultApps: ["files", "settings", "text", "tinyde"],
    appRepo: "additionalApps/",
    "mimedb": {}
}

document.addEventListener("DOMContentLoaded", async () => {
    const mimeurl = "assets/mimedb.json"
    const res = await fetch(mimeurl)
    if (!res.ok) throw new Error("Failed to fetch " + mimeurl)

    const status = await ensureRoot();

    if (!status) {
        log("Initializing filesystem")
        initializeOzone();
    } else {
        log("Resuming filesystem...")
    }

    const data = await res.json()
    state.mimedb = data;
    let directlyLoadApp = new URLSearchParams(window.location.search).get("app")
    if (directlyLoadApp) {
        log("Installing application...")
        let appURL = null
        if (!directlyLoadApp.includes("/") && state.defaultApps.includes(directlyLoadApp)) {
            appURL = "defaultSource/" + directlyLoadApp
        } else {
            appURL = state.appRepo + directlyLoadApp.replace("/", "-")
        }
        appURL = new URL(appURL, window.location.href).href
        await packageAppFromURL(appURL);
    }
    ensureSW();
    log("Ozone is Ready! If you want to, you can safely close this tab now.")
})

async function ensureSW() {
    if (!("serviceWorker" in navigator)) return

    const versions = await fetch("/versions.json").then(r => r.json())
    const v = versions.osware

    const reg = await navigator.serviceWorker.getRegistration()

    if (!reg) {
        await navigator.serviceWorker.register(`/sw.js?v=${v}`)
        localStorage.setItem("osware_sw_version", v)

        log("Service worker registered")
        return
    }

    const current = localStorage.getItem("osware_sw_version")

    if (current != v) {
        await navigator.serviceWorker.register(`/sw.js?v=${v}`)
        localStorage.setItem("osware_sw_version", v)
        log("Service worker upgraded")
    }
}

async function initializeOzone() {
    log("Downloading defaults... ")
    for (const app of state.defaultApps) {
        const appURL = new URL("defaultSource/" + app, window.location.href).href
        await packageAppFromURL(appURL)
    }
    await copySharedAssets();
    log("Ready!")
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
                log(`Downloaded ${base}/${file}`)
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
    const base = `/system/apps/${data.author}/${data.name}`
    const sources = data.sources || []


    log(`. Installing ${data.author}/${data.name}...`)
    console.log(data.capabilities)

    await settings.set(`${data.author}/${data.name}`, base, "TagPathIndex.json")

    if (data.capabilities) {
        const FileBindings = (await settings.get("FileBindings")) ?? {}
        const key = `${data.author}/${data.name}`

        for (const ext of data.capabilities) {
            FileBindings[ext] = [
                ...new Set([
                    ...(FileBindings[ext] ?? []),
                    key
                ])
            ]
        }

        settings.set("FileBindings", FileBindings)
    }

    await Promise.all(
        sources.map(async file => {
            try {
                const fileURL = appURL + "/" + file
                log(` .. ${file}`)
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
            log(` .. index.html`)
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

function log(text) {
    let x = document.createElement("div");
    x.className = "log";
    x.innerText = text;
    document.getElementById("logs").appendChild(x)
}

async function eraseExistance() {
    const regs = await navigator.serviceWorker.getRegistrations()

    await Promise.all(regs.map(r => r.unregister()))

    const clients = await navigator.serviceWorker.getRegistrations()
    console.log(clients)

    setTimeout(() => {
        const req = indexedDB.deleteDatabase("ozoneVFS")
        req.onsuccess = () => console.log("deleted")
        req.onerror = () => console.log(req.error)
        req.onblocked = () => console.log("still blocked")
    }, 1000)
}