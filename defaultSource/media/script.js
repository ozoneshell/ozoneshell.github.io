
document.addEventListener("DOMContentLoaded", async () => {
    const path = (await api.params)?.file || "";
    const textarea = document.getElementById("main_media_element");

    async function loadFile() {
        const file = await api.files.read(path);
        if (!file) {
            textarea.src = "";
            return;
        }
        
        let text = file.data;

        textarea.src = text;
    }

    loadFile();
    document.getElementById("openFileBtn").addEventListener("click", ()=> {
        api.apps.open("ozone/Files", { type: 'file_selector' })
    })
})