ozone.js is a script file that lets you have
- multiple applications served via service worker from the VFS
- Virtual file system and other 'native-like' APIs through the service worker

Ozone apps are webapps with manifest files and usage of an 'api'.
API calls are called using a syntax like `api.NAMESPACE.FUNCTION`.
each namespace (like fileGet, fileUtil, store) needs permission from the user or in bulk during installation.
permissions are controlled by the service worker and stored in a system file that cannot be edited by apps.

Ozone rewrites the native window opener and later inject application lander-page source
native window open can return an opener which can lead to XSS attacks. This is why it is limited as made only available through the SW.
This also allows the service worker to open windows or even system dialogs.

Also routes the further requests to the VFS scoped to the application's directory
apps get stored in the VFS path: system/apps/AUTHOR_NAME/APP_NAME/
application manifest must always exist in a `manifest.json` file at its root directory.

Ozone lets people easily turn their web apps into 'pseudo web desktops' by providing a more native like runtime through the IPC and offline first app delivery. 

events api is a global event synchronization layer. 
It works by using event channels with their keys, which is provided during registration of the event channel and is required to listen to it.
Any app, any system which have access to the ozone API can listen to any channel if it has the channel key. 
The channel key - if not provided during registration, will be a randomly generated, long string.

people can also make real web desktops using the ozone runtime.
real web desktops are web desktops which hosts a Desktop Environment, perhaps a Window Manager.
in web desktop, windows are built using IFRAMES. Ozone apps can be embedded as iframes.
as mentioned previously, the window opener method talks directly to the service worker instead of the native browser window opener
but this leads to the parent page (or the 'real web desktop') to not be able to intercept and keep the applications spawning on itself.
this requires applications which embed other applications to have some amount of control over the embedded application.
