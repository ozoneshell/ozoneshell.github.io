import esbuild from "esbuild"
import path from "path"

const rootAlias = {
    name: "root-alias",
    setup(build) {
        build.onResolve({ filter: /^\// }, args => {
            return {
                path: path.join(process.cwd(), args.path)
            }
        })
    }
}

await esbuild.build({
    entryPoints: {
        ozone: "ozone.js",
        sw: "sw.js"
    },
    outdir: "dist",
    bundle: true,
    format: "esm",
    splitting: false,
    plugins: [rootAlias]
})

console.log("build complete")