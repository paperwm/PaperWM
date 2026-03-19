from steps.common import NixOSNamespace

def before_all(context):
    ''' Wait until PaperWM is actually running
    '''
    print("Waiting for PaperWM...")
    nixos = NixOSNamespace(context)
    nixos.wait_for_paperwm()
