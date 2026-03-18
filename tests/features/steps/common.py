from types import SimpleNamespace
from pathlib import Path

class NixOSNamespace(SimpleNamespace):
    ''' Derived version of SimpleNamespace, helps unpack our NixOS test objects
    and add utility functions for commonly used test steps.
    '''

    def __init__(self, context):
        self.__dict__.update(**context.config.userdata)

    def libinput_play(self, recording):
        ''' Play the specified libinput recording file.
        '''
        recordFile = Path().resolve() / "recordings" / recording
        self.machine.succeed("libinput replay --once --replay-after 0 %s" %recordFile)

    def gjs_eval(self, code):
        ''' Execute the specified GJS code from within the GNOME Shell process.
        '''
        SHELL_DBUS = "org.gnome.Shell"
        SHELL_OBJECT = "/org/gnome/Shell"
        EVAL_DBUS = "org.gnome.Shell.Eval"
        esc_code = code.replace('"', '\\"')
        self.machine.succeed(f"gdbus call --session {SHELL_DBUS} --object-path {SHELL_OBJECT} --method {EVAL_DBUS} \"{code}\"")
