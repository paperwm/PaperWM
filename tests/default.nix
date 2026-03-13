{ pkgs ? import <nixpkgs> {}
, system ? builtins.currentSystem
, runTest ? pkgs.testers.nixosTest
, defaultConfig ?
    { ... }: { imports = [ ../vm.nix ]; }
, ... }:

#
# Root file for the set of unit tests on PaperWM. These make use of the NixOS
# unit test framework, and individual tests can be registered as Behave feature
# files.
# Documentation on the unit test framework is available in the NixOS manual:
#
#   https://nixos.org/manual/nixos/stable/index.html#sec-nixos-tests
#

let
  lib = pkgs.lib;

  # Run a single Behave feature file
  behaveTest = featureName: as: runTest
    (import ./template.nix ({ inherit defaultConfig pkgs featureName; } // as));

  allBehaveTests =
    let allBehaveFiles =
          lib.filterAttrs (k: v: lib.hasSuffix ".feature" k && v == "regular")
                          (builtins.readDir ./features);
        testName = s: lib.removeSuffix ".feature" s;
    in builtins.foldl'
        (l: r: l // { "${testName r}" = behaveTest r {}; })
        {} (builtins.attrNames allBehaveFiles);

in allBehaveTests //
{
  # Tests that require a specific system configuration go here
}

# Note: To run an individual unit test automatically (as part of the suite),
# run the following:
#   nix build .#checks.x86_64-linux.(test name)
#
# To debug a test (i.e. run it interactively), the command isn't very different
#   nix run .#checks.x86_64-linux.(test name).driverInteractive

