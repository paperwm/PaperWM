from behave import given, when, then
from common import unpack, libinput_play

@when("the user performs {gesture}")
def play_gesture(context, gesture):
    nixos = unpack(context)
    libinput_play(gesture + ".yaml", nixos)
