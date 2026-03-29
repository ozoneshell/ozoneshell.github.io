# System Architecture

## 1. Inter-App Communication

### 1.1 App Launching
- Apps can launch other apps
- Pass data to launched apps
- Receive return data from launched apps

### 1.2 Event System
- Global event bus
- Apps can emit and listen to events

---

## 2. File System & Handling

### 2.1 Core Capabilities
- Trigger file open
- Open files with specific apps
- File–app association registry (system-managed)
- Defer app selection to system
- User-configurable file associations
- Apps can:
  - Register supported file types
  - Query supported file handling

### 2.2 System Dialogs
- Open File
- Open File With
- Choose App UI
- Default App confirmation

### 2.3 Files App Methods
- Save File As
- Choose Folder
- Select Files
- Select Files (with filters)

### 2.4 Files App Features
- Extract ZIP
- Compress to ZIP
- Export files

---

## 3. App Functions System

### 3.1 Function Registration
- Register callable functions
- Define required parameters
- Provide human-readable labels

### 3.2 Function Invocation
- External apps can invoke registered functions

---

## 4. App Declarations

### 4.1 Window Configuration
- Window types
- Context-based sizing  
  - Example: file picker opens as popup

---

## 5. App & System Management

### 5.1 App Lifecycle
- Install (from folder)
- Clone (from URL)
- Uninstall
- Clear app data
- Register app

### 5.2 App Information
- Query by tag:
  - Name
  - Author
  - Version
  - Icon
  - Permissions

### 5.3 Permissions System
- Get permissions
- Set permissions
- Clear permissions

---

## 6. Desktop System

### 6.1 Desktop File Format
**JSON Schema:**
- `name`
- `app`
- `icon`
- `description`
- `type`

### 6.2 Desktop File Types
- `application` → launches app
- `directory` → opens in files app
- `link` → opens in browser

---

## 7. App Architecture

### 7.1 App Structure
- Apps are folder-based
- Manifest file (entry point)
- Resource declarations:
  - Required files by type

### 7.2 Manifest Responsibilities
- Reference source files
- Declare assets
- Define metadata

### 7.3 Kernel Responsibilities
- Fetch manifest
- Resolve file paths
- Bundle HTML/CSS/JS → single HTML
- Inject Ozone API
- Generate Blob URL
- Store compiled app in IndexedDB
- Register in Service Worker index

---

## 8. App Runtime & Storage

### 8.1 Stored Data
- App tag & display name
- Manifest & source files
- Permissions
- Runtime-generated data
- User data
- Local storage reference
- Version

---

## 9. App Launch Flow

### 9.1 Pre-Compilation Phase
1. Kernel loads
2. App compiled & assembled
3. Output stored in IndexedDB
4. URL added to Service Worker index
5. System reloads

### 9.2 Post-Compilation Phase
- Service Worker intercepts request
- Serves compiled app from IndexedDB

---

## 10. Shared Resources

### 10.1 Global Assets
- Shared asset directory
- Accessible via URL

---

## 11. Registry Systems

### 11.1 Apps–File Registry
- Maps file types → apps
- Used by:
  - System dialogs
  - File open flows