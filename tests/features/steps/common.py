from types import SimpleNamespace
from pathlib import Path

def unpack(context):
    ''' Shortcut to SimpleNamespace, helps unpack our NixOS test objects from the
    userdata dict.
    '''
    return SimpleNamespace(**context.config.userdata)

def libinput_play(recording, nixos):
    ''' Play the specified libinput recording file.
    '''
    recordFile = Path().resolve() / "recordings" / recording
    nixos.machine.succeed("libinput replay --once --replay-after 0 %s" %recordFile)
