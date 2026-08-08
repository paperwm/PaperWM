# PaperWM end-to-end tests

Unit tests on PaperWM are carried out using the [test VM](https://github.com/PaperWM/PaperWM/wiki/Using-the-test-VM), a NixOS virtual machine connected to a Python testing harness, and [Behave](https://behave.readthedocs.io), an implementation of the Gherkin unit testing language.

## Layout

### `default.nix` and `template.nix`

These files are NixOS boilerplate code that scan for features in the `features` directory and generate test VMs accordingly. You can use them to register tests that require extra dependencies not found in the base test VM, such as specific misbehaving applications.

### `features`

This is the directory where Behave feature tests and their Python implementations are found. Each `.feature` file maps to a NixOS unit test, which can be overridden in `default.nix` as mentioned above.

The usual testing loop is to record user input from within the VM, and replay them in the order specified in the feature file.

### `recordings`

This directory contains recordings of all input devices in the VM (touchpad, touchscreen, keyboard...), meant to be replayed as-is in the VM by the feature tests. Please only add recordings made from within the test VM.

### `screenshots`

This directory contains predicate screenshots to check against, to determine whether a test was successful.
