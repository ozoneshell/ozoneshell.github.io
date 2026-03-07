// primary loader
var loader = document.getElementById("textloader");
var arr = ["Collecting data...", "Compiling application...", "Downloading assets...", "Mounting local data...", "Installing application..."];

setInterval(() => {
    loader.innerText = arr[Math.floor(Math.random() * arr.length)];
}, 3500);
var state = {
    defaultApps: ["files", "settings", "camera", "gallery"],
    appRepo: "additionalApps/"
}

document.addEventListener("DOMContentLoaded", async () => {
    let directlyLoadApp = new URLSearchParams(window.location.search).get("app")
    if (directlyLoadApp) {
        let appURL = null
        if (!directlyLoadApp.includes("/") && state.defaultApps.includes(directlyLoadApp)) {
            appURL = "defaultSource/" + directlyLoadApp
        } else {
            appURL = state.appRepo + directlyLoadApp.replace("/", "-")
        }
        appURL = new URL(appURL, window.location.href).href
        let blob = await packageAppFromURL(appURL);
        const url = URL.createObjectURL(blob)
        location.replace(url)
    }
})

async function packageAppFromURL(appURL) {
    const manifestURL = appURL + "/manifest.json"
    const res = await fetch(manifestURL)
    if (!res.ok) throw new Error("Failed to fetch " + manifestURL)

    const data = await res.json()
    const sources = data.sources

    let html = ""
    let css = []
    let js = []

    for (const file of sources) {
        const fileURL = appURL + "/" + file.name
        const r = await fetch(fileURL)
        if (!r.ok) throw new Error("Failed to fetch " + fileURL)
        const text = await r.text()
// file types has to be removed.
        if (file.type === "html") html = text
        if (file.type === "css") css.push(text)
        if (file.type === "js") js.push(text)
    }

    const cssBlock = `<style>${css.join("\n")}</style>`
    const jsBlock = `<script>${js.join("\n")}</script>`

    let finalHTML = html

    if (html.includes("</head>")) finalHTML = finalHTML.replace("</head>", cssBlock + "</head>")
    else finalHTML = cssBlock + finalHTML

    if (finalHTML.includes("</body>")) finalHTML = finalHTML.replace("</body>", jsBlock + "</body>")
    else finalHTML += jsBlock

    const blob = new Blob([finalHTML], { type: "text/html" })
    return blob
}