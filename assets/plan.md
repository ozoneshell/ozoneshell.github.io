app installation
- apps are gonna be folders
- app will have a manifest file (considered the 'main' file)
- manifest will contain references to source code files and other required files
- something that allows apps to declare required files from a given set of resource types.

app opening
- kernel will fetch the app manifest and use the app director URL and absolutely' locate the source files.
- kernel will put all the script, style and html together into one html file and serve it as blob
- kernel also puts a javascript based standard ozone api in the blob.
- kernel stores the generated blob in indexedDB and redirects to same url.

app data stored
- app tags and display name 
- local storage reference
- app manifest, source files
- app permissions
- runtime generated app data 
- user defined app data 
- app version

opening an app: pre-compilation
1. kernel loads up, kernel assembles and compiles your application 
2. stores the output inside of indexedDB 
3. adds the URL to the serviceworker index stored in IDB.
4. reloads.
5. serviceworker checks its IDB index and intercepts the load event and serves app instead of kernel

opening an app: post compilation
1. serviceworker checks its IDB index and intercepts the load event and serves app instead of kernel