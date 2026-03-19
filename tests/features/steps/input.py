from behave import given, when, then

@when("the user performs {gesture}")
def play_gesture(context, gesture):
    context.nixos.libinput_play(gesture + ".yaml")
