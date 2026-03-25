from types import SimpleNamespace
from pathlib import Path
from behave import fixture, use_fixture

import allure
import cv2

class NixOSNamespace(SimpleNamespace):
    ''' Derived version of SimpleNamespace, helps unpack our NixOS test objects
    and add utility functions for commonly used test steps.
    '''

    def __init__(self, context):
        self.__dict__.update(**context.config.userdata)
        self._base_dir = Path(context.config.base_dir).parent.resolve()
        self._context = context
        self._last_scr_line = -1
        self._last_scr_id = 0

    def _gjs_cmdline(self, code):
        SHELL_DBUS = "org.gnome.Shell"
        SHELL_OBJECT = "/org/gnome/Shell"
        EVAL_DBUS = "org.gnome.Shell.Eval"
        code_full = f''' let paperwm = Main.extensionManager.lookup("paperwm@paperwm.github.com").stateObj; {code} '''
        esc_code = code_full.replace('"', '\\"').replace('`', '\\`')
        return f"sudo -u user gdbus call -a unix:path=/run/user/1000/bus -d {SHELL_DBUS} --object-path {SHELL_OBJECT} --method {EVAL_DBUS} \"{esc_code}\""

    def libinput_play(self, recording):
        ''' Play the specified libinput recording file.
        '''
        recordFile = self._base_dir / "recordings" / recording
        self.machine.succeed("libinput replay --once --replay-after 0 %s" %recordFile)

    def gjs_eval(self, code):
        ''' Execute the specified GJS code from within the GNOME Shell process.
        Will raise Exception in the event of a GJS error.
        '''
        result = eval(self.machine.succeed(self._gjs_cmdline(code)))
        if result[0]:
            return result[1]
        else:
            raise Exception(result[1])

    def wait_for_paperwm(self):
        ''' Wait until GNOME Shell is able to yield PaperWM internal state.
        '''
        return self.machine.wait_until_succeeds(self._gjs_cmdline('paperwm.findModule("tiling").spaces._initDone') + "| grep \"(true, 'true')\"")

    def screenshot(self):
        ''' Take a screenshot and load it as an OpenCV-compatible representation
        '''
        if self._last_scr_line == self._context.scenario.line:
            self._last_scr_id += 1
        else:
            self._last_scr_line = self._context.scenario.line
            self._last_scr_id = 0

        featname = Path(self._context.config.paths[0]).name[:-len(".feature")]
        filename = f"scr-{featname}-{self._context.scenario.line}_{self._last_scr_id}.png"
        self.machine.screenshot(filename)

        with open(filename, 'rb') as imfile:
            allure.attach(imfile.read(), name=filename, attachment_type=allure.attachment_type.PNG)
        return cv2.imread(filename)

@fixture
def shell(context):
    ''' Wait for PaperWM to start

    ### Wait, why do we need to specify which tests need PaperWM?

    If we want to be able to assume given settings when PaperWM starts, we need
    to have already updated dconf with them by the time GNOME has finished
    loading, meaning the steps altering dconf cannot wait for the Shell.

    The first Scenario should then make configuration assumptions, which the
    rest of the feature will be able to inherit.
    '''
    context.nixos.wait_for_paperwm()

def before_tag(context, tag):
    if tag == "fixture.shell":
        use_fixture(shell, context)

def before_all(context):
    ''' Populate the context with NixOS test objects
    '''
    context.nixos = NixOSNamespace(context)
