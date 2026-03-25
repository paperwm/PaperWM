{ pkgs, defaultConfig
, testsDir ? ./.
, featureName
, ... }@opts:

{
  name = featureName;
  nodes = { machine = defaultConfig; };

  extraPythonPackages = p: with p; [ behave opencv-python allure-behave ];

  skipTypeCheck = true;

  testScript = ''
    from behave.configuration import Configuration
    from behave.__main__ import run_behave

    conf = Configuration("${testsDir}/features/${featureName}", userdata = driver.test_symbols())
    conf.format = [ "allure_behave.formatter:AllureFormatter", "pretty" ]
    conf.outputs = []
    conf.setup_outputs(['allure_output'])
    start_all()
    exit(run_behave(conf))
  '';
} // (pkgs.lib.filterAttrs (n: v: n != "pkgs" && n != "defaultConfig" && n != "testsDir" && n != "featureName") opts)
