# To Do

### inter app communication 
- apps can open apps
- apps can pass data to apps they open
- apps can return data to apps who launched them
- apps use a global event bus.
- app instances change events

### files and handling
- apps can trigger opening files 
- apps can open files with an app
- system builds a file-app association list.
- apps can let the system choose an app to run a file.
- users can change app-file associations.
- apps can register file capabilities.
- apps can check for file type handling status.

## App functions
- apps can register and manage in-app-functionality.
- apps register functions with required params for calling them and their label.

## App declarations
- apps can register window type and sizes even per function. (files app can spawn on popup window if its opened as file picker)

# More stuff
- make shared assets accessible to everything, make that folder available as url.


# Tree
- apps-file registry
system dialogs
    - open file method
    - "open file with" method
    - "choose app to open file" screen
    - "register app as default handler confirmation" durin installation
- files app methods
    - save file as method
    - choose folder method
    - select files method
    - select files with type filters
- files app features
    - extract zip files
    - compress folder into zip
    - export files
- manage apps methods
    - uninstall app
    - register apps from folder
    - clone app from URL
    - clear app data
- app information methods
    - get app information by app tag
        - app name, author, version, icon, permissions
- app permissions   
    - clear app permissions method
    - get app permissions method
    - set app permissions method
- desktop file
    ```json
    {
        "name":"shortcut name",
        "app":"app/tag",
        "icon":"path/to/your/app/icon.png",
        "description":"this is a desktop shortcut file.",
        "type": "application/directory/link"
    }
    ```
    - types
        - application: triggers open application directly
        - directory: opens the path in files app
        - opens the link in your browser