importScripts("scripts/vfs.js");

ensureRoot();

self.addEventListener("fetch", e => {
    const url = new URL(e.request.url);

    if (!url.pathname.endsWith('/')) {
        e.respondWith(Response.redirect(url.pathname + '/' + url.search, 301));
        return;
    }

    const parts = url.pathname.split("/").filter(Boolean);
    if (!parts[0] || parts[0] !== "apps") return;

    e.respondWith(handleApp(parts.slice(1)));
});

async function handleApp(parts) {
    let [creator, app, ...rest] = parts;

    if (rest[0] === "sharedAssets") {
        const file = rest.slice(1).join("/") || "index.html";
        const vfsPath = `/system/sharedAssets/${file}`;
        const f = await readFile(vfsPath);
        if (!f || f.type !== "file") return new Response("Not found", { status: 404 });
        const body = f.data instanceof Blob ? f.data : new Blob([f.data]);
        return new Response(body, { headers: { "Content-Type": mime(vfsPath) } });
    }

    const file = rest.join("/") || "index.html";
    const vfsPath = `/system/${creator}/${app}/${file}`;
    const f = await readFile(vfsPath);
    if (!f || f.type !== "file") return new Response("Not found", { status: 404 });
    const body = f.data instanceof Blob ? f.data : new Blob([f.data]);
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