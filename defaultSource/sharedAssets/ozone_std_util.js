// Ozone standard utility for ozone default apps

// system dialogs
class SystemDialog {
  static instance = new SystemDialog();

  constructor() {
    this.dialog = document.createElement('dialog');
    this.dialog.classList.add('sd-dialog');

    this.content = document.createElement('div');
    this.content.classList.add('sd-container');

    this.dialog.appendChild(this.content);
    document.body.appendChild(this.dialog);

    this.dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
    });
  }

  static open(config) {
    return this.instance._open(config);
  }

  _open(config) {
    return new Promise((resolve) => {
      this.content.innerHTML = '';

      const { type } = config;
      let selectedIndexes = [];

      let primaryBtn = null;
      let cancelBtn = null;

      const contentEl = document.createElement('div');
      contentEl.classList.add('sd-content');

      const actionsEl = document.createElement('div');
      actionsEl.classList.add('sd-actions');

      if (type === 'alert') {
        this.dialog.classList.add('sd-alert');

        const title = document.createElement('div');
        title.classList.add('sd-title');
        title.textContent = config.title;

        const desc = document.createElement('div');
        desc.classList.add('sd-description');
        desc.textContent = config.description;

        contentEl.append(title, desc);
      }

      else if (type === 'confirm') {
        this.dialog.classList.add('sd-confirm');

        const desc = document.createElement('div');
        desc.classList.add('sd-description');
        desc.textContent = config.description;

        contentEl.appendChild(desc);
      }

      else if (type === 'list-selector') {
        this.dialog.classList.add('sd-list');

        const list = document.createElement('div');
        list.classList.add('sd-list-container');

        const multiple = !!config.multiple;

        config.list_items.forEach((item, index) => {
          const el = document.createElement('div');
          el.classList.add('sd-list-item');

          if (item.icon) {
            const img = document.createElement('img');
            img.classList.add('sd-list-icon');
            img.src = item.icon;
            el.appendChild(img);
          }

          const data = document.createElement('div');
          data.classList.add('sd-list-data');
          if (item.text) {
            const text = document.createElement('div');
            text.classList.add('sd-list-text');
            text.textContent = item.text;
            data.appendChild(text);
          }

          if (item.description) {
            const desc = document.createElement('div');
            desc.classList.add('sd-list-description');
            desc.textContent = item.description;
            data.appendChild(desc);
          }
          el.appendChild(data);

          el.addEventListener('click', () => {
            el.classList.toggle('selected');

            if (multiple) {
              if (selectedIndexes.includes(index)) {
                selectedIndexes = selectedIndexes.filter(i => i !== index);
              } else {
                selectedIndexes.push(index);
              }
            } else {
              selectedIndexes = [index];

              list.querySelectorAll('.sd-list-item').forEach(i => {
                if (i !== el) i.classList.remove('selected');
              });
            }
          });

          list.appendChild(el);
        });

        contentEl.appendChild(list);
      }

      else {
        throw new Error('Unknown dialog type');
      }

      const buttons = config.buttons || [
        { type: 'primary', label: 'OK' },
        { type: 'cancel', label: 'Cancel' }
      ];

      buttons.forEach(btn => {
        const button = document.createElement('button');
        button.classList.add('sd-button', `sd-${btn.type}`);
        button.textContent = btn.label;

        if (btn.type === 'primary') primaryBtn = button;
        if (btn.type === 'cancel') cancelBtn = button;

        button.addEventListener('click', () => {
          this.dialog.close();

          let result = null;
          if (btn.type === 'primary') result = true;
          if (btn.type === 'secondary') result = false;
          if (btn.type === 'cancel') result = null;

          if (type === 'list-selector' && btn.type === 'primary') {
            resolve({
              value: result,
              selected: selectedIndexes.map(i => config.list_items[i])
            });
          } else {
            resolve(result);
          }
        });

        actionsEl.appendChild(button);
      });

      this.content.append(contentEl, actionsEl);
      this.dialog.showModal();

      setTimeout(() => {
        if (primaryBtn) primaryBtn.focus();
      }, 0);

      const keyHandler = (e) => {
        if (e.key === 'Enter') {
          if (primaryBtn) {
            e.preventDefault();
            primaryBtn.click();
          }
        }

        if (e.key === 'Escape') {
          if (cancelBtn) {
            e.preventDefault();
            cancelBtn.click();
          } else {
            this.dialog.close();
            resolve(null);
          }
        }
      };

      this.dialog.addEventListener('keydown', keyHandler);
    });
  }
}

