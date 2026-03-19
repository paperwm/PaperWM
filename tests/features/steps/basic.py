from behave import given, when, then

@when("the machine starts")
def machine_boot(context):
    pass
    # no-op: our test template starts the machine already

@then("the machine should reach graphics")
def graphical_target(context):
    context.nixos.machine.wait_for_unit("graphical.target")
