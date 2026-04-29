
document.addEventListener("DOMContentLoaded", async () => {
    var path = (await api.params)?.file || "";
    const textarea = document.getElementById("main_input");

    async function loadFile() {
        const file = await api.files.read(path);
        if (!file) {
            textarea.value = "";
            return;
        }

        let text;

        if (file.data instanceof Blob) {
            text = await file.data.text();
        } else if (file.data instanceof ArrayBuffer) {
            text = new TextDecoder().decode(file.data);
        } else {
            text = file.data;
        }

        textarea.value = text;
    }
    async function saveFile() {
        const data = textarea.value;
        const encoded = new TextEncoder().encode(data);
        await api.files.write(path, encoded);
    }

    loadFile();

    document.getElementById("openFileBtn").addEventListener("click", async () => {
        let x = await api.apps.open("ozone/Files", { type: "file_selector" }, "popup");
        path = x;
        loadFile();
    });
})