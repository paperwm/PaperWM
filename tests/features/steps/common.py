from types import SimpleNamespace
from pathlib import Path

class NixOSNamespace(SimpleNamespace):
    ''' Derived version of SimpleNamespace, helps unpack our NixOS test objects
    and add utility functions for commonly used test steps.
    '''

    def __init__(self, context):
        self.__dict__.update(**context.config.userdata)
        self._base_dir = Path(context.config.base_dir).parent.resolve()

    def _gjs_cmdline(self, code):
        SHELL_DBUS = "org.gnome.Shell"
        SHELL_OBJECT = "/org/gnome/Shell"
        EVAL_DBUS = "org.gnome.Shell.Eval"
        code_full = f''' paperwm = Main.extensionManager.lookup("paperwm@paperwm.github.com").stateObj; {code} '''
        esc_code = code_full.replace('"', '\\"').replace('`', '\\`')
        return f"sudo -u user gdbus call -a unix:path=/run/user/1000/bus -d {SHELL_DBUS} --object-path {SHELL_OBJECT} --method {EVAL_DBUS} \"{esc_code}\""

    def libinput_play(self, recording):
        ''' Play the specified libinput recording file.
        '''
        recordFile = self._base_dir / "recordings" / recording
        self.machine.succeed("libinput replay --once --replay-after 0 %s" %recordFile)

    def gjs_eval(self, code):
        ''' Execute the specified GJS code from within the GNOME Shell process.
        '''
        return self.machine.succeed(self._gjs_cmdline(code))

    def wait_for_paperwm(self):
        ''' Wait until GNOME Shell is able to yield PaperWM internal state.
        '''
        return self.machine.wait_until_succeeds(self._gjs_cmdline('paperwm.findModule("tiling").spaces._initDone'))
