
document.addEventListener("DOMContentLoaded", async () => {
    const path = (await api.params)?.file || "";
    const player = document.getElementById("main_media_element");

    async function loadFile() {
        const file = await api.files.read(path);
        console.log(file)
        if (!file) {
            player.src = "";
            return;
        }

        let buffer = file.data;
        let mime = await api.utility.getMime(file.path);

        let blob = new Blob([buffer], { type: mime });
        let url = URL.createObjectURL(blob);

        console.log(file, url, blob, mime)
        player.src = url;
        player.type = mime;
    }

    loadFile();
    document.getElementById("openFileBtn").addEventListener("click", () => {
        api.apps.open("ozone/Files", { type: 'file_selector' })
    })
})