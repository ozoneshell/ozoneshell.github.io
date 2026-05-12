vfs.js
- read file: readFile(path)
- write file: writeFile(path, data)
- remove file/folder: remove(path)
- list files in path: list(path)
- make a directory: mkdir(path)
- make a path: mkdirp(path)
- check if file exists: exists(path)

script.js
- make sure sw exists: ensureSW
- initialize ozone: initializeOzone
- download shared assets: copySharedAssets
- clone app from URL: installURLasApp(appURL)
- log in ozone CLI: log(text)
- open file: openFile(path)

utility.js
- mime from path: mimeFromPath(path)
- get file name extension: getExtension(text)
- settings path helper: resolvePath
- read settings JSON: readJSON(path)
- write settings JSON: writeJSON(path, data)
- settings
-- set(key, value, path)
-- get(key, path)
-- rem(key, path)

sw.js
- self fetch listener
- ozone page generator and router: route(request, parts)
- self message listener
- open apps from SW: openFromSW(path, params)