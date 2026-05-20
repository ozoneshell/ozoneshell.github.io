document.addEventListener("DOMContentLoaded", async () => {
    let path = ((await api.params)?.file) || "";
    console.log(path)
    const container = document.getElementById("media_container");

    async function createMediaElement(mime, url) {
        let element;

        if (mime.startsWith("video/")) {
            element = document.createElement("video");
            element.controls = true;
        } else if (mime.startsWith("audio/")) {
            element = document.createElement("audio");
            element.controls = true;
        } else if (mime.startsWith("image/")) {
            element = document.createElement("img");
        } else if (mime === "application/pdf") {
            element = document.createElement("iframe");
        } else {
            element = document.createElement("a");
            element.textContent = "Download File";
            element.href = url;
            element.download = "";
        }

        element.id = "main_media_element";

        if (element.tagName === "IFRAME") {
            element.style.width = "100%";
            element.style.height = "100vh";
        }

        if (element.tagName === "IMG") {
            element.style.maxWidth = "100%";
            element.style.maxHeight = "100vh";
            element.style.objectFit = "contain";
        }

        if (
            element.tagName === "VIDEO" ||
            element.tagName === "AUDIO" ||
            element.tagName === "IMG" ||
            element.tagName === "IFRAME"
        ) {
            element.src = url;
        }

        return element;
    }

    async function loadFile() {
        const file = await api.fileGet.read(path);

        if (!file) {
            container.innerHTML = "";
            return;
        }

        const bytes = file.data instanceof Uint8Array
            ? file.data
            : new Uint8Array(file.data);

        const mime = await api.utility.getMime(path);

        const blob = new Blob([bytes], { type: mime });
        const url = URL.createObjectURL(blob);

        const oldElement = document.getElementById("main_media_element");

        if (oldElement?._url) {
            URL.revokeObjectURL(oldElement._url);
        }

        container.innerHTML = "";

        const media = await createMediaElement(mime, url);

        media._url = url;

        container.appendChild(media);

        if (media.tagName === "VIDEO" || media.tagName === "AUDIO") {
            media.load();
        }

        console.log(media);
    }

    await loadFile();

    document.getElementById("openFileBtn").addEventListener("click", async () => {
        const selected = await api.apps.open(
            "ozone/Files",
            { type: "file_selector" },
            "popup"
        );

        if (!selected) return;

        path = selected;

        await loadFile();
    });
});