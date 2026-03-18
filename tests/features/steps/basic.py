from behave import given, when, then
from common import NixOSNamespace

@when("the machine starts")
def machine_boot(context):
    nixos = NixOSNamespace(context)
    # no-op: our test template starts the machine already

@then("the machine should reach graphics")
def graphical_target(context):
    nixos = NixOSNamespace(context)
    nixos.machine.wait_for_unit("graphical.target")
