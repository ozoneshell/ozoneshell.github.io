const UI = {
  cardHeader: document.querySelector(".cardHeader"),
  configHeader: document.querySelector(".configHeader"),
  miscHeader: document.querySelector(".miscHeader"),
  configBtnHeader: document.querySelector(".configBtnHeader"),
  mainDataBox: document.querySelector("#main_data_box"),
  btnContainer: document.querySelector(".btns")
};

const Screens = {
  installation: {
    requiredParams: ["packageId"],

    mount(params) {
      console.log("installation screen init", params);
    },

    visible: ["cardHeader", "mainDataBox", "btnContainer"],

    buttons: [
      {
        label: "Cancel",
        onClick(params) {
          console.log("cancel install", params);
        }
      },
      {
        label: "Install",
        onClick(params) {
          console.log("install package", params.packageId);
        }
      }
    ]
  },

  escalation: {
    requiredParams: ["level"],

    mount(params) {
      console.log("escalation init", params);
    },

    visible: ["cardHeader", "mainDataBox", "btnContainer"],

    buttons: [
      {
        label: "Cancel",
        onClick(params) {
          console.log("cancel escalation", params);
        }
      },
      {
        label: "Allow",
        onClick(params) {
          console.log("allow escalation level", params.level);
        }
      }
    ]
  },

  config: {
    requiredParams: [],

    mount(params) {
      createConfigButtons(params);
      openConfigPage("inst", params);
    },

    visible: [
      "configHeader",
      "configBtnHeader",
      "mainDataBox",
      "btnContainer"
    ],

    buttons: [
      {
        label: "Cancel",
        onClick(params) {
          console.log("config cancel", params);
        }
      },
      {
        label: "Save changes",
        onClick(params) {
          console.log("save config", params.configId);
        }
      }
    ]
  },

  confirmation: {
    requiredParams: [],

    mount(params) {
      console.log("confirmation init", params);
    },

    visible: ["miscHeader", "mainDataBox", "btnContainer"],

    buttons: [
      {
        label: "Cancel",
        onClick() {
          console.log("cancel confirmation");
        }
      },
      {
        label: "Proceed",
        onClick() {
          console.log("proceed confirmation");
        }
      }
    ]
  }
};

function hideAll() {
  for (const key in UI) {
    const el = UI[key];
    if (el) el.style.display = "none";
  }
}

function validateParams(screen, params) {
  const required = screen.requiredParams || [];
  for (const key of required) {
    if (!(key in params)) {
      throw new Error(`Missing required param: ${key}`);
    }
  }
}

function showScreen(name, params) {
  const screen = Screens[name];
  if (!screen) throw new Error("Invalid screen: " + name);

  validateParams(screen, params);

  hideAll();

  for (const key of screen.visible) {
    const el = UI[key];
    if (el) el.style.display = "";
  }

  const buttons = UI.btnContainer.querySelectorAll("button");

  buttons.forEach((btn, i) => {
    const cfg = screen.buttons[i];

    if (!cfg) {
      btn.style.display = "none";
      btn.onclick = null;
      return;
    }

    btn.style.display = "";
    btn.textContent = cfg.label;

    btn.onclick = () => cfg.onClick(params);
  });

  if (screen.mount) {
    screen.mount(params);
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  const params = (await api.params) || {};

  const screenType = params.type || "config";

  showScreen(screenType, params);
});

const ConfigPages = {
  inst: {
    title: "Instance",
    render() {
      return `instance setting`;
    }
  },

  hdlr: {
    title: "Handlers",
    render() {
      return `handlers setting`;
    }
  },

  abut: {
    title: "About",
    render() {
      return `<h2>Ozone Shell</h2>
      <p>Client side shared webapp runtime framework,<br>
      HTML, Vanilla JS, CSS.<br><br>
      Built and maintained by <a href="https://github.com/adthoughtsglobal">darkdot</a>.<br>
      <a href="https://github.com/ozoneshell/ozoneshell.github.io">Source Code</a> &bull; Open Source (MPL-2.0) <br><br>
      Thanks to the community for their support!<br>
      Thank you for using this Ozone Shell Instance<br>
      </p>

      `;
    }
  }
};
function openConfigPage(page, params) {
  const configPage = ConfigPages[page];

  document
    .querySelectorAll(".configBtn")
    .forEach(btn => btn.classList.remove("active"));

  const activeBtn = UI.configBtnHeader.querySelector(
    `[data-page="${page}"]`
  );

  if (activeBtn) {
    activeBtn.classList.add("active");
  }

  if (!configPage) {
    UI.mainDataBox.innerHTML = `
      <div class="configPage">
        <h2>Not Found</h2>
      </div>
    `;
    return;
  }

  UI.mainDataBox.innerHTML = configPage.render(params);
}

function createConfigButtons(params) {
  UI.configBtnHeader.innerHTML = "";

  for (const [id, page] of Object.entries(ConfigPages)) {
    const btn = document.createElement("button");

    btn.className = "configBtn";
    btn.dataset.page = id;
    btn.textContent = page.title;

    btn.onclick = () => openConfigPage(id, params);

    UI.configBtnHeader.appendChild(btn);
  }
}