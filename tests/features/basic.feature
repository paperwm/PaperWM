Feature: The test machine starts

    Basic scenario to make sure our virtual machine actually starts.
    Demonstrates what a NixOS test in this repository looks like in practice.

    Scenario: The test machine starts
        When the machine starts
        Then the machine should reach graphics

    Scenario: Three finger swipe (stub)
        When the user performs three-finger-swipe
