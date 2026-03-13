from behave import given, when, then
from common import unpack

@when("the machine starts")
def machine_boot(context):
    nixos = unpack(context)
    # no-op: our test template starts the machine already

@then("the machine should reach graphics")
def graphical_target(context):
    nixos = unpack(context)
    nixos.machine.wait_for_unit("graphical.target")
