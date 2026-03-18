from behave import given, when, then
from common import NixOSNamespace

@when("the user performs {gesture}")
def play_gesture(context, gesture):
    nixos = NixOSNamespace(context)
    nixos.libinput_play(gesture + ".yaml")
