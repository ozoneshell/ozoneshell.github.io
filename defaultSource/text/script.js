
document.addEventListener("DOMContentLoaded", async () => {
    const path = "/system/ozone/Settings/manifest.json";
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
        } else {
            text = file.data;
        }

        textarea.value = text;
    }
    async function saveFile() {
        const data = textarea.value;
        await api.files.write(path, data);
    }

    loadFile();
    document.getElementById("openFileBtn").addEventListener("click", ()=> {
        api.apps.open("ozone/Files", { foo: 123 })
    })
})