// tooltips


// context menu

class SystemContextMenu {
  static instance = new SystemContextMenu();

  constructor() {
    this.menus = [];
    this.currentMenu = null;
    this.boundContextHandler = this.#handleContextMenu.bind(this);
    this.boundClickHandler = this.#handleOutsideClick.bind(this);
    this.boundKeyHandler = this.#handleKeydown.bind(this);

    document.addEventListener('contextmenu', this.boundContextHandler);
    document.addEventListener('click', this.boundClickHandler);
    document.addEventListener('keydown', this.boundKeyHandler);
    // window.addEventListener('blur', () => this.close());
  }

  static init(configs = []) {
    this.instance.register(configs);
  }

  register(configs = []) {
    this.menus.push(...configs);
  }

  close() {
    if (!this.currentMenu) return;

    this.currentMenu.remove();
    this.currentMenu = null;
  }

  #handleContextMenu(e) {
    const match = this.#findMatchingContext(e.target);

    if (!match) {
      this.close();
      return;
    }

    e.preventDefault();

    this.close();

    const menu = this.#createMenu(match.actions, match.element);

    document.body.appendChild(menu);

    this.currentMenu = menu;

    const { innerWidth, innerHeight } = window;
    const rect = menu.getBoundingClientRect();

    let x = e.clientX;
    let y = e.clientY;

    if (x + rect.width > innerWidth) {
      x = innerWidth - rect.width - 8;
    }

    if (y + rect.height > innerHeight) {
      y = innerHeight - rect.height - 8;
    }

    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
  }

  #handleOutsideClick(e) {
    if (!this.currentMenu) return;

    if (!this.currentMenu.contains(e.target)) {
      this.close();
    }
  }

  #handleKeydown(e) {
    if (e.key === 'Escape') {
      this.close();
    }
  }

  #findMatchingContext(target) {
    for (const menu of this.menus) {
      const selector = `[data-context="${menu['data-context']}"]`;
      const element = target.closest(selector);

      if (element) {
        return {
          ...menu,
          element
        };
      }
    }

    return null;
  }

  #createMenu(actions, contextElement) {
    const menu = document.createElement('div');
    menu.classList.add('scm-menu');

    actions.forEach(action => {
      if (typeof action === 'object' && Array.isArray(action.actions)) {
        const submenuWrapper = document.createElement('div');
        submenuWrapper.classList.add('scm-submenu-wrapper');

        const submenuButton = document.createElement('button');
        submenuButton.classList.add('scm-item', 'scm-submenu-button');
        submenuButton.textContent = action.label;

        const submenu = this.#createMenu(action.actions, contextElement);
        submenu.classList.add('scm-submenu');

        submenuWrapper.append(submenuButton, submenu);

        submenuButton.addEventListener('mouseenter', () => {
          submenu.style.display = 'flex';

          const rect = submenu.getBoundingClientRect();

          if (rect.right > window.innerWidth) {
            submenu.style.left = 'auto';
            submenu.style.right = '100%';
          }
        });

        submenuWrapper.addEventListener('mouseleave', () => {
          submenu.style.display = 'none';
        });

        menu.appendChild(submenuWrapper);

        return;
      }

      const item = document.createElement('button');
      item.classList.add('scm-item');
      item.textContent = action.label;

      item.addEventListener('click', () => {
        this.close();

        if (typeof action.fn === 'function') {
          action.fn(contextElement);
        }
      });

      menu.appendChild(item);
    });

    return menu;
  }
}