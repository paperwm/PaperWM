import St from 'gi://St';

import { Utils, Tiling } from './imports.js';

let fitProportionally = Tiling.fitProportionally;
let prefs = {
    window_gap: 5,
    minimum_margin: 3,
};

let virtStage = null;

export function repl() {
    if (virtStage) {
        virtStage.destroy();
    }

    let realMonitor = space.monitor;
    let scale = 0.10;
    let padding = 10;
    const monitorWidth = realMonitor.width * scale;
    const monitorHeight = realMonitor.height * scale;
    let stageStyle = 'background-color: white;';
    virtStage = new St.Widget({
        name: 'stage',
        style: stageStyle,
        height: monitorHeight + padding * 2,
        width: monitorWidth * 3,
    });

    let monitorStyle = `background-color: blue;`;
    let monitor = new St.Widget({
        name: "monitor0",
        style: monitorStyle,
        x: virtStage.width / 2 - monitorWidth / 2, y: padding,
        width: monitorWidth,
        height: virtStage.height - padding * 2,
    });

    let panel = new St.Widget({
        name: "panel",
        style: `background-color: gray`,
        x: 0, y: 0,
        width: monitor.width,
        height: 10,

    });
    let workArea = {
        x: monitor.x,
        y: panel.height,
        width: monitor.width,
        height: monitor.height - panel.height,
    };

    let tilingStyle = `background-color: rgba(190, 190, 0, 0.3);`;
    let tilingContainer = new St.Widget({ name: "tiling", style: tilingStyle });

    global.stage.add_child(virtStage);
    virtStage.x = 3000;
    virtStage.y = 300;

    virtStage.add_child(monitor);
    monitor.add_child(panel);
    monitor.add_child(tilingContainer);

    function sync(space_ = space) {
        let columns = layout(
            fromSpace(space_, scale),
            workArea,
            prefs
        );
        renderAndView(
            tilingContainer,
            columns
        );
        tilingContainer.x = space_.targetX * scale;
    }

    sync();

    Utils.printActorTree(virtStage, Utils.mkFmt({ nameOnly: true }));

    movecolumntoviewportposition(tilingContainer, monitor, columns[1][0], 30);

    virtStage.hide();
    virtStage.show();
    virtStage.y = 400;
}

/** tiling position given:
    m_s: monitor position
    w_m: window position (relative to monitor)
    w_t: window position (relative to tiling)
 */
export function t_s(m_s, w_m, w_t) {
    return w_m - w_t + m_s;
}

/**
   Calculates the tiling position such that column `k` is positioned at `x`
   relative to the viewport (or workArea?)
 */
export function movecolumntoviewportposition(tilingActor, viewport, window, x) {
    tilingActor.x = t_s(viewport.x, x, window.x);
}

export function renderAndView(container, columns) {
    for (let child of container.get_children()) {
        child.destroy();
    }

    render(columns, container);
}

export function fromSpace(space, scale = 1) {
    return space.map(
        col => col.map(
            metaWindow => {
                let f = metaWindow.get_frame_rect();
                return {
                    width: f.width * scale,
                    height: f.height * scale,
                };
            }
        )
    );
}

/** Render a dummy view of the windows */
export function render(columns, tiling) {
    const windowStyle = `border: black solid 1px; background-color: red`;

    function createWindowActor(window) {
        return new St.Widget({
            style: windowStyle,
            width: window.width,
            height: window.height,
            x: window.x,
            y: window.y,
        });
    }

    for (let col of columns) {
        for (let window of col) {
            let windowActor = createWindowActor(window);
            tiling.add_child(windowActor);
        }
    }
}

