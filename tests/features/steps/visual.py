from behave import given, when, then
from pathlib import Path

import cv2
import numpy as np

@given("a {kind} window with ID \"{id}\"")
def gtk_stream_spawn_wayland(context, kind, id):
    use_x11 = False
    scratch = False
    if "Wayland" in kind:
        use_x11 = False
    elif "X11" in kind:
        use_x11 = True

    if "scratch" in kind:
        scratch = True
    elif "tiled" in kind:
        scratch = False

    app = context.nixos.create_app(id, use_x11, scratch)
    win = context.nixos.create_widget("window", "win1", [
        context.nixos.create_widget("button", "btn1", [
            context.nixos.create_widget("label", "lbl1", text="Hello!")
        ])
    ])
    app.add(win)


@then("the screen should match {image}")
def scrcompare_simple(context, image):
    screen = context.nixos.screenshot()
    template = cv2.imread(Path(context.config.base_dir).parent.resolve() / "screenshots" / f"{image}.png")

    res = cv2.matchTemplate(screen, template, cv2.TM_CCOEFF_NORMED)
    threshold = 0.80
    loc = np.where(res >= threshold)

    assert len(loc[0]) > 0, "No match found."
