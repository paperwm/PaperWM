from behave import given, when, then
from types import SimpleNamespace

@when("the machine starts")
def machine_boot(context):
    nixos = SimpleNamespace(**context.config.userdata)
    # no-op: our test template starts the machine already

@then("the machine should reach graphics")
def graphical_target(context):
    nixos = SimpleNamespace(**context.config.userdata)
    nixos.machine.wait_for_unit("graphical.target")
