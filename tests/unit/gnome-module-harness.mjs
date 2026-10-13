import fs from 'node:fs/promises';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';

function syntheticModule(context, identifier, exports) {
    const names = Object.keys(exports);
    return new vm.SyntheticModule(names, function initialise() {
        for (const [name, value] of Object.entries(exports))
            this.setExport(name, value);
    }, { context, identifier });
}

export async function loadGnomeModule(filePath, mocks, globals = {}, testExports = '') {
    const context = vm.createContext({
        console,
        ...globals,
    });
    const source = await fs.readFile(filePath, 'utf8') + testExports;
    const identifier = pathToFileURL(filePath).href;
    const module = new vm.SourceTextModule(source, {
        context,
        identifier,
    });
    const dependencies = new Map();

    await module.link(specifier => {
        if (!Object.hasOwn(mocks, specifier))
            throw new Error(`Missing mock module: ${specifier}`);

        if (!dependencies.has(specifier)) {
            dependencies.set(specifier, syntheticModule(
                context,
                `${identifier}#mock:${specifier}`,
                mocks[specifier]
            ));
        }
        return dependencies.get(specifier);
    });

    await module.evaluate();
    return module.namespace;
}
