from behave import given, when, then
from pathlib import Path

import cv2
import numpy as np

@then("the screen should match {image}")
def scrcompare_simple(context, image):
    screen = context.nixos.screenshot()
    template = cv2.imread(Path(context.config.base_dir).parent.resolve() / "screenshots" / f"{image}.png")

    res = cv2.matchTemplate(screen, template, cv2.TM_CCOEFF_NORMED)
    threshold = 0.80
    loc = np.where(res >= threshold)

    assert len(loc[0]) > 0, "No match found."
