importScripts("scripts/vfs.js");

ensureRoot();

self.addEventListener("fetch", e => {
    const url = new URL(e.request.url);
    const parts = url.pathname.split("/").filter(Boolean);
    if (!parts[0] || parts[0] !== "apps") return;

    e.respondWith(handleApp(parts.slice(1)));
});

async function handleApp(parts) {
    let [creator, app, ...rest] = parts;
    const file = rest.join("/") || "index.html";
    const vfsPath = `/system/${creator}/${app}/${file}`;
    const f = await readFile(vfsPath);

    if (!f || f.type !== "file") return new Response("Not found", { status: 404 });

    let body = f.data instanceof Blob ? f.data : new Blob([f.data]);
    return new Response(body, { headers: { "Content-Type": mime(vfsPath) } });
}

function mime(p) {
    const ext = p.split(".").pop().toLowerCase();
    return ({
        html: "text/html",
        js: "application/javascript",
        css: "text/css",
        json: "application/json",
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        svg: "image/svg+xml",
        txt: "text/plain"
    })[ext] || "application/octet-stream";
}