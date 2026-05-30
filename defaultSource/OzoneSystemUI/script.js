const UI = {
  cardHeader: document.querySelector(".cardHeader"),
  configHeader: document.querySelector(".configHeader"),
  miscHeader: document.querySelector(".miscHeader"),
  configBtnHeader: document.querySelector(".configBtnHeader"),
  mainDataBox: document.querySelector("#main_data_box"),
  btnContainer: document.querySelector(".btns")
};

const SCREENS = {
  installation: {
    visible: ["cardHeader", "mainDataBox", "btnContainer"],
    buttons: [
      { label: "Cancel", action: "cancel" },
      { label: "Install", action: "install" }
    ]
  },

  escalation: {
    visible: ["cardHeader", "mainDataBox", "btnContainer"],
    buttons: [
      { label: "Cancel", action: "cancel" },
      { label: "Allow", action: "allow" }
    ]
  },

  config: {
    visible: ["configHeader", "configBtnHeader", "mainDataBox", "btnContainer"],
    buttons: [
      { label: "Cancel", action: "cancel" },
      { label: "Save changes", action: "save" }
    ]
  },

  confirmation: {
    visible: ["miscHeader", "mainDataBox", "btnContainer"],
    buttons: [
      { label: "Cancel", action: "cancel" },
      { label: "Proceed", action: "proceed" }
    ]
  }
};

function hideAll() {
  for (const key in UI) {
    const el = UI[key];
    if (el) el.style.display = "none";
  }
}

function render(mode) {
  const config = SCREENS[mode];
  if (!config) return;

  hideAll();

  for (const key of config.visible) {
    const el = UI[key];
    if (el) el.style.display = "";
  }

  const buttons = UI.btnContainer.querySelectorAll("button");

  buttons.forEach((btn, i) => {
    const cfg = config.buttons[i];

    if (!cfg) {
      btn.style.display = "none";
      return;
    }

    btn.style.display = "";
    btn.textContent = cfg.label;
    btn.dataset.action = cfg.action;
  });
}

UI.btnContainer.addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;

  const action = btn.dataset.action;

  if (action === "cancel") {
    console.log("cancel");
  }

  if (action === "install") {
    console.log("install");
  }

  if (action === "allow") {
    console.log("allow");
  }

  if (action === "save") {
    console.log("save");
  }

  if (action === "proceed") {
    console.log("proceed");
  }
});

render("installation");