{ pkgs, defaultConfig
, testsDir ? ./.
, featureName
, ... }@opts:

{
  name = featureName;
  nodes = { machine = defaultConfig; };

  extraPythonPackages = p: with p; [ behave ];

  skipTypeCheck = true;

  testScript = ''
    from behave.configuration import Configuration
    from behave.__main__ import run_behave

    conf = Configuration("${testsDir}/features/${featureName}", userdata = driver.test_symbols())
    start_all()
    if run_behave(conf) != 0:
      raise AssertionError("One or more Behave features have failed. Check the logs above for details.")
  '';
} // (pkgs.lib.filterAttrs (n: v: n != "pkgs" && n != "defaultConfig" && n != "testsDir" && n != "featureName") opts)
