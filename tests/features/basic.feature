Feature: The test machine starts

    Basic scenario to make sure our virtual machine actually starts.
    Demonstrates what a NixOS test in this repository looks like in practice.

    Scenario: The test machine starts
        When the machine starts
        Then the machine should reach graphics

    @fixture.shell
    Scenario: Three finger swipe (stub)
        Given a Wayland window with ID "hello"
        When the user performs three-finger-swipe
        Then the screen should match basic
