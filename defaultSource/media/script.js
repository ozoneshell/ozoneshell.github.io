document.addEventListener("DOMContentLoaded", async () => {
    const path = ((await api.params)?.file) || "";

    async function loadFile() {
        const file = await api.files.read(path);

        if (!file) {
            // player.src = "";
            return;
        }

        const bytes = file.data instanceof Uint8Array
            ? file.data
            : new Uint8Array(file.data);

        const mime = await api.utility.getMime(file.path);

        const blob = new Blob([bytes], { type: mime });
        const url = URL.createObjectURL(blob);

        const player = document.getElementById("main_media_element");
        if (player._url) {
            URL.revokeObjectURL(player._url);
        }

        player._url = url;

        player.src = url;
        player.load();
        console.log(player)
    }

    await loadFile();

    document.getElementById("openFileBtn").addEventListener("click", () => {
        api.apps.open("ozone/Files", { type: "file_selector" });
    });
});