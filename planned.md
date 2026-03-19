api.apps.?
- api.params
- api.launch

api.files.
- open
- read
- getInfo

apps are in pages (eg: http://127.0.0.1:5500/apps/ozone/Text/), serven by the sw directly from IDB vfs.

# iframes
if it has sandbox it cant request relative urls normally. 

# page served with CSP
wont allow opening windows. like if i wanted to have a file selector thing that opens up the files app it wont work. As it requires opening a new window as to not lose the user's progress.
i dont want apps to be able access other app's doms if popups are enabled - isnt that the same with in-app app frames