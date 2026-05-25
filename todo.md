general
- app versioning
- app loader toggle, registration for parent app handler support for nested app api calls
- system version controller and updater

ozone JS standard utility
- overwritten upgraded set of alerts and system dialog functions
  - tooltip attribute
  - can be used for selecting apps in the open with window

files app
- drag and drop to move
- select files for bulk actions
- zip file handling and ability to make them
- file & folder info panel
- pinned directories
- download file to device

installer wizard
- choose file system backend: OPFS, IndexedDB

store
- better app preview
- installing, unintalling and updating


PROPOSAL:
The proposal is to implement this child application window opening interception using the event channel and a new appembed API, both shipped through the ozone API.
appembed registration creates and returns
1. a URL of the application which the parent app can embed (this url will have an embed ID)
2. an event channel and makes the SW route all window events from the embedded app (using the embed ID from its URL) to this event channel
and the window open method fallbacks to default method if the parent isnt listening.
Also the child application's permissions will be reduced to that of the parent application, because embedded apps can be vaulnerable to XSS.