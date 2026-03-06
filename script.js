// primary loader
var loader = document.getElementById("textloader");
var arr = ["Collecting data...", "Compiling application...", "Downloading assets...", "Mounting local data...", "Installing application..."];

setInterval(() => {
    loader.innerText = arr[Math.floor(Math.random() * arr.length)];
}, 3500);

var state = {
    "defaultApps": [
        "files",
        "settings",
        "camera",
        "gallery"
    ],
    "appRepo": "additionalApps/"
}

document.addEventListener("DOMContentLoaded", ()=> {
    let directlyLoadApp =  new URLSearchParams(window.location.search).get("app");
    if (directlyLoadApp) {
        let appURL = null;
        if (!directlyLoadApp.includes("/") && state.defaultApps.includes(directlyLoadApp)) {
            appURL = "defaultSource/" + directlyLoadApp;
        } else {
            appURL = state.appRepo + directlyLoadApp.replace("/", "-")
        }
        let [author, appName] = directlyLoadApp.split("/");
    }
})