export function allocateDefault(column, availableHeight, preAllocatedWindow) {
    if (column.length === 1) {
        return [availableHeight];
    } else {
        // Distribute available height amongst non-selected windows in proportion to their existing height
        const gap = prefs.window_gap;
        const minHeight = 15;

        const heightOf = window => {
            return window.height;
        };

        const k = preAllocatedWindow && column.indexOf(preAllocatedWindow);
        const selectedHeight = preAllocatedWindow && heightOf(preAllocatedWindow);

        let nonSelected = column.slice();
        if (preAllocatedWindow) {
            nonSelected.splice(k, 1);
        }

        const nonSelectedHeights = nonSelected.map(heightOf);
        let availableForNonSelected = Math.max(
            0,
            availableHeight -
                (column.length - 1) * gap -
                (preAllocatedWindow ? selectedHeight : 0)
        );

        const deficit = Math.max(
            0, nonSelected.length * minHeight - availableForNonSelected);

        let heights = fitProportionally(
            nonSelectedHeights,
            availableForNonSelected + deficit
        );

        if (preAllocatedWindow) {
            heights.splice(k, 0, selectedHeight - deficit);
        }

        return heights;
    }
}

export function allocateEqualHeight(column, available) {
    available -= (column.length - 1) * prefs.window_gap;
    return column.map(_ => Math.floor(available / column.length));
}

export function layoutGrabColumn(column, x, y0, targetWidth, availableHeight, grabWindow) {
    function mosh(windows, height, y0) {
        let targetHeights = fitProportionally(
            windows.map(mw => mw.rect.height),
            height
        );
        let [w, y] = layoutColumnSimple(windows, x, y0, targetWidth, targetHeights);
        return y;
    }

    const k = column.indexOf(grabWindow);
    if (k < 0) {
        throw new Error(`Anchor doesn't exist in column ${grabWindow.title}`);
    }

    const gap = prefs.window_gap;
    const f = grabWindow.globalRect();
    let yGrabRel = f.y - this.monitor.y;
    targetWidth = f.width;

    const H1 = (yGrabRel - y0) - gap - (k - 1) * gap;
    const H2 = availableHeight - (yGrabRel + f.height - y0) - gap - (column.length - k - 2) * gap;
    k > 0 && mosh(column.slice(0, k), H1, y0);
    let y = mosh(column.slice(k, k + 1), f.height, yGrabRel);
    k + 1 < column.length && mosh(column.slice(k + 1), H2, y);

    return targetWidth;
}


export function layoutColumnSimple(windows, x, y0, targetWidth, targetHeights, time) {
    let y = y0;

    for (let i = 0; i < windows.length; i++) {
        let virtWindow = windows[i];
        let targetHeight = targetHeights[i];

        virtWindow.x = x;
        virtWindow.y = y;
        virtWindow.width = targetWidth;
        virtWindow.height = targetHeight;

        y += targetHeight + prefs.window_gap;
    }
    return targetWidth, y;
}


/**
   Mutates columns
 */
export function layout(columns, workArea, prefs, options = {}) {
    let gap = prefs.window_gap;
    let availableHeight = workArea.height;

    let { inGrab, selectedWindow } = options;
    let selectedIndex = -1;

    if (selectedWindow) {
        selectedIndex = columns.findIndex(col => col.includes(selectedWindow));
    }

    let y0 = workArea.y;
    let x = 0;

    for (let i = 0; i < columns.length; i++) {
        let column = columns[i];

        let selectedInColumn = i === selectedIndex ? selectedWindow : null;

        let targetWidth;
        if (i === selectedIndex) {
            targetWidth = selectedInColumn.width;
        } else {
            targetWidth = Math.max(...column.map(w => w.width));
        }
        targetWidth = Math.min(targetWidth, workArea.width - 2 * prefs.minimum_margin);

        if (inGrab && i === selectedIndex) {
            layoutGrabColumn(column, x, y0, targetWidth, availableHeight, selectedInColumn);
        } else {
            let allocator = options.customAllocators && options.customAllocators[i];
            allocator = allocator || allocateDefault;

            let targetHeights = allocator(column, availableHeight, selectedInColumn);
            layoutColumnSimple(column, x, y0, targetWidth, targetHeights);
        }

        x += targetWidth + gap;
    }

    return columns;
}
