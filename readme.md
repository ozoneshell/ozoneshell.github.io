# <img height="25" src="https://avatars.githubusercontent.com/u/265530475?s=200&v=4"> Ozone Shell

Client side shared webapp runtime framework &bull; HTML, Vanilla JS, CSS. 

By darkdot &bull; [Documentation](https://ozoneshell.readme.io/docs/getting-started) &bull; MPL 2.0 &bull; `⚠️ BETA`

## Introduction
Ozone shell let's you integrate multiple webapps without leaving the client side, by locally serving multiple web app suites in a single domain, creating a shared state, filesystem and IPC. 

By creating an Ozone instance, you can run all your apps within Ozone while also being able to sideload and integrate with additional apps into your instance. 

Apps cannot access the VFS, IPC, or system events without the required permissions. Permissions can only be granted by both the user and the hosting instance. Though instances may provide trusted default apps without installation prompts.

This architecture not only saves server computation for massive static web apps, makes it easier to setup complicated native like functionality and creates a way for web apps to safely integrate locally.

And Ozone does it all in two vanilla javascript files.

## Subprojects
- **Ozone Library**: Single JS library that turns your web app into an [Ozone instance](https://ozoneshell.readme.io/docs/instances). 
- **Ozone Hybrid Storage VFS**: Client side based virtual file system with multiple backends (OPFS, IDB). [Learn More](https://ozoneshell.readme.io/docs/vfs).
- **Ozone API**: [IPC layer](https://ozoneshell.readme.io/docs/ozone-api) and [permission system](https://ozoneshell.readme.io/docs/permissions) for web applications over the Ozone system.
- **Ozone Default Apps package**: Default apps to make use of, or debug Ozone instances.
- **Ozone Design Framework**: Material Design 3 inspired lightweight design framework. [Read](https://github.com/ozoneshell/ozoneshell.github.io/blob/main/about/design.md).
- **Ozone Standard Utility**: functionality centered web component javascript library based on Ozone design.
- **Ozone App Store**: Application distribution and package management for Ozone.

## Contribute
Pull requests are welcome, but they shouldn't be AI slop.

## Building
Service workers cannot be registered using scripts from a different domain. Because of this, you need to host scripts yourselves on your instance.

You can either grab the newest built scripts from `/dist` or build from source. Here's how to build from source: 
1. Clone this repo:
```sh
git clone https://github.com/ozoneshell/ozoneshell.github.io.git
```
2. Use node to build script files for an Ozone Shell instance. Run the following at clone root:
```sh
node build.mjs
```
3. Use the freshly generated scripts in your instance. Follow the docs for learning how to setup one.

## In this repo
Below is a list of everything that matters in this repo:
- `/dist` prebuilt version of ozone with fewest files 
- `/scripts` scripts that power ozone used by ozone.js and sw.js
- `/defaultSource` collection of default apps for ozone instances
- `todo.md` our to do list
- `versions.json` version control file for the ozone home
- `build.mjs` build script for ozone instances
- `LICENSE` license text for this repo