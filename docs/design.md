# Ozone design guidelines

root colors
- backgrounds: one, two, three
- regions: four, five, highone, highlight
- text and symbols: hightext, highdark, text

backgrounds
- UI layout should fill all points in screen at a very high zoom
- backgrounds use `one`.

panes
- stationary panes use `two`.
- `three` can be used as background for stationary buttons.
- For better themes, use flat design. No always on box shadow.

interactive regions
- Use `four` and `five` for action buttons, or interactive regions as they are *lighter*.
- `highone` is used for a *dark* yet active interactive region
    - text on `highone` should be `hightext` which is *light*.
- `highlight` is used for a prominent interactive region. it is *light*.
    - text on `highlight` should be `highdark`.
- For discouraged buttons, use `inherit` bg and `highlight` as color, with a border of `highdark`
- Disabled buttons, use filter saturation 0. and x cursor.

borders
- `three` can be used as border for panes with background as `two`.
- border weight is *1px solid*.
- border radiuses
    - panes inside `one`: 1em
    - singular primary interactive elements on pane: 1.5em (pill)
    - dynamic button group elements: .5em
    - sidebar buttons: .5em
    - panes group between elements inside `one`: .5em

padding
- text buttons: .7em 1.3em 
- sidebar text icon buttons: .7em
- sidebar text buttons: .7em 1.3em

gap
- pane items: .2em
- button group items: .5em
- navigations, bar items: 0
- separate panes: 1em

interactions
- items on hover: brightness 120%
- items on active: brightness 80%
- items on focus: highlight outline

headers and labels
- padding x: same as the padding of the target pane
- padding y: .5em to bottom and 1.5em to top
