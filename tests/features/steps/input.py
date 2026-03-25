from behave import given, when, then
from time import sleep

@when("the user performs {gesture}")
def play_gesture(context, gesture):
    context.nixos.libinput_play(gesture + ".yaml")
    # Wait for frames to settle on slow systems
    sleep(1)
