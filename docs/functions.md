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
- clone app from URL: packageAppFromURL(appURL)
- log in ozone CLI: log(text)
- open file: openFile(path)

utility.js
- mime from path: mimeFromPath(path)
- get file name extension: getExtension(text)
